use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::*;
use crate::constants::*;
use crate::oracle;
use crate::logic;
use crate::error::CoreError;

#[derive(Accounts)]
#[instruction(asset_id: String)]
pub struct OpenPosition<'info> {
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
        constraint = asset.is_enabled @ CoreError::AssetDisabled
    )]
    pub asset: Account<'info, Asset>,

    /// CHECK: Validated in oracle::get_validated_price
    pub pyth_price_update: UncheckedAccount<'info>,

    /// Position PDA: One position per trader per asset.
    /// Decision: We use seeds [b"position", trader, asset_id] to enforce uniqueness.
    /// This prevents duplicate positions, simplifies state management, and protects
    /// against state bloat/dust attacks.
    #[account(
        init,
        payer = trader,
        space = 8 + Position::INIT_SPACE,
        seeds = [POSITION_SEED, trader.key().as_ref(), asset_id.as_bytes()],
        bump
    )]
    pub position: Account<'info, Position>,

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

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn open_position_handler(
    ctx: Context<OpenPosition>,
    asset_id: String,
    collateral: u64,
    leverage: u8,
    direction: PositionDirection,
    sl_price: u64,
    tp_price: u64,
) -> Result<()> {
    let asset = &mut ctx.accounts.asset;

    // Basic Validations
    require!(collateral >= asset.min_trade_size, CoreError::InvalidPrice); // Reuse or add error
    require!(leverage as u64 >= asset.min_leverage && leverage as u64 <= asset.max_leverage, CoreError::Overflow);

    // Validate price using the oracle logic
    let oracle_price = oracle::get_validated_price(
        &ctx.accounts.pyth_price_update,
        &asset.pyth_feed.to_bytes(),
        60,
        200,
    )?;

    // Apply Spread and Calculate Liquidation Price
    let entry_price = logic::apply_spread(
        oracle_price,
        direction,
        asset.oi_long,
        asset.oi_short,
        asset.base_spread_bps,
    );

    let liq_price = logic::calculate_liquidation_price(entry_price, leverage, direction);

    // Validate SL/TP
    validate_sltp(direction, entry_price, liq_price, sl_price, tp_price)?;

    // Calculate Open Interest and Risk
    // Note: Commission is deducted from collateral BEFORE applying leverage.
    // Size = (Collateral - Commission) * Leverage
    let commission = collateral
        .checked_mul(asset.commission_open_bps)
        .ok_or(CoreError::Overflow)?
        / 10_000;
    
    let margin = collateral.saturating_sub(commission);
    let oi = margin
        .checked_mul(leverage as u64)
        .ok_or(CoreError::Overflow)?;

    let max_profit = oi
        .checked_mul(asset.profit_cap_bps)
        .ok_or(CoreError::Overflow)?
        / 10_000;

    // Check Global Limits (OI Cap, Trader Cap, Imbalance)
    let new_oi_long = asset.oi_long + if direction == PositionDirection::Long { oi } else { 0 };
    let new_oi_short = asset.oi_short + if direction == PositionDirection::Short { oi } else { 0 };

    require!(new_oi_long + new_oi_short <= asset.max_open_interest, CoreError::Overflow);
    // TODO: Trader-specific OI tracking if needed

    // Check Alpha-Scaling / Vault Capital
    let old_need_lock = logic::calculate_need_lock(asset.risk_long, asset.risk_short, asset.alpha_min, asset.alpha_scale);
    
    let new_risk_long = asset.risk_long + if direction == PositionDirection::Long { max_profit } else { 0 };
    let new_risk_short = asset.risk_short + if direction == PositionDirection::Short { max_profit } else { 0 };
    
    let new_need_lock = logic::calculate_need_lock(new_risk_long, new_risk_short, asset.alpha_min, asset.alpha_scale);

    if new_need_lock > old_need_lock {
        let additional_lock = new_need_lock - old_need_lock;
        msg!("Additional capital to lock: {}", additional_lock);
    }

    // Transfer Collateral
    let cpi_accounts = Transfer {
        from: ctx.accounts.trader_token_account.to_account_info(),
        to: ctx.accounts.vault_token_account.to_account_info(),
        authority: ctx.accounts.trader.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.key(), cpi_accounts);
    token::transfer(cpi_ctx, collateral)?;

    // Update Asset State
    if direction == PositionDirection::Long {
        asset.oi_long += oi;
        asset.risk_long += max_profit;
        asset.sum_priced_oi_long += (oi as u128) * (entry_price as u128);
    } else {
        asset.oi_short += oi;
        asset.risk_short += max_profit;
        asset.sum_priced_oi_short += (oi as u128) * (entry_price as u128);
    }

    // Store Position
    let position = &mut ctx.accounts.position;
    position.trader = ctx.accounts.trader.key();
    position.asset_id = asset_id;
    position.direction = direction;
    position.collateral = collateral;
    position.leverage = leverage;
    position.size = oi;
    position.entry_price = entry_price;
    position.liquidation_price = liq_price;
    position.lp_locked_capital = max_profit;
    position.state = PositionState::Open;
    position.open_time = Clock::get()?.unix_timestamp;
    position.bump = ctx.bumps.position;

    msg!("Position opened: ID={}, Price={}, Size={}", asset.asset_id, entry_price, oi);

    Ok(())
}

fn validate_sltp(
    direction: PositionDirection,
    entry_price: u64,
    liq_price: u64,
    sl_price: u64,
    tp_price: u64,
) -> Result<()> {
    if direction == PositionDirection::Long {
        if sl_price != 0 {
            require!(sl_price < entry_price, CoreError::InvalidPrice);
            require!(sl_price >= liq_price, CoreError::InvalidPrice);
        }
        if tp_price != 0 {
            require!(tp_price > entry_price, CoreError::InvalidPrice);
        }
    } else {
        if sl_price != 0 {
            require!(sl_price > entry_price, CoreError::InvalidPrice);
            require!(sl_price <= liq_price, CoreError::InvalidPrice);
        }
        if tp_price != 0 {
            require!(tp_price < entry_price, CoreError::InvalidPrice);
        }
    }
    Ok(())
}
