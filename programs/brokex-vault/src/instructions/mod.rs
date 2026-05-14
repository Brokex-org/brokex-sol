//! Handlers only — account structs are included at crate root via `include!("contexts.rs")` in `lib.rs`.

mod admin_set_paused;
mod admin_set_reported_unrealized_pnl;
mod deposit;
mod initialize;
mod lp_deposit;
mod lp_nav;
mod lp_withdraw;
mod settle;
mod withdraw;
mod update_locked_capital;

pub use admin_set_paused::set_paused_handler;
pub use admin_set_reported_unrealized_pnl::admin_set_reported_unrealized_pnl_handler;
pub use deposit::deposit_handler;
pub use initialize::initialize_handler;
pub use lp_deposit::lp_deposit_handler;
pub use lp_withdraw::lp_withdraw_handler;
pub use settle::settle_handler;
pub use withdraw::withdraw_handler;
pub use update_locked_capital::update_locked_capital_handler;
