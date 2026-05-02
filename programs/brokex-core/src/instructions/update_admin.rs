use anchor_lang::prelude::*;
use crate::state::*;
use crate::constants::*;
use crate::error::CoreError;

#[derive(Accounts)]
pub struct ProposeAdmin<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump,
        constraint = config.admin == admin.key() @ CoreError::Unauthorized
    )]
    pub config: Account<'info, ProtocolConfig>,
    
    pub admin: Signer<'info>,
}

pub fn propose_handler(ctx: Context<ProposeAdmin>, new_admin: Pubkey) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.pending_admin = Some(new_admin);
    
    msg!("New admin proposed: {}", new_admin);
    Ok(())
}

#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump,
        constraint = config.pending_admin == Some(pending_admin.key()) @ CoreError::Unauthorized
    )]
    pub config: Account<'info, ProtocolConfig>,
    
    pub pending_admin: Signer<'info>,
}

pub fn accept_handler(ctx: Context<AcceptAdmin>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.admin = config.pending_admin.ok_or(CoreError::PendingAdminNotSet)?;
    config.pending_admin = None;
    
    msg!("New admin accepted: {}", config.admin);
    Ok(())
}
