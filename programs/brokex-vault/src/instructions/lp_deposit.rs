use anchor_lang::prelude::*;
use anchor_spl::token::{self, MintTo, Transfer};

use crate::LpDeposit;
use crate::error::ErrorCode;
use super::lp_nav;

pub fn lp_deposit_handler(ctx: Context<LpDeposit>, amount: u64, min_shares: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::ZeroAmount);
    require!(!ctx.accounts.vault_state.paused, ErrorCode::Paused);

    let vault_state = &ctx.accounts.vault_state;
    require_keys_eq!(
        ctx.accounts.lp_mint.key(),
        vault_state.lp_mint,
        ErrorCode::InvalidVaultValue
    );

    // Price using post-deposit notion of vault balance (§23), but compute and enforce
    // slippage *before* CPI so a failed mint path cannot strand USDC in the vault.
    let vault_balance = ctx
        .accounts
        .vault_token
        .amount
        .checked_add(amount)
        .ok_or(ErrorCode::InvalidVaultValue)?;
    let supply = ctx.accounts.lp_mint.supply;
    let pnl = ctx.accounts.vault_state.reported_unrealized_pnl;

    let shares = if supply == 0 {
        lp_nav::shares_for_first_deposit(amount)?
    } else {
        let s = lp_nav::shares_for_deposit(amount, vault_balance, supply, pnl)?;
        require!(s > 0, ErrorCode::AmountTooSmall);
        s
    };

    require!(shares >= min_shares, ErrorCode::SlippageExceeded);

    let cpi = Transfer {
        from: ctx.accounts.user_usdc.to_account_info(),
        to: ctx.accounts.vault_token.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    token::transfer(
        CpiContext::new(ctx.accounts.token_program.key(), cpi),
        amount,
    )?;

    let bump = ctx.accounts.vault_state.bump;
    let seeds: &[&[u8]] = &[b"vault", &[bump]];
    let signer = &[seeds];

    let mint_cpi = MintTo {
        mint: ctx.accounts.lp_mint.to_account_info(),
        to: ctx.accounts.user_lp.to_account_info(),
        authority: ctx.accounts.vault_state.to_account_info(),
    };
    token::mint_to(
        CpiContext::new_with_signer(ctx.accounts.token_program.key(), mint_cpi, signer),
        shares,
    )?;

    Ok(())
}
