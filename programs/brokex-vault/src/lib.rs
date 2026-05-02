pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;

declare_id!("DYG1pqLqLjU7JuZfHqMR8ZfvZtL2XneuaXFaAjwXkrXV");

#[program]
pub mod brokex_vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        initialize::handler(ctx)
    }
}
