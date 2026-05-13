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
    #[msg("State invariant violated")]
    InvariantViolation,
    #[msg("Stop loss must be on the correct side of the reference price")]
    InvalidStopLossPrice,
    #[msg("Take profit must be on the correct side of the reference price")]
    InvalidTakeProfitPrice,
    #[msg("Invalid reference price for validation")]
    InvalidReferencePrice,
    #[msg("Invalid batch input")]
    InvalidBatchInput,
    #[msg("Invalid funding config (e.g. max funding too low vs base)")]
    InvalidFundingConfig,
    #[msg("Invalid capital locking parameters")]
    InvalidCapitalParams,
    #[msg("Invalid add/remove margin amount")]
    InvalidMarginAmount,
    #[msg("Insufficient margin after funding payment for this removal")]
    InsufficientMarginAfterFunding,
    #[msg("Partial close would leave open interest with no margin")]
    PartialCloseUndercollateralized,
    #[msg("Oracle mark is at or past liquidation after this margin removal")]
    PositionUnhealthyAfterMarginRemoval,
    #[msg("Merged oracle proof: account count does not match active asset count")]
    OracleProofCountMismatch,
    #[msg("Merged oracle proof: duplicate asset account")]
    OracleProofDuplicateAsset,
    #[msg("Merged oracle proof: publish times must match across all feeds (single batch)")]
    MergedOraclePublishTimeMismatch,
    #[msg("Merged oracle proof: invalid or wrong-program asset account")]
    InvalidOracleAssetAccount,
}
