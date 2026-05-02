use anchor_lang::prelude::*;
use crate::state::*;
use crate::constants::*;
use crate::error::BrokexError;

#[derive(Accounts)]
pub struct ToggleProtocolStatus<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump,
        constraint = config.admin == admin.key() @ BrokexError::Unauthorized
    )]
    pub config: Account<'info, ProtocolConfig>,
    
    pub admin: Signer<'info>,
}

pub fn toggle_protocol_handler(ctx: Context<ToggleProtocolStatus>, is_paused: bool) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.is_paused = is_paused;
    
    msg!("Protocol status updated: paused = {}", is_paused);
    Ok(())
}
