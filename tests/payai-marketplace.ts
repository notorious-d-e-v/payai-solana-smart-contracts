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
    const globalState = await initGlobalStateTestHelper();
    assert.equal(globalState.admin.toString(), program.provider.wallet.publicKey.toString());
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
    const buyerContractCounter = await initBuyerContractCounterTestHelper(buyer);
    assert.equal(buyerContractCounter.counter, 0);
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
    const contract = await startContractTestHelper(cid, serviceSeller.publicKey, payoutAmount, nonAdmin);

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
    let contract = await startContractTestHelper(cid, serviceSeller.publicKey, payoutAmount, nonAdmin);

    assert.equal(contract.cid, cid);
    assert.equal(contract.seller.toString(), serviceSeller.publicKey.toString());
    assert.equal(
      contract.amount.toString(),
      payoutAmount.toString()
    );

    // start another contract
    cid = "QmPK1s3pNYLi9ERiq3BDxKa4XosgWwFRQUydHUtz4YgpqC"
    payoutAmount = new anchor.BN(2 * anchor.web3.LAMPORTS_PER_SOL);
    contract = await startContractTestHelper(cid, serviceSeller.publicKey, payoutAmount, nonAdmin);

    assert.equal(contract.cid, cid);
    assert.equal(contract.seller.toString(), serviceSeller.publicKey.toString());
    assert.equal(
      contract.amount.toString(),
      payoutAmount.toString()
    );
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
    const globalState = await program.account.globalState.fetch(pda);

    return globalState;
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
    const buyerContractCounter = await program.account.buyerContractCounter.fetch(pda);

    return buyerContractCounter;
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
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([signer])
      .rpc();

    // return the contract
    const [contractPDA] = anchor.web3.PublicKey.findProgramAddressSync([
      Buffer.from(contractSeed),
      signer.publicKey.toBuffer(),
      new anchor.BN(counter.counter).toArrayLike(Buffer, "le", 8)
    ], program.programId);

    const contract = await program.account.contract.fetch(contractPDA);
    return contract;
  }

});
