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

    #[msg("Invalid unlock amount")]
    InvalidUnlockAmount,
}
