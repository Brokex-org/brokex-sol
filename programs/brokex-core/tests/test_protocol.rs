use anchor_litesvm::{AnchorContext, AnchorLiteSVM, Signer};
use anchor_lang::{
    prelude::Pubkey,
    solana_program::instruction::Instruction,
    InstructionData, ToAccountMetas,
};
use brokex_core::{constants::*, state::*};
use std::path::PathBuf;

fn brokex_core_elf() -> &'static [u8] {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/deploy/brokex_core.so");
    let data = std::fs::read(&path).unwrap_or_else(|e| {
        panic!(
            "missing {} — run `yarn prep:program-keys && anchor build` from the repo root (or `yarn test:rust:litesvm`): {e}",
            path.display()
        )
    });
    Box::leak(data.into_boxed_slice())
}

fn send_ix(ctx: &mut AnchorContext, ix: Instruction, admin: &anchor_litesvm::Keypair) {
    ctx.execute_instruction(ix, &[admin])
        .expect("execute_instruction failed")
        .assert_success();
}

#[test]
fn test_protocol_flow() {
    let program_id = brokex_core::id();
    let bytes = brokex_core_elf();

    let mut ctx = AnchorLiteSVM::build_with_program(program_id, bytes);

    let admin = anchor_litesvm::Keypair::new();
    ctx.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();

    let (config_pda, _) = Pubkey::find_program_address(&[CONFIG_SEED], &program_id);
    let init_ix = Instruction {
        program_id,
        accounts: brokex_core::accounts::InitializeProtocol {
            admin: admin.pubkey(),
            config: config_pda,
            system_program: anchor_lang::solana_program::system_program::ID,
        }
        .to_account_metas(None),
        data: brokex_core::instruction::InitializeProtocol {
            usdc_mint: Pubkey::new_unique(),
            vault: Pubkey::new_unique(),
            vault_program: Pubkey::new_unique(),
        }.data(),
    };
    send_ix(&mut ctx, init_ix, &admin);

    let asset_id = "BTC/USD".to_string();
    let pyth_feed = Pubkey::new_unique();
    let (asset_pda, _) =
        Pubkey::find_program_address(&[ASSET_SEED, asset_id.as_bytes()], &program_id);
    let add_asset_ix = Instruction {
        program_id,
        accounts: brokex_core::accounts::AddAsset {
            admin: admin.pubkey(),
            config: config_pda,
            asset: asset_pda,
            system_program: anchor_lang::solana_program::system_program::ID,
        }
        .to_account_metas(None),
        data: brokex_core::instruction::AddAsset {
            asset_id: asset_id.clone(),
            pyth_feed,
            config_input: brokex_core::instructions::AssetConfigInput {
                commission_open_bps: 0,
                base_spread_bps: 0,
                base_funding_per_year: 10_000,
                max_funding_per_year: 1_000_000,
                profit_cap_fp: 0,
                alpha_min_fp: 0,
                alpha_scale: 0,
                base_spread_fp: 0,
            }
        }
        .data(),
    };
    send_ix(&mut ctx, add_asset_ix, &admin);

    let config_data: ProtocolConfig = ctx.get_account(&config_pda).expect("config not found");
    assert_eq!(config_data.active_enabled_asset_count, 1);

    let toggle_asset_ix = Instruction {
        program_id,
        accounts: brokex_core::accounts::ToggleAssetStatus {
            admin: admin.pubkey(),
            config: config_pda,
            asset: asset_pda,
        }
        .to_account_metas(None),
        data: brokex_core::instruction::ToggleAssetStatus { is_enabled: false }.data(),
    };
    send_ix(&mut ctx, toggle_asset_ix, &admin);

    let toggle_protocol_ix = Instruction {
        program_id,
        accounts: brokex_core::accounts::ToggleProtocolStatus {
            admin: admin.pubkey(),
            config: config_pda,
        }
        .to_account_metas(None),
        data: brokex_core::instruction::ToggleProtocolStatus { is_paused: true }.data(),
    };
    send_ix(&mut ctx, toggle_protocol_ix, &admin);

    let config_data: ProtocolConfig = ctx.get_account(&config_pda).expect("config not found");
    assert!(config_data.is_paused);
}
