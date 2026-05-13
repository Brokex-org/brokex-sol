use anchor_lang::prelude::*;
use crate::constants::*;
use crate::error::CoreError;
use crate::oracle;
use crate::state::ProtocolConfig;

/// Verifies a merged Pyth proof for **every** currently enabled asset (Extended MVP §26).
///
/// Remaining accounts: alternating `[Asset account, Pyth PriceUpdateV2], ...` with length
/// `2 * config.active_enabled_asset_count`. Intended as the on-chain gate for LP pricing / vault uPnL
/// snapshots that must not rely on a partial price set.
#[derive(Accounts)]
pub struct ValidateMergedOracleSnapshot<'info> {
    #[account(seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, ProtocolConfig>,
}

pub fn validate_merged_oracle_snapshot_handler(
    ctx: Context<ValidateMergedOracleSnapshot>,
    max_age_secs: u64,
    max_conf_bps: u64,
) -> Result<()> {
    require!(max_age_secs > 0, CoreError::InvalidPrice);
    require!(max_conf_bps > 0, CoreError::InvalidPrice);

    oracle::validate_merged_oracle_for_active_assets(
        ctx.program_id,
        ctx.remaining_accounts,
        ctx.accounts.config.active_enabled_asset_count,
        max_age_secs,
        max_conf_bps,
    )?;

    msg!(
        "Merged oracle snapshot OK: {} active assets",
        ctx.accounts.config.active_enabled_asset_count
    );
    Ok(())
}
