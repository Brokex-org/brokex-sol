use crate::state::*;
use anchor_lang::prelude::*;

pub const PRECISION: u128 = 1_000_000;

pub fn calculate_smoothstep_skew(long_oi: u64, short_oi: u64) -> u128 {
    let total = (long_oi as u128) + (short_oi as u128);
    if total == 0 { return 0; }
    
    let diff = if long_oi > short_oi { long_oi - short_oi } else { short_oi - long_oi };
    let r = (diff as u128 * PRECISION) / total;
    let r2 = (r * r) / PRECISION;
    
    (r2 * (3 * PRECISION - 2 * r)) / PRECISION
}

pub fn apply_spread(
    oracle_price: u64,
    direction: PositionDirection,
    long_oi: u64,
    short_oi: u64,
    base_spread_bps: u64,
) -> u64 {
    let p = calculate_smoothstep_skew(long_oi, short_oi);
    let is_dominant = match direction {
        PositionDirection::Long => long_oi > short_oi,
        PositionDirection::Short => short_oi > long_oi,
    };

    let spread_bps = if is_dominant {
        (base_spread_bps as u128 * (PRECISION + 3 * p)) / PRECISION
    } else {
        let reduction = (200_000 * p) / PRECISION;
        let factor = if PRECISION > reduction { PRECISION - reduction } else { 0 };
        (base_spread_bps as u128 * factor) / PRECISION
    };

    let amount = (oracle_price as u128 * spread_bps) / (10_000 * PRECISION);
    
    match direction {
        PositionDirection::Long => oracle_price + (amount as u64),
        PositionDirection::Short => oracle_price.saturating_sub(amount as u64),
    }
}

/// EVM `_applySpread(..., isOpen: false)` — exit leg (inverse of `apply_spread` for long/short).
pub fn apply_spread_close(
    oracle_price: u64,
    direction: PositionDirection,
    long_oi: u64,
    short_oi: u64,
    base_spread_bps: u64,
) -> u64 {
    let p = calculate_smoothstep_skew(long_oi, short_oi);
    let is_dominant = match direction {
        PositionDirection::Long => long_oi > short_oi,
        PositionDirection::Short => short_oi > long_oi,
    };

    let spread_bps = if is_dominant {
        (base_spread_bps as u128 * (PRECISION + 3 * p)) / PRECISION
    } else {
        let reduction = (200_000 * p) / PRECISION;
        let factor = if PRECISION > reduction { PRECISION - reduction } else { 0 };
        (base_spread_bps as u128 * factor) / PRECISION
    };

    let amount = (oracle_price as u128 * spread_bps) / (10_000 * PRECISION);

    match direction {
        PositionDirection::Long => oracle_price.saturating_sub(amount as u64),
        PositionDirection::Short => oracle_price.saturating_add(amount as u64),
    }
}

/// EVM `LIQ_THRESHOLD` (90% of `PRECISION`) for `(loss + funding) >= margin * threshold / PRECISION`.
pub const LIQ_THRESHOLD_BPS: u128 = 900_000;

/// Ported from EVM: _calculateLiquidationPrice
pub fn calculate_liquidation_price(
    open_price: u64,
    leverage: u8,
    direction: PositionDirection,
) -> u64 {
    let move_amt = (open_price as u128 * 900_000) / (leverage as u128 * PRECISION);
    let move_amt = move_amt as u64;

    match direction {
        PositionDirection::Long => {
            if open_price > move_amt { open_price - move_amt } else { 0 }
        },
        PositionDirection::Short => open_price + move_amt,
    }
}

pub fn calculate_need_lock(
    risk_long: u64,
    risk_short: u64,
    alpha_min: u64,
    alpha_scale: u64,
) -> u64 {
    let (matched, dominant) = if risk_long < risk_short {
        (risk_long as u128, risk_short as u128)
    } else {
        (risk_short as u128, risk_long as u128)
    };

    if dominant == 0 { return 0; }

    let balance = (matched * PRECISION) / dominant;
    let depth = if matched == 0 { 0 } else { 
        (matched * PRECISION) / (matched + alpha_scale as u128) 
    };
    
    let reduction = ((PRECISION - alpha_min as u128) * balance / PRECISION * depth) / PRECISION;
    let alpha = if PRECISION > reduction { PRECISION - reduction } else { alpha_min as u128 };
    let alpha = if alpha < alpha_min as u128 { alpha_min as u128 } else { alpha };

    ((dominant * alpha) / PRECISION) as u64
}
