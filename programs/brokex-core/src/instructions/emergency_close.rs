use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};
use brokex_vault::cpi::{accounts::VaultSettle, settle};
use brokex_vault::program::BrokexVault;
use brokex_vault::VaultState;

use crate::constants::*;
use crate::error::CoreError;
use crate::state::*;

#[derive(Accounts)]
#[instruction(asset_id: String, trade_id: u64)]
pub struct EmergencyClose<'info> {
    #[account(mut)]
    pub trader: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump,
        // We check if emergency_mode is active or it's paused.
        constraint = config.emergency_mode || config.is_paused @ CoreError::Unauthorized
    )]
    pub config: Box<Account<'info, ProtocolConfig>>,

    #[account(
        mut,
        seeds = [ASSET_SEED, asset_id.as_bytes()],
        bump,
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
        constraint = vault_token_account.key() == config.vault @ CoreError::Unauthorized,
        constraint = vault_token_account.mint == config.usdc_mint
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = trader_token_account.owner == trader.key(),
        constraint = trader_token_account.mint == config.usdc_mint
    )]
    pub trader_token_account: Account<'info, TokenAccount>,

    /// CHECK: PDA signer for vault CPI; must match `VaultState.core`.
    #[account(seeds = [SETTLEMENT_SEED], bump)]
    pub settlement_authority: UncheckedAccount<'info>,

    pub vault_program: Program<'info, BrokexVault>,

    #[account(
        mut,
        seeds = [b"vault"],
        bump,
        seeds::program = vault_program.key(),
    )]
    pub vault_state: Box<Account<'info, VaultState>>,

    pub token_program: Program<'info, Token>,
}

pub fn emergency_close_handler(ctx: Context<EmergencyClose>, asset_id: String, _trade_id: u64) -> Result<()> {
    // Capture data from position to avoid borrow checker issues later
    let (pos_direction, pos_size, pos_collateral) = (ctx.accounts.position.direction, ctx.accounts.position.size, ctx.accounts.position.collateral);
    let priced_oi = (pos_size as u128)
        .checked_mul(ctx.accounts.position.entry_price as u128)
        .ok_or(CoreError::Overflow)?;

    let asset = &mut ctx.accounts.asset;

    // Capital Unlocking Logic 
    let locked_before = std::cmp::max(asset.lp_locked_long, asset.lp_locked_short);
    
    // Unwind Asset state
    if pos_direction == PositionDirection::Long {
        asset.oi_long = asset.oi_long.saturating_sub(pos_size);
        asset.lp_locked_long = asset.lp_locked_long.saturating_sub(pos_size);
        asset.sum_priced_oi_long = asset.sum_priced_oi_long.saturating_sub(priced_oi);
    } else {
        asset.oi_short = asset.oi_short.saturating_sub(pos_size);
        asset.lp_locked_short = asset.lp_locked_short.saturating_sub(pos_size);
        asset.sum_priced_oi_short = asset.sum_priced_oi_short.saturating_sub(priced_oi);
    }

    let locked_after = std::cmp::max(asset.lp_locked_long, asset.lp_locked_short);
    let delta_unlocked = locked_before.saturating_sub(locked_after);

    // Update Position
    let pm = &mut ctx.accounts.position;
    pm.state = PositionState::EmergencyClosed;
    pm.close_time = Clock::get()?.unix_timestamp;

    let bump = ctx.bumps.settlement_authority;
    let bump_seed = [bump];
    let signer_seeds: &[&[u8]] = &[SETTLEMENT_SEED, &bump_seed];
    let signers: &[&[&[u8]]] = &[signer_seeds];

    // Update Vault Locked Capital via CPI 
    if delta_unlocked > 0 {
        let cpi_accounts = brokex_vault::cpi::accounts::UpdateLockedCapital {
            caller: ctx.accounts.settlement_authority.to_account_info(),
            vault_state: ctx.accounts.vault_state.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.vault_program.to_account_info().key(),
            cpi_accounts,
            signers
        );
        brokex_vault::cpi::update_locked_capital(cpi_ctx, -(delta_unlocked as i64))?;
    }

    // Return 100% of collateral 
    let vault_pay_trader = pos_collateral;

    if vault_pay_trader > 0 {
        let cpi_accounts = VaultSettle {
            caller: ctx.accounts.settlement_authority.to_account_info(),
            vault_state: ctx.accounts.vault_state.to_account_info(),
            vault_token: ctx.accounts.vault_token_account.to_account_info(),
            trader_token: ctx.accounts.trader_token_account.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
        };

        let cpi_ctx =
            CpiContext::new_with_signer(ctx.accounts.vault_program.to_account_info().key(), cpi_accounts, signers);

        settle(cpi_ctx, vault_pay_trader, 0)?;
    }

    msg!("Emergency position closed: ID={}, Returned={}", asset_id, vault_pay_trader);

    Ok(())
}
