use anchor_lang::prelude::*;

use crate::AdminSetPaused;

pub fn set_paused_handler(ctx: Context<AdminSetPaused>, paused: bool) -> Result<()> {
    ctx.accounts.vault_state.paused = paused;
    Ok(())
}
