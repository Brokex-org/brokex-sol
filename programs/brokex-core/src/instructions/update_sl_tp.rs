use anchor_lang::prelude::*;
use crate::state::*;
use crate::constants::*;
use crate::error::CoreError;
use crate::logic::validate_sl_tp;

#[derive(Accounts)]
#[instruction(asset_id: String, trade_id: u64)]
pub struct UpdateSlTp<'info> {
    #[account(mut)]
    pub trader: Signer<'info>,

    #[account(
        mut,
        seeds = [POSITION_SEED, trader.key().as_ref(), asset_id.as_bytes(), trade_id.to_le_bytes().as_ref()],
        bump = position.bump,
        has_one = trader @ CoreError::Unauthorized,
        constraint = position.state == PositionState::Open || position.state == PositionState::Pending @ CoreError::PositionNotOpen,
    )]
    pub position: Account<'info, Position>,
}

pub fn update_sl_tp_handler(ctx: Context<UpdateSlTp>, _asset_id: String, _trade_id: u64, sl_price: u64, tp_price: u64) -> Result<()> {
    let position = &mut ctx.accounts.position;
    let reference_price = if position.state == PositionState::Open {
        position.entry_price
    } else {
        position.target_price
    };
    validate_sl_tp(reference_price, position.direction, sl_price, tp_price)?;

    position.sl_price = sl_price;
    position.tp_price = tp_price;

    msg!("SL/TP updated for TradeID {}: SL={}, TP={}", position.trade_id, sl_price, tp_price);

    Ok(())
}
