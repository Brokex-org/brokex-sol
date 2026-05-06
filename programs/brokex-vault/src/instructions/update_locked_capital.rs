use anchor_lang::prelude::*;
use crate::UpdateLockedCapital;
use crate::error::ErrorCode;

pub fn update_locked_capital_handler(ctx: Context<UpdateLockedCapital>, delta: i64) -> Result<()> {
    let vault_state = &mut ctx.accounts.vault_state;
    if delta >= 0 {
        vault_state.total_locked_capital = vault_state
            .total_locked_capital
            .checked_add(delta as u64)
            .ok_or(ErrorCode::InvalidVaultValue)?;
    } else {
        vault_state.total_locked_capital = vault_state
            .total_locked_capital
            .checked_sub(delta.unsigned_abs())
            .ok_or(ErrorCode::InvalidUnlockAmount)?;
    }
    Ok(())
}
