use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;
use brokex_vault::cpi::{accounts::VaultSettle, settle};
use brokex_vault::VaultState;

use crate::constants::*;
use crate::error::CoreError;
use crate::logic::{self, PRECISION};
use crate::oracle;
use crate::state::*;

/// Closes an open position using the same pricing and pool rules as [`open_position`](super::open_position):
/// exit spread (`apply_spread_close`), PnL vs `entry_price`, LP profit cap, liquidation threshold (EVM-style),
/// unwind of `Asset` OI/risk (symmetric to open), then vault settlement analogous to EVM `_settleTrade`.
///
/// **Funding:** on-chain funding indices are not modeled yet; `funding_fee` is treated as `0` (same structure
/// as EVM for when it is wired).
///
/// **Vault:** `VaultState.core` must be the settlement PDA `Pubkey::find_program_address(&[SETTLEMENT_SEED], id)`.
#[derive(Accounts)]
#[instruction(asset_id: String)]
pub struct ClosePosition<'info> {
    #[account(mut)]
    pub trader: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump,
        constraint = !config.is_paused @ CoreError::Paused
    )]
    pub config: Account<'info, ProtocolConfig>,

    #[account(
        mut,
        seeds = [ASSET_SEED, asset_id.as_bytes()],
        bump,
        constraint = asset.is_enabled @ CoreError::AssetDisabled,
    )]
    pub asset: Account<'info, Asset>,

    #[account(
        mut,
        seeds = [POSITION_SEED, trader.key().as_ref(), asset_id.as_bytes()],
        bump = position.bump,
        has_one = trader @ CoreError::Unauthorized,
    )]
    pub position: Account<'info, Position>,

    /// CHECK: Validated in `oracle::get_validated_price`
    pub pyth_price_update: UncheckedAccount<'info>,

    /// CHECK: SPL USDC vault token account; deserialized in handler.
    #[account(mut, constraint = vault_token_account.key() == config.vault @ CoreError::Unauthorized)]
    pub vault_token_account: UncheckedAccount<'info>,

    /// CHECK: Trader USDC ATA; deserialized in handler.
    #[account(mut)]
    pub trader_token_account: UncheckedAccount<'info>,

    /// CHECK: PDA signer for vault CPI; must match `VaultState.core`.
    #[account(seeds = [SETTLEMENT_SEED], bump)]
    pub settlement_authority: UncheckedAccount<'info>,

    /// CHECK: Settlement-authority USDC ATA (vault `settle` layout); unused when `loss == 0`.
    #[account(mut)]
    pub core_collateral_token: UncheckedAccount<'info>,

    /// CHECK: Vault program executable; matches `config.vault_program`.
    #[account(
        constraint = vault_program.key() == config.vault_program @ CoreError::Unauthorized,
        constraint = vault_program.executable @ CoreError::InvalidVaultProgram
    )]
    pub vault_program: UncheckedAccount<'info>,

    /// CHECK: Vault state PDA; owner + seeds; layout checked in `validate_close_token_layout`.
    #[account(
        mut,
        owner = vault_program.key(),
        seeds = [b"vault"],
        bump,
        seeds::program = vault_program.key(),
    )]
    pub vault_state: UncheckedAccount<'info>,

    pub token_program: Program<'info, anchor_spl::token::Token>,
}

pub fn close_position_handler(ctx: Context<ClosePosition>, asset_id: String) -> Result<()> {
    require!(
        ctx.accounts.position.asset_id == asset_id,
        CoreError::Unauthorized
    );
    require!(
        ctx.accounts.position.state == PositionState::Open,
        CoreError::PositionNotOpen
    );

    validate_close_token_layout(&ctx)?;

    let oracle_price = oracle::get_validated_price(
        &ctx.accounts.pyth_price_update,
        &ctx.accounts.asset.pyth_feed.to_bytes(),
        60,
        200,
    )?;

    let asset = &ctx.accounts.asset;
    let position = &ctx.accounts.position;

    // Exit spread uses OI **before** unwind (same as EVM `_closeTrade` ordering vs `_applySpread`).
    let close_price = logic::apply_spread_close(
        oracle_price,
        position.direction,
        asset.oi_long,
        asset.oi_short,
        asset.base_spread_bps,
    );

    let funding_fee: u64 = 0;

    let margin = position
        .size
        .checked_div(position.leverage as u64)
        .ok_or(CoreError::Overflow)?;
    require!(margin > 0, CoreError::InvalidPrice);

    let mut raw_pnl = signed_pnl(
        position.size,
        position.entry_price,
        close_price,
        position.direction,
    )?;

    let lp_cap = i128::from(position.lp_locked_capital);
    if raw_pnl > lp_cap {
        raw_pnl = lp_cap;
    }

    let loss_u128 = if raw_pnl < 0 {
        (-raw_pnl) as u128
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

    let margin_after_funding = if funding_fee >= margin {
        0u64
    } else {
        margin.saturating_sub(funding_fee)
    };

    let (final_state, vault_pay_trader) = if is_liquidation {
        (PositionState::Liquidated, 0u64)
    } else if margin_after_funding == 0 {
        (PositionState::Closed, 0u64)
    } else if raw_pnl >= 0 {
        let profit = u64::try_from(raw_pnl).map_err(|_| error!(CoreError::Overflow))?;
        let total = margin_after_funding
            .checked_add(profit)
            .ok_or(CoreError::Overflow)?;
        (PositionState::Closed, total)
    } else {
        let loss = u64::try_from(-raw_pnl).map_err(|_| error!(CoreError::Overflow))?;
        if loss >= margin_after_funding {
            (PositionState::Closed, 0u64)
        } else {
            let rem = margin_after_funding
                .checked_sub(loss)
                .ok_or(CoreError::Overflow)?;
            (PositionState::Closed, rem)
        }
    };

    unwind_asset_open_interest(&mut ctx.accounts.asset, position)?;

    let ts = Clock::get()?.unix_timestamp;
    let pm = &mut ctx.accounts.position;
    pm.close_price = close_price;
    pm.close_time = ts;
    pm.state = final_state;

    if vault_pay_trader > 0 {
        // Fail early with a core-level error if vault liquidity is insufficient.
        let vault_ta = {
            let data = ctx.accounts.vault_token_account.try_borrow_data()?;
            TokenAccount::try_deserialize(&mut data.as_ref())?
        };
        require!(
            vault_ta.amount >= vault_pay_trader,
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

    msg!(
        "Position closed: asset={}, close_price={}, liq={}, pay={}",
        asset_id,
        close_price,
        is_liquidation,
        vault_pay_trader
    );

    Ok(())
}

fn validate_close_token_layout(ctx: &Context<ClosePosition>) -> Result<()> {
    let usdc = ctx.accounts.config.usdc_mint;

    let vault_ta = {
        let data = ctx.accounts.vault_token_account.try_borrow_data()?;
        TokenAccount::try_deserialize(&mut data.as_ref())?
    };
    require_keys_eq!(vault_ta.mint, usdc);
    require_keys_eq!(
        ctx.accounts.vault_token_account.key(),
        ctx.accounts.config.vault
    );

    let trader_ta = {
        let data = ctx.accounts.trader_token_account.try_borrow_data()?;
        TokenAccount::try_deserialize(&mut data.as_ref())?
    };
    require_keys_eq!(trader_ta.mint, usdc);
    require_keys_eq!(trader_ta.owner, ctx.accounts.trader.key());

    let core_ta = {
        let data = ctx.accounts.core_collateral_token.try_borrow_data()?;
        TokenAccount::try_deserialize(&mut data.as_ref())?
    };
    require_keys_eq!(core_ta.mint, usdc);
    require_keys_eq!(core_ta.owner, ctx.accounts.settlement_authority.key());

    let vs = {
        let data = ctx.accounts.vault_state.try_borrow_data()?;
        VaultState::try_deserialize(&mut data.as_ref())?
    };
    require_keys_eq!(vs.token_vault, ctx.accounts.vault_token_account.key());
    require_keys_eq!(vs.core, ctx.accounts.settlement_authority.key());

    Ok(())
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
