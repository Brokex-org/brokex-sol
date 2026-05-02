pub mod constants;
pub mod error;
pub mod instructions;
pub mod oracle;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("98rvC5A8ibBdw5qCwP6sL8h41x4iugGZpMXDBoabe1nN");

#[program]
pub mod brokex_core {
    use super::*;

    pub fn initialize_protocol(ctx: Context<InitializeProtocol>) -> Result<()> {
        instructions::initialize_protocol_handler(ctx)
    }

    pub fn add_asset(ctx: Context<AddAsset>, asset_id: String, pyth_feed: Pubkey) -> Result<()> {
        instructions::add_asset_handler(ctx, asset_id, pyth_feed)
    }

    pub fn toggle_asset_status(ctx: Context<ToggleAssetStatus>, is_enabled: bool) -> Result<()> {
        instructions::toggle_asset_handler(ctx, is_enabled)
    }

    pub fn toggle_protocol_status(ctx: Context<ToggleProtocolStatus>, is_paused: bool) -> Result<()> {
        instructions::toggle_protocol_handler(ctx, is_paused)
    }

    pub fn propose_admin(ctx: Context<ProposeAdmin>, new_admin: Pubkey) -> Result<()> {
        instructions::propose_handler(ctx, new_admin)
    }

    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        instructions::accept_handler(ctx)
    }
}
