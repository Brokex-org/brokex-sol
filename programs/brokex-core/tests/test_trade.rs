use anchor_litesvm::{AnchorLiteSVM, AnchorContext, Signer, Keypair};
use anchor_lang::{
    prelude::*,
    solana_program::{
        instruction::Instruction, 
        system_program, 
        system_instruction,
        clock::Clock,
    },
    InstructionData, ToAccountMetas,
};
use solana_account::Account;
use brokex_core::{constants::*, state::*, oracle::{PriceFeedMessage, PYTH_RECEIVER_PROGRAM_ID}};

fn send_ix(ctx: &mut AnchorContext, ix: Instruction, signers: &[&Keypair]) {
    ctx.execute_instruction(ix, signers)
        .expect("execute_instruction failed")
        .assert_success();
}

fn make_pyth_data(price: i64, exponent: i32) -> Vec<u8> {
    let mut data = vec![0u8; 8 + 32];
    data[0..8].copy_from_slice(&[5, 70, 1, 153, 71, 5, 112, 2]); // Discriminator
    data.push(1); // Full verification
    let msg = PriceFeedMessage {
        feed_id: [0u8; 32],
        price,
        conf: 100,
        exponent,
        publish_time: 1000,
        prev_publish_time: 999,
        ema_price: price,
        ema_conf: 100,
    };
    use anchor_lang::AnchorSerialize;
    msg.serialize(&mut data).unwrap();
    data
}

#[test]
fn test_open_position_full_logic() {
    let program_id = brokex_core::id();
    let bytes = include_bytes!("../../../target/deploy/brokex_core.so");
    let mut ctx = AnchorLiteSVM::build_with_program(program_id, bytes);

    let admin = Keypair::new();
    let trader = Keypair::new();
    ctx.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();
    ctx.airdrop(&trader.pubkey(), 10_000_000_000).unwrap();

    // Setup USDC Mint
    let usdc_mint = Keypair::new();
    let (config_pda, _) = Pubkey::find_program_address(&[CONFIG_SEED], &program_id);
    
    let create_mint_ix = system_instruction::create_account(
        &admin.pubkey(),
        &usdc_mint.pubkey(),
        10_000_000, // lamports
        82, // size for Mint
        &anchor_spl::token::spl_token::ID,
    );
    ctx.execute_instruction(create_mint_ix, &[&admin, &usdc_mint]).unwrap().assert_success();

    let init_mint_ix = anchor_spl::token::spl_token::instruction::initialize_mint(
        &anchor_spl::token::spl_token::ID,
        &usdc_mint.pubkey(),
        &admin.pubkey(),
        None,
        6,
    ).unwrap();
    ctx.execute_instruction(init_mint_ix, &[&admin]).unwrap().assert_success();

    let vault = anchor_spl::associated_token::get_associated_token_address(&config_pda, &usdc_mint.pubkey());
    let create_vault_ix = anchor_spl::associated_token::spl_associated_token_account::instruction::create_associated_token_account(
        &admin.pubkey(),
        &config_pda,
        &usdc_mint.pubkey(),
        &anchor_spl::token::spl_token::ID,
    );
    ctx.execute_instruction(create_vault_ix, &[&admin]).unwrap().assert_success();

    // Initialize Protocol
    let init_ix = Instruction {
        program_id,
        accounts: brokex_core::accounts::InitializeProtocol {
            admin: admin.pubkey(),
            config: config_pda,
            system_program: system_program::ID,
        }.to_account_metas(None),
        data: brokex_core::instruction::InitializeProtocol {
            usdc_mint: usdc_mint.pubkey(),
            vault,
            vault_program: Pubkey::new_unique(),
        }.data(),
    };
    send_ix(&mut ctx, init_ix, &[&admin]);

    // Add Asset
    let asset_id = "SOL/USD".to_string();
    let (asset_pda, _) = Pubkey::find_program_address(&[ASSET_SEED, asset_id.as_bytes()], &program_id);
    let add_asset_ix = Instruction {
        program_id,
        accounts: brokex_core::accounts::AddAsset {
            admin: admin.pubkey(),
            config: config_pda,
            asset: asset_pda,
            system_program: system_program::ID,
        }.to_account_metas(None),
        data: brokex_core::instruction::AddAsset {
            asset_id: asset_id.clone(),
            pyth_feed: Pubkey::default(),
            config_input: brokex_core::instructions::AssetConfigInput {
                min_leverage: 1,
                max_leverage: 100,
                min_trade_size: 10_000_000,
                commission_open_bps: 10,
                base_spread_bps: 20,
                max_open_interest: 1_000_000_000_000,
                max_oi_per_trader: 100_000_000_000,
                alpha_min: 500_000,
                alpha_scale: 1_000_000_000,
                k: 100_000_000,
                profit_cap_bps: 5000,
            }
        }.data(),
    };
    send_ix(&mut ctx, add_asset_ix, &[&admin]);

    // Setup Trader USDC
    let trader_ata = anchor_spl::associated_token::get_associated_token_address(&trader.pubkey(), &usdc_mint.pubkey());
    let create_trader_ata_ix = anchor_spl::associated_token::spl_associated_token_account::instruction::create_associated_token_account(
        &trader.pubkey(),
        &trader.pubkey(),
        &usdc_mint.pubkey(),
        &anchor_spl::token::spl_token::ID,
    );
    ctx.execute_instruction(create_trader_ata_ix, &[&trader]).unwrap().assert_success();

    let mint_to_ix = anchor_spl::token::spl_token::instruction::mint_to(
        &anchor_spl::token::spl_token::ID,
        &usdc_mint.pubkey(),
        &trader_ata,
        &admin.pubkey(),
        &[],
        1000_000_000,
    ).unwrap();
    ctx.execute_instruction(mint_to_ix, &[&admin]).unwrap().assert_success();

    // Setup Mock Pyth Oracle ($65,000)
    let pyth_price_update = Keypair::new();
    let pyth_data = make_pyth_data(65_000_000_000, -6);
    let pyth_receiver_pid: Pubkey = PYTH_RECEIVER_PROGRAM_ID.parse().unwrap();
    
    ctx.svm.set_account(
        pyth_price_update.pubkey(),
        Account {
            lamports: 1_000_000_000,
            data: pyth_data,
            owner: pyth_receiver_pid,
            executable: false,
            rent_epoch: 0,
        }
    ).unwrap();
    
    let mut clock = Clock::default();
    clock.unix_timestamp = 1000;
    ctx.svm.set_sysvar(&clock);

    // Open Position
    let (position_pda, _) = Pubkey::find_program_address(&[POSITION_SEED, trader.pubkey().as_ref(), asset_id.as_bytes()], &program_id);
    let open_ix = Instruction {
        program_id,
        accounts: brokex_core::accounts::OpenPosition {
            trader: trader.pubkey(),
            config: config_pda,
            asset: asset_pda,
            pyth_price_update: pyth_price_update.pubkey(),
            position: position_pda,
            trader_token_account: trader_ata,
            vault_token_account: vault,
            token_program: anchor_spl::token::spl_token::ID,
            system_program: system_program::ID,
        }.to_account_metas(None),
        data: brokex_core::instruction::OpenPosition {
            asset_id: asset_id.clone(),
            collateral: 100_000_000,
            leverage: 10,
            direction: PositionDirection::Long,
            sl_price: 0,
            tp_price: 0,
        }.data(),
    };
    send_ix(&mut ctx, open_ix, &[&trader]);

    // Verification
    let pos_data: Position = ctx.get_account(&position_pda).unwrap();
    assert_eq!(pos_data.size, 999_000_000); 
    assert!(pos_data.entry_price > 65_000_000_000);
}
