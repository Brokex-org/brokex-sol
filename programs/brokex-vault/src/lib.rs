pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

// `#[derive(Accounts)]` must expand at crate root so generated `__client_accounts_*` matches
// what `#[program]` imports (`crate::__client_accounts_*`). A nested `mod contexts` breaks that.
include!("contexts.rs");

declare_id!("6bo6uqoj77cHBMYg9FCbKYGc3iUzNW62RLK7Xmzqawk8");

#[program]
pub mod brokex_vault {
    // Avoid `use super::*`: Anchor expands `#[program]` with an inner `accounts` module; a glob can
    // also import `accounts` from the parent crate (e.g. re-exports), causing E0428 duplicate name.
    use anchor_lang::prelude::{Context, Result};
    use super::{
        admin_set_reported_unrealized_pnl_handler, core_set_reported_unrealized_pnl_handler,
        deposit_handler, initialize_handler,
        lp_deposit_handler, lp_withdraw_handler, set_paused_handler, settle_handler,
        update_locked_capital_handler, withdraw_handler,
        AdminSetPaused, AdminSetReportedUnrealizedPnl, CoreSetReportedUnrealizedPnl, Initialize,
        LpDeposit, LpWithdraw,
        UpdateLockedCapital, VaultDeposit, VaultSettle, VaultWithdraw,
    };

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        initialize_handler(ctx)
    }

    pub fn set_paused(ctx: Context<AdminSetPaused>, paused: bool) -> Result<()> {
        set_paused_handler(ctx, paused)
    }

    pub fn deposit(ctx: Context<VaultDeposit>, amount: u64) -> Result<()> {
        deposit_handler(ctx, amount)
    }

    pub fn withdraw(ctx: Context<VaultWithdraw>, amount: u64) -> Result<()> {
        withdraw_handler(ctx, amount)
    }

    pub fn settle(ctx: Context<VaultSettle>, profit: u64, loss: u64) -> Result<()> {
        settle_handler(ctx, profit, loss)
    }

    pub fn update_locked_capital(ctx: Context<UpdateLockedCapital>, delta: i64) -> Result<()> {
        update_locked_capital_handler(ctx, delta)
    }

    pub fn core_set_reported_unrealized_pnl(
        ctx: Context<CoreSetReportedUnrealizedPnl>,
        reported_unrealized_pnl: i128,
    ) -> Result<()> {
        core_set_reported_unrealized_pnl_handler(ctx, reported_unrealized_pnl)
    }

    /// Admin-only NAV override (prefer Core `sync_vault_unrealized_pnl`).
    pub fn admin_set_reported_unrealized_pnl(
        ctx: Context<AdminSetReportedUnrealizedPnl>,
        reported_unrealized_pnl: i128,
    ) -> Result<()> {
        admin_set_reported_unrealized_pnl_handler(ctx, reported_unrealized_pnl)
    }

    /// Public LP deposit 
    pub fn lp_deposit(ctx: Context<LpDeposit>, amount: u64, min_shares: u64) -> Result<()> {
        lp_deposit_handler(ctx, amount, min_shares)
    }

    /// Public LP withdraw
    pub fn lp_withdraw(ctx: Context<LpWithdraw>, shares: u64, min_usdc: u64) -> Result<()> {
        lp_withdraw_handler(ctx, shares, min_usdc)
    }
}
