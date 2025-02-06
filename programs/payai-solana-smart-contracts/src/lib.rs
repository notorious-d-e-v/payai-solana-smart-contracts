use anchor_lang::prelude::*;
use anchor_lang::solana_program::{system_instruction, program::invoke_signed};
use anchor_lang::system_program;

declare_id!("DKgspHjnwuPZfYWKHdZwVCTZKtNX4TdpASTGoqxpcmtt");

// the current admin will be initialized to this
// the current admin can be updated by calling the update_admin instruction
// TODO change this to the actual admin wallet before deploying
pub const DEFAULT_ADMIN: Pubkey = Pubkey::new_from_array([
    149,5,172,186,118,202,88,55,
    85,178,133,131,38,235,51,148,
    185,110,122,25,211,16,147,15,
    247,80,58,198,87,121,0,147
]);


#[program]
pub mod payai_marketplace {
    use super::*;

    /// initializes the global state
    pub fn initialize_global_state(ctx: Context<InitializeGlobalState>) -> Result<()> {
        // only the DEFAULT_ADMIN can initialize
        require!(
            ctx.accounts.signer.key() == DEFAULT_ADMIN,
            PayAiError::Unauthorized
        );

        let global_state = &mut ctx.accounts.global_state;
        global_state.admin = DEFAULT_ADMIN;
        Ok(())
    }

    /// updates the current admin 
    pub fn update_admin(ctx: Context<UpdateAdmin>, new_admin: Pubkey) -> Result<()> {
        let global_state = &mut ctx.accounts.global_state;
        let signer = &ctx.accounts.signer;

        // only the current admin can update the admin wallet
        require!(
            signer.key() == global_state.admin,
            PayAiError::Unauthorized
        );

        global_state.admin = new_admin;
        Ok(())
    }

    /// Initializes the buyer counter for a given buyer.
    pub fn initialize_buyer_contract_counter(ctx: Context<InitializeBuyerContractCounter>) -> Result<()> {
        let counter = &mut ctx.accounts.buyer_contract_counter;
        counter.counter = 0;
        Ok(())
    }

    /// funds and starts a contract
    pub fn start_contract(
        ctx: Context<StartContract>,
        cid: String,
        payout_address: Pubkey,
        escrow_amount: u64,
    ) -> Result<()> {
        // increment the buyer's contract counter
        let counter = &mut ctx.accounts.buyer_contract_counter;
        counter.counter = counter.counter.checked_add(1).unwrap();

        // create a new contract account
        let contract = &mut ctx.accounts.contract;
        let signer = &ctx.accounts.signer;
        contract.cid = cid;
        contract.buyer = signer.key();
        contract.seller = payout_address;
        contract.amount = escrow_amount;
        contract.is_released = false;

        // Transfer SOL from buyer to contract account
        let ix = system_instruction::transfer(&signer.key(), &contract.key(), escrow_amount);
        invoke_signed(
            &ix,
            &[
                signer.to_account_info(),
                contract.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[],
        )?;

        Ok(())
    }

    /// read contract details
    pub fn read_contract(ctx: Context<ReadContract>) -> Result<()> {
        let contract = &ctx.accounts.contract;
        msg!("Contract CID: {}", contract.cid);
        msg!("Escrow Amount: {}", contract.amount);
        msg!("Buyer: {}", contract.buyer);
        msg!("Seller: {}", contract.seller);
        Ok(())
    }

    /// release payment from escrow to the seller
    pub fn release_payment(ctx: Context<ReleasePayment>) -> Result<()> {
        let contract = &mut ctx.accounts.contract;
        let admin = ctx.accounts.global_state.admin;
        let signer = &ctx.accounts.signer;

        // Ensure that only the buyer or admin can release funds
        require!(
            signer.key() == contract.buyer || signer.key() == admin,
            PayAiError::Unauthorized
        );

        // prevent releasing funds more than once
        require!(!contract.is_released, PayAiError::AlreadyReleased);
        contract.is_released = true;

        // transfer funds from escrow to the seller
        let seeds = &[
            b"contract".as_ref(),
            contract.buyer.as_ref(),
        ];
        let bump = ctx.bumps.contract;
        let bump_binding = [bump];
        let signer_seeds = &[&[seeds[0], seeds[1], &bump_binding][..]];

        let ix = system_instruction::transfer(&contract.key(), &contract.seller.key(), contract.amount);
        invoke_signed(
            &ix,
            &[
                contract.to_account_info(),
                ctx.accounts.seller.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            signer_seeds,
        )?;
        Ok(())
    }

    /// refunds the buyer from escrow
    pub fn refund_buyer(ctx: Context<RefundBuyer>) -> Result<()> {
        let contract = &ctx.accounts.contract;
        let signer = &ctx.accounts.signer;
        let admin = ctx.accounts.global_state.admin;

        // can only be called by the admin
        require!(
            signer.key() == admin,
            PayAiError::Unauthorized
        );

        // Transfer funds from escrow back to the Buyer.
        let seeds = &[
            b"contract".as_ref(),
            contract.buyer.as_ref(),
        ];
        let bump = ctx.bumps.contract;
        let bump_binding = [bump];
        let signer_seeds = &[&[seeds[0], seeds[1], &bump_binding][..]];

        let ix = system_instruction::transfer(&contract.key(), &contract.buyer.key(), contract.amount);
        invoke_signed(
            &ix,
            &[
                contract.to_account_info(),
                ctx.accounts.buyer.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            signer_seeds,
        )?;
        Ok(())
    }
}


#[account]
pub struct BuyerContractCounter {
    pub counter: u64,  // used as a seed for creating contract PDAs for the buyer.
}

impl BuyerContractCounter {
    pub const LEN: usize = 8;
}

#[derive(Accounts)]
pub struct InitializeBuyerContractCounter<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        init,
        payer = signer,
        space = 8 + BuyerContractCounter::LEN,
        seeds = [b"buyer_contract_counter", signer.key().as_ref()],
        bump
    )]
    pub buyer_contract_counter: Account<'info, BuyerContractCounter>,

    pub system_program: Program<'info, System>,
}

#[account]
pub struct Contract {
    pub cid: String,      // ipfs CID of the Agreement
    pub buyer: Pubkey,    // buyer's wallet address
    pub seller: Pubkey,   // seller's payout address
    pub amount: u64,      // escrow amount
    pub is_released: bool // whether the payment has been released
}

impl Contract {
    // Calculate the required space. Adjust the size of the string as needed.
    pub const LEN: usize = 64 + 32 + 32 + 8 + 1;
}

#[derive(Accounts)]
pub struct StartContract<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"buyer_contract_counter", signer.key().as_ref()],
        bump
    )]
    pub buyer_contract_counter: Account<'info, BuyerContractCounter>,

    /// the contract account holds the contract details
    #[account(
        init,
        payer = signer,
        space = 8 + Contract::LEN,
        seeds = [
          b"contract",
          signer.key().as_ref(),
          &buyer_contract_counter.counter.to_le_bytes()
        ],
        bump
    )]
    pub contract: Account<'info, Contract>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ReadContract<'info> {
    pub contract: Account<'info, Contract>,
}

#[derive(Accounts)]
pub struct ReleasePayment<'info> {
    /// the signer must be the Buyer or the Admin.
    #[account(mut)]
    pub signer: Signer<'info>,

    /// CHECK: this is the seller's wallet address, won't be used in the transfer instruction
    #[account(mut)]
    pub seller: AccountInfo<'info>,

    /// CHECK: this is the buyer's wallet address, won't be used in the transfer instruction
    #[account(mut)]
    pub buyer: AccountInfo<'info>,

    #[account(
        mut,
        has_one = buyer,
        has_one = seller,
        seeds = [b"contract", buyer.key().as_ref()],
        bump
    )]
    pub contract: Account<'info, Contract>,

    #[account(mut)]
    pub global_state: Account<'info, GlobalState>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RefundBuyer<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    /// CHECK: this is the buyer's wallet address, won't be used in the transfer instruction
    #[account(mut)]
    pub buyer: AccountInfo<'info>,

    /// TODO is the has_one enough or do we need to add more?
    #[account(
        mut,
        has_one = buyer,
        seeds = [b"contract", buyer.key().as_ref()],
        bump
    )]
    pub contract: Account<'info, Contract>,

    #[account(mut)]
    pub global_state: Account<'info, GlobalState>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateAdmin<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(mut)]
    pub global_state: Account<'info, GlobalState>,
}

#[account]
pub struct GlobalState {
    pub admin: Pubkey,  // the current admin
}

impl GlobalState {
    pub const LEN: usize = 32;
}

#[derive(Accounts)]
pub struct InitializeGlobalState<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        init,
        payer = signer,
        space = 8 + GlobalState::LEN,
        seeds = [b"global_state", ID.as_ref()],
        bump
    )]
    pub global_state: Account<'info, GlobalState>,

    pub system_program: Program<'info, System>,
}

#[error_code]
pub enum PayAiError {
    #[msg("Unauthorized action")]
    Unauthorized,

    #[msg("Payment has already been released")]
    AlreadyReleased,
}

