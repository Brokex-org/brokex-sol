use anchor_lang::prelude::*;
use anchor_spl::token::{self, Transfer};

use crate::VaultSettle;
use crate::error::ErrorCode;

pub fn settle_handler(ctx: Context<VaultSettle>, profit: u64, loss: u64) -> Result<()> {
    require!(!ctx.accounts.vault_state.paused, ErrorCode::Paused);

    let bump = ctx.accounts.vault_state.bump;
    let seeds: &[&[u8]] = &[b"vault", &[bump]];
    let signer = &[seeds];

    if profit > 0 {
        require!(
            profit <= ctx.accounts.vault_token.amount,
            ErrorCode::InsufficientBalance
        );

        let cpi_accounts = Transfer {
            from: ctx.accounts.vault_token.to_account_info(),
            to: ctx.accounts.trader_token.to_account_info(),
            authority: ctx.accounts.vault_state.to_account_info(),
        };
        let cpi_ctx =
            CpiContext::new_with_signer(ctx.accounts.token_program.key(), cpi_accounts, signer);
        token::transfer(cpi_ctx, profit)?;

        msg!("Vault paid {} (raw units) profit to trader", profit);
    }

    if loss > 0 {
        require!(
            loss <= ctx.accounts.core_collateral_token.amount,
            ErrorCode::InsufficientBalance
        );

        let cpi_accounts = Transfer {
            from: ctx.accounts.core_collateral_token.to_account_info(),
            to: ctx.accounts.vault_token.to_account_info(),
            authority: ctx.accounts.caller.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.key(), cpi_accounts);
        token::transfer(cpi_ctx, loss)?;

        msg!(
            "Vault received {} (raw units) loss from core collateral",
            loss
        );
    }

    Ok(())
}
