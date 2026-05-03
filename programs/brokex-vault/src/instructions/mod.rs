//! Handlers only — account structs are included at crate root via `include!("contexts.rs")` in `lib.rs`.

mod admin_set_paused;
mod deposit;
mod initialize;
mod settle;
mod withdraw;

pub use admin_set_paused::set_paused_handler;
pub use deposit::deposit_handler;
pub use initialize::initialize_handler;
pub use settle::settle_handler;
pub use withdraw::withdraw_handler;
