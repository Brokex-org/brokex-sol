use anchor_lang::prelude::*;

use crate::AdminSetReportedUnrealizedPnl;
use crate::vault_math;

pub fn admin_set_reported_unrealized_pnl_handler(
    ctx: Context<AdminSetReportedUnrealizedPnl>,
    reported_unrealized_pnl: i128,
) -> Result<()> {
    let balance = ctx.accounts.vault_token.amount;
    ctx.accounts.vault_state.reported_unrealized_pnl =
        vault_math::clamp_reported_unrealized_pnl(reported_unrealized_pnl, balance);
    Ok(())
}
