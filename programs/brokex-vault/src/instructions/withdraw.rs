use anchor_lang::prelude::*;
use anchor_spl::token::{self, Transfer};

use crate::VaultWithdraw;
use crate::error::ErrorCode;

pub fn withdraw_handler(ctx: Context<VaultWithdraw>, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::ZeroAmount);
    require!(!ctx.accounts.vault_state.paused, ErrorCode::Paused);
    let vault_balance = ctx.accounts.vault_token.amount;
    require!(vault_balance >= amount, ErrorCode::InsufficientBalance);
    let free_capital = vault_balance.saturating_sub(ctx.accounts.vault_state.total_locked_capital);
    require!(amount <= free_capital, ErrorCode::InsufficientFreeCapital);

    let bump = ctx.accounts.vault_state.bump;
    let seeds: &[&[u8]] = &[b"vault", &[bump]];
    let signer = &[seeds];

    let cpi_accounts = Transfer {
        from: ctx.accounts.vault_token.to_account_info(),
        to: ctx.accounts.admin_token.to_account_info(),
        authority: ctx.accounts.vault_state.to_account_info(),
    };
    let cpi_ctx =
        CpiContext::new_with_signer(ctx.accounts.token_program.key(), cpi_accounts, signer);
    token::transfer(cpi_ctx, amount)?;

    msg!("Withdrew {} (raw units) from vault token account", amount);
    Ok(())
}
