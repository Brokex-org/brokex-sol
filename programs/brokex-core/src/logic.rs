use anchor_lang::prelude::*;
use crate::error::CoreError;
use crate::state::PositionDirection;

pub const PRECISION: u128 = 1_000_000;

// MVP: No complex risk models (Alpha/K), spread, or liquidation price logic.
// Logic is moved to instruction handlers for simplicity and MVP alignment.

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
