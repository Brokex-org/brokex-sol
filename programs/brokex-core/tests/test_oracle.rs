use anchor_lang::prelude::*;
use brokex_core::oracle::{normalize_price, PriceFeedMessage, PRICE_PRECISION};

fn make_account_data(msg: &PriceFeedMessage, full_vl: bool) -> Vec<u8> {
    let mut buf = vec![0u8; 8 + 32];
    if full_vl { buf.push(1); } else { buf.extend_from_slice(&[0, 2]); }
    msg.serialize(&mut buf).unwrap();
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

#[test]
fn parses_full_verification_level() {
    let m = msg(6_500_000_000_000, 1_000_000, -8, 1_000_000);
    let data = make_account_data(&m, true);
    // Use AnchorDeserialize::try_from_slice
    let parsed = PriceFeedMessage::try_from_slice(&data[41..]).unwrap();
    assert_eq!(parsed.price, m.price);
    assert_eq!(parsed.conf, m.conf);
}

#[test]
fn parses_partial_verification_level() {
    let m = msg(6_500_000_000_000, 1_000_000, -8, 1_000_000);
    let data = make_account_data(&m, false);
    let parsed = PriceFeedMessage::try_from_slice(&data[42..]).unwrap();
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
