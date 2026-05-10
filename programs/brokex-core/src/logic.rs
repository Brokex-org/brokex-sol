use anchor_lang::prelude::*;
use crate::error::CoreError;
use crate::state::{Asset, PositionDirection};

/// Fixed-point scale for ratios and alpha (1e6).
pub const PRECISION: u128 = 1_000_000;
pub const SECONDS_PER_YEAR: i64 = 31_536_000;

pub fn sync_risk_from_oi(asset: &mut Asset) {
    asset.risk_long = asset.oi_long;
    asset.risk_short = asset.oi_short;
}

/// Imbalance skew `p` on 0..=PRECISION scale (Extended MVP §4 smoothstep).
pub fn smoothstep_skew_fp(oi_long: u64, oi_short: u64) -> u128 {
    let long = oi_long as u128;
    let short = oi_short as u128;
    let total = long.saturating_add(short);
    if total == 0 {
        return 0;
    }
    let diff = if long > short {
        long - short
    } else {
        short - long
    };
    let r_fp = diff
        .saturating_mul(PRECISION)
        .checked_div(total)
        .unwrap_or(0);
    r_fp
        .saturating_mul(r_fp)
        .saturating_mul(3u128.saturating_mul(PRECISION).saturating_sub(2u128.saturating_mul(r_fp)))
        .checked_div(PRECISION)
        .and_then(|x| x.checked_div(PRECISION))
        .unwrap_or(0)
}

/// Annual funding index growth for long and short (index units per year, before `dt / YEAR` integration).
pub fn funding_rates_annual(asset: &Asset) -> Result<(u64, u64)> {
    let base = asset.base_funding_per_year as u128;
    let max_f = asset.max_funding_per_year as u128;
    let p = smoothstep_skew_fp(asset.oi_long, asset.oi_short);

    let five_p = 5u128.saturating_mul(PRECISION);
    let dominant_raw = base
        .saturating_mul(five_p.saturating_add(95u128.saturating_mul(p)))
        .checked_div(10u128.saturating_mul(PRECISION))
        .ok_or(CoreError::Overflow)?;
    let minority_raw = base
        .saturating_mul(five_p.saturating_sub(2u128.saturating_mul(p)))
        .checked_div(10u128.saturating_mul(PRECISION))
        .ok_or(CoreError::Overflow)?;

    let dominant = dominant_raw.min(max_f);
    let minority = minority_raw.min(dominant);

    let half_base = base
        .checked_mul(5u128)
        .and_then(|x| x.checked_div(10))
        .ok_or(CoreError::Overflow)?;
    let balanced = half_base.min(max_f);

    let (rate_long, rate_short) = if asset.oi_long > asset.oi_short {
        (dominant, minority)
    } else if asset.oi_short > asset.oi_long {
        (minority, dominant)
    } else {
        (balanced, balanced)
    };

    Ok((
        u64::try_from(rate_long).map_err(|_| CoreError::Overflow)?,
        u64::try_from(rate_short).map_err(|_| CoreError::Overflow)?,
    ))
}

pub fn touch_asset_funding(asset: &mut Asset, now: i64) -> Result<()> {
    // First touch after asset init: establish the funding clock only. No accrual yet — there is
    // no prior timestamp, so Δt would be undefined; accrual starts on the next call.
    if asset.last_funding_update == 0 {
        asset.last_funding_update = now;
        return Ok(());
    }
    let dt = now.saturating_sub(asset.last_funding_update);
    if dt <= 0 {
        return Ok(());
    }
    asset.last_funding_update = now;

    let (rate_long, rate_short) = funding_rates_annual(asset)?;
    let dt_u = dt as u128;
    let inc_long = (rate_long as u128)
        .saturating_mul(dt_u)
        .checked_div(SECONDS_PER_YEAR as u128)
        .ok_or(CoreError::Overflow)?;
    let inc_short = (rate_short as u128)
        .saturating_mul(dt_u)
        .checked_div(SECONDS_PER_YEAR as u128)
        .ok_or(CoreError::Overflow)?;

    asset.funding_index_long = asset
        .funding_index_long
        .checked_add(inc_long)
        .ok_or(CoreError::Overflow)?;
    asset.funding_index_short = asset
        .funding_index_short
        .checked_add(inc_short)
        .ok_or(CoreError::Overflow)?;
    Ok(())
}

pub fn funding_index_for_direction(asset: &Asset, direction: PositionDirection) -> u128 {
    match direction {
        PositionDirection::Long => asset.funding_index_long,
        PositionDirection::Short => asset.funding_index_short,
    }
}

pub fn funding_fee_amount(oi: u64, open_index: u128, current_index: u128) -> Result<u64> {
    require!(
        current_index >= open_index,
        CoreError::InvariantViolation
    );
    let delta = current_index - open_index;
    let fee_u128 = (oi as u128)
        .saturating_mul(delta)
        .checked_div(PRECISION)
        .ok_or(CoreError::Overflow)?;
    u64::try_from(fee_u128).map_err(|_| error!(CoreError::Overflow))
}

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

#[cfg(test)]
mod funding_tests {
    use super::*;
    use crate::state::Asset;
    use anchor_lang::prelude::Pubkey;

    fn book(ol: u64, os: u64, base: u64, max: u64) -> Asset {
        Asset {
            asset_id: String::new(),
            pyth_feed: Pubkey::default(),
            is_enabled: true,
            commission_open_bps: 0,
            base_spread_bps: 0,
            base_funding_per_year: base,
            max_funding_per_year: max,
            profit_cap_fp: DEFAULT_PROFIT_CAP_FP,
            alpha_min_fp: DEFAULT_ALPHA_MIN_FP,
            alpha_scale: DEFAULT_ALPHA_SCALE,
            oi_long: ol,
            oi_short: os,
            risk_long: ol,
            risk_short: os,
            sum_priced_oi_long: 0,
            sum_priced_oi_short: 0,
            lp_locked_long: 0,
            lp_locked_short: 0,
            funding_index_long: 0,
            funding_index_short: 0,
            last_funding_update: 0,
        }
    }

    #[test]
    fn smoothstep_zero_when_balanced() {
        assert_eq!(smoothstep_skew_fp(100, 100), 0);
        assert_eq!(smoothstep_skew_fp(0, 0), 0);
    }

    #[test]
    fn smoothstep_increases_with_imbalance() {
        let p1 = smoothstep_skew_fp(60, 40);
        let p2 = smoothstep_skew_fp(90, 10);
        assert!(p2 > p1, "p2={p2} p1={p1}");
    }

    #[test]
    fn rates_equal_when_balanced() {
        let a = book(50, 50, 10_000, 100_000);
        let (rl, rs) = funding_rates_annual(&a).unwrap();
        assert_eq!(rl, rs);
        assert_eq!(rl, 5_000);
    }

    #[test]
    fn dominant_side_pays_more_per_year() {
        let a = book(1_000, 100, 10_000, 1_000_000);
        let (rl, rs) = funding_rates_annual(&a).unwrap();
        assert!(rl > rs, "long dominant should pay more: rl={rl} rs={rs}");
    }

    #[test]
    fn touch_accrues_indexes_over_time_no_full_scan() {
        let mut a = book(100, 100, 1_000_000, 10_000_000);
        touch_asset_funding(&mut a, 1_000_000).unwrap();
        assert_eq!(a.last_funding_update, 1_000_000);
        assert_eq!(a.funding_index_long, 0);
        touch_asset_funding(&mut a, 1_000_000 + SECONDS_PER_YEAR).unwrap();
        assert!(a.funding_index_long > 0 && a.funding_index_short > 0);
    }

    #[test]
    fn funding_fee_scales_with_index_delta_and_precision() {
        let fee = funding_fee_amount(2_000_000, 0, 10_000).unwrap();
        assert_eq!(fee, 20_000);
    }

    #[test]
    fn funding_fee_rejects_index_going_backwards() {
        let err = funding_fee_amount(1_000, 100, 99).unwrap_err();
        assert_eq!(err, anchor_lang::error::Error::from(CoreError::InvariantViolation));
    }
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
