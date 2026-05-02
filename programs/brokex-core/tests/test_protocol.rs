use anchor_lang::{
    prelude::Pubkey, solana_program::instruction::Instruction, InstructionData, ToAccountMetas,
};
use anchor_litesvm::{AnchorContext, AnchorLiteSVM, Signer};
use brokex_core::constants::{ASSET_SEED, CONFIG_SEED};
use brokex_core::instruction;
use brokex_core::state::Asset;

fn send_ix(ctx: &mut AnchorContext, ix: Instruction, admin: &anchor_litesvm::Keypair) {
    ctx.execute_instruction(ix, &[admin])
        .expect("execute_instruction failed")
        .assert_success();
}

#[test]
fn test_protocol_flow() {
    let program_id = brokex_core::id();
    let bytes = include_bytes!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../target/deploy/brokex_core.so"
    ));

    let mut ctx = AnchorLiteSVM::build_with_program(program_id, bytes);

    let admin = ctx
        .create_funded_account(10_000_000_000)
        .expect("airdrop failed");

    let (config_pda, _) = Pubkey::find_program_address(&[CONFIG_SEED], &program_id);

    // Initialize Protocol
    let init_ix = Instruction::new_with_bytes(
        program_id,
        &instruction::InitializeProtocol {}.data(),
        brokex_core::accounts::InitializeProtocol {
            config: config_pda,
            admin: admin.pubkey(),
            system_program: anchor_lang::solana_program::system_program::ID,
        }
        .to_account_metas(None),
    );
    send_ix(&mut ctx, init_ix, &admin);

    // Verify Config
    let config_data = ctx
        .get_account::<brokex_core::ProtocolConfig>(&config_pda)
        .expect("config not found");
    assert_eq!(config_data.admin, admin.pubkey());
    assert!(!config_data.is_paused);

    //  Add Asset
    let asset_id = "SOL/USD".to_string();
    let pyth_feed = Pubkey::new_unique();
    let (asset_pda, _) =
        Pubkey::find_program_address(&[ASSET_SEED, asset_id.as_bytes()], &program_id);

    let add_asset_ix = Instruction::new_with_bytes(
        program_id,
        &instruction::AddAsset {
            asset_id: asset_id.clone(),
            pyth_feed,
        }
        .data(),
        brokex_core::accounts::AddAsset {
            asset: asset_pda,
            config: config_pda,
            admin: admin.pubkey(),
            system_program: anchor_lang::solana_program::system_program::ID,
        }
        .to_account_metas(None),
    );
    send_ix(&mut ctx, add_asset_ix, &admin);

    // Verify Asset
    let asset_data: Asset = ctx.get_account(&asset_pda).expect("asset not found");
    assert_eq!(asset_data.asset_id, asset_id);
    assert_eq!(asset_data.pyth_feed, pyth_feed);
    assert!(asset_data.is_enabled);

    //  Toggle Asset off
    let toggle_asset_ix = Instruction::new_with_bytes(
        program_id,
        &instruction::ToggleAssetStatus { is_enabled: false }.data(),
        brokex_core::accounts::ToggleAssetStatus {
            asset: asset_pda,
            config: config_pda,
            admin: admin.pubkey(),
        }
        .to_account_metas(None),
    );
    send_ix(&mut ctx, toggle_asset_ix, &admin);

    let asset_data: Asset = ctx.get_account(&asset_pda).expect("asset not found");
    assert!(!asset_data.is_enabled);

    // Pause protocol
    let toggle_proto_ix = Instruction::new_with_bytes(
        program_id,
        &instruction::ToggleProtocolStatus { is_paused: true }.data(),
        brokex_core::accounts::ToggleProtocolStatus {
            config: config_pda,
            admin: admin.pubkey(),
        }
        .to_account_metas(None),
    );
    send_ix(&mut ctx, toggle_proto_ix, &admin);

    let config_data = ctx
        .get_account::<brokex_core::ProtocolConfig>(&config_pda)
        .expect("config not found");
    assert!(config_data.is_paused);
}
