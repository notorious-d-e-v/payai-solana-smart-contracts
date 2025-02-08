import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PayaiMarketplace } from "../target/types/payai_marketplace";
import { assert, expect } from "chai";

describe("payai-marketplace", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.PayaiMarketplace as Program<PayaiMarketplace>;

  const globalStateSeed = "global_state";
  const contractSeed = "contract";
  const contractCounterSeed = "buyer_contract_counter";
  const platformFeeSeed = "platform_fee_vault";

  let globalStatePDA;
  let platformFeePDA = anchor.web3.PublicKey.findProgramAddressSync([
    Buffer.from(platformFeeSeed),
  ], program.programId);

  let _currentAdmin;

  it("cannot initialize global state as non-default admin", async () => {
    // airdrop 2 SOL to non-admin
    const nonAdmin = anchor.web3.Keypair.generate();
    await program.provider.connection.confirmTransaction(
      await program.provider.connection.requestAirdrop(
        nonAdmin.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL
      ),
      "confirmed"
    );

    try {
        await program.methods
            .initializeGlobalState()
            .accounts({
              signer: nonAdmin.publicKey,
            })
            .signers([nonAdmin])
            .rpc();

        assert.fail("Expected error not thrown");
    } catch (error) {
        assert.equal(error.error.errorCode.code, "Unauthorized");
    }
  });

  it("initialize global state as default admin", async () => {
    const {data} = await initGlobalStateTestHelper();
    assert.equal(data.admin.toString(), program.provider.wallet.publicKey.toString());
  });

  it ("any buyer can initialize a buyer contract counter", async () => {
    // create a buyer
    const buyer = anchor.web3.Keypair.generate();
    await program.provider.connection.confirmTransaction(
      await program.provider.connection.requestAirdrop(
        buyer.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL
      ),
      "confirmed"
    );

    // initialize buyer's contract counter account
    const {data} = await initBuyerContractCounterTestHelper(buyer);
    assert.equal(data.counter, 0);
  });

  it("a buyer cannot create a buyer contract counter more than once", async () => {
    // create a buyer
    const buyer = anchor.web3.Keypair.generate();
    await program.provider.connection.confirmTransaction(
      await program.provider.connection.requestAirdrop(
        buyer.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL
      ),
      "confirmed"
    );

    // initialize buyer's contract counter account
    await initBuyerContractCounterTestHelper(buyer);

    // try to initialize buyer's contract counter account again
    try {
      await initBuyerContractCounterTestHelper(buyer);
      assert.fail("Expected error not thrown");
    } catch (error) {
      expect(error.toString()).to.include("Allocate: account Address");
      expect(error.toString()).to.include("already in use");
    }
  });

  it("anyone can start a contract", async () => {
    // airdrop 2 SOL to non-admin
    const nonAdmin = anchor.web3.Keypair.generate();
    await program.provider.connection.confirmTransaction(
      await program.provider.connection.requestAirdrop(
        nonAdmin.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL
      ),
      "confirmed"
    );

    // create accounts
    const serviceSeller = anchor.web3.Keypair.generate();

    // initialize buyer's contract counter account
    await initBuyerContractCounterTestHelper(nonAdmin);

    // start contract
    const cid = "QmPK1s3pNYLi9ERiq3BDxKa4XosgWwFRQUydHUtz4YgpqB"
    const payoutAmount = new anchor.BN(1 * anchor.web3.LAMPORTS_PER_SOL);
    const {data: contract} = await startContractTestHelper(cid, serviceSeller.publicKey, payoutAmount, nonAdmin);

    assert.equal(contract.cid, cid);
    assert.equal(contract.seller.toString(), serviceSeller.publicKey.toString());
    assert.equal(
      contract.amount.toString(),
      payoutAmount.toString()
    );
  });

  it("same buyer can start two or more contracts", async () => {
    // airdrop 4 SOL to non-admin
    const nonAdmin = anchor.web3.Keypair.generate();
    await program.provider.connection.confirmTransaction(
      await program.provider.connection.requestAirdrop(
        nonAdmin.publicKey, 4 * anchor.web3.LAMPORTS_PER_SOL
      ),
      "confirmed"
    );

    // create accounts
    const serviceSeller = anchor.web3.Keypair.generate();

    // initialize buyer's contract counter account
    await initBuyerContractCounterTestHelper(nonAdmin);

    // start first contract
    let cid = "QmPK1s3pNYLi9ERiq3BDxKa4XosgWwFRQUydHUtz4YgpqB"
    let payoutAmount = new anchor.BN(1 * anchor.web3.LAMPORTS_PER_SOL);
    let {data: contract} = await startContractTestHelper(cid, serviceSeller.publicKey, payoutAmount, nonAdmin);

    assert.equal(contract.cid, cid);
    assert.equal(contract.seller.toString(), serviceSeller.publicKey.toString());
    assert.equal(
      contract.amount.toString(),
      payoutAmount.toString()
    );

    // start another contract
    cid = "QmPK1s3pNYLi9ERiq3BDxKa4XosgWwFRQUydHUtz4YgpqC"
    payoutAmount = new anchor.BN(2 * anchor.web3.LAMPORTS_PER_SOL);
    contract = (await startContractTestHelper(cid, serviceSeller.publicKey, payoutAmount, nonAdmin)).data;

    assert.equal(contract.cid, cid);
    assert.equal(contract.seller.toString(), serviceSeller.publicKey.toString());
    assert.equal(
      contract.amount.toString(),
      payoutAmount.toString()
    );
  });

  it("buyer can release payment to seller", async () => {
    // airdrop 4 SOL to buyer
    const buyer = anchor.web3.Keypair.generate();
    await program.provider.connection.confirmTransaction(
      await program.provider.connection.requestAirdrop(
        buyer.publicKey, 4 * anchor.web3.LAMPORTS_PER_SOL
      ),
      "confirmed"
    );

    // create accounts
    const serviceSeller = anchor.web3.Keypair.generate();

    // initialize buyer's contract counter account
    await initBuyerContractCounterTestHelper(buyer);

    // start contract
    const cid = "QmPK1s3pNYLi9ERiq3BDxKa4XosgWwFRQUydHUtz4YgpqB";
    const payoutAmount = new anchor.BN(1 * anchor.web3.LAMPORTS_PER_SOL);
    const {pda: contractPDA} = await startContractTestHelper(cid, serviceSeller.publicKey, payoutAmount, buyer);

    // seller's balance before payment release
    const sellerBalanceBefore = await program.provider.connection.getBalance(serviceSeller.publicKey);

    // release payment
    await program.methods
      .releasePayment()
      .accounts({
        signer: buyer.publicKey,
        seller: serviceSeller.publicKey,
        contract: contractPDA,
        globalState: globalStatePDA,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([buyer])
      .rpc();

    // check if payment is released
    const updatedContract = await program.account.contract.fetch(contractPDA);
    assert.isTrue(updatedContract.isReleased);

    // assert that the seller's balance has increased
    const sellerBalanceAfter = await program.provider.connection.getBalance(serviceSeller.publicKey);
    const globalState = await program.account.globalState.fetch(globalStatePDA);
    assert.equal(
      sellerBalanceAfter - sellerBalanceBefore,
      payoutAmount * (100 - globalState.sellerFeePct) / 100
    );
  });

  it("admin can release payment to seller", async () => {
    // airdrop 4 SOL to buyer
    const buyer = anchor.web3.Keypair.generate();
    await program.provider.connection.confirmTransaction(
      await program.provider.connection.requestAirdrop(
        buyer.publicKey, 4 * anchor.web3.LAMPORTS_PER_SOL
      ),
      "confirmed"
    );

    // create accounts
    const serviceSeller = anchor.web3.Keypair.generate();

    // initialize buyer's contract counter account
    await initBuyerContractCounterTestHelper(buyer);

    // start contract
    const cid = "QmPK1s3pNYLi9ERiq3BDxKa4XosgWwFRQUydHUtz4YgpqB";
    const payoutAmount = new anchor.BN(1 * anchor.web3.LAMPORTS_PER_SOL);
    const {pda: contractPDA} = await startContractTestHelper(cid, serviceSeller.publicKey, payoutAmount, buyer);

    // seller's balance before payment release
    const sellerBalanceBefore = await program.provider.connection.getBalance(serviceSeller.publicKey);

    // release payment by admin
    await program.methods
      .releasePayment()
      .accounts({
        signer: program.provider.wallet.publicKey,
        seller: serviceSeller.publicKey,
        contract: contractPDA,
        globalState: globalStatePDA,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([])
      .rpc();

    // check if payment is released
    const updatedContract = await program.account.contract.fetch(contractPDA);
    assert.isTrue(updatedContract.isReleased);

    // assert that the seller's balance has increased
    const sellerBalanceAfter = await program.provider.connection.getBalance(serviceSeller.publicKey);
    const globalState = await program.account.globalState.fetch(globalStatePDA);
    assert.equal(
      sellerBalanceAfter - sellerBalanceBefore,
      payoutAmount * (100 - globalState.sellerFeePct) / 100
    );
  });

  it("admin can refund buyer", async () => {
    // airdrop 4 SOL to buyer
    const buyer = anchor.web3.Keypair.generate();
    await program.provider.connection.confirmTransaction(
      await program.provider.connection.requestAirdrop(
        buyer.publicKey, 4 * anchor.web3.LAMPORTS_PER_SOL
      ),
      "confirmed"
    );

    // create accounts
    const serviceSeller = anchor.web3.Keypair.generate();

    // initialize buyer's contract counter account
    await initBuyerContractCounterTestHelper(buyer);

    // start contract
    const cid = "QmPK1s3pNYLi9ERiq3BDxKa4XosgWwFRQUydHUtz4YgpqB";
    const payoutAmount = new anchor.BN(1 * anchor.web3.LAMPORTS_PER_SOL);
    const {pda: contractPDA} = await startContractTestHelper(cid, serviceSeller.publicKey, payoutAmount, buyer);

    // buyer's balance before refund
    const buyerBalanceBefore = await program.provider.connection.getBalance(buyer.publicKey);

    // refund buyer by admin
    await program.methods
      .refundBuyer()
      .accounts({
        signer: program.provider.wallet.publicKey,
        buyer: buyer.publicKey,
        contract: contractPDA,
        globalState: globalStatePDA,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([])
      .rpc();

    // assert that the buyer's balance has increased
    const buyerBalanceAfter = await program.provider.connection.getBalance(buyer.publicKey);
    const globalState = await program.account.globalState.fetch(globalStatePDA);
    const buyerFeePlusPayout = payoutAmount.add(payoutAmount.mul(new anchor.BN(globalState.buyerFeePct)).div(new anchor.BN(100)));
    assert.equal(
      buyerBalanceAfter - buyerBalanceBefore,
      buyerFeePlusPayout
    );
  });

  it("non-admin cannot refund buyer", async () => {
    // airdrop 4 SOL to buyer
    const buyer = anchor.web3.Keypair.generate();
    await program.provider.connection.confirmTransaction(
      await program.provider.connection.requestAirdrop(
        buyer.publicKey, 4 * anchor.web3.LAMPORTS_PER_SOL
      ),
      "confirmed"
    );

    // create accounts
    const serviceSeller = anchor.web3.Keypair.generate();

    // initialize buyer's contract counter account
    await initBuyerContractCounterTestHelper(buyer);

    // start contract
    const cid = "QmPK1s3pNYLi9ERiq3BDxKa4XosgWwFRQUydHUtz4YgpqB";
    const payoutAmount = new anchor.BN(1 * anchor.web3.LAMPORTS_PER_SOL);
    const {pda: contractPDA} = await startContractTestHelper(cid, serviceSeller.publicKey, payoutAmount, buyer);

    // airdrop 2 SOL to non-admin
    const nonAdmin = anchor.web3.Keypair.generate();
    await program.provider.connection.confirmTransaction(
      await program.provider.connection.requestAirdrop(
        nonAdmin.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL
      ),
      "confirmed"
    );

    // try to refund buyer by non-admin
    try {
      await program.methods
        .refundBuyer()
        .accounts({
          signer: nonAdmin.publicKey,
          buyer: buyer.publicKey,
          contract: contractPDA,
          globalState: globalStatePDA,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([nonAdmin])
        .rpc();

      assert.fail("Expected error not thrown");
    } catch (error) {
      assert.equal(error.error.errorCode.code, "Unauthorized");
    }
  });

  it("can update the admin", async () => {
    // airdrop 2 SOL to new admin
    const newAdmin = anchor.web3.Keypair.generate();
    await program.provider.connection.confirmTransaction(
      await program.provider.connection.requestAirdrop(
        newAdmin.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL
      ),
      "confirmed"
    );

    // update admin
    await program.methods
      .updateAdmin(newAdmin.publicKey)
      .accounts({
        signer: program.provider.wallet.publicKey,
        globalState: globalStatePDA,
      })
      .signers([])
      .rpc();
    _currentAdmin = newAdmin;

    // fetch the updated global state
    const globalState = await program.account.globalState.fetch(globalStatePDA);
    assert.equal(globalState.admin.toString(), newAdmin.publicKey.toString());
  });

  it("old admin can no longer call protected functions after admin is updated", async () => {
    // airdrop 2 SOL to new admin
    const newAdmin = anchor.web3.Keypair.generate();
    await program.provider.connection.confirmTransaction(
      await program.provider.connection.requestAirdrop(
        newAdmin.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL
      ),
      "confirmed"
    );

    // the admin was updated in the previous test
    // now try updating admin again using the old admin signer key
    // it should fail
    try {
      await program.methods
        .updateAdmin(newAdmin.publicKey)
        .accounts({
          signer: program.provider.wallet.publicKey,
          globalState: globalStatePDA,
        })
        .signers([])
        .rpc();

        assert.fail("Expected error not thrown");
    } catch (error) {
      assert.equal(error.error.errorCode.code, "Unauthorized");
    }
  });

  it("sends fees to platform fee vault on successful completion of a contract", async () => {
    // airdrop 4 SOL to buyer
    const buyer = anchor.web3.Keypair.generate();
    await program.provider.connection.confirmTransaction(
      await program.provider.connection.requestAirdrop(
        buyer.publicKey, 4 * anchor.web3.LAMPORTS_PER_SOL
      ),
      "confirmed"
    );

    // create accounts
    const serviceSeller = anchor.web3.Keypair.generate();

    // initialize buyer's contract counter account
    await initBuyerContractCounterTestHelper(buyer);

    // start contract
    const cid = "QmPK1s3pNYLi9ERiq3BDxKa4XosgWwFRQUydHUtz4YgpqB";
    const payoutAmount = new anchor.BN(1 * anchor.web3.LAMPORTS_PER_SOL);
    const {pda: contractPDA} = await startContractTestHelper(cid, serviceSeller.publicKey, payoutAmount, buyer);

    // platform fee vault balance before payment release
    const platformFeeVaultBalanceBefore = await program.provider.connection.getBalance(platformFeePDA[0]);

    // release payment
    await program.methods
      .releasePayment()
      .accounts({
        signer: buyer.publicKey,
        seller: serviceSeller.publicKey,
        contract: contractPDA,
        globalState: globalStatePDA,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([buyer])
      .rpc();

    // check if payment is released
    const updatedContract = await program.account.contract.fetch(contractPDA);
    assert.isTrue(updatedContract.isReleased);

    // assert that the platform fee vault balance has increased by buyer_fee_pct
    // and seller_fee_pct of the payout amount
    const globalState = await program.account.globalState.fetch(globalStatePDA);
    const buyerFee = payoutAmount.mul(new anchor.BN(globalState.buyerFeePct)).div(new anchor.BN(100));
    const sellerFee = payoutAmount.mul(new anchor.BN(globalState.sellerFeePct)).div(new anchor.BN(100));
    const platformFeeVaultBalanceAfter = await program.provider.connection.getBalance(platformFeePDA[0]);
    assert.equal(
      platformFeeVaultBalanceAfter - platformFeeVaultBalanceBefore,
      buyerFee.add(sellerFee).toNumber()
    );
  });

  it("admin can collect platform fees", async () => {
    // platform fee vault balance before collecting fees
    const platformFeeVaultBalanceBefore = await program.provider.connection.getBalance(platformFeePDA[0]);

    // admin balance before collecting fees
    const adminBalanceBefore = await program.provider.connection.getBalance(_currentAdmin.publicKey);

    // collect platform fees
    await program.methods
      .collectPlatformFees()
      .accounts({
        signer: _currentAdmin.publicKey,
        admin: _currentAdmin.publicKey,
        globalState: globalStatePDA,
        platformFeeVault: platformFeePDA,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([_currentAdmin])
      .rpc();

    // assert that the platform fee vault balance is zero
    const platformFeeVaultBalanceAfter = await program.provider.connection.getBalance(platformFeePDA[0]);
    assert.equal(platformFeeVaultBalanceAfter, 0);

    // assert that the admin's balance has increased by the platform fee vault balance
    const adminBalanceAfter = await program.provider.connection.getBalance(_currentAdmin.publicKey);
    assert.equal(
      adminBalanceAfter - adminBalanceBefore,
      platformFeeVaultBalanceBefore
    );
  });

  it("admin can update buyer fee", async () => {
    const newBuyerFee = new anchor.BN(2);

    // update buyer fee
    await program.methods
      .updateBuyerFee(newBuyerFee)
      .accounts({
        signer: _currentAdmin.publicKey,
        globalState: globalStatePDA,
      })
      .signers([_currentAdmin])
      .rpc();

    // fetch the updated global state
    const globalState = await program.account.globalState.fetch(globalStatePDA);
    assert.equal(globalState.buyerFeePct.toNumber(), newBuyerFee.toNumber());
  });

  it("admin can update seller fee", async () => {
    const newSellerFee = new anchor.BN(2);

    // update seller fee
    await program.methods
      .updateSellerFee(newSellerFee)
      .accounts({
        signer: _currentAdmin.publicKey,
        globalState: globalStatePDA,
      })
      .signers([_currentAdmin])
      .rpc();

    // fetch the updated global state
    const globalState = await program.account.globalState.fetch(globalStatePDA);
    assert.equal(globalState.sellerFeePct.toNumber(), newSellerFee.toNumber());
  });

  it("non-admin cannot update buyer fee", async () => {
    const newBuyerFee = new anchor.BN(2);

    // airdrop 2 SOL to non-admin
    const nonAdmin = anchor.web3.Keypair.generate();
    await program.provider.connection.confirmTransaction(
      await program.provider.connection.requestAirdrop(
        nonAdmin.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL
      ),
      "confirmed"
    );

    // try to update buyer fee by non-admin
    try {
      await program.methods
        .updateBuyerFee(newBuyerFee)
        .accounts({
          signer: nonAdmin.publicKey,
          globalState: globalStatePDA,
        })
        .signers([nonAdmin])
        .rpc();

      assert.fail("Expected error not thrown");
    } catch (error) {
      assert.equal(error.error.errorCode.code, "Unauthorized");
    }
  });

  it("non-admin cannot update seller fee", async () => {
    const newSellerFee = new anchor.BN(2);

    // airdrop 2 SOL to non-admin
    const nonAdmin = anchor.web3.Keypair.generate();
    await program.provider.connection.confirmTransaction(
      await program.provider.connection.requestAirdrop(
        nonAdmin.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL
      ),
      "confirmed"
    );

    // try to update seller fee by non-admin
    try {
      await program.methods
        .updateSellerFee(newSellerFee)
        .accounts({
          signer: nonAdmin.publicKey,
          globalState: globalStatePDA,
        })
        .signers([nonAdmin])
        .rpc();

      assert.fail("Expected error not thrown");
    } catch (error) {
      assert.equal(error.error.errorCode.code, "Unauthorized");
    }
  });

  async function initGlobalStateTestHelper() {
    // default admin is the program provider
    await program.methods
        .initializeGlobalState()
        .accounts({
          signer: program.provider.wallet.publicKey,
        })
        .signers([])
        .rpc();

    // return the global state
    const [pda] = anchor.web3.PublicKey.findProgramAddressSync([
      Buffer.from(globalStateSeed),
      program.programId.toBuffer()
    ], program.programId);
    const data = await program.account.globalState.fetch(pda);

    // make globalStatePDA available for all tests
    if (!globalStatePDA) { globalStatePDA = pda; }

    return {pda, data};
  }

  async function initBuyerContractCounterTestHelper(buyer: anchor.web3.Keypair) {
    // initialize buyer's contract counter account
    await program.methods
      .initializeBuyerContractCounter()
      .accounts({
        signer: buyer.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([buyer])
      .rpc();

    // return the buyer's contract counter
    const [pda] = anchor.web3.PublicKey.findProgramAddressSync([
      Buffer.from(contractCounterSeed), buyer.publicKey.toBuffer()
    ], program.programId);
    const data = await program.account.buyerContractCounter.fetch(pda);

    return {pda, data};
  }

  async function startContractTestHelper(
    cid: string,
    serviceSeller: anchor.web3.PublicKey,
    payoutAmount: anchor.BN,
    signer: anchor.web3.Keypair,
  ) {
    // get the buyer contract counter account
    const [buyerContractCounterPDA] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from(contractCounterSeed), signer.publicKey.toBuffer()],
      program.programId
    );
    const counter = await program.account.buyerContractCounter.fetch(buyerContractCounterPDA);

    // start contract
    await program.methods
      .startContract(
        cid,
        serviceSeller,
        payoutAmount
      )
      .accounts({
        signer: signer.publicKey,
        globalState: globalStatePDA,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([signer])
      .rpc();

    // return the contract
    const [pda] = anchor.web3.PublicKey.findProgramAddressSync([
      Buffer.from(contractSeed),
      signer.publicKey.toBuffer(),
      new anchor.BN(counter.counter).toArrayLike(Buffer, "le", 8)
    ], program.programId);

    const data = await program.account.contract.fetch(pda);
    return {pda, data};
  }

});
