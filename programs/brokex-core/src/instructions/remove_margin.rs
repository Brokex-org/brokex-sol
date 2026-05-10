use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use brokex_vault::cpi::{accounts::VaultSettle, settle};
use brokex_vault::program::BrokexVault;
use brokex_vault::VaultState;

use crate::constants::*;
use crate::error::CoreError;
use crate::logic::{
    calculate_liquidation_price, capital_delta_close_remove_side, funding_fee_amount,
    funding_index_for_direction, sync_risk_from_oi, touch_asset_funding, trade_lp_locked_capital,
 };
use crate::oracle;
use crate::state::*;

/// Partial close / remove margin: proportional OI, LP lock, risk; realize slice PnL and funding on closed OI (Extended MVP §§18–19).
/// `lp_locked_capital` after a partial is always `trade_lp_locked_capital(remaining_oi, profit_cap)` so per-position lock stays aligned with §11–12.
/// Remaining positions must not be liquidatable at the oracle mark used for this instruction (strict inequality vs liq price).
#[derive(Accounts)]
#[instruction(asset_id: String, trade_id: u64)]
pub struct RemoveMargin<'info> {
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
        constraint = vault_state.key() == config.vault_state @ CoreError::Unauthorized,
        constraint = vault_state.token_vault == vault_token_account.key(),
        constraint = vault_state.core == settlement_authority.key(),
    )]
    pub vault_state: Box<Account<'info, VaultState>>,

    pub token_program: Program<'info, Token>,
}

pub fn remove_margin_handler(
    ctx: Context<RemoveMargin>,
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

    let collateral = ctx.accounts.position.collateral;
    require!(amount > 0, CoreError::InvalidMarginAmount);
    require!(amount <= collateral, CoreError::InvalidMarginAmount);

    let oracle_price = oracle::get_validated_price(
        &ctx.accounts.pyth_price_update,
        &ctx.accounts.asset.pyth_feed.to_bytes(),
        60,
        200,
    )?;

    let close_price = oracle_price;

    let (pos_size, pos_entry, pos_dir, open_idx, pos_lp) = (
        ctx.accounts.position.size,
        ctx.accounts.position.entry_price,
        ctx.accounts.position.direction,
        ctx.accounts.position.open_funding_index,
        ctx.accounts.position.lp_locked_capital,
    );

    let asset = &mut ctx.accounts.asset;
    let now = Clock::get()?.unix_timestamp;
    touch_asset_funding(asset, now)?;
    let cur_idx = funding_index_for_direction(asset, pos_dir);

    let c = collateral as u128;
    let a = amount as u128;

    // Proportional slice from pre-fee margin (spec §19).
    let mut oi_remove = u64::try_from(
        (pos_size as u128)
            .checked_mul(a)
            .ok_or(CoreError::Overflow)?
            .checked_div(c)
            .ok_or(CoreError::Overflow)?,
    )
    .map_err(|_| error!(CoreError::Overflow))?;

    let mut raw_funding = funding_fee_amount(oi_remove, open_idx, cur_idx)?;
    let mut funding_fee = raw_funding.min(collateral);
    let mut collateral_after_funding = collateral.saturating_sub(funding_fee);

    // Draining post-funding margin must not strand OI: if that would leave size>0 with 0 margin, require full-close economics.
    if amount == collateral_after_funding && oi_remove < pos_size {
        let fee_full = funding_fee_amount(pos_size, open_idx, cur_idx)?.min(collateral);
        let collateral_if_full = collateral.saturating_sub(fee_full);
        require!(
            amount == collateral_if_full,
            CoreError::PartialCloseUndercollateralized
        );
        oi_remove = pos_size;
        raw_funding = funding_fee_amount(oi_remove, open_idx, cur_idx)?;
        funding_fee = raw_funding.min(collateral);
        collateral_after_funding = collateral.saturating_sub(funding_fee);
    }

    require!(oi_remove > 0, CoreError::TradeSizeTooSmall);
    require!(oi_remove <= pos_size, CoreError::InvariantViolation);
    require!(
        amount <= collateral_after_funding,
        CoreError::InsufficientMarginAfterFunding
    );

    let size_new = pos_size.saturating_sub(oi_remove);
    let (lp_remove, lp_new) = if size_new == 0 {
        (pos_lp, 0u64)
    } else {
        let lp_remain = trade_lp_locked_capital(size_new, asset.profit_cap_fp)?;
        let rem = pos_lp.checked_sub(lp_remain).ok_or(CoreError::InvariantViolation)?;
        (rem, lp_remain)
    };

    let bump = ctx.bumps.settlement_authority;
    let bump_seed = [bump];
    let signer_seeds: &[&[u8]] = &[SETTLEMENT_SEED, &bump_seed];
    let signers: &[&[&[u8]]] = &[signer_seeds];

    if funding_fee > 0 {
        let cpi_accounts = Transfer {
            from: ctx.accounts.core_collateral_token.to_account_info(),
            to: ctx.accounts.vault_token_account.to_account_info(),
            authority: ctx.accounts.settlement_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info().key(),
            cpi_accounts,
            signers,
        );
        token::transfer(cpi_ctx, funding_fee)?;
    }

    let pnl_total = signed_pnl(pos_size, pos_entry, close_price, pos_dir)?;
    let pnl_slice = if oi_remove == pos_size {
        pnl_total
    } else {
        pnl_total
            .checked_mul(amount as i128)
            .ok_or(CoreError::Overflow)?
            .checked_div(collateral as i128)
            .ok_or(CoreError::Overflow)?
    };

    let (core_pay_trader, vault_pay_trader_profit, vault_collect_loss) = if pnl_slice >= 0 {
        let profit = u64::try_from(pnl_slice).map_err(|_| error!(CoreError::Overflow))?;
        (amount, profit, 0u64)
    } else {
        let loss = u64::try_from(-pnl_slice).map_err(|_| error!(CoreError::Overflow))?;
        let collected = std::cmp::min(loss, amount);
        let rem = amount.saturating_sub(collected);
        (rem, 0u64, collected)
    };

    let (new_rl, new_rs, delta_unlocked) = capital_delta_close_remove_side(
        asset.lp_locked_long,
        asset.lp_locked_short,
        pos_dir == PositionDirection::Long,
        lp_remove,
        asset.alpha_min_fp,
        asset.alpha_scale,
    )?;

    if delta_unlocked > 0 {
        let cpi_accounts = brokex_vault::cpi::accounts::UpdateLockedCapital {
            caller: ctx.accounts.settlement_authority.to_account_info(),
            vault_state: ctx.accounts.vault_state.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.vault_program.to_account_info().key(),
            cpi_accounts,
            signers,
        );
        brokex_vault::cpi::update_locked_capital(cpi_ctx, -(delta_unlocked as i64))?;
    }

    let priced_remove = (oi_remove as u128)
        .checked_mul(pos_entry as u128)
        .ok_or(CoreError::Overflow)?;

    if pos_dir == PositionDirection::Long {
        asset.oi_long = asset
            .oi_long
            .checked_sub(oi_remove)
            .ok_or(CoreError::InvariantViolation)?;
        asset.sum_priced_oi_long = asset
            .sum_priced_oi_long
            .checked_sub(priced_remove)
            .ok_or(CoreError::InvariantViolation)?;
    } else {
        asset.oi_short = asset
            .oi_short
            .checked_sub(oi_remove)
            .ok_or(CoreError::InvariantViolation)?;
        asset.sum_priced_oi_short = asset
            .sum_priced_oi_short
            .checked_sub(priced_remove)
            .ok_or(CoreError::InvariantViolation)?;
    }
    asset.lp_locked_long = new_rl;
    asset.lp_locked_short = new_rs;
    sync_risk_from_oi(asset);

    let collateral_new = collateral_after_funding.saturating_sub(amount);

    require!(
        (size_new == 0 && collateral_new == 0) || (size_new > 0 && collateral_new > 0),
        CoreError::PartialCloseUndercollateralized
    );

    let pm = &mut ctx.accounts.position;
    pm.size = size_new;
    pm.collateral = collateral_new;
    pm.lp_locked_capital = lp_new;

    if size_new == 0 {
        require!(collateral_new == 0, CoreError::InvariantViolation);
        pm.state = PositionState::Closed;
        pm.liquidation_price = 0;
        pm.close_price = close_price;
        pm.close_time = now;
    } else {
        pm.state = PositionState::Open;
        pm.liquidation_price = calculate_liquidation_price(
            pm.entry_price,
            size_new,
            collateral_new,
            pm.direction,
        )?;
        match pm.direction {
            PositionDirection::Long => {
                require!(
                    close_price > pm.liquidation_price,
                    CoreError::PositionUnhealthyAfterMarginRemoval
                );
            }
            PositionDirection::Short => {
                require!(
                    close_price < pm.liquidation_price,
                    CoreError::PositionUnhealthyAfterMarginRemoval
                );
            }
        }
    }

    if core_pay_trader > 0 {
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
        token::transfer(cpi_ctx, core_pay_trader)?;
    }

    if vault_pay_trader_profit > 0 || vault_collect_loss > 0 {
        let cpi_accounts = VaultSettle {
            caller: ctx.accounts.settlement_authority.to_account_info(),
            vault_state: ctx.accounts.vault_state.to_account_info(),
            vault_token: ctx.accounts.vault_token_account.to_account_info(),
            core_collateral_token: ctx.accounts.core_collateral_token.to_account_info(),
            trader_token: ctx.accounts.trader_token_account.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
        };
        let cpi_ctx =
            CpiContext::new_with_signer(ctx.accounts.vault_program.to_account_info().key(), cpi_accounts, signers);
        settle(cpi_ctx, vault_pay_trader_profit, vault_collect_loss)?;
    }

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
