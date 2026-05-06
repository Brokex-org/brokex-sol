use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::*;
use crate::constants::*;
use crate::oracle;
use crate::error::CoreError;
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
    action_type: ActionType,
) -> Result<()> {
    let oracle_price = oracle::get_validated_price(
        &ctx.accounts.pyth_price_update,
        &ctx.accounts.asset.pyth_feed.to_bytes(),
        60,
        200,
    )?;

    // Iterate through remaining accounts (positions)
    // For SL/TP/Close, we expect pairs: [Position, TraderTokenAccount]
    // For ConditionalOpen, we just need [Position]
    let mut it = ctx.remaining_accounts.iter();
    while let Some(position_info) = it.next() {
        // Identify if we need a trader account for this action
        let trader_token_account = if action_type != ActionType::ConditionalOrderExecute {
            it.next() // Pull the next account as the trader account
        } else {
            None
        };

        if let Err(e) = execute_single_trade(&mut ctx, &asset_id, action_type, position_info, trader_token_account, oracle_price) {
            msg!("Skipping trade {}: {:?}", position_info.key(), e);
            continue;
        }
    }

    Ok(())
}

fn execute_single_trade<'info>(
    ctx: &mut Context<'info, ExecuteBatch<'info>>,
    asset_id: &str,
    action_type: ActionType,
    position_info: &AccountInfo<'info>,
    trader_token_account: Option<&AccountInfo<'info>>,
    oracle_price: u64,
) -> Result<()> {
    //  Basic Account Validation
    let mut position = {
        let position_data = position_info.try_borrow_data()?;
        Position::try_deserialize(&mut position_data.as_ref())?
    };

    // Verify seeds
    let trade_id_bytes = position.trade_id.to_le_bytes();
    let seeds = [
        POSITION_SEED,
        position.trader.as_ref(),
        asset_id.as_bytes(),
        trade_id_bytes.as_ref(),
    ];
    let (expected_pda, _bump) = Pubkey::find_program_address(&seeds, ctx.program_id);
    require!(position_info.key() == expected_pda, CoreError::Unauthorized);

    // Check Logic based on ActionType
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
        ActionType::StopLoss | ActionType::TakeProfit | ActionType::MarketClose => {
            require!(position.state == PositionState::Open, CoreError::Unauthorized);
            let trader_account = trader_token_account.ok_or(CoreError::Unauthorized)?;
            
            let trigger = match action_type {
                ActionType::StopLoss => {
                    if position.direction == PositionDirection::Long {
                        oracle_price <= position.sl_price
                    } else {
                        oracle_price >= position.sl_price
                    }
                },
                ActionType::TakeProfit => {
                    if position.direction == PositionDirection::Long {
                        oracle_price >= position.tp_price
                    } else {
                        oracle_price <= position.tp_price
                    }
                },
                ActionType::MarketClose => true,
                _ => false,
            };

            if !trigger { return Err(CoreError::Unauthorized.into()); }
            execute_order_close(ctx, &mut position, position_info, trader_account, oracle_price)?;
        },
        _ => return Err(CoreError::Unauthorized.into()),
    }

    Ok(())
}

fn execute_order_open<'info>(
    ctx: &mut Context<'info, ExecuteBatch<'info>>,
    position: &mut Position,
    position_info: &AccountInfo<'info>,
    execution_price: u64,
) -> Result<()> {
    let asset = &mut ctx.accounts.asset;
    let collateral = position.collateral; 
    
    // Calculate Commission
    let commission = collateral
        .checked_mul(asset.commission_open_bps)
        .ok_or(CoreError::Overflow)?
        / 10_000;
    
    let margin = collateral.saturating_sub(commission);
    let oi = margin.checked_mul(position.leverage as u64).ok_or(CoreError::Overflow)?;

    // Capital Locking Logic
    let locked_before = std::cmp::max(asset.lp_locked_long, asset.lp_locked_short);
    let (new_lp_locked_long, new_lp_locked_short) = if position.direction == PositionDirection::Long {
        (asset.lp_locked_long.checked_add(oi).ok_or(CoreError::Overflow)?, asset.lp_locked_short)
    } else {
        (asset.lp_locked_long, asset.lp_locked_short.checked_add(oi).ok_or(CoreError::Overflow)?)
    };
    let locked_after = std::cmp::max(new_lp_locked_long, new_lp_locked_short);
    let delta_locked = locked_after.saturating_sub(locked_before);

    // Verify Vault free liquidity
    let vault_balance = ctx.accounts.vault_token_account.amount;
    let free_capital = vault_balance.saturating_sub(ctx.accounts.vault_state.total_locked_capital);
    require!(free_capital >= delta_locked, CoreError::InsufficientVaultLiquidity);

    let bump = ctx.bumps.settlement_authority;
    let bump_seed = [bump];
    let signer_seeds: &[&[u8]] = &[SETTLEMENT_SEED, &bump_seed];
    let signers: &[&[&[u8]]] = &[signer_seeds];

    // Transfer Commission from Core to Vault
    if commission > 0 {
        let cpi_accounts = Transfer {
            from: ctx.accounts.core_collateral_token.to_account_info(),
            to: ctx.accounts.vault_token_account.to_account_info(),
            authority: ctx.accounts.settlement_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info().key(), cpi_accounts, signers);
        token::transfer(cpi_ctx, commission)?;
    }

    // Update Vault Locked Capital via CPI
    if delta_locked > 0 {
        let cpi_accounts = brokex_vault::cpi::accounts::UpdateLockedCapital {
            caller: ctx.accounts.settlement_authority.to_account_info(),
            vault_state: ctx.accounts.vault_state.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(ctx.accounts.vault_program.to_account_info().key(), cpi_accounts, signers);
        brokex_vault::cpi::update_locked_capital(cpi_ctx, delta_locked as i64)?;
    }

    // Update Asset State
    if position.direction == PositionDirection::Long {
        asset.oi_long = asset.oi_long.checked_add(oi).ok_or(CoreError::Overflow)?;
        asset.lp_locked_long = asset.lp_locked_long.checked_add(oi).ok_or(CoreError::Overflow)?;
        let priced_oi = (oi as u128).checked_mul(execution_price as u128).ok_or(CoreError::Overflow)?;
        asset.sum_priced_oi_long = asset.sum_priced_oi_long.checked_add(priced_oi).ok_or(CoreError::Overflow)?;
    } else {
        asset.oi_short = asset.oi_short.checked_add(oi).ok_or(CoreError::Overflow)?;
        asset.lp_locked_short = asset.lp_locked_short.checked_add(oi).ok_or(CoreError::Overflow)?;
        let priced_oi = (oi as u128).checked_mul(execution_price as u128).ok_or(CoreError::Overflow)?;
        asset.sum_priced_oi_short = asset.sum_priced_oi_short.checked_add(priced_oi).ok_or(CoreError::Overflow)?;
    }

    //  Update Position
    position.collateral = margin;
    position.size = oi;
    position.entry_price = execution_price;
    position.lp_locked_capital = oi;
    position.state = PositionState::Open;
    position.execution_status = ExecutionStatus::Executed;
    position.open_time = Clock::get()?.unix_timestamp;
    
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
    execution_price: u64,
) -> Result<()> {
    let pnl = signed_pnl(position.size, position.entry_price, execution_price, position.direction)?;
    
    let (vault_pay_trader_profit, vault_collect_loss, core_pay_trader) = if pnl >= 0 {
        let profit = u64::try_from(pnl).map_err(|_| CoreError::Overflow)?;
        (profit, 0, position.collateral)
    } else {
        let loss = u64::try_from(-pnl).map_err(|_| CoreError::Overflow)?;
        let collected = std::cmp::min(loss, position.collateral);
        let rem = position.collateral.saturating_sub(collected);
        (0, collected, rem)
    };

    let asset = &mut ctx.accounts.asset;
    let locked_before = std::cmp::max(asset.lp_locked_long, asset.lp_locked_short);
    
    let priced_oi = (position.size as u128).checked_mul(position.entry_price as u128).ok_or(CoreError::Overflow)?;
    if position.direction == PositionDirection::Long {
        asset.oi_long = asset.oi_long.saturating_sub(position.size);
        asset.lp_locked_long = asset.lp_locked_long.saturating_sub(position.size);
        asset.sum_priced_oi_long = asset.sum_priced_oi_long.saturating_sub(priced_oi);
    } else {
        asset.oi_short = asset.oi_short.saturating_sub(position.size);
        asset.lp_locked_short = asset.lp_locked_short.saturating_sub(position.size);
        asset.sum_priced_oi_short = asset.sum_priced_oi_short.saturating_sub(priced_oi);
    }

    let locked_after = std::cmp::max(asset.lp_locked_long, asset.lp_locked_short);
    let delta_unlocked = locked_before.saturating_sub(locked_after);

    let bump = ctx.bumps.settlement_authority;
    let bump_seed = [bump];
    let signer_seeds: &[&[u8]] = &[SETTLEMENT_SEED, &bump_seed];
    let signers: &[&[&[u8]]] = &[signer_seeds];

    // Unlock Capital in Vault
    if delta_unlocked > 0 {
        let cpi_accounts = brokex_vault::cpi::accounts::UpdateLockedCapital {
            caller: ctx.accounts.settlement_authority.to_account_info(),
            vault_state: ctx.accounts.vault_state.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(ctx.accounts.vault_program.to_account_info().key(), cpi_accounts, signers);
        brokex_vault::cpi::update_locked_capital(cpi_ctx, -(delta_unlocked as i64))?;
    }

    // Return Collateral from Core to Trader
    if core_pay_trader > 0 {
        let cpi_accounts = Transfer {
            from: ctx.accounts.core_collateral_token.to_account_info(),
            to: trader_token_account.to_account_info(),
            authority: ctx.accounts.settlement_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info().key(), cpi_accounts, signers);
        token::transfer(cpi_ctx, core_pay_trader)?;
    }

    //  Vault Settlement (Profit payout or Loss collection)
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

    // Update Position State
    position.state = PositionState::Closed;
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
