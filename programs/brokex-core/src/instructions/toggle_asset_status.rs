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
        mut,
        seeds = [CONFIG_SEED],
        bump,
        constraint = config.admin == admin.key() @ CoreError::Unauthorized
    )]
    pub config: Account<'info, ProtocolConfig>,
    
    pub admin: Signer<'info>,
}

pub fn toggle_asset_handler(ctx: Context<ToggleAssetStatus>, is_enabled: bool) -> Result<()> {
    let asset = &mut ctx.accounts.asset;
    let was_enabled = asset.is_enabled;
    asset.is_enabled = is_enabled;

    let cfg = &mut ctx.accounts.config;
    if was_enabled && !is_enabled {
        cfg.active_enabled_asset_count = cfg
            .active_enabled_asset_count
            .checked_sub(1)
            .ok_or(error!(CoreError::InvariantViolation))?;
    } else if !was_enabled && is_enabled {
        cfg.active_enabled_asset_count = cfg
            .active_enabled_asset_count
            .checked_add(1)
            .ok_or(error!(CoreError::Overflow))?;
    }

    msg!("Asset {} status updated: enabled = {}", asset.asset_id, is_enabled);
    Ok(())
}
