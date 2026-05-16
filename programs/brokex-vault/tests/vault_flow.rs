//! Vault integration tests (LiteSVM).
//!
//! **Artifact:** needs `target/deploy/brokex_vault.so` from the repo root, e.g.
//! `yarn prep:program-keys && anchor build` (or `yarn test:rust:litesvm`).
//!
//! **Stale `.so` symptom:** if almost every test fails on the first `Initialize` with
//! `InvalidProgramId` / `token_program` and logs show `Left` = some PDA and `Right` =
//! `Tokenkeg...`, the binary was built before the on-chain `Initialize` account list
//! matched this repo (for example after adding `lp_mint`). Rebuild the program and
//! re-run these tests.
use anchor_lang::{
    prelude::Pubkey,
    solana_program::{instruction::Instruction, system_program},
    InstructionData, ToAccountMetas,
};
use anchor_litesvm::{AnchorContext, AnchorLiteSVM, Signer};
use brokex_vault::{accounts as vault_accounts, instruction as vault_ix, state::VaultState};
use litesvm_utils::{AssertionHelpers, TestHelpers, TransactionResult};
use std::path::PathBuf;

fn program_bytes() -> &'static [u8] {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/deploy/brokex_vault.so");
    let data = std::fs::read(&path).unwrap_or_else(|e| {
        panic!(
            "cannot read vault program artifact at {}: {e}\n\
Run from repo root: `yarn prep:program-keys && anchor build` (or `yarn test:rust:litesvm`).\n\
If the file loads but `Initialize` fails with InvalidProgramId on `token_program`, rebuild anyway — \
the .so likely predates the current `Initialize` account layout (e.g. `lp_mint`).",
            path.display()
        )
    });
    Box::leak(data.into_boxed_slice())
}

fn program_id() -> Pubkey {
    brokex_vault::id()
}

fn vault_state_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"vault"], &program_id())
}

fn vault_token_ata(mint: Pubkey, vault_state: Pubkey) -> Pubkey {
    spl_associated_token_account::get_associated_token_address(&vault_state, &mint)
}

fn exec(ctx: &mut AnchorContext, ix: Instruction, signers: &[&anchor_litesvm::Keypair]) -> TransactionResult {
    ctx.execute_instruction(ix, signers)
        .expect("execute_instruction wrapper error")
}

fn exec_ok(
    ctx: &mut AnchorContext,
    ix: Instruction,
    signers: &[&anchor_litesvm::Keypair],
) {
    exec(ctx, ix, signers).assert_success();
}

/// Anchor logs / error strings use variant names or `#[msg(...)]` text.
fn assert_anchor_err(result: &TransactionResult, code: &str) {
    result.assert_failure();
    let ok_log = result.logs().iter().any(|l| l.contains(code));
    let ok_msg = result
        .error()
        .map(|e| e.contains(code))
        .unwrap_or(false);
    assert!(
        ok_log || ok_msg,
        "expected '{}' in logs or error; err={:?}\nlogs:\n{}",
        code,
        result.error(),
        result.logs().join("\n")
    );
}

fn lp_mint_pda(vault_state: Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"lp_mint", vault_state.as_ref()], &program_id()).0
}

fn user_lp_ata(owner: Pubkey, lp_mint: Pubkey) -> Pubkey {
    spl_associated_token_account::get_associated_token_address(&owner, &lp_mint)
}

struct Fixture {
    ctx: AnchorContext,
    admin: anchor_litesvm::Keypair,
    core: anchor_litesvm::Keypair,
    _trader: anchor_litesvm::Keypair,
    attacker: anchor_litesvm::Keypair,
    mint: Pubkey,
    vault_state: Pubkey,
    vault_token: Pubkey,
    lp_mint: Pubkey,
    admin_ata: Pubkey,
    trader_ata: Pubkey,
    core_collateral_ata: Pubkey,
}

impl Fixture {
    fn new_uninitialized() -> Self {
        let mut ctx = AnchorLiteSVM::build_with_program(program_id(), program_bytes());
        let admin = ctx
            .create_funded_account(10_000_000_000)
            .expect("admin");
        let core = ctx
            .create_funded_account(10_000_000_000)
            .expect("core");
        let trader = ctx
            .create_funded_account(10_000_000_000)
            .expect("trader");
        let attacker = ctx
            .create_funded_account(10_000_000_000)
            .expect("attacker");

        let mint_kp = ctx.svm.create_token_mint(&admin, 6).expect("mint");
        let mint = mint_kp.pubkey();
        let (vault_state, _) = vault_state_pda();
        let vault_token = vault_token_ata(mint, vault_state);
        let lp_mint = lp_mint_pda(vault_state);

        let admin_ata = ctx
            .svm
            .create_associated_token_account(&mint, &admin)
            .expect("admin ata");
        ctx.svm
            .mint_to(&mint, &admin_ata, &admin, 100_000_000)
            .expect("mint admin");

        let trader_ata = ctx
            .svm
            .create_associated_token_account(&mint, &trader)
            .expect("trader ata");

        let core_collateral_ata = ctx
            .svm
            .create_associated_token_account(&mint, &core)
            .expect("core collateral ata");
        ctx.svm
            .mint_to(&mint, &core_collateral_ata, &admin, 50_000_000)
            .expect("mint core collateral");

        Self {
            ctx,
            admin,
            core,
            _trader: trader,
            attacker,
            mint,
            vault_state,
            vault_token,
            lp_mint,
            admin_ata,
            trader_ata,
            core_collateral_ata,
        }
    }

    fn init_ix(&self) -> Instruction {
        Instruction::new_with_bytes(
            program_id(),
            &vault_ix::Initialize {}.data(),
            vault_accounts::Initialize {
                admin: self.admin.pubkey(),
                vault_state: self.vault_state,
                stable_mint: self.mint,
                core: self.core.pubkey(),
                vault_token: self.vault_token,
                lp_mint: self.lp_mint,
                token_program: spl_token::id(),
                associated_token_program: spl_associated_token_account::id(),
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        )
    }

    fn initialize(&mut self) {
        let ix = self.init_ix();
        exec_ok(&mut self.ctx, ix, &[&self.admin]);
    }

    fn deposit_ix(&self, admin_token: Pubkey, amount: u64) -> Instruction {
        Instruction::new_with_bytes(
            program_id(),
            &vault_ix::Deposit { amount }.data(),
            vault_accounts::VaultDeposit {
                admin: self.admin.pubkey(),
                vault_state: self.vault_state,
                admin_token,
                vault_token: self.vault_token,
                token_program: spl_token::id(),
            }
            .to_account_metas(None),
        )
    }

    fn withdraw_ix(&self, admin_token: Pubkey, amount: u64) -> Instruction {
        Instruction::new_with_bytes(
            program_id(),
            &vault_ix::Withdraw { amount }.data(),
            vault_accounts::VaultWithdraw {
                admin: self.admin.pubkey(),
                vault_state: self.vault_state,
                admin_token,
                vault_token: self.vault_token,
                token_program: spl_token::id(),
            }
            .to_account_metas(None),
        )
    }

    fn settle_ix(&self, profit: u64, loss: u64, caller: &anchor_litesvm::Keypair) -> Instruction {
        Instruction::new_with_bytes(
            program_id(),
            &vault_ix::Settle { profit, loss }.data(),
            vault_accounts::VaultSettle {
                caller: caller.pubkey(),
                vault_state: self.vault_state,
                vault_token: self.vault_token,
                core_collateral_token: self.core_collateral_ata,
                trader_token: self.trader_ata,
                token_program: spl_token::id(),
            }
            .to_account_metas(None),
        )
    }

    fn set_paused_ix(&self, paused: bool) -> Instruction {
        Instruction::new_with_bytes(
            program_id(),
            &vault_ix::SetPaused { paused }.data(),
            vault_accounts::AdminSetPaused {
                admin: self.admin.pubkey(),
                vault_state: self.vault_state,
            }
            .to_account_metas(None),
        )
    }

    fn update_locked_ix(&self, delta: i64) -> Instruction {
        Instruction::new_with_bytes(
            program_id(),
            &vault_ix::UpdateLockedCapital { delta }.data(),
            vault_accounts::UpdateLockedCapital {
                caller: self.core.pubkey(),
                vault_state: self.vault_state,
                vault_token: self.vault_token,
            }
            .to_account_metas(None),
        )
    }

    fn admin_set_pnl_ix(&self, reported_unrealized_pnl: i128) -> Instruction {
        Instruction::new_with_bytes(
            program_id(),
            &vault_ix::AdminSetReportedUnrealizedPnl {
                reported_unrealized_pnl,
            }
            .data(),
            vault_accounts::AdminSetReportedUnrealizedPnl {
                admin: self.admin.pubkey(),
                vault_state: self.vault_state,
            }
            .to_account_metas(None),
        )
    }

    fn lp_deposit_ix(
        &self,
        user: &anchor_litesvm::Keypair,
        user_usdc: Pubkey,
        amount: u64,
        min_shares: u64,
    ) -> Instruction {
        Instruction::new_with_bytes(
            program_id(),
            &vault_ix::LpDeposit { amount, min_shares }.data(),
            vault_accounts::LpDeposit {
                user: user.pubkey(),
                vault_state: self.vault_state,
                user_usdc,
                vault_token: self.vault_token,
                lp_mint: self.lp_mint,
                user_lp: user_lp_ata(user.pubkey(), self.lp_mint),
                token_program: spl_token::id(),
            }
            .to_account_metas(None),
        )
    }

    fn lp_withdraw_ix(
        &self,
        user: &anchor_litesvm::Keypair,
        user_usdc: Pubkey,
        shares: u64,
        min_usdc: u64,
    ) -> Instruction {
        Instruction::new_with_bytes(
            program_id(),
            &vault_ix::LpWithdraw { shares, min_usdc }.data(),
            vault_accounts::LpWithdraw {
                user: user.pubkey(),
                vault_state: self.vault_state,
                user_usdc,
                vault_token: self.vault_token,
                lp_mint: self.lp_mint,
                user_lp: user_lp_ata(user.pubkey(), self.lp_mint),
                token_program: spl_token::id(),
            }
            .to_account_metas(None),
        )
    }

    fn vault_state_account(&self) -> VaultState {
        self.ctx.get_account(&self.vault_state).expect("vault state")
    }
}

// ─── Happy path ─────────────────────────────────────────────────────────────

#[test]
fn vault_initialize_deposit_withdraw_settle_pause_flow() {
    let mut f = Fixture::new_uninitialized();
    f.initialize();

    let st = f.vault_state_account();
    assert_eq!(st.admin, f.admin.pubkey());
    assert_eq!(st.core, f.core.pubkey());
    assert_eq!(st.stable_mint, f.mint);
    assert_eq!(st.token_vault, f.vault_token);
    assert!(!st.paused);

    f.ctx.svm.assert_token_balance(&f.vault_token, 0);

    let ix = f.deposit_ix(f.admin_ata, 10_000_000);
    exec_ok(&mut f.ctx, ix, &[&f.admin]);
    f.ctx.svm.assert_token_balance(&f.vault_token, 10_000_000);

    let ix = f.withdraw_ix(f.admin_ata, 3_000_000);
    exec_ok(&mut f.ctx, ix, &[&f.admin]);
    f.ctx.svm.assert_token_balance(&f.vault_token, 7_000_000);

    let ix = f.settle_ix(2_000_000, 0, &f.core);
    exec_ok(&mut f.ctx, ix, &[&f.core]);
    f.ctx.svm.assert_token_balance(&f.vault_token, 5_000_000);
    f.ctx.svm.assert_token_balance(&f.trader_ata, 2_000_000);

    let ix = f.set_paused_ix(true);
    exec_ok(&mut f.ctx, ix, &[&f.admin]);
    let ix = f.set_paused_ix(false);
    exec_ok(&mut f.ctx, ix, &[&f.admin]);
}

#[test]
fn settle_breakeven_no_transfers() {
    let mut f = Fixture::new_uninitialized();
    f.initialize();
    let ix = f.deposit_ix(f.admin_ata, 10_000_000);
    exec_ok(&mut f.ctx, ix, &[&f.admin]);
    let v_before = f.ctx.svm.get_account(&f.vault_token).unwrap().data;
    let t_before = f.ctx.svm.get_account(&f.trader_ata).unwrap().data;

    let ix = f.settle_ix(0, 0, &f.core);
    exec_ok(&mut f.ctx, ix, &[&f.core]);

    assert_eq!(
        f.ctx.svm.get_account(&f.vault_token).unwrap().data,
        v_before
    );
    assert_eq!(
        f.ctx.svm.get_account(&f.trader_ata).unwrap().data,
        t_before
    );
}

// ─── Initialize ─────────────────────────────────────────────────────────────

#[test]
fn initialize_duplicate_fails() {
    let mut f = Fixture::new_uninitialized();
    f.initialize();
    let ix = f.init_ix();
    let r = exec(&mut f.ctx, ix, &[&f.admin]);
    r.assert_failure();
}

// ─── Auth / constraints ─────────────────────────────────────────────────────

#[test]
fn deposit_non_admin_rejected() {
    let mut f = Fixture::new_uninitialized();
    f.initialize();
    let ix = Instruction::new_with_bytes(
        program_id(),
        &vault_ix::Deposit { amount: 1_000_000 }.data(),
        vault_accounts::VaultDeposit {
            admin: f.attacker.pubkey(),
            vault_state: f.vault_state,
            admin_token: f.admin_ata,
            vault_token: f.vault_token,
            token_program: spl_token::id(),
        }
        .to_account_metas(None),
    );
    let r = exec(&mut f.ctx, ix, &[&f.attacker]);
    assert_anchor_err(&r, "NotOwner");
}

#[test]
fn withdraw_non_admin_rejected() {
    let mut f = Fixture::new_uninitialized();
    f.initialize();
    let ix = f.deposit_ix(f.admin_ata, 10_000_000);
    exec_ok(&mut f.ctx, ix, &[&f.admin]);
    let ix = Instruction::new_with_bytes(
        program_id(),
        &vault_ix::Withdraw { amount: 1_000_000 }.data(),
        vault_accounts::VaultWithdraw {
            admin: f.attacker.pubkey(),
            vault_state: f.vault_state,
            admin_token: f.admin_ata,
            vault_token: f.vault_token,
            token_program: spl_token::id(),
        }
        .to_account_metas(None),
    );
    let r = exec(&mut f.ctx, ix, &[&f.attacker]);
    assert_anchor_err(&r, "NotOwner");
}

#[test]
fn set_paused_non_admin_rejected() {
    let mut f = Fixture::new_uninitialized();
    f.initialize();
    let ix = Instruction::new_with_bytes(
        program_id(),
        &vault_ix::SetPaused { paused: true }.data(),
        vault_accounts::AdminSetPaused {
            admin: f.attacker.pubkey(),
            vault_state: f.vault_state,
        }
        .to_account_metas(None),
    );
    let r = exec(&mut f.ctx, ix, &[&f.attacker]);
    assert_anchor_err(&r, "NotOwner");
}

#[test]
fn deposit_wrong_mint_admin_token_rejected() {
    let mut f = Fixture::new_uninitialized();
    f.initialize();

    let wrong_mint_kp = f
        .ctx
        .svm
        .create_token_mint(&f.admin, 6)
        .expect("wrong mint");
    let wrong_mint = wrong_mint_kp.pubkey();
    let wrong_ata = f
        .ctx
        .svm
        .create_associated_token_account(&wrong_mint, &f.admin)
        .expect("wrong ata");
    f.ctx
        .svm
        .mint_to(&wrong_mint, &wrong_ata, &f.admin, 1_000_000)
        .expect("mint wrong");

    let ix = Instruction::new_with_bytes(
        program_id(),
        &vault_ix::Deposit { amount: 1_000_000 }.data(),
        vault_accounts::VaultDeposit {
            admin: f.admin.pubkey(),
            vault_state: f.vault_state,
            admin_token: wrong_ata,
            vault_token: f.vault_token,
            token_program: spl_token::id(),
        }
        .to_account_metas(None),
    );
    let r = exec(&mut f.ctx, ix, &[&f.admin]);
    assert_anchor_err(&r, "InvalidVaultValue");
}

#[test]
fn withdraw_wrong_mint_admin_token_rejected() {
    let mut f = Fixture::new_uninitialized();
    f.initialize();
    let ix_dep = f.deposit_ix(f.admin_ata, 10_000_000);
    exec_ok(&mut f.ctx, ix_dep, &[&f.admin]);

    let wrong_mint_kp = f
        .ctx
        .svm
        .create_token_mint(&f.admin, 6)
        .expect("wrong mint");
    let wrong_mint = wrong_mint_kp.pubkey();
    let wrong_ata = f
        .ctx
        .svm
        .create_associated_token_account(&wrong_mint, &f.admin)
        .expect("wrong ata");
    f.ctx
        .svm
        .mint_to(&wrong_mint, &wrong_ata, &f.admin, 1_000_000)
        .expect("mint wrong");

    let ix = Instruction::new_with_bytes(
        program_id(),
        &vault_ix::Withdraw { amount: 1_000_000 }.data(),
        vault_accounts::VaultWithdraw {
            admin: f.admin.pubkey(),
            vault_state: f.vault_state,
            admin_token: wrong_ata,
            vault_token: f.vault_token,
            token_program: spl_token::id(),
        }
        .to_account_metas(None),
    );
    let r = exec(&mut f.ctx, ix, &[&f.admin]);
    assert_anchor_err(&r, "InvalidVaultValue");
}

// ─── Amounts ────────────────────────────────────────────────────────────────

#[test]
fn deposit_zero_rejected() {
    let mut f = Fixture::new_uninitialized();
    f.initialize();
    let ix = f.deposit_ix(f.admin_ata, 0);
    let r = exec(&mut f.ctx, ix, &[&f.admin]);
    assert_anchor_err(&r, "ZeroAmount");
}

#[test]
fn withdraw_zero_rejected() {
    let mut f = Fixture::new_uninitialized();
    f.initialize();
    let ix = f.deposit_ix(f.admin_ata, 10_000_000);
    exec_ok(&mut f.ctx, ix, &[&f.admin]);
    let ix = f.withdraw_ix(f.admin_ata, 0);
    let r = exec(&mut f.ctx, ix, &[&f.admin]);
    assert_anchor_err(&r, "ZeroAmount");
}

#[test]
fn withdraw_exceeds_vault_rejected() {
    let mut f = Fixture::new_uninitialized();
    f.initialize();
    let ix = f.deposit_ix(f.admin_ata, 10_000_000);
    exec_ok(&mut f.ctx, ix, &[&f.admin]);
    let ix = f.withdraw_ix(f.admin_ata, 10_000_001);
    let r = exec(&mut f.ctx, ix, &[&f.admin]);
    assert_anchor_err(&r, "InsufficientBalance");
}

// ─── Settle ──────────────────────────────────────────────────────────────────

#[test]
fn settle_non_core_rejected() {
    let mut f = Fixture::new_uninitialized();
    f.initialize();
    let ix = f.deposit_ix(f.admin_ata, 10_000_000);
    exec_ok(&mut f.ctx, ix, &[&f.admin]);
    let ix = f.settle_ix(1_000_000, 0, &f.attacker);
    let r = exec(&mut f.ctx, ix, &[&f.attacker]);
    assert_anchor_err(&r, "NotCore");
}

#[test]
fn settle_profit_exceeds_vault_rejected() {
    let mut f = Fixture::new_uninitialized();
    f.initialize();
    let ix = f.deposit_ix(f.admin_ata, 5_000_000);
    exec_ok(&mut f.ctx, ix, &[&f.admin]);
    let ix = f.settle_ix(6_000_000, 0, &f.core);
    let r = exec(&mut f.ctx, ix, &[&f.core]);
    assert_anchor_err(&r, "InsufficientFreeCapital");
}

#[test]
fn settle_profit_exceeds_free_capital_when_locked_rejected() {
    let mut f = Fixture::new_uninitialized();
    f.initialize();
    let ix = f.deposit_ix(f.admin_ata, 10_000_000);
    exec_ok(&mut f.ctx, ix, &[&f.admin]);
    let ix = f.update_locked_ix(9_000_000);
    exec_ok(&mut f.ctx, ix, &[&f.core]);
    // free capital 1M; profit 2M would dip into notionally locked USDC
    let ix = f.settle_ix(2_000_000, 0, &f.core);
    let r = exec(&mut f.ctx, ix, &[&f.core]);
    assert_anchor_err(&r, "InsufficientFreeCapital");
}

#[test]
fn settle_loss_is_collected_from_core_collateral() {
    let mut f = Fixture::new_uninitialized();
    f.initialize();
    let ix = f.deposit_ix(f.admin_ata, 10_000_000);
    exec_ok(&mut f.ctx, ix, &[&f.admin]);

    // Loss is transferred from core collateral to vault.
    let ix = f.settle_ix(0, 5_000_000, &f.core);
    exec_ok(&mut f.ctx, ix, &[&f.core]);
    f.ctx.svm.assert_token_balance(&f.vault_token, 15_000_000);
    f.ctx
        .svm
        .assert_token_balance(&f.core_collateral_ata, 45_000_000);
}

#[test]
fn settle_profit_and_loss_same_ix_rejected() {
    let mut f = Fixture::new_uninitialized();
    f.initialize();
    let ix = f.deposit_ix(f.admin_ata, 10_000_000);
    exec_ok(&mut f.ctx, ix, &[&f.admin]);
    let ix = f.settle_ix(1_000_000, 1_000_000, &f.core);
    let r = exec(&mut f.ctx, ix, &[&f.core]);
    assert_anchor_err(&r, "InvalidVaultValue");
}

// ─── Paused ─────────────────────────────────────────────────────────────────

#[test]
fn paused_blocks_deposit() {
    let mut f = Fixture::new_uninitialized();
    f.initialize();
    let ix = f.set_paused_ix(true);
    exec_ok(&mut f.ctx, ix, &[&f.admin]);
    let ix = f.deposit_ix(f.admin_ata, 1_000_000);
    let r = exec(&mut f.ctx, ix, &[&f.admin]);
    assert_anchor_err(&r, "Paused");
}

#[test]
fn paused_blocks_withdraw() {
    let mut f = Fixture::new_uninitialized();
    f.initialize();
    let ix = f.deposit_ix(f.admin_ata, 10_000_000);
    exec_ok(&mut f.ctx, ix, &[&f.admin]);
    let ix = f.set_paused_ix(true);
    exec_ok(&mut f.ctx, ix, &[&f.admin]);
    let ix = f.withdraw_ix(f.admin_ata, 1_000_000);
    let r = exec(&mut f.ctx, ix, &[&f.admin]);
    assert_anchor_err(&r, "Paused");
}

#[test]
fn paused_blocks_settle() {
    let mut f = Fixture::new_uninitialized();
    f.initialize();
    let ix = f.set_paused_ix(true);
    exec_ok(&mut f.ctx, ix, &[&f.admin]);
    let ix = f.settle_ix(0, 0, &f.core);
    let r = exec(&mut f.ctx, ix, &[&f.core]);
    assert_anchor_err(&r, "Paused");
}

#[test]
fn unpause_restores_deposit() {
    let mut f = Fixture::new_uninitialized();
    f.initialize();
    let ix = f.set_paused_ix(true);
    exec_ok(&mut f.ctx, ix, &[&f.admin]);
    let ix = f.set_paused_ix(false);
    exec_ok(&mut f.ctx, ix, &[&f.admin]);
    let ix = f.deposit_ix(f.admin_ata, 1_000_000);
    exec_ok(&mut f.ctx, ix, &[&f.admin]);
}

// ─── Public LP  ───────────────────────────────────────

#[test]
fn initialize_sets_lp_mint_and_zero_reported_pnl() {
    let mut f = Fixture::new_uninitialized();
    f.initialize();
    let st = f.vault_state_account();
    assert_eq!(st.lp_mint, f.lp_mint);
    assert_eq!(st.reported_unrealized_pnl, 0);
    assert_eq!(st.total_locked_capital, 0);
}

#[test]
fn lp_first_deposit_mints_one_share_per_raw_unit() {
    let mut f = Fixture::new_uninitialized();
    f.initialize();
    let lp_user = f
        .ctx
        .create_funded_account(5_000_000_000)
        .expect("lp user");
    let lp_usdc = f
        .ctx
        .svm
        .create_associated_token_account(&f.mint, &lp_user)
        .expect("lp usdc ata");
    f.ctx
        .svm
        .mint_to(&f.mint, &lp_usdc, &f.admin, 10_000_000)
        .expect("fund lp user");
    f.ctx
        .svm
        .create_associated_token_account(&f.lp_mint, &lp_user)
        .expect("user lp ata");

    let ix = f.lp_deposit_ix(&lp_user, lp_usdc, 3_000_000, 0);
    exec_ok(&mut f.ctx, ix, &[&lp_user]);

    f.ctx.svm.assert_token_balance(&f.vault_token, 3_000_000);
    let lp_ata = user_lp_ata(lp_user.pubkey(), f.lp_mint);
    f.ctx.svm.assert_token_balance(&lp_ata, 3_000_000);
}

#[test]
fn lp_second_deposit_mints_pro_rata_shares() {
    let mut f = Fixture::new_uninitialized();
    f.initialize();
    let lp_user = f
        .ctx
        .create_funded_account(5_000_000_000)
        .expect("lp user");
    let lp_usdc = f
        .ctx
        .svm
        .create_associated_token_account(&f.mint, &lp_user)
        .expect("lp usdc ata");
    f.ctx
        .svm
        .mint_to(&f.mint, &lp_usdc, &f.admin, 50_000_000)
        .expect("fund lp user");
    f.ctx
        .svm
        .create_associated_token_account(&f.lp_mint, &lp_user)
        .expect("user lp ata");

    let ix = f.lp_deposit_ix(&lp_user, lp_usdc, 10_000_000, 0);
    exec_ok(&mut f.ctx, ix, &[&lp_user]);
    // Same ix data + same signers + same blockhash ⇒ duplicate tx signature (AlreadyProcessed).
    f.ctx.svm.expire_blockhash();
    // vault 10M, supply 10M LP; second deposit 10M USDC -> balance 20M, shares = 10M * 10M / 20M = 5M
    let ix = f.lp_deposit_ix(&lp_user, lp_usdc, 10_000_000, 0);
    exec_ok(&mut f.ctx, ix, &[&lp_user]);
    let lp_ata = user_lp_ata(lp_user.pubkey(), f.lp_mint);
    f.ctx.svm.assert_token_balance(&lp_ata, 15_000_000);
    f.ctx.svm.assert_token_balance(&f.vault_token, 20_000_000);
}

#[test]
fn lp_deposit_rounds_to_zero_shares_rejected() {
    let mut f = Fixture::new_uninitialized();
    f.initialize();
    let lp_user = f
        .ctx
        .create_funded_account(5_000_000_000)
        .expect("lp user");
    let lp_usdc = f
        .ctx
        .svm
        .create_associated_token_account(&f.mint, &lp_user)
        .expect("lp usdc ata");
    f.ctx
        .svm
        .mint_to(&f.mint, &lp_usdc, &f.admin, 20_000_000)
        .expect("fund lp user");
    f.ctx
        .svm
        .create_associated_token_account(&f.lp_mint, &lp_user)
        .expect("user lp ata");

    let ix = f.lp_deposit_ix(&lp_user, lp_usdc, 10_000_000, 0);
    exec_ok(&mut f.ctx, ix, &[&lp_user]);
    f.ctx.svm.expire_blockhash();

    f.ctx.svm.assert_token_balance(&f.vault_token, 10_000_000);
    let ix = f.lp_deposit_ix(&lp_user, lp_usdc, 1, 0);
    let r = exec(&mut f.ctx, ix, &[&lp_user]);
    assert_anchor_err(&r, "AmountTooSmall");
    f.ctx.svm.assert_token_balance(&f.vault_token, 10_000_000);
}

#[test]
fn lp_withdraw_burns_and_pays_usdc_floor() {
    let mut f = Fixture::new_uninitialized();
    f.initialize();
    let lp_user = f
        .ctx
        .create_funded_account(5_000_000_000)
        .expect("lp user");
    let lp_usdc = f
        .ctx
        .svm
        .create_associated_token_account(&f.mint, &lp_user)
        .expect("lp usdc ata");
    f.ctx
        .svm
        .mint_to(&f.mint, &lp_usdc, &f.admin, 20_000_000)
        .expect("fund lp user");
    f.ctx
        .svm
        .create_associated_token_account(&f.lp_mint, &lp_user)
        .expect("user lp ata");

    let ix = f.lp_deposit_ix(&lp_user, lp_usdc, 8_000_000, 0);
    exec_ok(&mut f.ctx, ix, &[&lp_user]);
    let lp_ata = user_lp_ata(lp_user.pubkey(), f.lp_mint);
    let usdc_before = f.ctx.svm.get_account(&lp_usdc).unwrap();
    let usdc_amt_before = u64::from_le_bytes(usdc_before.data[64..72].try_into().unwrap());

    let ix = f.lp_withdraw_ix(&lp_user, lp_usdc, 2_000_000, 0);
    exec_ok(&mut f.ctx, ix, &[&lp_user]);

    f.ctx.svm.assert_token_balance(&lp_ata, 6_000_000);
    let usdc_after = f.ctx.svm.get_account(&lp_usdc).unwrap();
    let usdc_amt_after = u64::from_le_bytes(usdc_after.data[64..72].try_into().unwrap());
    assert!(usdc_amt_after > usdc_amt_before);
    f.ctx.svm.assert_token_balance(&f.vault_token, 6_000_000);
}

#[test]
fn lp_withdraw_rejects_when_not_enough_free_capital() {
    let mut f = Fixture::new_uninitialized();
    f.initialize();
    let lp_user = f
        .ctx
        .create_funded_account(5_000_000_000)
        .expect("lp user");
    let lp_usdc = f
        .ctx
        .svm
        .create_associated_token_account(&f.mint, &lp_user)
        .expect("lp usdc ata");
    f.ctx
        .svm
        .mint_to(&f.mint, &lp_usdc, &f.admin, 30_000_000)
        .expect("fund lp user");
    f.ctx
        .svm
        .create_associated_token_account(&f.lp_mint, &lp_user)
        .expect("user lp ata");

    let ix = f.lp_deposit_ix(&lp_user, lp_usdc, 10_000_000, 0);
    exec_ok(&mut f.ctx, ix, &[&lp_user]);
    // vault 10M LP-side; lock 9M -> free 1M. Withdrawing ~all LP tries to take ~10M USDC.
    let ix = f.update_locked_ix(9_000_000);
    exec_ok(&mut f.ctx, ix, &[&f.core]);

    let lp_ata = user_lp_ata(lp_user.pubkey(), f.lp_mint);
    let ix = f.lp_withdraw_ix(&lp_user, lp_usdc, 9_000_000, 0);
    let r = exec(&mut f.ctx, ix, &[&lp_user]);
    assert_anchor_err(&r, "InsufficientFreeCapital");
    // balances unchanged on failure
    f.ctx.svm.assert_token_balance(&lp_ata, 10_000_000);
}

#[test]
fn lp_deposit_zero_rejected() {
    let mut f = Fixture::new_uninitialized();
    f.initialize();
    let lp_user = f
        .ctx
        .create_funded_account(2_000_000_000)
        .expect("lp user");
    let lp_usdc = f
        .ctx
        .svm
        .create_associated_token_account(&f.mint, &lp_user)
        .expect("lp usdc ata");
    f.ctx
        .svm
        .mint_to(&f.mint, &lp_usdc, &f.admin, 1_000_000)
        .expect("fund");
    f.ctx
        .svm
        .create_associated_token_account(&f.lp_mint, &lp_user)
        .expect("user lp ata");
    let ix = f.lp_deposit_ix(&lp_user, lp_usdc, 0, 0);
    let r = exec(&mut f.ctx, ix, &[&lp_user]);
    assert_anchor_err(&r, "ZeroAmount");
}

#[test]
fn lp_withdraw_zero_rejected() {
    let mut f = Fixture::new_uninitialized();
    f.initialize();
    let lp_user = f
        .ctx
        .create_funded_account(2_000_000_000)
        .expect("lp user");
    let lp_usdc = f
        .ctx
        .svm
        .create_associated_token_account(&f.mint, &lp_user)
        .expect("lp usdc ata");
    f.ctx
        .svm
        .mint_to(&f.mint, &lp_usdc, &f.admin, 5_000_000)
        .expect("fund");
    f.ctx
        .svm
        .create_associated_token_account(&f.lp_mint, &lp_user)
        .expect("user lp ata");
    let ix = f.lp_deposit_ix(&lp_user, lp_usdc, 1_000_000, 0);
    exec_ok(&mut f.ctx, ix, &[&lp_user]);
    let ix = f.lp_withdraw_ix(&lp_user, lp_usdc, 0, 0);
    let r = exec(&mut f.ctx, ix, &[&lp_user]);
    assert_anchor_err(&r, "ZeroAmount");
}

#[test]
fn lp_deposit_slippage_rejected() {
    let mut f = Fixture::new_uninitialized();
    f.initialize();
    let lp_user = f
        .ctx
        .create_funded_account(2_000_000_000)
        .expect("lp user");
    let lp_usdc = f
        .ctx
        .svm
        .create_associated_token_account(&f.mint, &lp_user)
        .expect("lp usdc ata");
    f.ctx
        .svm
        .mint_to(&f.mint, &lp_usdc, &f.admin, 5_000_000)
        .expect("fund");
    f.ctx
        .svm
        .create_associated_token_account(&f.lp_mint, &lp_user)
        .expect("user lp ata");
    // genesis mints 1:1; impossible min
    let ix = f.lp_deposit_ix(&lp_user, lp_usdc, 1_000_000, 2_000_000);
    let r = exec(&mut f.ctx, ix, &[&lp_user]);
    assert_anchor_err(&r, "SlippageExceeded");
}

#[test]
fn lp_withdraw_slippage_rejected() {
    let mut f = Fixture::new_uninitialized();
    f.initialize();
    let lp_user = f
        .ctx
        .create_funded_account(2_000_000_000)
        .expect("lp user");
    let lp_usdc = f
        .ctx
        .svm
        .create_associated_token_account(&f.mint, &lp_user)
        .expect("lp usdc ata");
    f.ctx
        .svm
        .mint_to(&f.mint, &lp_usdc, &f.admin, 5_000_000)
        .expect("fund");
    f.ctx
        .svm
        .create_associated_token_account(&f.lp_mint, &lp_user)
        .expect("user lp ata");
    let ix = f.lp_deposit_ix(&lp_user, lp_usdc, 4_000_000, 0);
    exec_ok(&mut f.ctx, ix, &[&lp_user]);
    let ix = f.lp_withdraw_ix(&lp_user, lp_usdc, 1_000_000, 5_000_000);
    let r = exec(&mut f.ctx, ix, &[&lp_user]);
    assert_anchor_err(&r, "SlippageExceeded");
}

#[test]
fn lp_deposit_paused_rejected() {
    let mut f = Fixture::new_uninitialized();
    f.initialize();
    let ix = f.set_paused_ix(true);
    exec_ok(&mut f.ctx, ix, &[&f.admin]);
    let lp_user = f
        .ctx
        .create_funded_account(2_000_000_000)
        .expect("lp user");
    let lp_usdc = f
        .ctx
        .svm
        .create_associated_token_account(&f.mint, &lp_user)
        .expect("lp usdc ata");
    f.ctx
        .svm
        .mint_to(&f.mint, &lp_usdc, &f.admin, 2_000_000)
        .expect("fund");
    f.ctx
        .svm
        .create_associated_token_account(&f.lp_mint, &lp_user)
        .expect("user lp ata");
    let ix = f.lp_deposit_ix(&lp_user, lp_usdc, 1_000_000, 0);
    let r = exec(&mut f.ctx, ix, &[&lp_user]);
    assert_anchor_err(&r, "Paused");
}

#[test]
fn lp_withdraw_paused_rejected() {
    let mut f = Fixture::new_uninitialized();
    f.initialize();
    let lp_user = f
        .ctx
        .create_funded_account(2_000_000_000)
        .expect("lp user");
    let lp_usdc = f
        .ctx
        .svm
        .create_associated_token_account(&f.mint, &lp_user)
        .expect("lp usdc ata");
    f.ctx
        .svm
        .mint_to(&f.mint, &lp_usdc, &f.admin, 5_000_000)
        .expect("fund");
    f.ctx
        .svm
        .create_associated_token_account(&f.lp_mint, &lp_user)
        .expect("user lp ata");
    let ix = f.lp_deposit_ix(&lp_user, lp_usdc, 2_000_000, 0);
    exec_ok(&mut f.ctx, ix, &[&lp_user]);
    let ix = f.set_paused_ix(true);
    exec_ok(&mut f.ctx, ix, &[&f.admin]);
    let ix = f.lp_withdraw_ix(&lp_user, lp_usdc, 500_000, 0);
    let r = exec(&mut f.ctx, ix, &[&lp_user]);
    assert_anchor_err(&r, "Paused");
}

#[test]
fn admin_set_reported_pnl_non_admin_rejected() {
    let mut f = Fixture::new_uninitialized();
    f.initialize();
    let ix = Instruction::new_with_bytes(
        program_id(),
        &vault_ix::AdminSetReportedUnrealizedPnl {
            reported_unrealized_pnl: -1_000_000,
        }
        .data(),
        vault_accounts::AdminSetReportedUnrealizedPnl {
            admin: f.attacker.pubkey(),
            vault_state: f.vault_state,
        }
        .to_account_metas(None),
    );
    let r = exec(&mut f.ctx, ix, &[&f.attacker]);
    assert_anchor_err(&r, "NotOwner");
}

#[test]
fn admin_set_reported_pnl_updates_state() {
    let mut f = Fixture::new_uninitialized();
    f.initialize();
    let ix = f.admin_set_pnl_ix(-500_000);
    exec_ok(&mut f.ctx, ix, &[&f.admin]);
    let st = f.vault_state_account();
    assert_eq!(st.reported_unrealized_pnl, -500_000);
}

#[test]
fn lp_deposit_rejects_wrong_lp_mint_pubkey() {
    let mut f = Fixture::new_uninitialized();
    f.initialize();
    let lp_user = f
        .ctx
        .create_funded_account(2_000_000_000)
        .expect("lp user");
    let lp_usdc = f
        .ctx
        .svm
        .create_associated_token_account(&f.mint, &lp_user)
        .expect("lp usdc ata");
    f.ctx
        .svm
        .mint_to(&f.mint, &lp_usdc, &f.admin, 2_000_000)
        .expect("fund");
    let wrong_mint_kp = f
        .ctx
        .svm
        .create_token_mint(&f.admin, 6)
        .expect("wrong mint");
    let wrong_mint = wrong_mint_kp.pubkey();
    f.ctx
        .svm
        .create_associated_token_account(&wrong_mint, &lp_user)
        .expect("wrong lp ata");
    let ix = Instruction::new_with_bytes(
        program_id(),
        &vault_ix::LpDeposit {
            amount: 1_000_000,
            min_shares: 0,
        }
        .data(),
        vault_accounts::LpDeposit {
            user: lp_user.pubkey(),
            vault_state: f.vault_state,
            user_usdc: lp_usdc,
            vault_token: f.vault_token,
            lp_mint: wrong_mint,
            user_lp: user_lp_ata(lp_user.pubkey(), wrong_mint),
            token_program: spl_token::id(),
        }
        .to_account_metas(None),
    );
    let r = exec(&mut f.ctx, ix, &[&lp_user]);
    assert_anchor_err(&r, "InvalidVaultValue");
}

#[test]
fn update_locked_capital_non_core_rejected() {
    let mut f = Fixture::new_uninitialized();
    f.initialize();
    let ix = Instruction::new_with_bytes(
        program_id(),
        &vault_ix::UpdateLockedCapital { delta: 1 }.data(),
        vault_accounts::UpdateLockedCapital {
            caller: f.attacker.pubkey(),
            vault_state: f.vault_state,
            vault_token: f.vault_token,
        }
        .to_account_metas(None),
    );
    let r = exec(&mut f.ctx, ix, &[&f.attacker]);
    assert_anchor_err(&r, "NotCore");
}

#[test]
fn update_locked_capital_core_succeeds() {
    let mut f = Fixture::new_uninitialized();
    f.initialize();
    let ix = f.deposit_ix(f.admin_ata, 1_000_000);
    exec_ok(&mut f.ctx, ix, &[&f.admin]);
    let ix = f.update_locked_ix(123);
    exec_ok(&mut f.ctx, ix, &[&f.core]);
    assert_eq!(f.vault_state_account().total_locked_capital, 123);
    let ix = f.update_locked_ix(-23);
    exec_ok(&mut f.ctx, ix, &[&f.core]);
    assert_eq!(f.vault_state_account().total_locked_capital, 100);
}

#[test]
fn admin_withdraw_rejects_when_amount_exceeds_free_capital() {
    let mut f = Fixture::new_uninitialized();
    f.initialize();
    let ix = f.deposit_ix(f.admin_ata, 10_000_000);
    exec_ok(&mut f.ctx, ix, &[&f.admin]);
    let ix = f.update_locked_ix(9_000_000);
    exec_ok(&mut f.ctx, ix, &[&f.core]);
    // free capital 1M; withdraw 2M
    let ix = f.withdraw_ix(f.admin_ata, 2_000_000);
    let r = exec(&mut f.ctx, ix, &[&f.admin]);
    assert_anchor_err(&r, "InsufficientFreeCapital");
}

#[test]
fn admin_withdraw_free_capital_succeeds() {
    let mut f = Fixture::new_uninitialized();
    f.initialize();
    let ix = f.deposit_ix(f.admin_ata, 10_000_000);
    exec_ok(&mut f.ctx, ix, &[&f.admin]);
    let ix = f.update_locked_ix(9_000_000);
    exec_ok(&mut f.ctx, ix, &[&f.core]);
    let ix = f.withdraw_ix(f.admin_ata, 1_000_000);
    exec_ok(&mut f.ctx, ix, &[&f.admin]);
    f.ctx.svm.assert_token_balance(&f.vault_token, 9_000_000);
}

#[test]
fn update_locked_capital_rejects_when_lock_exceeds_vault_balance() {
    let mut f = Fixture::new_uninitialized();
    f.initialize();
    let ix = f.deposit_ix(f.admin_ata, 5_000_000);
    exec_ok(&mut f.ctx, ix, &[&f.admin]);
    let ix = f.update_locked_ix(6_000_000);
    let r = exec(&mut f.ctx, ix, &[&f.core]);
    assert_anchor_err(&r, "InvalidVaultValue");
}
