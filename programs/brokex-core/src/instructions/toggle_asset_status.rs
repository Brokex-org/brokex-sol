use anchor_lang::prelude::*;
use crate::state::*;
use crate::constants::*;
use crate::error::CoreError;

#[derive(Accounts)]
pub struct ToggleAssetStatus<'info> {
    #[account(
        mut,
        seeds = [ASSET_SEED, asset.asset_id.as_bytes()],
        bump
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

pub fn toggle_asset_handler(ctx: Context<ToggleAssetStatus>, is_enabled: bool) -> Result<()> {
    let asset = &mut ctx.accounts.asset;
    asset.is_enabled = is_enabled;
    
    msg!("Asset {} status updated: enabled = {}", asset.asset_id, is_enabled);
    Ok(())
}
