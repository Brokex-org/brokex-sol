//! Vault integration tests (LiteSVM). Needs `target/deploy/brokex_vault.so` from `yarn prep:program-keys && anchor build` (or `yarn test:rust:litesvm`).
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
            "missing {} — run `yarn prep:program-keys && anchor build` from the repo root (or `yarn test:rust:litesvm`): {e}",
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

struct Fixture {
    ctx: AnchorContext,
    admin: anchor_litesvm::Keypair,
    core: anchor_litesvm::Keypair,
    _trader: anchor_litesvm::Keypair,
    attacker: anchor_litesvm::Keypair,
    mint: Pubkey,
    vault_state: Pubkey,
    vault_token: Pubkey,
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
            .expect("core ata");
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
                trader_token: self.trader_ata,
                core_collateral_token: self.core_collateral_ata,
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
    let c_before = f.ctx.svm.get_account(&f.core_collateral_ata).unwrap().data;

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
    assert_eq!(
        f.ctx.svm.get_account(&f.core_collateral_ata).unwrap().data,
        c_before
    );
}

#[test]
fn settle_loss_moves_from_core_collateral_to_vault() {
    let mut f = Fixture::new_uninitialized();
    f.initialize();
    let ix = f.deposit_ix(f.admin_ata, 10_000_000);
    exec_ok(&mut f.ctx, ix, &[&f.admin]);

    let ix = f.settle_ix(0, 4_000_000, &f.core);
    exec_ok(&mut f.ctx, ix, &[&f.core]);
    f.ctx.svm.assert_token_balance(&f.vault_token, 14_000_000);
    f.ctx.svm.assert_token_balance(&f.core_collateral_ata, 46_000_000);
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
    assert_anchor_err(&r, "InsufficientBalance");
}

#[test]
fn settle_loss_exceeds_collateral_rejected() {
    let mut f = Fixture::new_uninitialized();
    f.initialize();
    let ix = f.deposit_ix(f.admin_ata, 10_000_000);
    exec_ok(&mut f.ctx, ix, &[&f.admin]);
    let ix = f.settle_ix(0, 51_000_000, &f.core);
    let r = exec(&mut f.ctx, ix, &[&f.core]);
    assert_anchor_err(&r, "InsufficientBalance");
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
