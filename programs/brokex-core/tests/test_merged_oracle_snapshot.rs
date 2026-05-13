//! Requires `target/deploy/brokex_core.so` built with `--features mock-oracle` (see `package.json` `build:mock-oracle:sbf`).
use anchor_lang::{AnchorSerialize, InstructionData, ToAccountMetas};
use anchor_litesvm::{
    build_anchor_instruction, AccountMeta, AnchorContext, AnchorLiteSVM, Instruction, Keypair,
    Pubkey, Signer, TransactionResult,
};
use brokex_core::{constants::*, state::*};
use std::path::PathBuf;

fn brokex_core_elf() -> &'static [u8] {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/deploy/brokex_core.so");
    let data = std::fs::read(&path).unwrap_or_else(|e| {
        panic!(
            "missing {} — run `yarn build:mock-oracle:sbf` then retry: {e}",
            path.display()
        )
    });
    Box::leak(data.into_boxed_slice())
}

fn asset_config() -> brokex_core::instructions::AssetConfigInput {
    brokex_core::instructions::AssetConfigInput {
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

/// Mock Pyth: system-owned account; `pubkey[0] > 0` price; avoid `pubkey[31]` in 0xFE/0xFF unless testing those paths.
fn mock_pyth_fresh_keypair() -> Keypair {
    loop {
        let k = Keypair::new();
        let b = k.pubkey().to_bytes();
        if b[0] > 0 && b[31] != 0xFE && b[31] != 0xFF {
            return k;
        }
    }
}

fn mock_pyth_stale_keypair() -> Keypair {
    loop {
        let k = Keypair::new();
        let b = k.pubkey().to_bytes();
        if b[31] == 0xFF && b[1] >= 100 {
            return k;
        }
    }
}

fn init_protocol(
    ctx: &mut AnchorContext,
    program_id: Pubkey,
    admin: &Keypair,
    config_pda: Pubkey,
) {
    let ix = Instruction {
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
        }
        .data(),
    };
    ctx.execute_instruction(ix, &[admin])
        .expect("init")
        .assert_success();
}

fn add_asset(
    ctx: &mut AnchorContext,
    program_id: Pubkey,
    admin: &Keypair,
    config_pda: Pubkey,
    asset_id: &str,
    pyth_feed: Pubkey,
) -> Pubkey {
    let (asset_pda, _) = Pubkey::find_program_address(&[ASSET_SEED, asset_id.as_bytes()], &program_id);
    let ix = Instruction {
        program_id,
        accounts: brokex_core::accounts::AddAsset {
            admin: admin.pubkey(),
            config: config_pda,
            asset: asset_pda,
            system_program: anchor_lang::solana_program::system_program::ID,
        }
        .to_account_metas(None),
        data: brokex_core::instruction::AddAsset {
            asset_id: asset_id.to_string(),
            pyth_feed,
            config_input: asset_config(),
        }
        .data(),
    };
    ctx.execute_instruction(ix, &[admin])
        .expect("add_asset")
        .assert_success();
    asset_pda
}

#[derive(AnchorSerialize)]
struct ValidateMergedOracleSnapshotArgs {
    pub max_age_secs: u64,
    pub max_conf_bps: u64,
}

fn validate_merged_ix(
    program_id: Pubkey,
    config_pda: Pubkey,
    asset_pyth_pairs: &[(Pubkey, Pubkey)],
) -> Instruction {
    let mut metas = brokex_core::accounts::ValidateMergedOracleSnapshot { config: config_pda }.to_account_metas(None);
    for (asset, pyth) in asset_pyth_pairs {
        metas.push(AccountMeta::new_readonly(*asset, false));
        metas.push(AccountMeta::new_readonly(*pyth, false));
    }
    build_anchor_instruction(
        &program_id,
        "validate_merged_oracle_snapshot",
        metas,
        ValidateMergedOracleSnapshotArgs {
            max_age_secs: 60,
            max_conf_bps: 200,
        },
    )
    .expect("build ix")
}

#[test]
fn merged_oracle_snapshot_success_two_assets() {
    let program_id = brokex_core::id();
    let bytes = brokex_core_elf();
    let mut ctx = AnchorLiteSVM::build_with_program(program_id, bytes);
    let admin = Keypair::new();
    ctx.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();
    let (config_pda, _) = Pubkey::find_program_address(&[CONFIG_SEED], &program_id);

    init_protocol(&mut ctx, program_id, &admin, config_pda);

    let pyth_btc = Pubkey::new_unique();
    let pyth_eth = Pubkey::new_unique();
    let asset_btc = add_asset(&mut ctx, program_id, &admin, config_pda, "BTC/USD", pyth_btc);
    let asset_eth = add_asset(&mut ctx, program_id, &admin, config_pda, "ETH/USD", pyth_eth);

    let cfg: ProtocolConfig = ctx.get_account(&config_pda).unwrap();
    assert_eq!(cfg.active_enabled_asset_count, 2);

    let k_btc = mock_pyth_fresh_keypair();
    let k_eth = mock_pyth_fresh_keypair();
    ctx.airdrop(&k_btc.pubkey(), 1_000_000).unwrap();
    ctx.airdrop(&k_eth.pubkey(), 1_000_000).unwrap();

    let payer = Keypair::new();
    ctx.airdrop(&payer.pubkey(), 10_000_000).unwrap();

    let ix = validate_merged_ix(
        program_id,
        config_pda,
        &[
            (asset_btc, k_btc.pubkey()),
            (asset_eth, k_eth.pubkey()),
        ],
    );
    ctx.execute_instruction(ix, &[&payer])
        .expect("exec")
        .assert_success();
}

#[test]
fn merged_oracle_snapshot_ok_zero_active_assets_empty_remaining() {
    let program_id = brokex_core::id();
    let bytes = brokex_core_elf();
    let mut ctx = AnchorLiteSVM::build_with_program(program_id, bytes);
    let admin = Keypair::new();
    ctx.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();
    let (config_pda, _) = Pubkey::find_program_address(&[CONFIG_SEED], &program_id);
    init_protocol(&mut ctx, program_id, &admin, config_pda);

    let cfg: ProtocolConfig = ctx.get_account(&config_pda).unwrap();
    assert_eq!(cfg.active_enabled_asset_count, 0);

    let payer = Keypair::new();
    ctx.airdrop(&payer.pubkey(), 10_000_000).unwrap();

    let ix = validate_merged_ix(program_id, config_pda, &[]);
    ctx.execute_instruction(ix, &[&payer])
        .expect("exec")
        .assert_success();
}

#[test]
fn merged_oracle_rejects_when_protocol_paused() {
    let program_id = brokex_core::id();
    let bytes = brokex_core_elf();
    let mut ctx = AnchorLiteSVM::build_with_program(program_id, bytes);
    let admin = Keypair::new();
    ctx.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();
    let (config_pda, _) = Pubkey::find_program_address(&[CONFIG_SEED], &program_id);

    init_protocol(&mut ctx, program_id, &admin, config_pda);

    let pyth_btc = Pubkey::new_unique();
    let pyth_eth = Pubkey::new_unique();
    let asset_btc = add_asset(&mut ctx, program_id, &admin, config_pda, "BTC/USD", pyth_btc);
    let asset_eth = add_asset(&mut ctx, program_id, &admin, config_pda, "ETH/USD", pyth_eth);

    let k_btc = mock_pyth_fresh_keypair();
    let k_eth = mock_pyth_fresh_keypair();
    ctx.airdrop(&k_btc.pubkey(), 1_000_000).unwrap();
    ctx.airdrop(&k_eth.pubkey(), 1_000_000).unwrap();

    let pause_ix = Instruction {
        program_id,
        accounts: brokex_core::accounts::ToggleProtocolStatus {
            admin: admin.pubkey(),
            config: config_pda,
        }
        .to_account_metas(None),
        data: brokex_core::instruction::ToggleProtocolStatus { is_paused: true }.data(),
    };
    ctx.execute_instruction(pause_ix, &[&admin])
        .expect("pause")
        .assert_success();

    let payer = Keypair::new();
    ctx.airdrop(&payer.pubkey(), 10_000_000).unwrap();

    let ix = validate_merged_ix(
        program_id,
        config_pda,
        &[
            (asset_btc, k_btc.pubkey()),
            (asset_eth, k_eth.pubkey()),
        ],
    );
    ctx.execute_instruction(ix, &[&payer])
        .expect("exec")
        .assert_failure();
}

#[test]
fn merged_oracle_rejects_count_mismatch_too_few_pairs() {
    let program_id = brokex_core::id();
    let bytes = brokex_core_elf();
    let mut ctx = AnchorLiteSVM::build_with_program(program_id, bytes);
    let admin = Keypair::new();
    ctx.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();
    let (config_pda, _) = Pubkey::find_program_address(&[CONFIG_SEED], &program_id);
    init_protocol(&mut ctx, program_id, &admin, config_pda);
    let a1 = add_asset(
        &mut ctx,
        program_id,
        &admin,
        config_pda,
        "BTC/USD",
        Pubkey::new_unique(),
    );
    let _a2 = add_asset(
        &mut ctx,
        program_id,
        &admin,
        config_pda,
        "ETH/USD",
        Pubkey::new_unique(),
    );

    let k = mock_pyth_fresh_keypair();
    ctx.airdrop(&k.pubkey(), 1_000_000).unwrap();
    let payer = Keypair::new();
    ctx.airdrop(&payer.pubkey(), 10_000_000).unwrap();

    let ix = validate_merged_ix(program_id, config_pda, &[(a1, k.pubkey())]);
    let r: TransactionResult = ctx.execute_instruction(ix, &[&payer]).expect("exec");
    r.assert_failure();
}

#[test]
fn merged_oracle_rejects_stale_price() {
    let program_id = brokex_core::id();
    let bytes = brokex_core_elf();
    let mut ctx = AnchorLiteSVM::build_with_program(program_id, bytes);
    let admin = Keypair::new();
    ctx.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();
    let (config_pda, _) = Pubkey::find_program_address(&[CONFIG_SEED], &program_id);
    init_protocol(&mut ctx, program_id, &admin, config_pda);
    let a1 = add_asset(
        &mut ctx,
        program_id,
        &admin,
        config_pda,
        "BTC/USD",
        Pubkey::new_unique(),
    );

    let k_stale = mock_pyth_stale_keypair();
    ctx.airdrop(&k_stale.pubkey(), 1_000_000).unwrap();
    let payer = Keypair::new();
    ctx.airdrop(&payer.pubkey(), 10_000_000).unwrap();

    let ix = validate_merged_ix(program_id, config_pda, &[(a1, k_stale.pubkey())]);
    ctx.execute_instruction(ix, &[&payer])
        .expect("exec")
        .assert_failure();
}

#[test]
fn merged_oracle_rejects_duplicate_asset_slot() {
    let program_id = brokex_core::id();
    let bytes = brokex_core_elf();
    let mut ctx = AnchorLiteSVM::build_with_program(program_id, bytes);
    let admin = Keypair::new();
    ctx.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();
    let (config_pda, _) = Pubkey::find_program_address(&[CONFIG_SEED], &program_id);
    init_protocol(&mut ctx, program_id, &admin, config_pda);
    let a1 = add_asset(
        &mut ctx,
        program_id,
        &admin,
        config_pda,
        "BTC/USD",
        Pubkey::new_unique(),
    );
    let _a2 = add_asset(
        &mut ctx,
        program_id,
        &admin,
        config_pda,
        "ETH/USD",
        Pubkey::new_unique(),
    );

    let k1 = mock_pyth_fresh_keypair();
    let k2 = mock_pyth_fresh_keypair();
    ctx.airdrop(&k1.pubkey(), 1_000_000).unwrap();
    ctx.airdrop(&k2.pubkey(), 1_000_000).unwrap();
    let payer = Keypair::new();
    ctx.airdrop(&payer.pubkey(), 10_000_000).unwrap();

    // Same asset twice — must not satisfy merged uniqueness (§26).
    let ix = validate_merged_ix(
        program_id,
        config_pda,
        &[(a1, k1.pubkey()), (a1, k2.pubkey())],
    );
    ctx.execute_instruction(ix, &[&payer])
        .expect("exec")
        .assert_failure();
}

#[test]
fn merged_oracle_rejects_disabled_asset_in_proof() {
    let program_id = brokex_core::id();
    let bytes = brokex_core_elf();
    let mut ctx = AnchorLiteSVM::build_with_program(program_id, bytes);
    let admin = Keypair::new();
    ctx.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();
    let (config_pda, _) = Pubkey::find_program_address(&[CONFIG_SEED], &program_id);
    init_protocol(&mut ctx, program_id, &admin, config_pda);
    let a1 = add_asset(
        &mut ctx,
        program_id,
        &admin,
        config_pda,
        "BTC/USD",
        Pubkey::new_unique(),
    );
    let a2 = add_asset(
        &mut ctx,
        program_id,
        &admin,
        config_pda,
        "ETH/USD",
        Pubkey::new_unique(),
    );

    let toggle_ix = Instruction {
        program_id,
        accounts: brokex_core::accounts::ToggleAssetStatus {
            admin: admin.pubkey(),
            config: config_pda,
            asset: a2,
        }
        .to_account_metas(None),
        data: brokex_core::instruction::ToggleAssetStatus { is_enabled: false }.data(),
    };
    ctx.execute_instruction(toggle_ix, &[&admin])
        .expect("toggle")
        .assert_success();

    let cfg: ProtocolConfig = ctx.get_account(&config_pda).unwrap();
    assert_eq!(cfg.active_enabled_asset_count, 1);

    let k1 = mock_pyth_fresh_keypair();
    let k2 = mock_pyth_fresh_keypair();
    ctx.airdrop(&k1.pubkey(), 1_000_000).unwrap();
    ctx.airdrop(&k2.pubkey(), 1_000_000).unwrap();
    let payer = Keypair::new();
    ctx.airdrop(&payer.pubkey(), 10_000_000).unwrap();

    let ix = validate_merged_ix(
        program_id,
        config_pda,
        &[(a1, k1.pubkey()), (a2, k2.pubkey())],
    );
    ctx.execute_instruction(ix, &[&payer])
        .expect("exec")
        .assert_failure();
}
