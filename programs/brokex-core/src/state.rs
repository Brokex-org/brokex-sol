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

    // State
    pub oi_long: u64,
    pub oi_short: u64,
    pub sum_priced_oi_long: u128, // sum of (OI * price)
    pub sum_priced_oi_short: u128,
    pub lp_locked_long: u64,
    pub lp_locked_short: u64,
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
    pub open_time: i64,
    pub close_time: i64,
    pub close_price: u64,
    pub bump: u8,
}
