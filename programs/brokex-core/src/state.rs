use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct ProtocolConfig {
    pub admin: Pubkey,
    pub is_paused: bool,
    pub emergency_mode: bool,
    /// Authorized signer for `execute_triggered` (liquidation / SL / TP). Initialized to `admin`.
    pub keeper: Pubkey,
    pub pending_admin: Option<Pubkey>,
    pub usdc_mint: Pubkey,
    pub vault: Pubkey,
    pub vault_program: Pubkey, // Address of brokex-vault program for CPIs
}

#[account]
#[derive(InitSpace)]
pub struct Asset {
    #[max_len(32)]
    pub asset_id: String,
    pub pyth_feed: Pubkey,
    pub is_enabled: bool,

    // Config
    pub min_leverage: u64,
    pub max_leverage: u64,
    pub min_trade_size: u64,
    pub commission_open_bps: u64,
    pub base_spread_bps: u64,
    pub max_open_interest: u64,
    pub max_oi_per_trader: u64,

    // Risk Parameters (Alpha/K)
    pub alpha_min: u64,
    pub alpha_scale: u64,
    pub k: u64,
    pub profit_cap_bps: u64,
    /// Same semantics as EVM: `tol = oraclePrice * execution_tolerance / PRECISION`.
    pub execution_tolerance: u64,

    // State
    pub oi_long: u64,
    pub oi_short: u64,
    pub risk_long: u64,
    pub risk_short: u64,
    pub sum_priced_oi_long: u128, // sum of (OI * price)
    pub sum_priced_oi_short: u128,
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
    pub liquidation_price: u64,
    pub lp_locked_capital: u64,
    pub sl_price: u64,
    pub tp_price: u64,
    pub close_price: u64,
    pub close_time: i64,
    pub state: PositionState,
    pub open_time: i64,
    pub close_time: i64,
    pub close_price: u64,
    pub bump: u8,
}
