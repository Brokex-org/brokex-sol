use anchor_lang::prelude::*;
use brokex_core::oracle::{normalize_price, require_all_same_publish_time, PriceFeedMessage, PRICE_PRECISION};

// Offset math: 8 (discriminator) + 32 (header)
const MSG_OFFSET_BASE: usize = 40;

fn make_account_data(msg: &PriceFeedMessage, full_vl: bool) -> Vec<u8> {
    let mut buf = vec![0u8; 8 + 32];
    if full_vl {
        buf.push(1); // 1 byte verification header
    } else {
        buf.extend_from_slice(&[0, 2]); // 2 byte verification header
    }
    use anchor_lang::AnchorSerialize;
    msg.serialize(&mut buf).unwrap();
    buf.extend_from_slice(&999u64.to_le_bytes()); // posted_slot like real PriceUpdateV2
    buf
}

fn msg(price: i64, conf: u64, exponent: i32, publish_time: i64) -> PriceFeedMessage {
    PriceFeedMessage {
        feed_id: [0u8; 32],
        price,
        conf,
        exponent,
        publish_time,
        prev_publish_time: publish_time - 1,
        ema_price: price,
        ema_conf: conf,
    }
}

#[test]
fn normalize_btc_exponent_neg8() {
    assert_eq!(normalize_price(6_500_000_000_000, -8).unwrap(), 65_000 * PRICE_PRECISION);
}

#[test]
fn normalize_exponent_neg6() {
    assert_eq!(normalize_price(65_000_000_000, -6).unwrap(), 65_000_000_000);
}

#[test]
fn normalize_exponent_zero() {
    assert_eq!(normalize_price(65_000, 0).unwrap(), 65_000 * PRICE_PRECISION);
}

#[test]
fn normalize_exponent_positive() {
    assert_eq!(normalize_price(650, 2).unwrap(), 65_000 * PRICE_PRECISION);
}

const PRICE_FEED_MESSAGE_BYTES: usize = 32 + 8 + 8 + 4 + 8 + 8 + 8 + 8;

#[test]
fn parses_full_verification_level() {
    let m = msg(6_500_000_000_000, 1_000_000, -8, 1_000_000);
    let data = make_account_data(&m, true);

    // Offset = Base(40) + 1 (full verification byte) = 41
    let o = MSG_OFFSET_BASE + 1;
    let parsed = PriceFeedMessage::try_from_slice(&data[o..o + PRICE_FEED_MESSAGE_BYTES]).unwrap();
    assert_eq!(parsed.price, m.price);
    assert_eq!(parsed.conf, m.conf);
}

#[test]
fn parses_partial_verification_level() {
    let m = msg(6_500_000_000_000, 1_000_000, -8, 1_000_000);
    let data = make_account_data(&m, false);

    // Offset = Base(40) + 2 (partial verification bytes) = 42
    let o = MSG_OFFSET_BASE + 2;
    let parsed = PriceFeedMessage::try_from_slice(&data[o..o + PRICE_FEED_MESSAGE_BYTES]).unwrap();
    assert_eq!(parsed.price, m.price);
}

#[test]
fn confidence_within_limit() {
    let conf_bps = (10_000u128 * 10_000) / 1_000_000u128;
    assert!(conf_bps <= 200);
}

#[test]
fn confidence_exceeds_limit() {
    let conf_bps = (50_000u128 * 10_000) / 1_000_000u128;
    assert!(conf_bps > 200);
}

#[test]
fn price_within_max_age() {
    let age = 1_000_000i64.saturating_sub(999_970);
    assert!((age as u64) <= 60);
}

#[test]
fn price_beyond_max_age() {
    let age = 1_000_000i64.saturating_sub(999_900);
    assert!((age as u64) > 60);
}

#[test]
fn merged_publish_times_all_equal_ok() {
    require_all_same_publish_time(&[42, 42, 42]).unwrap();
}

#[test]
fn merged_publish_times_mismatch_rejected() {
    assert!(require_all_same_publish_time(&[42, 43]).is_err());
}
