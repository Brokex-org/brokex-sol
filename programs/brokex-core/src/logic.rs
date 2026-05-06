use anchor_lang::prelude::*;

pub const PRECISION: u128 = 1_000_000;

// MVP: No complex risk models (Alpha/K), spread, or liquidation price logic.
// Logic is moved to instruction handlers for simplicity and MVP alignment.
