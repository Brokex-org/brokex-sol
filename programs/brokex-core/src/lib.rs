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

declare_id!("2D2SpgCJqZquV5DD1jrXWL6cmuqoxFgsNjihkt9BUdNB");

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

    pub fn update_asset_pyth_feed(
        ctx: Context<UpdateAssetPythFeed>,
        new_pyth_feed: Pubkey,
    ) -> Result<()> {
        instructions::update_asset_pyth_feed_handler(ctx, new_pyth_feed)
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
        collateral: u64,
        leverage: u8,
        direction: PositionDirection,
        order_type: OrderType,
        target_price: u64,
        sl_price: u64,
        tp_price: u64,
    ) -> Result<()> {
        instructions::open_position_handler(
            ctx,
            asset_id,
            collateral,
            leverage,
            direction,
            order_type,
            target_price,
            sl_price,
            tp_price,
        )
    }

    pub fn close_position(
        ctx: Context<ClosePosition>,
        asset_id: String,
        trade_id: u64,
    ) -> Result<()> {
        instructions::close_position_handler(ctx, asset_id, trade_id)
    }

    pub fn emergency_close(
        ctx: Context<EmergencyClose>,
        asset_id: String,
        trade_id: u64,
    ) -> Result<()> {
        instructions::emergency_close_handler(ctx, asset_id, trade_id)
    }

    pub fn cancel_order(
        ctx: Context<CancelOrder>,
        asset_id: String,
        trade_id: u64,
    ) -> Result<()> {
        instructions::cancel_order_handler(ctx, asset_id, trade_id)
    }

    pub fn update_sl_tp(
        ctx: Context<UpdateSlTp>,
        asset_id: String,
        trade_id: u64,
        sl_price: u64,
        tp_price: u64,
    ) -> Result<()> {
        instructions::update_sl_tp_handler(ctx, asset_id, trade_id, sl_price, tp_price)
    }

    pub fn execute_batch<'info>(
        ctx: Context<'info, ExecuteBatch<'info>>,
        asset_id: String,
        trade_ids: Vec<u64>,
        action_types: Vec<ActionType>,
    ) -> Result<()> {
        instructions::execute_batch_handler(ctx, asset_id, trade_ids, action_types)
    }

    pub fn add_margin(
        ctx: Context<AddMargin>,
        asset_id: String,
        trade_id: u64,
        amount: u64,
    ) -> Result<()> {
        instructions::add_margin_handler(ctx, asset_id, trade_id, amount)
    }

    pub fn remove_margin(
        ctx: Context<RemoveMargin>,
        asset_id: String,
        trade_id: u64,
        amount: u64,
    ) -> Result<()> {
        instructions::remove_margin_handler(ctx, asset_id, trade_id, amount)
    }
}
