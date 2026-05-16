use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::*;
use crate::constants::*;
use crate::oracle;
use crate::error::CoreError;
use crate::logic::{
    calculate_liquidation_price, capital_delta_close_remove_side, capital_delta_open_add_side,
    execution_price_with_spread, funding_fee_amount, funding_index_for_direction, sync_risk_from_oi,
    touch_asset_funding, trade_lp_locked_capital, validate_sl_tp,
};
use brokex_vault::cpi::{accounts::VaultSettle, settle};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum ActionType {
    MarketClose,
    Liquidation,
    StopLoss,
    TakeProfit,
    ConditionalOrderExecute,
}

#[derive(Accounts)]
#[instruction(asset_id: String)]
pub struct ExecuteBatch<'info> {
    pub keeper: Signer<'info>,

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
        constraint = asset.is_enabled @ CoreError::AssetDisabled
    )]
    pub asset: Box<Account<'info, Asset>>,

    /// CHECK: Validated in oracle::get_validated_price
    pub pyth_price_update: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = vault_token_account.key() == config.vault,
        constraint = vault_token_account.mint == config.usdc_mint
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = core_collateral_token.owner == settlement_authority.key(),
        constraint = core_collateral_token.mint == config.usdc_mint
    )]
    pub core_collateral_token: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = vault_state.key() == config.vault_state @ CoreError::Unauthorized,
    )]
    pub vault_state: Box<Account<'info, brokex_vault::state::VaultState>>,

    /// CHECK: PDA signer for vault CPI; must match `VaultState.core`.
    #[account(seeds = [SETTLEMENT_SEED], bump)]
    pub settlement_authority: UncheckedAccount<'info>,

    pub vault_program: Program<'info, brokex_vault::program::BrokexVault>,
    pub token_program: Program<'info, Token>,
}

pub fn execute_batch_handler<'info>(
    mut ctx: Context<'info, ExecuteBatch<'info>>,
    asset_id: String,
    trade_ids: Vec<u64>,
    action_types: Vec<ActionType>,
) -> Result<()> {
    require!(trade_ids.len() == action_types.len(), CoreError::InvalidBatchInput);

    let oracle_price = oracle::get_validated_price(
        &ctx.accounts.pyth_price_update,
        &ctx.accounts.asset.pyth_feed.to_bytes(),
        60,
        200,
    )?;

    let mut it = ctx.remaining_accounts.iter();
    for (trade_id, action_type) in trade_ids.into_iter().zip(action_types.into_iter()) {
        let position_info = match it.next() {
            Some(acc) => acc,
            None => break,
        };

        let trader_token_account = if requires_trader_token(action_type) {
            it.next()
        } else {
            None
        };

        if let Err(e) = execute_single_trade(
            &mut ctx,
            &asset_id,
            trade_id,
            action_type,
            position_info,
            trader_token_account,
            oracle_price,
        ) {
            msg!("Skipping trade {}: {:?}", position_info.key(), e);
        }
    }

    Ok(())
}

fn requires_trader_token(action_type: ActionType) -> bool {
    matches!(
        action_type,
        ActionType::StopLoss | ActionType::TakeProfit | ActionType::MarketClose | ActionType::Liquidation
    )
}

fn execute_single_trade<'info>(
    ctx: &mut Context<'info, ExecuteBatch<'info>>,
    asset_id: &str,
    trade_id: u64,
    action_type: ActionType,
    position_info: &AccountInfo<'info>,
    trader_token_account: Option<&AccountInfo<'info>>,
    oracle_price: u64,
) -> Result<()> {
    let mut position = {
        let position_data = position_info.try_borrow_data()?;
        Position::try_deserialize(&mut position_data.as_ref())?
    };

    require!(position.trade_id == trade_id, CoreError::Unauthorized);
    require!(position.asset_id == asset_id, CoreError::Unauthorized);

    let trade_id_bytes = trade_id.to_le_bytes();
    let seeds = [
        POSITION_SEED,
        position.trader.as_ref(),
        asset_id.as_bytes(),
        trade_id_bytes.as_ref(),
    ];
    let (expected_pda, _bump) = Pubkey::find_program_address(&seeds, ctx.program_id);
    require!(position_info.key() == expected_pda, CoreError::Unauthorized);

    match action_type {
        ActionType::ConditionalOrderExecute => {
            require!(position.state == PositionState::Pending, CoreError::Unauthorized);

            let can_execute = match position.order_type {
                OrderType::Limit => {
                    if position.direction == PositionDirection::Long {
                        oracle_price <= position.target_price
                    } else {
                        oracle_price >= position.target_price
                    }
                },
                OrderType::Stop => {
                    if position.direction == PositionDirection::Long {
                        oracle_price >= position.target_price
                    } else {
                        oracle_price <= position.target_price
                    }
                },
                _ => false,
            };

            if !can_execute { return Err(CoreError::Unauthorized.into()); }
            execute_order_open(ctx, &mut position, position_info, oracle_price)?;
        },
        ActionType::StopLoss | ActionType::TakeProfit | ActionType::MarketClose | ActionType::Liquidation => {
            require!(position.state == PositionState::Open, CoreError::Unauthorized);
            let trader_account = trader_token_account.ok_or(CoreError::Unauthorized)?;

            let trigger = match action_type {
                ActionType::StopLoss => {
                    if position.sl_price == 0 {
                        false
                    } else if position.direction == PositionDirection::Long {
                        oracle_price <= position.sl_price
                    } else {
                        oracle_price >= position.sl_price
                    }
                },
                ActionType::TakeProfit => {
                    if position.tp_price == 0 {
                        false
                    } else if position.direction == PositionDirection::Long {
                        oracle_price >= position.tp_price
                    } else {
                        oracle_price <= position.tp_price
                    }
                },
                ActionType::Liquidation => {
                    if position.liquidation_price == 0 {
                        false
                    } else if position.direction == PositionDirection::Long {
                        oracle_price <= position.liquidation_price
                    } else {
                        oracle_price >= position.liquidation_price
                    }
                }
                ActionType::MarketClose => true,
                _ => false,
            };

            if !trigger { return Err(CoreError::Unauthorized.into()); }
            execute_order_close(
                ctx,
                &mut position,
                position_info,
                trader_account,
                oracle_price,
                action_type == ActionType::Liquidation,
            )?;
        }
    }

    Ok(())
}

fn execute_order_open<'info>(
    ctx: &mut Context<'info, ExecuteBatch<'info>>,
    position: &mut Position,
    position_info: &AccountInfo<'info>,
    oracle_price: u64,
) -> Result<()> {
    let (oi_long, oi_short, base_spread_fp, base_spread_bps, commission_open_bps) = {
        let a = &ctx.accounts.asset;
        (
            a.oi_long,
            a.oi_short,
            a.base_spread_fp,
            a.base_spread_bps,
            a.commission_open_bps,
        )
    };
    let execution_price = execution_price_with_spread(
        oracle_price,
        base_spread_fp,
        base_spread_bps,
        position.direction,
        false,
        oi_long,
        oi_short,
    )?;

    validate_sl_tp(execution_price, position.direction, position.sl_price, position.tp_price)?;

    let asset = &mut ctx.accounts.asset;
    let ts = Clock::get()?.unix_timestamp;
    touch_asset_funding(asset, ts)?;
    position.open_funding_index = funding_index_for_direction(asset, position.direction);

    let collateral = position.collateral;

    let commission = collateral
        .checked_mul(commission_open_bps)
        .ok_or(CoreError::Overflow)?
        / 10_000;

    let margin = collateral.saturating_sub(commission);
    let oi = margin.checked_mul(position.leverage as u64).ok_or(CoreError::Overflow)?;

    let contrib = trade_lp_locked_capital(oi, asset.profit_cap_fp)?;
    let (new_rl, new_rs, delta_locked) = capital_delta_open_add_side(
        asset.lp_locked_long,
        asset.lp_locked_short,
        position.direction == PositionDirection::Long,
        contrib,
        asset.alpha_min_fp,
        asset.alpha_scale,
    )?;

    let vault_balance = ctx.accounts.vault_token_account.amount;
    let free_capital = vault_balance.saturating_sub(ctx.accounts.vault_state.total_locked_capital);
    require!(free_capital >= delta_locked, CoreError::InsufficientVaultLiquidity);

    let bump = ctx.bumps.settlement_authority;
    let bump_seed = [bump];
    let signer_seeds: &[&[u8]] = &[SETTLEMENT_SEED, &bump_seed];
    let signers: &[&[&[u8]]] = &[signer_seeds];

    if commission > 0 {
        let cpi_accounts = Transfer {
            from: ctx.accounts.core_collateral_token.to_account_info(),
            to: ctx.accounts.vault_token_account.to_account_info(),
            authority: ctx.accounts.settlement_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info().key(), cpi_accounts, signers);
        token::transfer(cpi_ctx, commission)?;
    }

    if delta_locked > 0 {
        let cpi_accounts = brokex_vault::cpi::accounts::UpdateLockedCapital {
            caller: ctx.accounts.settlement_authority.to_account_info(),
            vault_state: ctx.accounts.vault_state.to_account_info(),
            vault_token: ctx.accounts.vault_token_account.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(ctx.accounts.vault_program.to_account_info().key(), cpi_accounts, signers);
        brokex_vault::cpi::update_locked_capital(cpi_ctx, delta_locked as i64)?;
    }

    if position.direction == PositionDirection::Long {
        asset.oi_long = asset.oi_long.checked_add(oi).ok_or(CoreError::Overflow)?;
        let priced_oi = (oi as u128).checked_mul(execution_price as u128).ok_or(CoreError::Overflow)?;
        asset.sum_priced_oi_long = asset.sum_priced_oi_long.checked_add(priced_oi).ok_or(CoreError::Overflow)?;
    } else {
        asset.oi_short = asset.oi_short.checked_add(oi).ok_or(CoreError::Overflow)?;
        let priced_oi = (oi as u128).checked_mul(execution_price as u128).ok_or(CoreError::Overflow)?;
        asset.sum_priced_oi_short = asset.sum_priced_oi_short.checked_add(priced_oi).ok_or(CoreError::Overflow)?;
    }
    sync_risk_from_oi(asset);
    asset.lp_locked_long = new_rl;
    asset.lp_locked_short = new_rs;

    position.collateral = margin;
    position.size = oi;
    position.entry_price = execution_price;
    position.liquidation_price = calculate_liquidation_price(
        execution_price,
        oi,
        margin,
        position.direction,
        asset.liquidation_threshold_bps,
    )?;
    position.lp_locked_capital = contrib;
    position.state = PositionState::Open;
    position.execution_status = ExecutionStatus::Executed;
    position.open_time = ts;

    let mut data = position_info.try_borrow_mut_data()?;
    let mut writer: &mut [u8] = &mut data[8..];
    position.serialize(&mut writer)?;

    Ok(())
}

fn execute_order_close<'info>(
    ctx: &mut Context<'info, ExecuteBatch<'info>>,
    position: &mut Position,
    position_info: &AccountInfo<'info>,
    trader_token_account: &AccountInfo<'info>,
    oracle_price: u64,
    is_liquidation: bool,
) -> Result<()> {
    let (oi_long, oi_short, base_spread_fp, base_spread_bps) = {
        let a = &ctx.accounts.asset;
        (a.oi_long, a.oi_short, a.base_spread_fp, a.base_spread_bps)
    };
    let execution_price = execution_price_with_spread(
        oracle_price,
        base_spread_fp,
        base_spread_bps,
        position.direction,
        true,
        oi_long,
        oi_short,
    )?;

    let oi = position.size;
    let open_idx = position.open_funding_index;
    let col = position.collateral;

    let asset = &mut ctx.accounts.asset;
    let now = Clock::get()?.unix_timestamp;
    touch_asset_funding(asset, now)?;
    let cur_idx = funding_index_for_direction(asset, position.direction);
    let raw_funding = funding_fee_amount(oi, open_idx, cur_idx)?;
    let funding_fee = raw_funding.min(col);
    let effective_collateral = col.saturating_sub(funding_fee);

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

    let pnl = signed_pnl(
        position.size,
        position.entry_price,
        execution_price,
        position.direction,
    )?;

    let (vault_pay_trader_profit, vault_collect_loss, core_pay_trader) = if is_liquidation {
        (0, effective_collateral, 0)
    } else if pnl >= 0 {
        let profit = u64::try_from(pnl).map_err(|_| CoreError::Overflow)?;
        (profit, 0, effective_collateral)
    } else {
        let loss = u64::try_from(-pnl).map_err(|_| CoreError::Overflow)?;
        let collected = std::cmp::min(loss, effective_collateral);
        let rem = effective_collateral.saturating_sub(collected);
        (0, collected, rem)
    };

    let contrib = position.lp_locked_capital;
    let (new_rl, new_rs, delta_unlocked) = capital_delta_close_remove_side(
        asset.lp_locked_long,
        asset.lp_locked_short,
        position.direction == PositionDirection::Long,
        contrib,
        asset.alpha_min_fp,
        asset.alpha_scale,
    )?;

    if delta_unlocked > 0 {
        let cpi_accounts = brokex_vault::cpi::accounts::UpdateLockedCapital {
            caller: ctx.accounts.settlement_authority.to_account_info(),
            vault_state: ctx.accounts.vault_state.to_account_info(),
            vault_token: ctx.accounts.vault_token_account.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(ctx.accounts.vault_program.to_account_info().key(), cpi_accounts, signers);
        brokex_vault::cpi::update_locked_capital(cpi_ctx, -(delta_unlocked as i64))?;
    }

    if core_pay_trader > 0 {
        let cpi_accounts = Transfer {
            from: ctx.accounts.core_collateral_token.to_account_info(),
            to: trader_token_account.to_account_info(),
            authority: ctx.accounts.settlement_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info().key(), cpi_accounts, signers);
        token::transfer(cpi_ctx, core_pay_trader)?;
    }

    if vault_pay_trader_profit > 0 || vault_collect_loss > 0 {
        let cpi_accounts = VaultSettle {
            caller: ctx.accounts.settlement_authority.to_account_info(),
            vault_state: ctx.accounts.vault_state.to_account_info(),
            vault_token: ctx.accounts.vault_token_account.to_account_info(),
            core_collateral_token: ctx.accounts.core_collateral_token.to_account_info(),
            trader_token: trader_token_account.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(ctx.accounts.vault_program.to_account_info().key(), cpi_accounts, signers);
        settle(cpi_ctx, vault_pay_trader_profit, vault_collect_loss)?;
    }

    let priced_oi = (position.size as u128).checked_mul(position.entry_price as u128).ok_or(CoreError::Overflow)?;
    if position.direction == PositionDirection::Long {
        asset.oi_long = asset
            .oi_long
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
        asset.sum_priced_oi_short = asset
            .sum_priced_oi_short
            .checked_sub(priced_oi)
            .ok_or(CoreError::InvariantViolation)?;
    }
    asset.lp_locked_long = new_rl;
    asset.lp_locked_short = new_rs;
    sync_risk_from_oi(asset);

    position.state = if is_liquidation {
        PositionState::Liquidated
    } else {
        PositionState::Closed
    };
    position.close_price = execution_price;
    position.close_time = Clock::get()?.unix_timestamp;

    let mut data = position_info.try_borrow_mut_data()?;
    let mut writer: &mut [u8] = &mut data[8..];
    position.serialize(&mut writer)?;

    Ok(())
}

fn signed_pnl(size: u64, entry: u64, exit: u64, direction: PositionDirection) -> Result<i128> {
    let size_i = i128::from(size);
    let entry_i = i128::from(entry);
    let exit_i = i128::from(exit);
    let delta = match direction {
        PositionDirection::Long => exit_i.checked_sub(entry_i).ok_or(CoreError::Overflow)?,
        PositionDirection::Short => entry_i.checked_sub(exit_i).ok_or(CoreError::Overflow)?,
    };
    size_i.checked_mul(delta).ok_or(CoreError::Overflow)?.checked_div(entry_i).ok_or(CoreError::Overflow.into())
}
