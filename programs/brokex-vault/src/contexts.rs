// Included by `lib.rs` (`include!("contexts.rs")`) so account derives emit `crate::__client_accounts_*`.

#[allow(unused_imports)]
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::error::ErrorCode;

/// One-time setup: creates the vault state PDA and the vault USDC ATA (authority = vault PDA).
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + state::VaultState::INIT_SPACE,
        seeds = [b"vault"],
        bump
    )]
    pub vault_state: Account<'info, state::VaultState>,

    #[account(constraint = stable_mint.decimals == 6 @ ErrorCode::InvalidVaultValue)]
    pub stable_mint: Account<'info, Mint>,

    /// CHECK: Core settlement authority; stored and enforced on `settle`.
    pub core: UncheckedAccount<'info>,

    #[account(
        init,
        payer = admin,
        associated_token::mint = stable_mint,
        associated_token::authority = vault_state,
    )]
    pub vault_token: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = admin,
        mint::decimals = 6,
        mint::authority = vault_state,
        seeds = [b"lp_mint", vault_state.key().as_ref()],
        bump
    )]
    pub lp_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminSetPaused<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault"],
        bump = vault_state.bump,
        has_one = admin @ ErrorCode::NotOwner,
    )]
    pub vault_state: Account<'info, state::VaultState>,
}

/// Admin adds USDC to the vault token account
#[derive(Accounts)]
pub struct VaultDeposit<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault"],
        bump = vault_state.bump,
        has_one = admin @ ErrorCode::NotOwner,
    )]
    pub vault_state: Account<'info, state::VaultState>,

    #[account(
        mut,
        constraint = admin_token.owner == admin.key() @ ErrorCode::NotOwner,
        constraint = admin_token.mint == vault_state.stable_mint @ ErrorCode::InvalidVaultValue,
    )]
    pub admin_token: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = vault_token.key() == vault_state.token_vault @ ErrorCode::InvalidVaultValue,
        constraint = vault_token.mint == vault_state.stable_mint @ ErrorCode::InvalidVaultValue,
        constraint = vault_token.owner == vault_state.key() @ ErrorCode::InvalidVaultValue,
    )]
    pub vault_token: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

/// Admin pulls stablecoin from the vault
#[derive(Accounts)]
pub struct VaultWithdraw<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault"],
        bump = vault_state.bump,
        has_one = admin @ ErrorCode::NotOwner,
    )]
    pub vault_state: Account<'info, state::VaultState>,

    #[account(
        mut,
        constraint = admin_token.owner == admin.key() @ ErrorCode::NotOwner,
        constraint = admin_token.mint == vault_state.stable_mint @ ErrorCode::InvalidVaultValue,
    )]
    pub admin_token: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = vault_token.key() == vault_state.token_vault @ ErrorCode::InvalidVaultValue,
        constraint = vault_token.mint == vault_state.stable_mint @ ErrorCode::InvalidVaultValue,
        constraint = vault_token.owner == vault_state.key() @ ErrorCode::InvalidVaultValue,
    )]
    pub vault_token: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

/// Core updates vault `reported_unrealized_pnl` after §22 merged-oracle uPnL (Extended MVP §21–22).
#[derive(Accounts)]
pub struct CoreSetReportedUnrealizedPnl<'info> {
    /// CHECK: Core settlement PDA; must match `VaultState.core`.
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault"],
        bump = vault_state.bump,
        constraint = caller.key() == vault_state.core @ ErrorCode::NotCore,
    )]
    pub vault_state: Account<'info, state::VaultState>,

    #[account(
        constraint = vault_token.key() == vault_state.token_vault @ ErrorCode::InvalidVaultValue,
        constraint = vault_token.mint == vault_state.stable_mint @ ErrorCode::InvalidVaultValue,
        constraint = vault_token.owner == vault_state.key() @ ErrorCode::InvalidVaultValue,
    )]
    pub vault_token: Account<'info, TokenAccount>,
}

/// Admin override for `reported_unrealized_pnl` (ops / bootstrap; prefer `sync_vault_unrealized_pnl` on Core).
#[derive(Accounts)]
pub struct AdminSetReportedUnrealizedPnl<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault"],
        bump = vault_state.bump,
        has_one = admin @ ErrorCode::NotOwner,
    )]
    pub vault_state: Account<'info, state::VaultState>,

    #[account(
        constraint = vault_token.key() == vault_state.token_vault @ ErrorCode::InvalidVaultValue,
        constraint = vault_token.mint == vault_state.stable_mint @ ErrorCode::InvalidVaultValue,
        constraint = vault_token.owner == vault_state.key() @ ErrorCode::InvalidVaultValue,
    )]
    pub vault_token: Account<'info, TokenAccount>,
}

/// Public LP deposit: USDC in, LP shares minted at NAV (Extended MVP §23).
/// Requires `sync_vault_unrealized_pnl` → vault CPI in the **same transaction / slot** (§26).
#[derive(Accounts)]
pub struct LpDeposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault"],
        bump = vault_state.bump,
    )]
    pub vault_state: Account<'info, state::VaultState>,

    #[account(
        mut,
        constraint = user_usdc.owner == user.key() @ ErrorCode::NotOwner,
        constraint = user_usdc.mint == vault_state.stable_mint @ ErrorCode::InvalidVaultValue,
    )]
    pub user_usdc: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = vault_token.key() == vault_state.token_vault @ ErrorCode::InvalidVaultValue,
        constraint = vault_token.mint == vault_state.stable_mint @ ErrorCode::InvalidVaultValue,
        constraint = vault_token.owner == vault_state.key() @ ErrorCode::InvalidVaultValue,
    )]
    pub vault_token: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = lp_mint.key() == vault_state.lp_mint @ ErrorCode::InvalidVaultValue,
        constraint = lp_mint.decimals == 6 @ ErrorCode::InvalidVaultValue,
    )]
    pub lp_mint: Account<'info, Mint>,

    #[account(
        mut,
        constraint = user_lp.owner == user.key() @ ErrorCode::NotOwner,
        constraint = user_lp.mint == lp_mint.key() @ ErrorCode::InvalidVaultValue,
    )]
    pub user_lp: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

/// Public LP withdraw: burn shares, USDC out capped by free capital (Extended MVP §§24–25).
/// Requires merged-oracle NAV sync in the **same transaction / slot** (§26).
#[derive(Accounts)]
pub struct LpWithdraw<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault"],
        bump = vault_state.bump,
    )]
    pub vault_state: Account<'info, state::VaultState>,

    #[account(
        mut,
        constraint = user_usdc.owner == user.key() @ ErrorCode::NotOwner,
        constraint = user_usdc.mint == vault_state.stable_mint @ ErrorCode::InvalidVaultValue,
    )]
    pub user_usdc: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = vault_token.key() == vault_state.token_vault @ ErrorCode::InvalidVaultValue,
        constraint = vault_token.mint == vault_state.stable_mint @ ErrorCode::InvalidVaultValue,
        constraint = vault_token.owner == vault_state.key() @ ErrorCode::InvalidVaultValue,
    )]
    pub vault_token: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = lp_mint.key() == vault_state.lp_mint @ ErrorCode::InvalidVaultValue,
    )]
    pub lp_mint: Account<'info, Mint>,

    #[account(
        mut,
        constraint = user_lp.owner == user.key() @ ErrorCode::NotOwner,
        constraint = user_lp.mint == vault_state.lp_mint @ ErrorCode::InvalidVaultValue,
    )]
    pub user_lp: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct VaultSettle<'info> {
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault"],
        bump = vault_state.bump,
        constraint = caller.key() == vault_state.core @ ErrorCode::NotCore,
    )]
    pub vault_state: Account<'info, state::VaultState>,

    #[account(
        mut,
        constraint = vault_token.key() == vault_state.token_vault @ ErrorCode::InvalidVaultValue,
        constraint = vault_token.mint == vault_state.stable_mint @ ErrorCode::InvalidVaultValue,
        constraint = vault_token.owner == vault_state.key() @ ErrorCode::InvalidVaultValue,
    )]
    pub vault_token: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = core_collateral_token.owner == caller.key() @ ErrorCode::InvalidVaultValue,
        constraint = core_collateral_token.mint == vault_state.stable_mint @ ErrorCode::InvalidVaultValue,
    )]
    pub core_collateral_token: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = trader_token.mint == vault_state.stable_mint @ ErrorCode::InvalidVaultValue,
    )]
    pub trader_token: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct UpdateLockedCapital<'info> {
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault"],
        bump = vault_state.bump,
        constraint = caller.key() == vault_state.core @ ErrorCode::NotCore,
    )]
    pub vault_state: Account<'info, state::VaultState>,

    #[account(
        constraint = vault_token.key() == vault_state.token_vault @ ErrorCode::InvalidVaultValue,
        constraint = vault_token.mint == vault_state.stable_mint @ ErrorCode::InvalidVaultValue,
        constraint = vault_token.owner == vault_state.key() @ ErrorCode::InvalidVaultValue,
    )]
    pub vault_token: Account<'info, TokenAccount>,
}
