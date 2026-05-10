use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::error::CoreError;
use crate::logic::calculate_liquidation_price;
use crate::state::*;

/// Adds USDC margin to an open position; updates liquidation price only (Extended MVP §17).
/// Requires the asset to be enabled (same as opening risk). Clients should use the canonical USDC ATA owned by `settlement_authority` (see deploy / `getAtaAddress`).
#[derive(Accounts)]
#[instruction(asset_id: String, trade_id: u64)]
pub struct AddMargin<'info> {
    #[account(mut)]
    pub trader: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump,
        constraint = !config.is_paused @ CoreError::Paused
    )]
    pub config: Box<Account<'info, ProtocolConfig>>,

    #[account(
        seeds = [ASSET_SEED, asset_id.as_bytes()],
        bump,
        constraint = asset.is_enabled @ CoreError::AssetDisabled
    )]
    pub asset: Box<Account<'info, Asset>>,

    #[account(
        mut,
        seeds = [POSITION_SEED, trader.key().as_ref(), asset_id.as_bytes(), trade_id.to_le_bytes().as_ref()],
        bump = position.bump,
        has_one = trader @ CoreError::Unauthorized,
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

    /// CHECK: PDA signer; must match core collateral token owner (`VaultState.core`).
    #[account(seeds = [SETTLEMENT_SEED], bump)]
    pub settlement_authority: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn add_margin_handler(
    ctx: Context<AddMargin>,
    asset_id: String,
    _trade_id: u64,
    amount: u64,
) -> Result<()> {
    require!(
        ctx.accounts.position.asset_id == asset_id,
        CoreError::Unauthorized
    );
    require!(
        ctx.accounts.position.state == PositionState::Open,
        CoreError::PositionNotOpen
    );
    require!(amount > 0, CoreError::InvalidMarginAmount);

    let position = &mut ctx.accounts.position;
    let collateral_before = position.collateral;
    let new_collateral = collateral_before
        .checked_add(amount)
        .ok_or(CoreError::Overflow)?;

    let cpi_accounts = Transfer {
        from: ctx.accounts.trader_token_account.to_account_info(),
        to: ctx.accounts.core_collateral_token.to_account_info(),
        authority: ctx.accounts.trader.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info().key(), cpi_accounts);
    token::transfer(cpi_ctx, amount)?;

    position.collateral = new_collateral;
    position.liquidation_price = calculate_liquidation_price(
        position.entry_price,
        position.size,
        new_collateral,
        position.direction,
    )?;

    Ok(())
}
