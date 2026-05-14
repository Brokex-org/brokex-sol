use anchor_lang::prelude::*;

use crate::AdminSetReportedUnrealizedPnl;

pub fn admin_set_reported_unrealized_pnl_handler(
    ctx: Context<AdminSetReportedUnrealizedPnl>,
    reported_unrealized_pnl: i128,
) -> Result<()> {
    ctx.accounts.vault_state.reported_unrealized_pnl = reported_unrealized_pnl;
    Ok(())
}
