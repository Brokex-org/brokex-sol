use anchor_lang::prelude::*;
use crate::error::CoreError;
use crate::state::{Asset, PositionDirection};

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
    let delta = current_index.saturating_sub(open_index);
    let fee_u128 = (oi as u128)
        .saturating_mul(delta)
        .checked_div(PRECISION)
        .ok_or(CoreError::Overflow)?;
    u64::try_from(fee_u128).map_err(|_| error!(CoreError::Overflow))
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
            base_funding_per_year: base,
            max_funding_per_year: max,
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
}
