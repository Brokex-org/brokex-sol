use anchor_lang::prelude::*;
use crate::error::CoreError;

pub const PRICE_PRECISION: u64 = 1_000_000; // 1e6
/// Official Pyth Solana Receiver Program ID (Mainnet/Devnet)
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

/// Borsh-packed size of `PriceFeedMessage` (`pyth_solana_receiver_sdk::PriceUpdateV2::price_message`).
/// On-chain account data continues with `posted_slot: u64` after this; `try_from_slice` on the tail fails if those bytes are included.
const PRICE_FEED_MESSAGE_BYTES: usize =
    32 + 8 + 8 + 4 + 8 + 8 + 8 + 8;

/// Returns the size of the verification level header based on the first byte.
fn verification_level_size(data: &[u8]) -> Result<usize> {
    match data.first() {
        Some(0) => Ok(2), // Partial verification (discriminator + verification level)
        Some(1) => Ok(1), // Full verification
        _       => err!(CoreError::InvalidPrice),
    }
}

/// Validates a Pyth PriceUpdateV2 account and returns the normalized price.
pub fn get_validated_price(
    price_account: &AccountInfo,
    expected_feed: &[u8; 32],
    max_age_secs:  u64,
    max_conf_bps:  u64,
) -> Result<u64> {
    #[cfg(not(feature = "mock-oracle"))]
    let expected_owner = PYTH_RECEIVER_PROGRAM_ID
        .parse::<Pubkey>()
        .map_err(|_| error!(CoreError::InvalidPrice))?;

    // Ownership check (skipped in mock mode)
    #[cfg(not(feature = "mock-oracle"))]
    require_keys_eq!(*price_account.owner, expected_owner, CoreError::InvalidOracleOwner);

    #[cfg(feature = "mock-oracle")]
    {
        if price_account.owner == &anchor_lang::solana_program::system_program::ID {
            // Derive price from the first byte of the key to allow control in tests
            let price = price_account.key().to_bytes()[0] as u64;
            return Ok(PRICE_PRECISION * price);
        }
    }

    let data   = price_account.try_borrow_data()?;
    let mut offset = 8 + 32; // Skip discriminator (8b) + write_authority (32b)

    require!(data.len() > offset, CoreError::InvalidPrice);
    offset += verification_level_size(&data[offset..])?;

    let msg_end = offset
        .checked_add(PRICE_FEED_MESSAGE_BYTES)
        .ok_or(error!(CoreError::InvalidPrice))?;
    require!(data.len() >= msg_end, CoreError::InvalidPrice);

    // Deserialize only `price_message`; real accounts have `posted_slot` (8 B) after this.
    let msg = PriceFeedMessage::try_from_slice(&data[offset..msg_end])
        .map_err(|_| error!(CoreError::InvalidPrice))?;

    //  Feed ID check
    require!(msg.feed_id == *expected_feed, CoreError::FeedIdMismatch);

    // 5. Staleness check
    let current_time = Clock::get()?.unix_timestamp;
    
    // Explicitly check for future prices before subtraction to avoid overflow/underflow
    require!(current_time >= msg.publish_time, CoreError::FuturePrice);
    
    let age = (current_time - msg.publish_time) as u64;
    require!(age <= max_age_secs, CoreError::StalePrice);

    //  Price validity check (must be positive)
    require!(msg.price > 0, CoreError::InvalidPrice);

    //  Confidence check
    let conf_bps = (msg.conf as u128)
        .checked_mul(10_000)
        .ok_or(error!(CoreError::Overflow))?
        / msg.price.unsigned_abs() as u128;

    require!(conf_bps <= max_conf_bps as u128, CoreError::ConfidenceTooWide);

    //  Normalization to 1e6
    normalize_price(msg.price.unsigned_abs(), msg.exponent)
}

/// Scales the raw Pyth price to 1e6 precision based on the exponent.
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
