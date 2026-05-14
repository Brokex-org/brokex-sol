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
    Ok(get_validated_price_with_publish_time(
        price_account,
        expected_feed,
        max_age_secs,
        max_conf_bps,
    )?
    .0)
}

/// Same as [`get_validated_price`], but returns Pyth `publish_time` for merged-batch checks (Extended MVP §26).
pub fn get_validated_price_with_publish_time(
    price_account: &AccountInfo,
    expected_feed: &[u8; 32],
    max_age_secs:  u64,
    max_conf_bps:  u64,
) -> Result<(u64, i64)> {
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
            let kb = price_account.key().to_bytes();
            let price = kb[0] as u64;
            let current_time = Clock::get()?.unix_timestamp;
            // `kb[30]==0xFE`: publish_time = now - kb[1] seconds (for merged-batch mismatch tests; easy to grind).
            // `kb[31]==0xFF`: key[1] = simulated age in seconds (staleness tests).
            // `kb[31]==0xFE` (and byte 30 is not 0xFE): bytes[1..9] = explicit publish_time (i64 le).
            let publish_time = if kb[30] == 0xFE {
                current_time.saturating_sub(kb[1] as i64)
            } else if kb[31] == 0xFE {
                i64::from_le_bytes(kb[1..9].try_into().unwrap())
            } else {
                let age_secs = if kb[31] == 0xFF { kb[1] as u64 } else { 0u64 };
                current_time
                    .checked_sub(age_secs as i64)
                    .ok_or(error!(CoreError::InvalidPrice))?
            };
            require!(current_time >= publish_time, CoreError::FuturePrice);
            let age = (current_time - publish_time) as u64;
            require!(age <= max_age_secs, CoreError::StalePrice);
            let norm = PRICE_PRECISION
                .checked_mul(price)
                .ok_or(error!(CoreError::Overflow))?;
            return Ok((norm, publish_time));
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
    let norm = normalize_price(msg.price.unsigned_abs(), msg.exponent)?;
    Ok((norm, msg.publish_time))
}

/// All feeds in a merged proof must share one `publish_time` (single Hermes / batch payload).
pub fn require_all_same_publish_time(times: &[i64]) -> Result<()> {
    require!(!times.is_empty(), CoreError::InvariantViolation);
    let t0 = times[0];
    for t in &times[1..] {
        require!(*t == t0, CoreError::MergedOraclePublishTimeMismatch);
    }
    Ok(())
}

/// Validates Pyth updates against **exactly** `active_enabled_asset_count` distinct core [`Asset`](crate::state::Asset) accounts,
/// each with `is_enabled == true`, plus a matching Pyth account per pair. That matches “every enabled market” **only if**
/// `active_enabled_asset_count` is kept in sync with the true enabled-asset count (see `ProtocolConfig::active_enabled_asset_count`).
///
/// Also enforces: unique asset keys, per-feed freshness and confidence, and one shared `publish_time` (Extended MVP §26).
///
/// `remaining` must be `[asset, pyth, asset, pyth, ...]` with length `2 * active_enabled_asset_count`, except when
/// `active_enabled_asset_count == 0`: then `remaining` must be empty and this returns `Ok` immediately (nothing to validate).
pub fn validate_merged_oracle_for_active_assets<'info>(
    program_id: &Pubkey,
    remaining: &'info [AccountInfo<'info>],
    active_enabled_asset_count: u32,
    max_age_secs: u64,
    max_conf_bps: u64,
) -> Result<()> {
    let n = active_enabled_asset_count as usize;
    if n == 0 {
        // Intentional: no listed markets — empty proof is valid; do not “fix” by requiring dummy accounts.
        require!(remaining.is_empty(), CoreError::OracleProofCountMismatch);
        return Ok(());
    }
    let expected_len = n
        .checked_mul(2)
        .ok_or(error!(CoreError::Overflow))?;
    require!(
        remaining.len() == expected_len,
        CoreError::OracleProofCountMismatch
    );

    let mut seen: Vec<Pubkey> = Vec::with_capacity(n);
    let mut publish_times: Vec<i64> = Vec::with_capacity(n);

    for i in 0..n {
        let asset_ai = &remaining[2 * i];
        let pyth_ai = &remaining[2 * i + 1];

        let asset = Account::<crate::state::Asset>::try_from(asset_ai)
            .map_err(|_| error!(CoreError::InvalidOracleAssetAccount))?;
        require_keys_eq!(*asset_ai.owner, *program_id, CoreError::InvalidOracleAssetAccount);

        require!(asset.is_enabled, CoreError::AssetDisabled);

        let k = asset_ai.key();
        require!(!seen.contains(&k), CoreError::OracleProofDuplicateAsset);
        seen.push(k);

        let (_price, pt) = get_validated_price_with_publish_time(
            pyth_ai,
            &asset.pyth_feed.to_bytes(),
            max_age_secs,
            max_conf_bps,
        )?;
        publish_times.push(pt);
    }

    require_all_same_publish_time(&publish_times)
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
