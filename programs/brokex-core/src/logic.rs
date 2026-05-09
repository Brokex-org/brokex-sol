use anchor_lang::prelude::*;
use crate::error::CoreError;
use crate::state::PositionDirection;

pub const PRECISION: u128 = 1_000_000;

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
}
