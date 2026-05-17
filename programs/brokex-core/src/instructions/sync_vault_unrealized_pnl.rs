use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;
use crate::constants::*;
use crate::error::CoreError;
use crate::logic::{lp_reported_unrealized_pnl_from_trader_pnl, trader_unrealized_pnl_for_asset};
use crate::oracle;
use crate::state::{Asset, ProtocolConfig};

/// Validates merged oracle (§26), computes trader uPnL per asset (§22), and CPI-updates vault NAV input (§21).
/// Callable only by protocol admin to prevent permissionless NAV manipulation.
#[derive(Accounts)]
pub struct SyncVaultUnrealizedPnl<'info> {
    #[account(
        seeds = [CONFIG_SEED],
        bump,
        has_one = admin @ CoreError::Unauthorized,
        constraint = vault_state.key() == config.vault_state @ CoreError::Unauthorized,
    )]
    pub config: Account<'info, ProtocolConfig>,

    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault"],
        bump = vault_state.bump,
        constraint = vault_state.key() == config.vault_state @ CoreError::Unauthorized,
    )]
    pub vault_state: Account<'info, brokex_vault::state::VaultState>,

    #[account(
        constraint = vault_token.key() == config.vault @ CoreError::Unauthorized,
        constraint = vault_token.mint == config.usdc_mint @ CoreError::Unauthorized,
    )]
    pub vault_token: Account<'info, TokenAccount>,

    pub vault_program: Program<'info, brokex_vault::program::BrokexVault>,

    /// CHECK: PDA signer for vault CPI; must match `VaultState.core`.
    #[account(seeds = [SETTLEMENT_SEED], bump)]
    pub settlement_authority: UncheckedAccount<'info>,
}

pub fn sync_vault_unrealized_pnl_handler(
    ctx: Context<SyncVaultUnrealizedPnl>,
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
        cfg.active_enabled_asset_count,
        max_age_secs,
        max_conf_bps,
    )?;

    let n = cfg.active_enabled_asset_count as usize;
    let mut trader_pnl: i128 = 0;

    for i in 0..n {
        let asset_ai = &ctx.remaining_accounts[2 * i];
        let pyth_ai = &ctx.remaining_accounts[2 * i + 1];
        let asset = Account::<Asset>::try_from(asset_ai)
            .map_err(|_| error!(CoreError::InvalidOracleAssetAccount))?;
        require_keys_eq!(
            pyth_ai.key(),
            asset.pyth_feed,
            CoreError::FeedIdMismatch
        );

        let price = oracle::get_validated_price(
            pyth_ai,
            &asset.pyth_feed.to_bytes(),
            max_age_secs,
            max_conf_bps,
        )?;

        let side_pnl = trader_unrealized_pnl_for_asset(&asset, price)?;
        trader_pnl = trader_pnl
            .checked_add(side_pnl)
            .ok_or(error!(CoreError::Overflow))?;
    }

    let reported = lp_reported_unrealized_pnl_from_trader_pnl(trader_pnl)?;

    let bump = ctx.bumps.settlement_authority;
    let bump_seed = [bump];
    let signer_seeds: &[&[u8]] = &[SETTLEMENT_SEED, &bump_seed];
    let signers: &[&[&[u8]]] = &[signer_seeds];

    let cpi_accounts = brokex_vault::cpi::accounts::CoreSetReportedUnrealizedPnl {
        caller: ctx.accounts.settlement_authority.to_account_info(),
        vault_state: ctx.accounts.vault_state.to_account_info(),
        vault_token: ctx.accounts.vault_token.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.vault_program.to_account_info().key(),
        cpi_accounts,
        signers,
    );
    brokex_vault::cpi::core_set_reported_unrealized_pnl(cpi_ctx, reported)?;

    msg!(
        "Vault uPnL synced: trader_pnl={}, reported={}",
        trader_pnl,
        reported
    );
    Ok(())
}
