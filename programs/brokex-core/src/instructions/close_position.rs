use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use brokex_vault::cpi::{accounts::VaultSettle, settle};
use brokex_vault::program::BrokexVault;
use brokex_vault::VaultState;

use crate::constants::*;
use crate::error::CoreError;
use crate::logic::execution_price_with_spread;
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

    let (oi_long, oi_short, base_spread_bps, pos_direction, pos_size) = {
        let asset = &ctx.accounts.asset;
        (
            asset.oi_long,
            asset.oi_short,
            asset.base_spread_bps,
            ctx.accounts.position.direction,
            ctx.accounts.position.size,
        )
    };

    let close_price = execution_price_with_spread(
        oracle_price,
        base_spread_bps,
        pos_direction,
        true,
        oi_long,
        oi_short,
    )?;

    let asset = &mut ctx.accounts.asset;

    // Capital Unlocking Logic 
    let locked_before = std::cmp::max(asset.lp_locked_long, asset.lp_locked_short);
    
    let (new_lp_locked_long, new_lp_locked_short) = if pos_direction == PositionDirection::Long {
        (
            asset
                .lp_locked_long
                .checked_sub(pos_size)
                .ok_or(CoreError::InvariantViolation)?,
            asset.lp_locked_short,
        )
    } else {
        (
            asset.lp_locked_long,
            asset
                .lp_locked_short
                .checked_sub(pos_size)
                .ok_or(CoreError::InvariantViolation)?,
        )
    };
    let locked_after = std::cmp::max(new_lp_locked_long, new_lp_locked_short);
    let delta_unlocked = locked_before.saturating_sub(locked_after);

    // Settlement Calculation
    let (final_state, core_pay_trader, vault_pay_trader_profit, vault_collect_loss) =
        calculate_settlement(&ctx.accounts.position, close_price)?;
    
    // Internal state updates
    unwind_asset_open_interest(asset, &ctx.accounts.position)?;
    
    let ts = Clock::get()?.unix_timestamp;
    let pm = &mut ctx.accounts.position;
    pm.close_price = close_price;
    pm.close_time = ts;
    pm.state = final_state;

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

    // Core returns collateral (or remaining collateral) to the trader.
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

    // Vault settlement must be one-sided: either pay profit or collect loss.
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

    msg!("Position closed: ID={}, Price={}, Unlocked={}", asset_id, close_price, delta_unlocked);

    Ok(())
}

fn calculate_settlement(
    position: &Position,
    close_price: u64,
) -> Result<(PositionState, u64, u64, u64)> {
    let pnl = signed_pnl(
        position.size,
        position.entry_price,
        close_price,
        position.direction,
    )?;

    if pnl >= 0 {
        // Profitable: core returns full collateral; vault pays profit.
        let profit = u64::try_from(pnl).map_err(|_| error!(CoreError::Overflow))?;
        Ok((PositionState::Closed, position.collateral, profit, 0))
    } else {
        let loss = u64::try_from(-pnl).map_err(|_| error!(CoreError::Overflow))?;
        let collected = std::cmp::min(loss, position.collateral);
        let rem = position.collateral.saturating_sub(collected);
        Ok((PositionState::Closed, rem, 0, collected))
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
            .ok_or(CoreError::InvariantViolation)?;
        asset.lp_locked_long = asset
            .lp_locked_long
            .checked_sub(position.size)
            .ok_or(CoreError::InvariantViolation)?;
        asset.sum_priced_oi_long = asset
            .sum_priced_oi_long
            .checked_sub(priced_oi)
            .ok_or(CoreError::InvariantViolation)?;
    } else {
        asset.oi_short = asset
            .oi_short
            .checked_sub(position.size)
            .ok_or(CoreError::InvariantViolation)?;
        asset.lp_locked_short = asset
            .lp_locked_short
            .checked_sub(position.size)
            .ok_or(CoreError::InvariantViolation)?;
        asset.sum_priced_oi_short = asset
            .sum_priced_oi_short
            .checked_sub(priced_oi)
            .ok_or(CoreError::InvariantViolation)?;
    }

    Ok(())
}
