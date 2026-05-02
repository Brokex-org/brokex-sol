use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct ProtocolConfig {
    pub admin: Pubkey,
    pub is_paused: bool,
    pub pending_admin: Option<Pubkey>,
}

#[account]
#[derive(InitSpace)]
pub struct Asset {
    #[max_len(32)]
    pub asset_id: String,
    pub pyth_feed: Pubkey,
    pub is_enabled: bool,
}

impl ProtocolConfig {
    pub const LEN: usize = 8 + 32 + 1 + (1 + 32); // discriminator + pubkey + bool + Option<Pubkey>
}

impl Asset {
    pub const MAX_ASSET_ID_LEN: usize = 32;
    pub const LEN: usize = 8 + (4 + 32) + 32 + 1; // discriminator + string(max 32) + pubkey + bool
}
