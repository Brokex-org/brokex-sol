use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Transfer};

use crate::LpWithdraw;
use crate::error::ErrorCode;
use crate::vault_math;
use super::lp_nav;

pub fn lp_withdraw_handler(ctx: Context<LpWithdraw>, shares: u64, min_usdc: u64) -> Result<()> {
    require!(shares > 0, ErrorCode::ZeroAmount);
    require!(!ctx.accounts.vault_state.paused, ErrorCode::Paused);

    let vault_state = &ctx.accounts.vault_state;
    vault_math::require_lp_nav_synced_in_current_slot(vault_state.last_pnl_sync_slot)?;
    require_keys_eq!(
        ctx.accounts.lp_mint.key(),
        vault_state.lp_mint,
        ErrorCode::InvalidVaultValue
    );

    let vault_balance = ctx.accounts.vault_token.amount;
    let supply = ctx.accounts.lp_mint.supply;
    let pnl = vault_state.reported_unrealized_pnl;

    let usdc_out = lp_nav::usdc_for_withdraw(shares, vault_balance, supply, pnl)?;

    let free_capital = vault_math::free_capital(vault_balance, vault_state.total_locked_capital)?;
    require!(usdc_out <= free_capital, ErrorCode::InsufficientFreeCapital);

    require!(usdc_out >= min_usdc, ErrorCode::SlippageExceeded);

    token::burn(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Burn {
                mint: ctx.accounts.lp_mint.to_account_info(),
                from: ctx.accounts.user_lp.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        shares,
    )?;

    let bump = vault_state.bump;
    let seeds: &[&[u8]] = &[b"vault", &[bump]];
    let signer = &[seeds];

    let xfer = Transfer {
        from: ctx.accounts.vault_token.to_account_info(),
        to: ctx.accounts.user_usdc.to_account_info(),
        authority: ctx.accounts.vault_state.to_account_info(),
    };
    token::transfer(
        CpiContext::new_with_signer(ctx.accounts.token_program.key(), xfer, signer),
        usdc_out,
    )?;

    Ok(())
}
