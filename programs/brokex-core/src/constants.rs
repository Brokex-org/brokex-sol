use anchor_lang::prelude::*;

#[constant]
pub const CONFIG_SEED: &[u8] = b"config";
#[constant]
pub const ASSET_SEED: &[u8] = b"asset";
#[constant]
pub const POSITION_SEED: &[u8] = b"position";

/// PDA authorized as `VaultState.core` for vault `settle` CPIs from this program.
#[constant]
pub const SETTLEMENT_SEED: &[u8] = b"settlement";
