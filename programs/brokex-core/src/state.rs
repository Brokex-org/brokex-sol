use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct ProtocolConfig {
    pub admin: Pubkey,
    pub is_paused: bool,
    pub emergency_mode: bool,
    pub next_position_id: u64,
    pub pending_admin: Option<Pubkey>,
    pub usdc_mint: Pubkey,
    pub vault: Pubkey,
    pub vault_state: Pubkey,
    /// **Invariant:** must always equal the number of [`Asset`] accounts with `is_enabled == true`.
    /// Every instruction that adds an asset or toggles `Asset::is_enabled` must update this field;
    /// merged-oracle validation (Extended MVP §26) trusts this count for proof completeness.
    pub active_enabled_asset_count: u32,
}

#[account]
#[derive(InitSpace)]
pub struct Asset {
    #[max_len(32)]
    pub asset_id: String,
    pub pyth_feed: Pubkey,
    pub is_enabled: bool,

    // Config
    pub commission_open_bps: u64,
    /// Base spread as bps of oracle price; dynamic skew scales effective spread (see `logic::execution_price_with_spread`).
    pub base_spread_bps: u64,
    /// Annual funding index increment at a balanced book (`index += rate * dt / YEAR`; fee = OI * Δindex / PRECISION).
    pub base_funding_per_year: u64,
    pub max_funding_per_year: u64,
    /// Risk contribution per trade: `oi * profit_cap_fp / PRECISION` (fixed-point, see `logic::PRECISION`).
    pub profit_cap_fp: u64,
    /// Minimum alpha in fixed-point on `PRECISION` (e.g. `800_000` = 0.8).
    pub alpha_min_fp: u64,
    /// Depth denominator scale (same units as aggregate risk); larger ⇒ shallower depth.
    pub alpha_scale: u64,
    /// Fixed-point on [`crate::logic::PRECISION`]; execution delta = `oracle * effective_spread / PRECISION`. `0` = no spread.
    pub base_spread_fp: u64,
    /// Liquidation threshold in bps of margin (9000–10000 = 90%–100%; Extended MVP §15–16).
    pub liquidation_threshold_bps: u16,

    // State
    pub oi_long: u64,
    pub oi_short: u64,
    /// Mirrors OI notional for future alpha / risk formulas (Extended MVP §11).
    pub risk_long: u64,
    pub risk_short: u64,
    pub sum_priced_oi_long: u128, // sum of (OI * price)
    pub sum_priced_oi_short: u128,
    pub lp_locked_long: u64,
    pub lp_locked_short: u64,

    pub funding_index_long: u128,
    pub funding_index_short: u128,
    pub last_funding_update: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum PositionDirection {
    Long,
    Short,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum PositionState {
    Open,
    Closed,
    Liquidated,
    EmergencyClosed,
    Pending,
    Canceled,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum OrderType {
    Market,
    Limit,
    Stop,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum ExecutionStatus {
    Pending,
    Executed,
    Canceled,
}

#[account]
#[derive(InitSpace)]
pub struct Position {
    pub trade_id: u64,
    pub trader: Pubkey,
    #[max_len(32)]
    pub asset_id: String,
    pub direction: PositionDirection,
    pub collateral: u64,
    pub leverage: u8,
    pub size: u64,
    pub entry_price: u64,
    pub lp_locked_capital: u64,
    pub state: PositionState,
    pub order_type: OrderType,
    pub target_price: u64,
    pub execution_status: ExecutionStatus,
    pub sl_price: u64,
    pub tp_price: u64,
    pub liquidation_price: u64,
    pub open_time: i64,
    pub close_time: i64,
    pub close_price: u64,
    /// Side funding index snapshot at open (long → long index, short → short index).
    pub open_funding_index: u128,
    pub bump: u8,
}
