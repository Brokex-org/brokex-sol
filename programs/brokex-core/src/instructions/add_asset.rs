use anchor_lang::prelude::*;
use crate::state::*;
use crate::constants::*;
use crate::error::CoreError;

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct AssetConfigInput {
    pub min_leverage: u64,
    pub max_leverage: u64,
    pub min_trade_size: u64,
    pub commission_open_bps: u64,
    pub base_spread_bps: u64,
    pub max_open_interest: u64,
    pub max_oi_per_trader: u64,
    pub alpha_min: u64,
    pub alpha_scale: u64,
    pub k: u64,
    pub profit_cap_bps: u64,
}

#[derive(Accounts)]
#[instruction(asset_id: String)]
pub struct AddAsset<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + Asset::INIT_SPACE,
        seeds = [ASSET_SEED, asset_id.as_bytes()],
        bump
    )]
    pub asset: Account<'info, Asset>,
    
    #[account(
        seeds = [CONFIG_SEED],
        bump,
        constraint = config.admin == admin.key() @ CoreError::Unauthorized
    )]
    pub config: Account<'info, ProtocolConfig>,
    
    #[account(mut)]
    pub admin: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn add_asset_handler(
    ctx: Context<AddAsset>,
    asset_id: String,
    pyth_feed: Pubkey,
    config_input: AssetConfigInput,
) -> Result<()> {
    require!(asset_id.len() <= 32, CoreError::AssetIdTooLong);

    let asset = &mut ctx.accounts.asset;
    asset.asset_id = asset_id.clone();
    asset.pyth_feed = pyth_feed;
    asset.is_enabled = true;

    // Initialize config
    asset.min_leverage = config_input.min_leverage;
    asset.max_leverage = config_input.max_leverage;
    asset.min_trade_size = config_input.min_trade_size;
    asset.commission_open_bps = config_input.commission_open_bps;
    asset.base_spread_bps = config_input.base_spread_bps;
    asset.max_open_interest = config_input.max_open_interest;
    asset.max_oi_per_trader = config_input.max_oi_per_trader;
    asset.alpha_min = config_input.alpha_min;
    asset.alpha_scale = config_input.alpha_scale;
    asset.k = config_input.k;
    asset.profit_cap_bps = config_input.profit_cap_bps;

    // Initialize state
    asset.oi_long = 0;
    asset.oi_short = 0;
    asset.risk_long = 0;
    asset.risk_short = 0;
    asset.sum_priced_oi_long = 0;
    asset.sum_priced_oi_short = 0;
    
    msg!("Asset added: {} with feed: {}", asset_id, pyth_feed);
    Ok(())
}
