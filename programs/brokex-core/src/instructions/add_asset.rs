use anchor_lang::prelude::*;
use crate::state::*;
use crate::constants::*;
use crate::error::CoreError;
use crate::logic::{
    DEFAULT_ALPHA_MIN_FP, DEFAULT_ALPHA_SCALE, DEFAULT_PROFIT_CAP_FP, PRECISION_U64,
};

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct AssetConfigInput {
    pub commission_open_bps: u64,
    /// Base spread as bps of oracle price (`0` allowed — no spread).
    pub base_spread_bps: u64,
    /// Fixed-point on [`crate::logic::PRECISION`]; `0` uses [`DEFAULT_PROFIT_CAP_FP`] (full-OI risk).
    pub profit_cap_fp: u64,
    /// Minimum alpha fixed-point; `0` uses [`DEFAULT_ALPHA_MIN_FP`].
    pub alpha_min_fp: u64,
    /// Depth scale (risk units); `0` uses [`DEFAULT_ALPHA_SCALE`].
    pub alpha_scale: u64,
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
    asset.commission_open_bps = config_input.commission_open_bps;
    asset.base_spread_bps = config_input.base_spread_bps;

    let profit_cap_fp = if config_input.profit_cap_fp == 0 {
        DEFAULT_PROFIT_CAP_FP
    } else {
        config_input.profit_cap_fp
    };
    let alpha_min_fp = if config_input.alpha_min_fp == 0 {
        DEFAULT_ALPHA_MIN_FP
    } else {
        config_input.alpha_min_fp
    };
    let alpha_scale = if config_input.alpha_scale == 0 {
        DEFAULT_ALPHA_SCALE
    } else {
        config_input.alpha_scale
    };

    require!(profit_cap_fp > 0, CoreError::InvalidCapitalParams);
    require!(alpha_min_fp <= PRECISION_U64, CoreError::InvalidCapitalParams);

    asset.profit_cap_fp = profit_cap_fp;
    asset.alpha_min_fp = alpha_min_fp;
    asset.alpha_scale = alpha_scale;

    // Initialize state
    asset.oi_long = 0;
    asset.oi_short = 0;
    asset.sum_priced_oi_long = 0;
    asset.sum_priced_oi_short = 0;
    asset.lp_locked_long = 0;
    asset.lp_locked_short = 0;
    
    msg!("Asset added: {} with feed: {}", asset_id, pyth_feed);
    Ok(())
}
