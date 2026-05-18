use anchor_lang::prelude::*;
use crate::UpdateLockedCapital;
use crate::error::ErrorCode;

pub fn update_locked_capital_handler(ctx: Context<UpdateLockedCapital>, delta: i64) -> Result<()> {
    let vault_state = &mut ctx.accounts.vault_state;
    let vault_balance = ctx.accounts.vault_token.amount;

    if delta >= 0 {
        let new_locked = vault_state
            .total_locked_capital
            .checked_add(delta as u64)
            .ok_or(ErrorCode::InvalidVaultValue)?;
        require!(new_locked <= vault_balance, ErrorCode::InvalidVaultValue);
        vault_state.total_locked_capital = new_locked;
    } else {
        let new_locked = vault_state
            .total_locked_capital
            .checked_sub(delta.unsigned_abs())
            .ok_or(ErrorCode::InvalidUnlockAmount)?;
        require!(new_locked <= vault_balance, ErrorCode::InvalidVaultValue);
        vault_state.total_locked_capital = new_locked;
    }

    require!(
        vault_state.total_locked_capital <= vault_balance,
        ErrorCode::InvariantViolation
    );
    Ok(())
}
