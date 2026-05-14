use anchor_lang::prelude::*;
use crate::state::*;
use crate::constants::*;

#[derive(Accounts)]
pub struct InitializeProtocol<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + ProtocolConfig::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, ProtocolConfig>,
    
    #[account(mut)]
    pub admin: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn initialize_protocol_handler(
    ctx: Context<InitializeProtocol>,
    usdc_mint: Pubkey,
    vault: Pubkey,
    vault_state: Pubkey,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.pending_admin = None;
    config.is_paused = false;
    config.emergency_mode = false;
    config.next_position_id = 0;
    config.usdc_mint = usdc_mint;
    config.vault = vault;
    config.vault_state = vault_state;
    config.active_enabled_asset_count = 0;

    msg!("Protocol initialized with admin: {}", config.admin);
    Ok(())
}
