use anchor_lang::prelude::*;

use crate::error::ErrorCode;

/// NAV in raw stable units: `vault_balance + unrealized_pnl` (Extended MVP §21).
pub fn nav_i128(vault_balance: u64, unrealized_pnl: i128) -> Result<i128> {
    (vault_balance as i128)
        .checked_add(unrealized_pnl)
        .ok_or(error!(ErrorCode::InvalidVaultValue))
}

/// First LP deposit: 1 share per 1 raw unit of stable deposited (§23 bootstrap when `supply == 0`).
pub fn shares_for_first_deposit(deposit: u64) -> Result<u64> {
    require!(deposit > 0, ErrorCode::ZeroAmount);
    Ok(deposit)
}

/// Subsequent deposits: `shares = deposit * supply / nav` (floor), `nav = vault_balance + pnl` (§23).
pub fn shares_for_deposit(deposit: u64, vault_balance: u64, supply: u64, unrealized_pnl: i128) -> Result<u64> {
    require!(deposit > 0, ErrorCode::ZeroAmount);
    require!(supply > 0, ErrorCode::InvalidVaultValue);
    let nav = nav_i128(vault_balance, unrealized_pnl)?;
    require!(nav > 0, ErrorCode::LpNavNonPositive);
    let nav_u = u128::try_from(nav).map_err(|_| error!(ErrorCode::LpNavNonPositive))?;
    let num = (deposit as u128)
        .checked_mul(supply as u128)
        .ok_or(ErrorCode::InvalidVaultValue)?;
    let sh = num
        .checked_div(nav_u)
        .ok_or(ErrorCode::InvalidVaultValue)?;
    u64::try_from(sh).map_err(|_| error!(ErrorCode::InvalidVaultValue))
}

/// Withdraw: `usdc = shares * nav / supply` (floor) (§24).
pub fn usdc_for_withdraw(shares: u64, vault_balance: u64, supply: u64, unrealized_pnl: i128) -> Result<u64> {
    require!(shares > 0, ErrorCode::ZeroAmount);
    require!(supply > 0, ErrorCode::InvalidVaultValue);
    require!(shares <= supply, ErrorCode::InvalidVaultValue);
    let nav = nav_i128(vault_balance, unrealized_pnl)?;
    require!(nav > 0, ErrorCode::LpNavNonPositive);
    let nav_u = u128::try_from(nav).map_err(|_| error!(ErrorCode::LpNavNonPositive))?;
    let num = (shares as u128)
        .checked_mul(nav_u)
        .ok_or(ErrorCode::InvalidVaultValue)?;
    let out = num
        .checked_div(supply as u128)
        .ok_or(ErrorCode::InvalidVaultValue)?;
    u64::try_from(out).map_err(|_| error!(ErrorCode::InvalidVaultValue))
}
