use anchor_lang::prelude::*;
use crate::error::CoreError;
use crate::state::PositionDirection;

/// Fixed-point scale for ratios and alpha (1e6).
pub const PRECISION: u128 = 1_000_000;
pub const PRECISION_U64: u64 = 1_000_000;

pub const DEFAULT_PROFIT_CAP_FP: u64 = PRECISION_U64;
pub const DEFAULT_ALPHA_MIN_FP: u64 = 800_000;
pub const DEFAULT_ALPHA_SCALE: u64 = 1_000_000;

/// Smoothstep imbalance skew `p` in \[0, PRECISION\] from long/short OI (same construction as funding family / `v1.md`).
pub fn skew_p_smoothstep(oi_long: u64, oi_short: u64) -> u128 {
    let total = oi_long as u128 + oi_short as u128;
    if total == 0 {
        return 0;
    }
    let diff = (oi_long as i128 - oi_short as i128).unsigned_abs() as u128;
    let p = PRECISION;
    let x_fp = diff.saturating_mul(p) / total;
    let x2 = x_fp.saturating_mul(x_fp) / p;
    let x3 = x2.saturating_mul(x_fp) / p;
    x2.saturating_mul(3).saturating_sub(x3.saturating_mul(2))
}

/// Numerator for `spread / baseSpread` scaled by PRECISION (dominant: 1+3p, minority: 1-0.2p).
fn spread_scale_numerator(trade_is_long: bool, oi_long: u64, oi_short: u64, skew_p: u128) -> u128 {
    let p = PRECISION;
    let dominant_nr = p.saturating_add(skew_p.saturating_mul(3));
    let minority_nr = p.saturating_sub(skew_p / 5);

    if oi_long == oi_short {
        return p;
    }

    let on_dominant_side = if trade_is_long {
        oi_long > oi_short
    } else {
        oi_short > oi_long
    };

    if on_dominant_side {
        dominant_nr
    } else {
        minority_nr
    }
}

/// Execution price after applying dynamic spread; uses OI snapshot **before** exposure updates (`v1.md` dynamic spread — open vs close).
pub fn execution_price_with_spread(
    oracle_price: u64,
    base_spread_bps: u64,
    direction: PositionDirection,
    is_close: bool,
    oi_long: u64,
    oi_short: u64,
) -> Result<u64> {
    if base_spread_bps == 0 {
        return Ok(oracle_price);
    }

    let skew = skew_p_smoothstep(oi_long, oi_short);
    let trade_is_long = matches!(direction, PositionDirection::Long);
    let mult_nr = spread_scale_numerator(trade_is_long, oi_long, oi_short, skew);

    let oracle_u = oracle_price as u128;
    let base_abs = oracle_u
        .checked_mul(base_spread_bps as u128)
        .ok_or(CoreError::Overflow)?
        / 10_000u128;
    let spread_abs = base_abs
        .checked_mul(mult_nr)
        .ok_or(CoreError::Overflow)?
        / PRECISION;

    let spread_u64 = u64::try_from(spread_abs).map_err(|_| error!(CoreError::Overflow))?;

    match (direction, is_close) {
        (PositionDirection::Long, false) => oracle_price
            .checked_add(spread_u64)
            .ok_or(CoreError::Overflow.into()),
        (PositionDirection::Short, false) => oracle_price
            .checked_sub(spread_u64)
            .ok_or(CoreError::InvalidPrice.into()),
        (PositionDirection::Long, true) => oracle_price
            .checked_sub(spread_u64)
            .ok_or(CoreError::InvalidPrice.into()),
        (PositionDirection::Short, true) => oracle_price
            .checked_add(spread_u64)
            .ok_or(CoreError::Overflow.into()),
    }
}

/// Per `@brokex-solana/Extended_MVP.md` §§11–12: `lpLockedCapital = openInterest * profitCap` (fixed-point cap).
pub fn trade_lp_locked_capital(oi: u64, profit_cap_fp: u64) -> Result<u64> {
    let prod = (oi as u128)
        .checked_mul(profit_cap_fp as u128)
        .ok_or(CoreError::Overflow)?;
    // Truncates toward zero vs exact fixed-point oi * cap / PRECISION (slightly under-books risk).
    let q = prod / PRECISION;
    u64::try_from(q).map_err(|_| error!(CoreError::Overflow))
}

/// `@brokex-solana/Extended_MVP.md` §12: matched/dominant, balance, depth, reduction, alpha, `needLock = dominant * alpha`.
pub fn need_lock(
    risk_long: u64,
    risk_short: u64,
    alpha_min_fp: u64,
    alpha_scale: u64,
) -> Result<u64> {
    require!(alpha_min_fp as u128 <= PRECISION, CoreError::InvalidCapitalParams);

    let matched = risk_long.min(risk_short);
    let dominant = risk_long.max(risk_short);
    if dominant == 0 {
        return Ok(0);
    }

    let p = PRECISION;
    let alpha_min = alpha_min_fp as u128;

    let balance_fp = (matched as u128)
        .checked_mul(p)
        .ok_or(CoreError::Overflow)?
        / (dominant as u128);

    let denom = (matched as u128)
        .checked_add(alpha_scale as u128)
        .ok_or(CoreError::Overflow)?;
    let depth_fp = if denom == 0 {
        0u128
    } else {
        (matched as u128)
            .checked_mul(p)
            .ok_or(CoreError::Overflow)?
            / denom
    };

    let one_minus_alpha_min = p.saturating_sub(alpha_min);
    let reduction_fp = one_minus_alpha_min
        .checked_mul(balance_fp)
        .ok_or(CoreError::Overflow)?
        .checked_div(p)
        .ok_or(CoreError::Overflow)?
        .checked_mul(depth_fp)
        .ok_or(CoreError::Overflow)?
        .checked_div(p)
        .ok_or(CoreError::Overflow)?;

    let alpha_from_curve = p.saturating_sub(reduction_fp);
    let alpha_fp = alpha_min.max(alpha_from_curve).min(p);

    let need = (dominant as u128)
        .checked_mul(alpha_fp)
        .ok_or(CoreError::Overflow)?
        .checked_div(p)
        .ok_or(CoreError::Overflow)?;

    u64::try_from(need).map_err(|_| error!(CoreError::Overflow))
}

/// `@brokex-solana/Extended_MVP.md` §13 open: lock `max(0, newNeedLock - oldNeedLock)`; returns new risk long/short and that delta.
pub fn capital_delta_open_add_side(
    risk_long: u64,
    risk_short: u64,
    add_long_side: bool,
    contrib: u64,
    alpha_min_fp: u64,
    alpha_scale: u64,
) -> Result<(u64, u64, u64)> {
    let old_need = need_lock(risk_long, risk_short, alpha_min_fp, alpha_scale)?;
    let (rl, rs) = if add_long_side {
        (
            risk_long
                .checked_add(contrib)
                .ok_or(CoreError::Overflow)?,
            risk_short,
        )
    } else {
        (
            risk_long,
            risk_short
                .checked_add(contrib)
                .ok_or(CoreError::Overflow)?,
        )
    };
    let new_need = need_lock(rl, rs, alpha_min_fp, alpha_scale)?;
    let delta_lock = new_need.saturating_sub(old_need);
    Ok((rl, rs, delta_lock))
}

/// `@brokex-solana/Extended_MVP.md` §13 close: unlock `max(0, oldNeedLock - newNeedLock)` only — never increase vault lock on close.
pub fn capital_delta_close_remove_side(
    risk_long: u64,
    risk_short: u64,
    long_side: bool,
    contrib: u64,
    alpha_min_fp: u64,
    alpha_scale: u64,
) -> Result<(u64, u64, u64)> {
    let old_need = need_lock(risk_long, risk_short, alpha_min_fp, alpha_scale)?;
    let (rl, rs) = if long_side {
        (
            risk_long
                .checked_sub(contrib)
                .ok_or(CoreError::InvariantViolation)?,
            risk_short,
        )
    } else {
        (
            risk_long,
            risk_short
                .checked_sub(contrib)
                .ok_or(CoreError::InvariantViolation)?,
        )
    };
    let new_need = need_lock(rl, rs, alpha_min_fp, alpha_scale)?;
    let delta_unlock = old_need.saturating_sub(new_need);
    Ok((rl, rs, delta_unlock))
}

pub fn validate_sl_tp(reference_price: u64, direction: PositionDirection, sl_price: u64, tp_price: u64) -> Result<()> {
    require!(reference_price > 0, CoreError::InvalidReferencePrice);

    match direction {
        PositionDirection::Long => {
            if sl_price != 0 {
                require!(sl_price < reference_price, CoreError::InvalidStopLossPrice);
            }
            if tp_price != 0 {
                require!(tp_price > reference_price, CoreError::InvalidTakeProfitPrice);
            }
        }
        PositionDirection::Short => {
            if sl_price != 0 {
                require!(sl_price > reference_price, CoreError::InvalidStopLossPrice);
            }
            if tp_price != 0 {
                require!(tp_price < reference_price, CoreError::InvalidTakeProfitPrice);
            }
        }
    }

    Ok(())
}

pub fn calculate_liquidation_price(entry_price: u64, leverage: u8, direction: PositionDirection) -> Result<u64> {
    require!(entry_price > 0, CoreError::InvalidReferencePrice);
    require!(leverage > 0, CoreError::Overflow);

    let move_amount = entry_price
        .checked_div(leverage as u64)
        .ok_or(CoreError::Overflow)?;

    let liq_price = match direction {
        PositionDirection::Long => entry_price.saturating_sub(move_amount),
        PositionDirection::Short => entry_price.checked_add(move_amount).ok_or(CoreError::Overflow)?,
    };

    Ok(liq_price)
}

// Vault `total_locked_capital` CPI alignment with core is exercised in `tests/brokex-core-lifecycle.ts`
// (`keeps vault total_locked_capital in sync through openPosition and closePosition`).
#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::PositionDirection;

    #[test]
    fn symmetric_book_entry_matches_base_spread_bps() {
        let oracle = 100_000_000u64;
        let bps = 100u64;
        let base_abs = (oracle as u128 * bps as u128 / 10000) as u64;

        let open_long =
            execution_price_with_spread(oracle, bps, PositionDirection::Long, false, 50, 50).unwrap();
        let open_short =
            execution_price_with_spread(oracle, bps, PositionDirection::Short, false, 50, 50).unwrap();

        assert_eq!(open_long, oracle + base_abs);
        assert_eq!(open_short, oracle - base_abs);

        let close_long =
            execution_price_with_spread(oracle, bps, PositionDirection::Long, true, 50, 50).unwrap();
        let close_short =
            execution_price_with_spread(oracle, bps, PositionDirection::Short, true, 50, 50).unwrap();

        assert_eq!(close_long, oracle - base_abs);
        assert_eq!(close_short, oracle + base_abs);
    }

    #[test]
    fn skewed_book_long_heavy_wider_long_open_tighter_short_open() {
        let oracle = 1_000_000u64;
        let bps = 100u64;

        let balanced_long =
            execution_price_with_spread(oracle, bps, PositionDirection::Long, false, 500, 500).unwrap();
        let skewed_long =
            execution_price_with_spread(oracle, bps, PositionDirection::Long, false, 900, 100).unwrap();
        assert!(
            skewed_long > balanced_long,
            "opening long on already-long-heavy book widens spread"
        );

        let balanced_short =
            execution_price_with_spread(oracle, bps, PositionDirection::Short, false, 500, 500).unwrap();
        let skewed_short =
            execution_price_with_spread(oracle, bps, PositionDirection::Short, false, 900, 100).unwrap();
        assert!(
            skewed_short > balanced_short,
            "opening short against long-heavy book is minority side — tighter (higher short entry price)"
        );
    }

    #[test]
    fn need_lock_single_sided_equals_risk() {
        let r = 5_000_000u64;
        let alpha_min = DEFAULT_ALPHA_MIN_FP;
        let scale = DEFAULT_ALPHA_SCALE;
        assert_eq!(need_lock(r, 0, alpha_min, scale).unwrap(), r);
        assert_eq!(need_lock(0, r, alpha_min, scale).unwrap(), r);
    }

    #[test]
    fn hedged_need_below_each_side_need() {
        let alpha_min = DEFAULT_ALPHA_MIN_FP;
        let scale = DEFAULT_ALPHA_SCALE;
        let r = 2_000_000u64;
        let solo_long = need_lock(r, 0, alpha_min, scale).unwrap();
        let hedged = need_lock(r, r, alpha_min, scale).unwrap();
        assert!(hedged < solo_long);
        assert!(hedged < r);
    }

    #[test]
    fn second_offsetting_open_smaller_delta_than_naive_max() {
        let alpha_min = DEFAULT_ALPHA_MIN_FP;
        let scale = DEFAULT_ALPHA_SCALE;
        let contrib = 1_000_000u64;
        let (_, _, d1) =
            capital_delta_open_add_side(0, 0, true, contrib, alpha_min, scale).unwrap();
        let (_, _, d2) =
            capital_delta_open_add_side(contrib, 0, false, contrib, alpha_min, scale).unwrap();
        assert_eq!(d1, contrib);
        assert!(
            d2 < contrib,
            "second leg should add less incremental lock than naive max delta"
        );
    }

    #[test]
    fn close_delta_non_negative() {
        let alpha_min = DEFAULT_ALPHA_MIN_FP;
        let scale = DEFAULT_ALPHA_SCALE;
        let rl = 3_000_000u64;
        let rs = 2_500_000u64;
        let contrib = 500_000u64;
        let (_, _, du) =
            capital_delta_close_remove_side(rl, rs, true, contrib, alpha_min, scale).unwrap();
        let old_n = need_lock(rl, rs, alpha_min, scale).unwrap();
        let new_n = need_lock(rl - contrib, rs, alpha_min, scale).unwrap();
        assert_eq!(du, old_n.saturating_sub(new_n));
    }
}
