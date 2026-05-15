use anchor_lang::prelude::*;

use crate::Initialize;
use crate::error::ErrorCode;

pub fn initialize_handler(ctx: Context<Initialize>) -> Result<()> {
    require!(
        ctx.accounts.core.key() != Pubkey::default(),
        ErrorCode::CoreNotSet
    );

    let bump = ctx.bumps.vault_state;
    let state = &mut ctx.accounts.vault_state;
    state.admin = ctx.accounts.admin.key();
    state.stable_mint = ctx.accounts.stable_mint.key();
    state.token_vault = ctx.accounts.vault_token.key();
    state.core = ctx.accounts.core.key();
    state.paused = false;
    state.bump = bump;
    state.total_locked_capital = 0;
    state.lp_mint = ctx.accounts.lp_mint.key();
    state.reported_unrealized_pnl = 0;

    Ok(())
}
