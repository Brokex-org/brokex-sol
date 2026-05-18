use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Not owner")]
    NotOwner,

    #[msg("Not core")]
    NotCore,

    #[msg("Zero address")]
    ZeroAddress,

    #[msg("Zero amount")]
    ZeroAmount,

    #[msg("Paused")]
    Paused,

    #[msg("Reentrancy")]
    Reentrancy,

    #[msg("Transfer failed")]
    TransferFailed,

    #[msg("Core already locked")]
    CoreAlreadyLocked,

    #[msg("Core not set")]
    CoreNotSet,

    #[msg("Insufficient balance")]
    InsufficientBalance,

    #[msg("Insufficient free capital")]
    InsufficientFreeCapital,

    #[msg("Active withdraw request")]
    ActiveWithdrawRequest,

    #[msg("No active withdraw request")]
    NoActiveWithdrawRequest,

    #[msg("Amount too small")]
    AmountTooSmall,

    #[msg("Invalid vault value")]
    InvalidVaultValue,

    #[msg("LP NAV non-positive; cannot price shares")]
    LpNavNonPositive,

    #[msg("Slippage tolerance exceeded")]
    SlippageExceeded,

    #[msg("Invalid unlock amount")]
    InvalidUnlockAmount,

    #[msg("Vault invariant violated locked capital exceeds balance")]
    InvariantViolation,

    #[msg("Reported PnL sync slot is older than the last applied sync")]
    StalePnlSync,
}
