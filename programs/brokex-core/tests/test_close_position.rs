//! Edge-case integration tests for `close_position` (LiteSVM + vault CPI).
use anchor_lang::{
    prelude::Pubkey,
    solana_program::{
        clock::Clock,
        instruction::Instruction,
        system_program,
    },
    AnchorSerialize, InstructionData, ToAccountMetas,
};
use anchor_litesvm::{AnchorContext, AnchorLiteSVM, Keypair, Signer, TransactionResult};
use brokex_core::{
    constants::*,
    oracle::{PriceFeedMessage, PYTH_RECEIVER_PROGRAM_ID},
    state::*,
};
use brokex_vault::{accounts as vault_accounts, instruction as vault_ix};
use litesvm_utils::TestHelpers;
use solana_account::Account;
use std::path::PathBuf;

fn read_deploy_so(name: &str) -> &'static [u8] {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../target/deploy/")
        .join(name);
    let data = std::fs::read(&path).unwrap_or_else(|e| {
        panic!(
            "missing {} — run `yarn prep:program-keys && anchor build` from the repo root: {e}",
            path.display()
        )
    });
    Box::leak(data.into_boxed_slice())
}

fn exec(ctx: &mut AnchorContext, ix: Instruction, signers: &[&Keypair]) -> TransactionResult {
    ctx.execute_instruction(ix, signers)
        .expect("execute_instruction wrapper error")
}

fn assert_anchor_err(result: &TransactionResult, needle: &str) {
    result.assert_failure();
    let ok_log = result.logs().iter().any(|l| l.contains(needle));
    let ok_msg = result
        .error()
        .map(|e| e.contains(needle))
        .unwrap_or(false);
    assert!(
        ok_log || ok_msg,
        "expected '{}' in logs or error; err={:?}\nlogs:\n{}",
        needle,
        result.error(),
        result.logs().join("\n")
    );
}

fn get_token_balance(ctx: &AnchorContext, ata: &Pubkey) -> u64 {
    let account = ctx.svm.get_account(ata).expect("ata not found");
    u64::from_le_bytes(account.data[64..72].try_into().unwrap())
}

fn make_pyth_account_data(feed_id: [u8; 32], price: i64, exponent: i32, publish_time: i64) -> Vec<u8> {
    let mut data = vec![0u8; 8 + 32];
    data[0..8].copy_from_slice(&[5, 70, 1, 153, 71, 5, 112, 2]);
    data.push(1);
    let msg = PriceFeedMessage {
        feed_id,
        price,
        conf: 100,
        exponent,
        publish_time,
        prev_publish_time: publish_time.saturating_sub(1),
        ema_price: price,
        ema_conf: 100,
    };
    msg.serialize(&mut data).unwrap();
    data
}

fn install_pyth_account(
    ctx: &mut AnchorContext,
    pyth_kp: &Keypair,
    feed_id: [u8; 32],
    price: i64,
    exponent: i32,
    publish_time: i64,
) {
    let pyth_receiver_pid: Pubkey = PYTH_RECEIVER_PROGRAM_ID.parse().unwrap();
    let pyth_data = make_pyth_account_data(feed_id, price, exponent, publish_time);
    ctx.svm
        .set_account(
            pyth_kp.pubkey(),
            Account {
                lamports: 1_000_000_000,
                data: pyth_data,
                owner: pyth_receiver_pid,
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();
}

struct Fixture {
    ctx: AnchorContext,
    admin: Keypair,
    trader: Keypair,
    config_pda: Pubkey,
    asset_pda: Pubkey,
    asset_id: String,
    feed_id: Pubkey,
    vault_state: Pubkey,
    vault_token: Pubkey,
    trader_ata: Pubkey,
    settlement_auth: Pubkey,
    core_collateral_ata: Pubkey,
    pyth_kp: Keypair,
}

impl Fixture {
    fn new() -> Self {
        let core_so = read_deploy_so("brokex_core.so");
        let vault_so = read_deploy_so("brokex_vault.so");
        let programs = &[(brokex_core::id(), core_so), (brokex_vault::id(), vault_so)];
        let mut ctx = AnchorLiteSVM::build_with_programs(programs);

        let admin = Keypair::new();
        let trader = Keypair::new();
        ctx.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();
        ctx.airdrop(&trader.pubkey(), 10_000_000_000).unwrap();

        let mint_kp = ctx.svm.create_token_mint(&admin, 6).expect("mint");
        let mint = mint_kp.pubkey();

        let (settlement_auth, _) = Pubkey::find_program_address(&[SETTLEMENT_SEED], &brokex_core::id());
        let (vault_state, _) = Pubkey::find_program_address(&[b"vault"], &brokex_vault::id());
        let vault_token =
            anchor_spl::associated_token::get_associated_token_address(&vault_state, &mint);

        let init_vault_ix = Instruction::new_with_bytes(
            brokex_vault::id(),
            &vault_ix::Initialize {}.data(),
            vault_accounts::Initialize {
                admin: admin.pubkey(),
                vault_state,
                stable_mint: mint,
                core: settlement_auth,
                vault_token,
                token_program: anchor_spl::token::spl_token::ID,
                associated_token_program: anchor_spl::associated_token::ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        exec(&mut ctx, init_vault_ix, &[&admin]).assert_success();

        let admin_vault_liquidity_ata = ctx
            .svm
            .create_associated_token_account(&mint, &admin)
            .expect("admin ata");
        ctx.svm
            .mint_to(&mint, &admin_vault_liquidity_ata, &admin, 5_000_000_000)
            .expect("mint admin");

        let deposit_ix = Instruction::new_with_bytes(
            brokex_vault::id(),
            &vault_ix::Deposit { amount: 2_000_000_000 }.data(),
            vault_accounts::VaultDeposit {
                admin: admin.pubkey(),
                vault_state,
                admin_token: admin_vault_liquidity_ata,
                vault_token,
                token_program: anchor_spl::token::spl_token::ID,
            }
            .to_account_metas(None),
        );
        exec(&mut ctx, deposit_ix, &[&admin]).assert_success();

        let create_core_collateral_ix =
            anchor_spl::associated_token::spl_associated_token_account::instruction::create_associated_token_account(
                &admin.pubkey(),
                &settlement_auth,
                &mint,
                &anchor_spl::token::spl_token::ID,
            );
        exec(&mut ctx, create_core_collateral_ix, &[&admin])
            .assert_success();
        let core_collateral_ata =
            anchor_spl::associated_token::get_associated_token_address(&settlement_auth, &mint);
        ctx.svm
            .mint_to(&mint, &core_collateral_ata, &admin, 500_000_000)
            .expect("mint core collateral");

        let (config_pda, _) = Pubkey::find_program_address(&[CONFIG_SEED], &brokex_core::id());
        let init_core_ix = Instruction {
            program_id: brokex_core::id(),
            accounts: brokex_core::accounts::InitializeProtocol {
                admin: admin.pubkey(),
                config: config_pda,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
            data: brokex_core::instruction::InitializeProtocol {
                usdc_mint: mint,
                vault: vault_token,
                vault_program: brokex_vault::id(),
            }
            .data(),
        };
        exec(&mut ctx, init_core_ix, &[&admin]).assert_success();

        let asset_id = "SOL/USD".to_string();
        let feed_id = Pubkey::new_unique();
        let (asset_pda, _) =
            Pubkey::find_program_address(&[ASSET_SEED, asset_id.as_bytes()], &brokex_core::id());
        let add_asset_ix = Instruction {
            program_id: brokex_core::id(),
            accounts: brokex_core::accounts::AddAsset {
                admin: admin.pubkey(),
                config: config_pda,
                asset: asset_pda,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
            data: brokex_core::instruction::AddAsset {
                asset_id: asset_id.clone(),
                pyth_feed: feed_id,
                config_input: brokex_core::instructions::AssetConfigInput {
                    min_leverage: 1,
                    max_leverage: 100,
                    min_trade_size: 1,
                    commission_open_bps: 0,
                    base_spread_bps: 0,
                    max_open_interest: 10_000_000_000_000,
                    max_oi_per_trader: 10_000_000_000_000,
                    alpha_min: 500_000,
                    alpha_scale: 1_000_000_000,
                    k: 100_000_000,
                    profit_cap_bps: 5000,
                },
            }
            .data(),
        };
        exec(&mut ctx, add_asset_ix, &[&admin]).assert_success();

        let trader_ata = ctx
            .svm
            .create_associated_token_account(&mint, &trader)
            .expect("trader ata");
        ctx.svm
            .mint_to(&mint, &trader_ata, &admin, 500_000_000)
            .expect("mint trader");

        let pyth_kp = Keypair::new();
        install_pyth_account(
            &mut ctx,
            &pyth_kp,
            feed_id.to_bytes(),
            65_000_000_000,
            -6,
            1000,
        );

        let mut clock = Clock::default();
        clock.unix_timestamp = 1000;
        ctx.svm.set_sysvar(&clock);

        Self {
            ctx,
            admin,
            trader,
            config_pda,
            asset_pda,
            asset_id,
            feed_id,
            vault_state,
            vault_token,
            trader_ata,
            settlement_auth,
            core_collateral_ata,
            pyth_kp,
        }
    }

    fn position_pda(&self) -> Pubkey {
        self.position_pda_for(0)
    }

    fn position_pda_for(&self, trade_id: u64) -> Pubkey {
        Pubkey::find_program_address(
            &[
                POSITION_SEED,
                self.trader.pubkey().as_ref(),
                self.asset_id.as_bytes(),
                &trade_id.to_le_bytes(),
            ],
            &brokex_core::id(),
        )
        .0
    }

    fn open_long_default(&mut self) {
        self.open_long_for(0)
    }

    fn open_long_for(&mut self, trade_id: u64) {
        let open_ix = Instruction {
            program_id: brokex_core::id(),
            accounts: brokex_core::accounts::OpenPosition {
                trader: self.trader.pubkey(),
                config: self.config_pda,
                asset: self.asset_pda,
                pyth_price_update: self.pyth_kp.pubkey(),
                position: self.position_pda_for(trade_id),
                trader_token_account: self.trader_ata,
                vault_token_account: self.vault_token,
                token_program: anchor_spl::token::spl_token::ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
            data: brokex_core::instruction::OpenPosition {
                asset_id: self.asset_id.clone(),
                trade_id,
                collateral: 100_000_000,
                leverage: 10,
                direction: PositionDirection::Long,
                sl_price: 0,
                tp_price: 0,
            }
            .data(),
        };
        exec(&mut self.ctx, open_ix, &[&self.trader]).assert_success();
    }

    fn open_short_default(&mut self) {
        let open_ix = Instruction {
            program_id: brokex_core::id(),
            accounts: brokex_core::accounts::OpenPosition {
                trader: self.trader.pubkey(),
                config: self.config_pda,
                asset: self.asset_pda,
                pyth_price_update: self.pyth_kp.pubkey(),
                position: self.position_pda_for(0),
                trader_token_account: self.trader_ata,
                vault_token_account: self.vault_token,
                token_program: anchor_spl::token::spl_token::ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
            data: brokex_core::instruction::OpenPosition {
                asset_id: self.asset_id.clone(),
                trade_id: 0,
                collateral: 100_000_000,
                leverage: 10,
                direction: PositionDirection::Short,
                sl_price: 0,
                tp_price: 0,
            }
            .data(),
        };
        exec(&mut self.ctx, open_ix, &[&self.trader]).assert_success();
    }

    fn close_ix(&self) -> Instruction {
        Instruction {
            program_id: brokex_core::id(),
            accounts: brokex_core::accounts::ClosePosition {
                trader: self.trader.pubkey(),
                config: self.config_pda,
                asset: self.asset_pda,
                position: self.position_pda_for(0),
                pyth_price_update: self.pyth_kp.pubkey(),
                vault_token_account: self.vault_token,
                trader_token_account: self.trader_ata,
                settlement_authority: self.settlement_auth,
                core_collateral_token: self.core_collateral_ata,
                vault_program: brokex_vault::id(),
                vault_state: self.vault_state,
                token_program: anchor_spl::token::spl_token::ID,
            }
            .to_account_metas(None),
            data: brokex_core::instruction::ClosePosition {
                asset_id: self.asset_id.clone(),
                trade_id: 0,
            }
            .data(),
        }
    }

    fn liquidate_ix(&self, liquidator_pubkey: Pubkey) -> Instruction {
        Instruction {
            program_id: brokex_core::id(),
            accounts: brokex_core::accounts::LiquidatePosition {
                liquidator: liquidator_pubkey,
                trader: self.trader.pubkey(),
                config: self.config_pda,
                asset: self.asset_pda,
                position: self.position_pda_for(0),
                pyth_price_update: self.pyth_kp.pubkey(),
                vault_token_account: self.vault_token,
                trader_token_account: self.trader_ata,
                settlement_authority: self.settlement_auth,
                core_collateral_token: self.core_collateral_ata,
                vault_program: brokex_vault::id(),
                vault_state: self.vault_state,
                token_program: anchor_spl::token::spl_token::ID,
            }
            .to_account_metas(None),
            data: brokex_core::instruction::LiquidatePosition {
                asset_id: self.asset_id.clone(),
                trade_id: 0,
            }
            .data(),
        }
    }

    fn set_clock_ts(&mut self, unix_timestamp: i64) {
        let mut clock = Clock::default();
        clock.unix_timestamp = unix_timestamp;
        self.ctx.svm.set_sysvar(&clock);
    }

    fn position(&self) -> Position {
        self.ctx
            .get_account(&self.position_pda())
            .expect("position account")
    }

    fn asset(&self) -> Asset {
        self.ctx.get_account(&self.asset_pda).expect("asset")
    }
}

#[test]
fn close_happy_path_long_profit() {
    let mut f = Fixture::new();
    let trader_bal_before = get_token_balance(&f.ctx, &f.trader_ata);

    f.open_long_default();
    install_pyth_account(&mut f.ctx, &f.pyth_kp, f.feed_id.to_bytes(), 70_000_000_000, -6, 1000);

    let ix = f.close_ix();
    let signers = [&f.trader];
    exec(&mut f.ctx, ix, &signers).assert_success();

    let pos = f.position();
    assert!(pos.state == PositionState::Closed);
    assert!(get_token_balance(&f.ctx, &f.trader_ata) > trader_bal_before);
}

#[test]
fn close_happy_path_short_profit() {
    let mut f = Fixture::new();
    let trader_bal_before = get_token_balance(&f.ctx, &f.trader_ata);

    f.open_short_default();
    install_pyth_account(&mut f.ctx, &f.pyth_kp, f.feed_id.to_bytes(), 60_000_000_000, -6, 1000);

    let ix = f.close_ix();
    let signers = [&f.trader];
    exec(&mut f.ctx, ix, &signers).assert_success();

    let pos = f.position();
    assert!(pos.state == PositionState::Closed);
    assert!(get_token_balance(&f.ctx, &f.trader_ata) > trader_bal_before);
}

#[test]
fn close_unauthorized_errors() {
    let mut f = Fixture::new();
    f.open_long_default();
    let rogue = Keypair::new();
    f.ctx.airdrop(&rogue.pubkey(), 1_000_000_000).unwrap();

    let mut ix = f.close_ix();
    ix.accounts[0].pubkey = rogue.pubkey(); // Change trader to rogue

    let signers = [&rogue];
    let r = exec(&mut f.ctx, ix, &signers);
    assert_anchor_err(&r, "ConstraintSeeds");
}

#[test]
fn liquidate_long_success() {
    let mut f = Fixture::new();
    f.open_long_default();
    
    // Drop price to liquidate ($65k -> $55k)
    install_pyth_account(&mut f.ctx, &f.pyth_kp, f.feed_id.to_bytes(), 55_000_000_000, -6, 1000);

    let liquidator = Keypair::new();
    f.ctx.airdrop(&liquidator.pubkey(), 1_000_000_000).unwrap();

    let ix = f.liquidate_ix(liquidator.pubkey());
    let signers = [&liquidator];
    exec(&mut f.ctx, ix, &signers).assert_success();

    let pos = f.position();
    assert!(pos.state == PositionState::Liquidated);
}

#[test]
fn liquidate_fails_if_not_threshold_met() {
    let mut f = Fixture::new();
    f.open_long_default();
    
    // Price only drops a little ($65k -> $64k) - not liquidation level
    install_pyth_account(&mut f.ctx, &f.pyth_kp, f.feed_id.to_bytes(), 64_000_000_000, -6, 1000);

    let liquidator = Keypair::new();
    f.ctx.airdrop(&liquidator.pubkey(), 1_000_000_000).unwrap();

    let ix = f.liquidate_ix(liquidator.pubkey());
    let signers = [&liquidator];
    let r = exec(&mut f.ctx, ix, &signers);
    assert_anchor_err(&r, "Overflow"); // Our error for "is_liq was false" in calculate_settlement
}
