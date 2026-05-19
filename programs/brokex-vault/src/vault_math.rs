use anchor_lang::prelude::*;

use crate::error::ErrorCode;

/// `freeCapital = vaultBalance - totalLocked` (§25). Errors if locked exceeds balance.
pub fn free_capital(vault_balance: u64, total_locked: u64) -> Result<u64> {
    vault_balance
        .checked_sub(total_locked)
        .ok_or(error!(ErrorCode::InvariantViolation))
}

/// LP deposit/withdraw must use NAV from a merged-oracle sync in the same slot (Extended MVP §26).
pub fn require_lp_nav_synced_in_current_slot(last_pnl_sync_slot: u64) -> Result<()> {
    let slot = Clock::get()?.slot;
    require!(
        last_pnl_sync_slot == slot,
        ErrorCode::StaleLpNav
    );
    Ok(())
}

/// Keep `vault_balance + reported` within `[-vault_balance, +vault_balance]` (symmetric vs vault USDC).
pub fn clamp_reported_unrealized_pnl(reported: i128, vault_balance: u64) -> i128 {
    if vault_balance == 0 {
        return 0;
    }
    let vb = vault_balance as i128;
    reported.max(-vb).min(vb)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn free_capital_errors_when_locked_exceeds_balance() {
        assert!(free_capital(100, 101).is_err());
    }

    #[test]
    fn clamp_symmetric_to_vault_balance() {
        assert_eq!(clamp_reported_unrealized_pnl(-5_000, 1_000), -1_000);
        assert_eq!(clamp_reported_unrealized_pnl(5_000, 1_000), 1_000);
    }
}
