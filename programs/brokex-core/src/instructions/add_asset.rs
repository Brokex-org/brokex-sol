use anchor_lang::prelude::*;
use crate::state::*;
use crate::constants::*;
use crate::error::CoreError;

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct AssetConfigInput {
    pub commission_open_bps: u64,
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
