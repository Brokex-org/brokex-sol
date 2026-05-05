use anchor_lang::prelude::*;

#[error_code]
pub enum CoreError {
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
    #[msg("Price is stale")]
    StalePrice,
    #[msg("Price is from the future")]
    FuturePrice,
    #[msg("Price is invalid or negative")]
    InvalidPrice,
    #[msg("Confidence interval too wide")]
    ConfidenceTooWide,
    #[msg("Oracle feed ID mismatch")]
    FeedIdMismatch,
    #[msg("Invalid oracle account owner")]
    InvalidOracleOwner,
    #[msg("Trade size too small")]
    TradeSizeTooSmall,
    #[msg("Max open interest exceeded for this asset")]
    MaxOIExceeded,
    #[msg("Max open interest per trader exceeded")]
    MaxTraderOIExceeded,
    #[msg("Position is not open")]
    PositionNotOpen,
    #[msg("Configured vault program account is invalid")]
    InvalidVaultProgram,
    #[msg("Vault has insufficient liquidity for settlement payout")]
    InsufficientVaultLiquidity,
}
