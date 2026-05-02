pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;


declare_id!("9bPWLjPxqR78kR63YokXeQ8k1nLDHfagh4W2117vjyWu");

#[program]
pub mod brokex_solana {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        initialize::handler(ctx)
    }
}
