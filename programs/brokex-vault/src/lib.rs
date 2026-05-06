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

declare_id!("AePFV3TeyAkWMSR3YjE7ufkkwo1Mcsm4vUDSgvouqxUK");

#[program]
pub mod brokex_vault {
    // Avoid `use super::*`: Anchor expands `#[program]` with an inner `accounts` module; a glob can
    // also import `accounts` from the parent crate (e.g. re-exports), causing E0428 duplicate name.
    use anchor_lang::prelude::{Context, Result};
    use super::{
        initialize_handler, set_paused_handler, deposit_handler, withdraw_handler, settle_handler,
        update_locked_capital_handler,
        AdminSetPaused, Initialize, VaultDeposit, VaultSettle, VaultWithdraw, UpdateLockedCapital,
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
}
