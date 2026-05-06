use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::*;
use crate::constants::*;
use crate::error::CoreError;

#[derive(Accounts)]
#[instruction(asset_id: String, trade_id: u64)]
pub struct CancelOrder<'info> {
    #[account(mut)]
    pub trader: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump,
    )]
    pub config: Box<Account<'info, ProtocolConfig>>,

    #[account(
        mut,
        seeds = [POSITION_SEED, trader.key().as_ref(), asset_id.as_bytes(), trade_id.to_le_bytes().as_ref()],
        bump = position.bump,
        has_one = trader @ CoreError::Unauthorized,
        constraint = position.state == PositionState::Pending @ CoreError::Unauthorized,
    )]
    pub position: Box<Account<'info, Position>>,

    #[account(
        mut,
        constraint = trader_token_account.owner == trader.key(),
        constraint = trader_token_account.mint == config.usdc_mint
    )]
    pub trader_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = core_collateral_token.owner == settlement_authority.key(),
        constraint = core_collateral_token.mint == config.usdc_mint
    )]
    pub core_collateral_token: Account<'info, TokenAccount>,

    /// CHECK: PDA signer for collateral return
    #[account(seeds = [SETTLEMENT_SEED], bump)]
    pub settlement_authority: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn cancel_order_handler(ctx: Context<CancelOrder>, _asset_id: String, _trade_id: u64) -> Result<()> {
    let position = &mut ctx.accounts.position;
    
    // Return 100% of collateral
    let collateral = position.collateral;
    
    if collateral > 0 {
        let bump = ctx.bumps.settlement_authority;
        let bump_seed = [bump];
        let signer_seeds: &[&[u8]] = &[SETTLEMENT_SEED, &bump_seed];
        let signers: &[&[&[u8]]] = &[signer_seeds];

        let cpi_accounts = Transfer {
            from: ctx.accounts.core_collateral_token.to_account_info(),
            to: ctx.accounts.trader_token_account.to_account_info(),
            authority: ctx.accounts.settlement_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info().key(),
            cpi_accounts,
            signers,
        );
        token::transfer(cpi_ctx, collateral)?;
    }

    // Set state to Canceled
    position.state = PositionState::Canceled;
    position.execution_status = ExecutionStatus::Canceled;
    position.close_time = Clock::get()?.unix_timestamp;

    msg!("Order canceled: Asset={}, TradeID={}", position.asset_id, position.trade_id);

    Ok(())
}
