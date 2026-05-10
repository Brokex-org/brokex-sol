use anchor_lang::prelude::*;
use crate::state::*;
use crate::constants::*;
use crate::error::CoreError;

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct AssetConfigInput {
    pub commission_open_bps: u64,
    pub base_funding_per_year: u64,
    pub max_funding_per_year: u64,
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
    let base = config_input.base_funding_per_year;
    let max = config_input.max_funding_per_year;
    // Loose sanity: dominant-side cap should not be orders of magnitude below baseline (misconfig).
    // Integer form of max >= base/2: 2*max >= base when base > 0.
    if base > 0 {
        require!(
            max.saturating_mul(2) >= base,
            CoreError::InvalidFundingConfig
        );
    }
    asset.base_funding_per_year = base;
    asset.max_funding_per_year = max;

    // Initialize state
    asset.oi_long = 0;
    asset.oi_short = 0;
    asset.risk_long = 0;
    asset.risk_short = 0;
    asset.sum_priced_oi_long = 0;
    asset.sum_priced_oi_short = 0;
    asset.lp_locked_long = 0;
    asset.lp_locked_short = 0;
    asset.funding_index_long = 0;
    asset.funding_index_short = 0;
    asset.last_funding_update = 0;
    
    msg!("Asset added: {} with feed: {}", asset_id, pyth_feed);
    Ok(())
}
