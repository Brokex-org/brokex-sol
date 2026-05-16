use anchor_lang::prelude::*;

use crate::CoreSetReportedUnrealizedPnl;

pub fn core_set_reported_unrealized_pnl_handler(
    ctx: Context<CoreSetReportedUnrealizedPnl>,
    reported_unrealized_pnl: i128,
) -> Result<()> {
    ctx.accounts.vault_state.reported_unrealized_pnl = reported_unrealized_pnl;
    Ok(())
}
