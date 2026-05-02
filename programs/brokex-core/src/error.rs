use anchor_lang::prelude::*;

#[error_code]
pub enum BrokexError {
    #[msg("Unauthorized access")]
    Unauthorized,
    #[msg("Protocol is paused")]
    Paused,
    #[msg("Asset is disabled")]
    AssetDisabled,
    #[msg("Asset ID is too long")]
    AssetIdTooLong,
    #[msg("Calculation overflow")]
    Overflow,
    #[msg("No pending admin found")]
    PendingAdminNotSet,
}
