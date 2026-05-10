use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::*;
use crate::constants::*;
use crate::oracle;
use crate::error::CoreError;
use crate::logic::{
    calculate_liquidation_price, capital_delta_open_add_side, execution_price_with_spread,
    funding_index_for_direction, sync_risk_from_oi, touch_asset_funding, trade_lp_locked_capital,
    validate_sl_tp,
};

#[derive(Accounts)]
#[instruction(asset_id: String)]
pub struct OpenPosition<'info> {
    #[account(mut)]
    pub trader: Signer<'info>,

    #[account(
        mut,
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

    /// Position PDA: Supports multiple positions per trader per asset via global position id.
    #[account(
        init,
        payer = trader,
        space = 8 + Position::INIT_SPACE,
        seeds = [
            POSITION_SEED, 
            trader.key().as_ref(), 
            asset_id.as_bytes(), 
            config.next_position_id.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub position: Box<Account<'info, Position>>,

    #[account(
        mut,
        constraint = trader_token_account.mint == config.usdc_mint,
        constraint = trader_token_account.owner == trader.key()
    )]
    pub trader_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = vault_token_account.key() == config.vault,
        constraint = vault_token_account.mint == config.usdc_mint @ CoreError::Unauthorized
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
    pub system_program: Program<'info, System>,
}

pub fn open_position_handler(
    ctx: Context<OpenPosition>,
    asset_id: String,
    collateral: u64,
    leverage: u8,
    direction: PositionDirection,
    order_type: OrderType,
    target_price: u64,
    sl_price: u64,
    tp_price: u64,
) -> Result<()> {
    let position_id = ctx.accounts.config.next_position_id;
    let asset = &mut ctx.accounts.asset;

    // Basic Validations
    require!(leverage > 0, CoreError::Overflow);

    let ts = Clock::get()?.unix_timestamp;
    touch_asset_funding(asset, ts)?;

    // Validate price using the oracle logic
    let oracle_price = oracle::get_validated_price(
        &ctx.accounts.pyth_price_update,
        &asset.pyth_feed.to_bytes(),
        60,
        200,
    )?;

    let entry_price = execution_price_with_spread(
        oracle_price,
        asset.base_spread_bps,
        direction,
        false,
        asset.oi_long,
        asset.oi_short,
    )?;

    // For Market orders, we charge commission and execute immediately.
    // For Limit/Stop orders, we only transfer collateral; commission and execution happen later.
    let is_market = order_type == OrderType::Market;
    let open_funding_snap = if is_market {
        funding_index_for_direction(asset, direction)
    } else {
        0u128
    };
    let mut margin = collateral;

    if is_market {
        // Calculate Commission
        let commission = collateral
            .checked_mul(asset.commission_open_bps)
            .ok_or(CoreError::Overflow)?
            / 10_000;
        
        margin = collateral.saturating_sub(commission);
        
        // Transfer Commission to Vault
        if commission > 0 {
            let cpi_accounts = Transfer {
                from: ctx.accounts.trader_token_account.to_account_info(),
                to: ctx.accounts.vault_token_account.to_account_info(),
                authority: ctx.accounts.trader.to_account_info(),
            };
            let cpi_ctx =
                CpiContext::new(ctx.accounts.token_program.to_account_info().key(), cpi_accounts);
            token::transfer(cpi_ctx, commission)?;
        }
    }

    // Core holds the trader's net collateral (margin) while the position is pending or open.
    if margin > 0 {
        let cpi_accounts = Transfer {
            from: ctx.accounts.trader_token_account.to_account_info(),
            to: ctx.accounts.core_collateral_token.to_account_info(),
            authority: ctx.accounts.trader.to_account_info(),
        };
        let cpi_ctx =
            CpiContext::new(ctx.accounts.token_program.to_account_info().key(), cpi_accounts);
        token::transfer(cpi_ctx, margin)?;
    }

    let oi = margin
        .checked_mul(leverage as u64)
        .ok_or(CoreError::Overflow)?;

    let mut delta_locked = 0;
    let mut actual_entry_price = 0;
    let mut lp_cap_for_position = 0u64;

    if is_market {
        actual_entry_price = entry_price;
        validate_sl_tp(actual_entry_price, direction, sl_price, tp_price)?;

        let contrib = trade_lp_locked_capital(oi, asset.profit_cap_fp)?;
        lp_cap_for_position = contrib;
        let (new_rl, new_rs, d_lock) = capital_delta_open_add_side(
            asset.lp_locked_long,
            asset.lp_locked_short,
            direction == PositionDirection::Long,
            contrib,
            asset.alpha_min_fp,
            asset.alpha_scale,
        )?;
        delta_locked = d_lock;

        // Trade Acceptance Rule 
        let vault_balance = ctx.accounts.vault_token_account.amount;
        let free_capital = vault_balance.saturating_sub(ctx.accounts.vault_state.total_locked_capital);
        
        require!(free_capital >= delta_locked, CoreError::InsufficientVaultLiquidity);

        // Update Vault Locked Capital via CPI
        if delta_locked > 0 {
            let bump = ctx.bumps.settlement_authority;
            let bump_seed = [bump];
            let signer_seeds: &[&[u8]] = &[SETTLEMENT_SEED, &bump_seed];
            let signers: &[&[&[u8]]] = &[signer_seeds];

            let cpi_accounts = brokex_vault::cpi::accounts::UpdateLockedCapital {
                caller: ctx.accounts.settlement_authority.to_account_info(),
                vault_state: ctx.accounts.vault_state.to_account_info(),
            };
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.vault_program.to_account_info().key(),
                cpi_accounts,
                signers
            );
            brokex_vault::cpi::update_locked_capital(cpi_ctx, delta_locked as i64)?;
        }

        // Update Asset State
        if direction == PositionDirection::Long {
            asset.oi_long = asset.oi_long.checked_add(oi).ok_or(CoreError::Overflow)?;
            let priced_oi = (oi as u128).checked_mul(actual_entry_price as u128).ok_or(CoreError::Overflow)?;
            asset.sum_priced_oi_long = asset.sum_priced_oi_long.checked_add(priced_oi).ok_or(CoreError::Overflow)?;
        } else {
            asset.oi_short = asset.oi_short.checked_add(oi).ok_or(CoreError::Overflow)?;
            let priced_oi = (oi as u128).checked_mul(actual_entry_price as u128).ok_or(CoreError::Overflow)?;
            asset.sum_priced_oi_short = asset.sum_priced_oi_short.checked_add(priced_oi).ok_or(CoreError::Overflow)?;
        }
        sync_risk_from_oi(asset);
        asset.lp_locked_long = new_rl;
        asset.lp_locked_short = new_rs;
    }

    // Store Position
    let position = &mut ctx.accounts.position;
    position.trade_id = position_id;
    position.trader = ctx.accounts.trader.key();
    position.asset_id = asset_id;
    position.direction = direction;
    position.collateral = margin; // Net collateral
    position.leverage = leverage;
    position.size = oi;
    position.entry_price = actual_entry_price;
    position.lp_locked_capital = lp_cap_for_position;
    position.state = if is_market { PositionState::Open } else { PositionState::Pending };
    position.order_type = order_type;
    position.target_price = target_price;
    position.execution_status = if is_market { ExecutionStatus::Executed } else { ExecutionStatus::Pending };
    position.sl_price = sl_price;
    position.tp_price = tp_price;
    position.liquidation_price = if is_market {
        calculate_liquidation_price(actual_entry_price, leverage, direction)?
    } else {
        validate_sl_tp(target_price, direction, sl_price, tp_price)?;
        0
    };
    position.open_funding_index = open_funding_snap;
    position.open_time = ts;
    position.bump = ctx.bumps.position;
    ctx.accounts.config.next_position_id = position_id.checked_add(1).ok_or(CoreError::Overflow)?;

    msg!(
        "Position opened: ID={}, Price={}, Size={}, Locked={}",
        position.asset_id,
        actual_entry_price,
        oi,
        delta_locked
    );

    Ok(())
}
