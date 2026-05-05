use anchor_lang::prelude::*;
use crate::UpdateLockedCapital;

pub fn update_locked_capital_handler(ctx: Context<UpdateLockedCapital>, delta: i64) -> Result<()> {
    let vault_state = &mut ctx.accounts.vault_state;
    if delta >= 0 {
        vault_state.total_locked_capital = vault_state.total_locked_capital.checked_add(delta as u64).unwrap();
    } else {
        vault_state.total_locked_capital = vault_state.total_locked_capital.checked_sub(delta.abs() as u64).unwrap();
    }
    Ok(())
}
