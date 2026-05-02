use anchor_lang::prelude::*;
use anchor_spl::token::{self, Transfer};

use crate::VaultDeposit;
use crate::error::ErrorCode;

pub fn deposit_handler(ctx: Context<VaultDeposit>, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::ZeroAmount);
    require!(!ctx.accounts.vault_state.paused, ErrorCode::Paused);

    let cpi_accounts = Transfer {
        from: ctx.accounts.admin_token.to_account_info(),
        to: ctx.accounts.vault_token.to_account_info(),
        authority: ctx.accounts.admin.to_account_info(),
    };
    // Anchor 1.0 `CpiContext::new` takes `program_id: Pubkey` (not `AccountInfo`).
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.key(), cpi_accounts);
    token::transfer(cpi_ctx, amount)?;

    msg!("Deposited {} (raw units) into vault token account", amount);
    Ok(())
}
