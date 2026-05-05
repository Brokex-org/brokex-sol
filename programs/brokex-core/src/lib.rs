pub mod constants;
pub mod error;
pub mod instructions;
pub mod oracle;
pub mod state;
pub mod logic;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("7yRpue4276YpzxgF3bTTUfTTUbtVArjDYbbYxYBWV8Ys");

#[program]
pub mod brokex_core {
    use super::*;

    pub fn initialize_protocol(
        ctx: Context<InitializeProtocol>,
        usdc_mint: Pubkey,
        vault: Pubkey,
        vault_program: Pubkey,
    ) -> Result<()> {
        instructions::initialize_protocol_handler(ctx, usdc_mint, vault, vault_program)
    }

    pub fn add_asset(
        ctx: Context<AddAsset>,
        asset_id: String,
        pyth_feed: Pubkey,
        config_input: AssetConfigInput,
    ) -> Result<()> {
        instructions::add_asset_handler(ctx, asset_id, pyth_feed, config_input)
    }

    pub fn toggle_asset_status(ctx: Context<ToggleAssetStatus>, is_enabled: bool) -> Result<()> {
        instructions::toggle_asset_handler(ctx, is_enabled)
    }

    pub fn toggle_protocol_status(
        ctx: Context<ToggleProtocolStatus>,
        is_paused: bool,
    ) -> Result<()> {
        instructions::toggle_protocol_handler(ctx, is_paused)
    }

    pub fn propose_admin(ctx: Context<ProposeAdmin>, new_admin: Pubkey) -> Result<()> {
        instructions::propose_handler(ctx, new_admin)
    }

    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        instructions::accept_handler(ctx)
    }

    pub fn open_position(
        ctx: Context<OpenPosition>,
        asset_id: String,
        trade_id: u64,
        collateral: u64,
        leverage: u8,
        direction: PositionDirection,
        sl_price: u64,
        tp_price: u64,
    ) -> Result<()> {
        instructions::open_position_handler(ctx, asset_id, trade_id, collateral, leverage, direction, sl_price, tp_price)
    }
}
