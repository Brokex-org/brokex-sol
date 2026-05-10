use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use brokex_vault::program::BrokexVault;
use brokex_vault::VaultState;

use crate::constants::*;
use crate::error::CoreError;
use crate::logic::{sync_risk_from_oi, touch_asset_funding};
use crate::logic::capital_delta_close_remove_side;
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

    #[account(
        mut,
        constraint = core_collateral_token.owner == settlement_authority.key(),
        constraint = core_collateral_token.mint == config.usdc_mint
    )]
    pub core_collateral_token: Account<'info, TokenAccount>,

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

    let mut delta_unlocked = 0u64;

    if ctx.accounts.position.state == PositionState::Open {
        let now = Clock::get()?.unix_timestamp;
        touch_asset_funding(asset, now)?;

        let contrib = ctx.accounts.position.lp_locked_capital;
        let (new_rl, new_rs, du) = capital_delta_close_remove_side(
            asset.lp_locked_long,
            asset.lp_locked_short,
            pos_direction == PositionDirection::Long,
            contrib,
            asset.alpha_min_fp,
            asset.alpha_scale,
        )?;
        delta_unlocked = du;

        if pos_direction == PositionDirection::Long {
            asset.oi_long = asset.oi_long.checked_sub(pos_size).ok_or(CoreError::InvariantViolation)?;
            asset.sum_priced_oi_long = asset
                .sum_priced_oi_long
                .checked_sub(priced_oi)
                .ok_or(CoreError::InvariantViolation)?;
        } else {
            asset.oi_short = asset.oi_short.checked_sub(pos_size).ok_or(CoreError::InvariantViolation)?;
            asset.sum_priced_oi_short = asset
                .sum_priced_oi_short
                .checked_sub(priced_oi)
                .ok_or(CoreError::InvariantViolation)?;
        }
        asset.lp_locked_long = new_rl;
        asset.lp_locked_short = new_rs;
        sync_risk_from_oi(asset);
    }

    // Update Position
    let pm = &mut ctx.accounts.position;
    pm.state = PositionState::EmergencyClosed;
    pm.execution_status = ExecutionStatus::Canceled;
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

    // Return 100% of collateral from Core custody. No oracle/PnL and no Vault settlement.
    if pos_collateral > 0 {
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
        token::transfer(cpi_ctx, pos_collateral)?;
    }

    msg!("Emergency position closed: ID={}, Returned={}", asset_id, pos_collateral);

    Ok(())
}
