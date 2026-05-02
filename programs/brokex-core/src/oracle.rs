use anchor_lang::prelude::*;
use crate::error::CoreError;

pub const PRICE_PRECISION: u64 = 1_000_000; // 1e6
pub const PYTH_RECEIVER_PROGRAM_ID: &str = "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ";

#[derive(AnchorDeserialize, AnchorSerialize, Clone, Copy)]
pub struct PriceFeedMessage {
    pub feed_id:           [u8; 32],
    pub price:             i64,
    pub conf:              u64,
    pub exponent:          i32,
    pub publish_time:      i64,
    pub prev_publish_time: i64,
    pub ema_price:         i64,
    pub ema_conf:          u64,
}

/// Returns the size of the verification level header based on the first byte.
fn verification_level_size(data: &[u8]) -> Result<usize> {
    match data.first() {
        Some(0) => Ok(2), // Partial verification
        Some(1) => Ok(1), // Full verification
        _       => err!(CoreError::InvalidPrice),
    }
}

pub fn get_validated_price(
    price_account: &AccountInfo,
    expected_feed: &[u8; 32],
    max_age_secs:  u64,
    max_conf_bps:  u64,
) -> Result<u64> {
    let expected_owner = PYTH_RECEIVER_PROGRAM_ID
        .parse::<Pubkey>()
        .map_err(|_| error!(CoreError::InvalidPrice))?;

    require_keys_eq!(*price_account.owner, expected_owner, CoreError::InvalidPrice);

    let data   = price_account.try_borrow_data()?;
    let mut offset = 8 + 32; // Skip discriminator and header

    require!(data.len() > offset + 2, CoreError::InvalidPrice);

    offset += verification_level_size(&data[offset..])?;

    let msg = PriceFeedMessage::try_from_slice(&data[offset..])
        .map_err(|_| error!(CoreError::InvalidPrice))?;

    require!(msg.feed_id == *expected_feed, CoreError::InvalidPrice);

    let age = Clock::get()?.unix_timestamp.saturating_sub(msg.publish_time);
    require!(age >= 0 && (age as u64) <= max_age_secs, CoreError::StalePrice);

    require!(msg.price > 0, CoreError::InvalidPrice);

    let conf_bps = (msg.conf as u128)
        .checked_mul(10_000)
        .ok_or(error!(CoreError::Overflow))?
        / msg.price.unsigned_abs() as u128;

    require!(conf_bps <= max_conf_bps as u128, CoreError::ConfidenceTooWide);

    normalize_price(msg.price.unsigned_abs(), msg.exponent)
}

pub fn normalize_price(raw: u64, exponent: i32) -> Result<u64> {
    let shift = exponent + 6i32; // Target 10^6
    if shift >= 0 {
        let factor = 10u64.checked_pow(shift as u32).ok_or(error!(CoreError::Overflow))?;
        raw.checked_mul(factor).ok_or(error!(CoreError::Overflow))
    } else {
        let factor = 10u64.checked_pow((-shift) as u32).ok_or(error!(CoreError::Overflow))?;
        Ok(raw / factor)
    }
}
