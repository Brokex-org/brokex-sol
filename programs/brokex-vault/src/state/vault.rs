use anchor_lang::prelude::*;

/// Vault configuration and LP accounting (Extended MVP §§20–25).
///
/// `reported_unrealized_pnl` is **off-chain / admin supplied** until Core wires §22 merged-oracle
/// uPnL into a dedicated updater; LP math always uses `vault_usdc_balance + reported_unrealized_pnl`
/// for NAV (§21).
#[account]
#[derive(InitSpace)]
pub struct VaultState {
    pub admin: Pubkey,

    pub stable_mint: Pubkey,

    /// PDA-owned token account that holds vault USDC.
    pub token_vault: Pubkey,

    /// Core program authorized to settle against this vault.
    pub core: Pubkey,

    /// When set, vault instructions that should respect pause are disabled.
    pub paused: bool,

    /// Total capital locked across all assets (sum of `needLock` per asset per Extended MVP §§12–13).
    pub total_locked_capital: u64,

    /// PDA bump for the vault state account.
    pub bump: u8,

    /// SPL mint for LP shares (decimals match `stable_mint`; mint authority = vault PDA).
    pub lp_mint: Pubkey,

    /// Global unrealized PnL in raw stable units (signed). Must stay consistent with §22 once wired.
    pub reported_unrealized_pnl: i128,

    /// Slot of the last successful `core_set_reported_unrealized_pnl` (monotonic; blocks stale replays).
    pub last_pnl_sync_slot: u64,
}
