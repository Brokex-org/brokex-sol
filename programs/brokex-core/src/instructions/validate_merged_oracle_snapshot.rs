use anchor_lang::prelude::*;
use crate::constants::*;
use crate::error::CoreError;
use crate::oracle;
use crate::state::ProtocolConfig;

/// Verifies a merged Pyth proof sized to [`ProtocolConfig::active_enabled_asset_count`](crate::state::ProtocolConfig::active_enabled_asset_count) (Extended MVP §26).
///
/// **Protocol state:** fails if the protocol is paused or in emergency mode (same rough bar as normal trading paths).
/// Success here means oracle proof shape and prices are valid — **not** that the protocol is otherwise “live” for trading.
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
    let cfg = &ctx.accounts.config;
    require!(!cfg.is_paused, CoreError::Paused);
    require!(!cfg.emergency_mode, CoreError::EmergencyModeActive);
    require!(max_age_secs > 0, CoreError::InvalidOracleParams);
    require!(max_conf_bps > 0, CoreError::InvalidOracleParams);

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
