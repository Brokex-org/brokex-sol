use anchor_lang::prelude::*;

use crate::CoreSetReportedUnrealizedPnl;
use crate::error::ErrorCode;
use crate::vault_math;

pub fn core_set_reported_unrealized_pnl_handler(
    ctx: Context<CoreSetReportedUnrealizedPnl>,
    reported_unrealized_pnl: i128,
) -> Result<()> {
    let slot = Clock::get()?.slot;
    let vault_state = &mut ctx.accounts.vault_state;
    require!(
        slot >= vault_state.last_pnl_sync_slot,
        ErrorCode::StalePnlSync
    );
    vault_state.last_pnl_sync_slot = slot;

    let balance = ctx.accounts.vault_token.amount;
    vault_state.reported_unrealized_pnl =
        vault_math::clamp_reported_unrealized_pnl(reported_unrealized_pnl, balance);
    Ok(())
}
