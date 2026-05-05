use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount};
use brokex_vault::cpi::{accounts::VaultSettle, settle};
use brokex_vault::program::BrokexVault;
use brokex_vault::VaultState;

use crate::constants::*;
use crate::error::CoreError;
use crate::logic::{self, PRECISION};
use crate::oracle;
use crate::state::*;

/// Closes an open position by the trader themselves.
#[derive(Accounts)]
#[instruction(asset_id: String, trade_id: u64)]
pub struct ClosePosition<'info> {
    #[account(mut)]
    pub trader: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump,
        constraint = !config.is_paused @ CoreError::Paused
    )]
    pub config: Box<Account<'info, ProtocolConfig>>,

    #[account(
        mut,
        seeds = [ASSET_SEED, asset_id.as_bytes()],
        bump,
        constraint = asset.is_enabled @ CoreError::AssetDisabled,
    )]
    pub asset: Box<Account<'info, Asset>>,

    #[account(
        mut,
        seeds = [POSITION_SEED, trader.key().as_ref(), asset_id.as_bytes(), trade_id.to_le_bytes().as_ref()],
        bump = position.bump,
        has_one = trader @ CoreError::Unauthorized,
    )]
    pub position: Box<Account<'info, Position>>,

    /// CHECK: Validated in `oracle::get_validated_price`
    pub pyth_price_update: UncheckedAccount<'info>,

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

    #[account(
        mut,
        constraint = core_collateral_token.owner == settlement_authority.key(),
        constraint = core_collateral_token.mint == config.usdc_mint
    )]
    pub core_collateral_token: Account<'info, TokenAccount>,

    pub vault_program: Program<'info, BrokexVault>,

    #[account(
        mut,
        seeds = [b"vault"],
        bump,
        seeds::program = vault_program.key(),
        constraint = vault_state.token_vault == vault_token_account.key(),
        constraint = vault_state.core == settlement_authority.key(),
    )]
    pub vault_state: Box<Account<'info, VaultState>>,

    pub token_program: Program<'info, Token>,
}

/// Liquidates an open position when it hits the maintenance margin threshold.
/// Can be called by anyone (liquidator).
#[derive(Accounts)]
#[instruction(asset_id: String, trade_id: u64)]
pub struct LiquidatePosition<'info> {
    #[account(mut)]
    pub liquidator: Signer<'info>,

    /// CHECK: The trader whose position is being liquidated.
    pub trader: UncheckedAccount<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump,
        constraint = !config.is_paused @ CoreError::Paused
    )]
    pub config: Box<Account<'info, ProtocolConfig>>,

    #[account(
        mut,
        seeds = [ASSET_SEED, asset_id.as_bytes()],
        bump,
        constraint = asset.is_enabled @ CoreError::AssetDisabled,
    )]
    pub asset: Box<Account<'info, Asset>>,

    #[account(
        mut,
        seeds = [POSITION_SEED, trader.key().as_ref(), asset_id.as_bytes(), trade_id.to_le_bytes().as_ref()],
        bump = position.bump,
        constraint = position.trader == trader.key() @ CoreError::Unauthorized,
    )]
    pub position: Box<Account<'info, Position>>,

    /// CHECK: Validated in `oracle::get_validated_price`
    pub pyth_price_update: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = vault_token_account.key() == config.vault @ CoreError::Unauthorized,
        constraint = vault_token_account.mint == config.usdc_mint
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    /// CHECK: Trader's token account (not used for liquidation payout to liquidator yet,
    /// but needed for settlement flow if any residual is returned, though usually 0).
    #[account(mut)]
    pub trader_token_account: UncheckedAccount<'info>,

    /// CHECK: PDA signer for vault CPI; must match `VaultState.core`.
    #[account(seeds = [SETTLEMENT_SEED], bump)]
    pub settlement_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = core_collateral_token.owner == settlement_authority.key(),
        constraint = core_collateral_token.mint == config.usdc_mint
    )]
    pub core_collateral_token: Account<'info, TokenAccount>,

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

pub fn close_position_handler(ctx: Context<ClosePosition>, asset_id: String, _trade_id: u64) -> Result<()> {
    require!(
        ctx.accounts.position.asset_id == asset_id,
        CoreError::Unauthorized
    );
    require!(
        ctx.accounts.position.state == PositionState::Open,
        CoreError::PositionNotOpen
    );

    let oracle_price = oracle::get_validated_price(
        &ctx.accounts.pyth_price_update,
        &ctx.accounts.asset.pyth_feed.to_bytes(),
        60,
        200,
    )?;

    let asset = &ctx.accounts.asset;
    let position = &ctx.accounts.position;

    // Exit spread uses OI **before** unwind
    let close_price = logic::apply_spread_close(
        oracle_price,
        position.direction,
        asset.oi_long,
        asset.oi_short,
        asset.base_spread_bps,
    );

    let (final_state, vault_pay_trader, _is_liq) = calculate_settlement(position, close_price, 0)?;
    
    require!(!_is_liq, CoreError::Overflow); // Trader should use liquidate_position if insolvent

    unwind_asset_open_interest(&mut ctx.accounts.asset, position)?;

    let ts = Clock::get()?.unix_timestamp;
    let pm = &mut ctx.accounts.position;
    pm.close_price = close_price;
    pm.close_time = ts;
    pm.state = final_state;

    if vault_pay_trader > 0 {
        require!(
            ctx.accounts.vault_token_account.amount >= vault_pay_trader,
            CoreError::InsufficientVaultLiquidity
        );

        let bump = ctx.bumps.settlement_authority;
        let bump_seed = [bump];
        let signer_seeds: &[&[u8]] = &[SETTLEMENT_SEED, &bump_seed];
        let signers: &[&[&[u8]]] = &[signer_seeds];

        let cpi_accounts = VaultSettle {
            caller: ctx.accounts.settlement_authority.to_account_info(),
            vault_state: ctx.accounts.vault_state.to_account_info(),
            vault_token: ctx.accounts.vault_token_account.to_account_info(),
            trader_token: ctx.accounts.trader_token_account.to_account_info(),
            core_collateral_token: ctx.accounts.core_collateral_token.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
        };

        let cpi_ctx =
            CpiContext::new_with_signer(ctx.accounts.vault_program.key(), cpi_accounts, signers);

        settle(cpi_ctx, vault_pay_trader, 0)?;
    }

    Ok(())
}

pub fn liquidate_position_handler(ctx: Context<LiquidatePosition>, asset_id: String, _trade_id: u64) -> Result<()> {
    require!(
        ctx.accounts.position.asset_id == asset_id,
        CoreError::Unauthorized
    );
    require!(
        ctx.accounts.position.state == PositionState::Open,
        CoreError::PositionNotOpen
    );

    let oracle_price = oracle::get_validated_price(
        &ctx.accounts.pyth_price_update,
        &ctx.accounts.asset.pyth_feed.to_bytes(),
        60,
        200,
    )?;

    let position = &ctx.accounts.position;

    // Liquidation uses mark price (oracle price) directly or with a penalty
    let close_price = oracle_price;

    let (final_state, _vault_pay_trader, is_liq) = calculate_settlement(position, close_price, 0)?;
    
    require!(is_liq, CoreError::Overflow); // Only allow liquidation if threshold is met

    unwind_asset_open_interest(&mut ctx.accounts.asset, position)?;

    let ts = Clock::get()?.unix_timestamp;
    let pm = &mut ctx.accounts.position;
    pm.close_price = close_price;
    pm.close_time = ts;
    pm.state = final_state;

    // In a liquidation, vault_pay_trader is usually 0. 
    // Liquidator rewards would be implemented here in a production system.

    Ok(())
}

fn calculate_settlement(
    position: &Position,
    close_price: u64,
    funding_fee: u64,
) -> Result<(PositionState, u64, bool)> {
    let margin = position
        .size
        .checked_div(position.leverage as u64)
        .ok_or(CoreError::Overflow)?;

    let raw_pnl = signed_pnl(
        position.size,
        position.entry_price,
        close_price,
        position.direction,
    )?;

    let lp_cap = i128::from(position.lp_locked_capital);
    let capped_pnl = if raw_pnl > lp_cap { lp_cap } else { raw_pnl };

    let loss_u128 = if capped_pnl < 0 {
        (-capped_pnl) as u128
    } else {
        0u128
    };

    let liq_threshold = (margin as u128)
        .checked_mul(logic::LIQ_THRESHOLD_BPS)
        .ok_or(CoreError::Overflow)?
        .checked_div(PRECISION)
        .ok_or(CoreError::Overflow)?;

    let is_liquidation = loss_u128
        .checked_add(funding_fee as u128)
        .ok_or(CoreError::Overflow)?
        >= liq_threshold;

    if is_liquidation {
        return Ok((PositionState::Liquidated, 0, true));
    }

    let margin_after_funding = margin.saturating_sub(funding_fee);
    if margin_after_funding == 0 {
        return Ok((PositionState::Closed, 0, false));
    }

    if capped_pnl >= 0 {
        let profit = u64::try_from(capped_pnl).map_err(|_| error!(CoreError::Overflow))?;
        let total = margin_after_funding
            .checked_add(profit)
            .ok_or(CoreError::Overflow)?;
        Ok((PositionState::Closed, total, false))
    } else {
        let loss = u64::try_from(-capped_pnl).map_err(|_| error!(CoreError::Overflow))?;
        if loss >= margin_after_funding {
            Ok((PositionState::Closed, 0, false))
        } else {
            let rem = margin_after_funding
                .checked_sub(loss)
                .ok_or(CoreError::Overflow)?;
            Ok((PositionState::Closed, rem, false))
        }
    }
}

fn signed_pnl(
    size: u64,
    entry_price: u64,
    exit_price: u64,
    direction: PositionDirection,
) -> Result<i128> {
    require!(entry_price > 0, CoreError::InvalidPrice);

    let size_i = i128::from(size);
    let entry_i = i128::from(entry_price);
    let exit_i = i128::from(exit_price);

    let delta = match direction {
        PositionDirection::Long => exit_i.checked_sub(entry_i).ok_or(CoreError::Overflow)?,
        PositionDirection::Short => entry_i.checked_sub(exit_i).ok_or(CoreError::Overflow)?,
    };

    size_i
        .checked_mul(delta)
        .ok_or(error!(CoreError::Overflow))?
        .checked_div(entry_i)
        .ok_or(error!(CoreError::Overflow))
}

fn unwind_asset_open_interest(asset: &mut Account<'_, Asset>, position: &Position) -> Result<()> {
    let priced_oi = (position.size as u128)
        .checked_mul(position.entry_price as u128)
        .ok_or(CoreError::Overflow)?;

    if position.direction == PositionDirection::Long {
        asset.oi_long = asset
            .oi_long
            .checked_sub(position.size)
            .ok_or(CoreError::Overflow)?;
        asset.risk_long = asset
            .risk_long
            .checked_sub(position.lp_locked_capital)
            .ok_or(CoreError::Overflow)?;
        asset.sum_priced_oi_long = asset
            .sum_priced_oi_long
            .checked_sub(priced_oi)
            .ok_or(CoreError::Overflow)?;
    } else {
        asset.oi_short = asset
            .oi_short
            .checked_sub(position.size)
            .ok_or(CoreError::Overflow)?;
        asset.risk_short = asset
            .risk_short
            .checked_sub(position.lp_locked_capital)
            .ok_or(CoreError::Overflow)?;
        asset.sum_priced_oi_short = asset
            .sum_priced_oi_short
            .checked_sub(priced_oi)
            .ok_or(CoreError::Overflow)?;
    }

    Ok(())
}
