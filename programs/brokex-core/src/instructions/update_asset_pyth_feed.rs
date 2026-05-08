use anchor_lang::prelude::*;
use crate::constants::*;
use crate::error::CoreError;
use crate::state::*;

#[derive(Accounts)]
pub struct UpdateAssetPythFeed<'info> {
    #[account(
        mut,
        seeds = [ASSET_SEED, asset.asset_id.as_bytes()],
        bump,
    )]
    pub asset: Account<'info, Asset>,

    #[account(
        seeds = [CONFIG_SEED],
        bump,
        constraint = config.admin == admin.key() @ CoreError::Unauthorized
    )]
    pub config: Account<'info, ProtocolConfig>,

    pub admin: Signer<'info>,
}

pub fn update_asset_pyth_feed_handler(
    ctx: Context<UpdateAssetPythFeed>,
    new_pyth_feed: Pubkey,
) -> Result<()> {
    let asset = &mut ctx.accounts.asset;
    let old = asset.pyth_feed;
    asset.pyth_feed = new_pyth_feed;
    msg!(
        "Asset {} pyth_feed updated: {} -> {}",
        asset.asset_id,
        old,
        new_pyth_feed
    );
    Ok(())
}
