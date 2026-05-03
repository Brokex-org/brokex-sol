use anchor_lang::prelude::*;

/// Minimal singleton vault config for the MVP (`MVP_SPEC.md`): admin-provided USDC
/// liquidity, settlement via Core, SPL vault token account. Full EVM-style LP / withdraw
/// queue fields stay out until post-MVP.
#[account]
pub struct VaultState {
    /// Admin authority — sole liquidity provider in MVP.
    pub admin: Pubkey,

    /// USDC (SPL) mint for `token_vault`.
    pub stable_mint: Pubkey,

    /// PDA-owned token account that holds vault USDC.
    pub token_vault: Pubkey,

    /// Core program authorized to settle against this vault.
    pub core: Pubkey,

    /// When set, vault instructions that should respect pause are disabled.
    pub paused: bool,

    /// PDA bump for the vault state account.
    pub bump: u8,
}

impl VaultState {
    pub const LEN: usize = 8 // discriminator
        + 32 * 4 // admin, stable_mint, token_vault, core
        + 1 // paused
        + 1; // bump
}
