/**
 * Integration tests for `brokex-vault` (localnet via `anchor test`).
 *
 * Prerequisites: `anchor build`, then `anchor test` (deploys programs + runs this file).
 * Prefer `anchor test --validator legacy` if the default Surfpool validator misbehaves.
 *
 * Provider wallet is `Anchor.toml` `[provider].wallet` (repo `keys/localnet-authority.json`).
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, BN, AnchorError } from "@coral-xyz/anchor";
import { expect } from "chai";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  mintTo,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import type { BrokexVault } from "../target/types/brokex_vault";

// Use `require` so the IDL matches Node’s JSON shape under ts-mocha (ESM `import` can wrap `default`
// and drop `address`, which breaks PDAs and yields InstructionFallbackNotFound). Equivalent:
// `import idl from "../target/idl/brokex_vault.json"` once your runner resolves JSON like Node.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const idl = require("../target/idl/brokex_vault.json") as BrokexVault;

function expectAnchorCode(err: unknown, code: string) {
  expect(err).to.be.instanceOf(AnchorError);
  const e = err as AnchorError;
  expect(e.error?.errorCode?.code).to.equal(code);
}

describe("brokex_vault", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // Second arg is `provider`; program id comes from `idl.address`.
  const program = new Program(idl, provider) as Program<BrokexVault>;

  const admin = (provider.wallet as anchor.Wallet).payer;
  const core = Keypair.generate();
  const trader = Keypair.generate();
  const attacker = Keypair.generate();

  let mint: PublicKey;
  let vaultStatePda: PublicKey;
  let vaultTokenAta: PublicKey;
  let adminAta: PublicKey;
  let traderAta: PublicKey;
  let coreCollateralAta: PublicKey;

  const ONE = new BN(1_000_000); // 1.0 token @ 6 decimals
  const TEN = new BN(10_000_000);
  /** Raw token amount at 6 decimals (spl-token `mintTo`). */
  const RAW_100 = BigInt(100_000_000);
  const RAW_50 = BigInt(50_000_000);

  before(async () => {
    const conn = provider.connection;

    // Include `admin` so a fresh local validator always funds the payer (Surfpool/legacy
    // sometimes omit the authority keypair from the initial airdrop list).
    for (const kp of [admin, core, trader, attacker]) {
      const sig = await conn.requestAirdrop(kp.publicKey, 5 * LAMPORTS_PER_SOL);
      await conn.confirmTransaction(sig, "confirmed");
    }

    mint = await createMint(
      conn,
      admin,
      admin.publicKey,
      null,
      6,
      undefined,
      undefined,
      TOKEN_PROGRAM_ID
    );

    vaultStatePda = PublicKey.findProgramAddressSync(
      [Buffer.from("vault")],
      program.programId
    )[0];

    vaultTokenAta = getAssociatedTokenAddressSync(
      mint,
      vaultStatePda,
      true,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    await program.methods
      .initialize()
      .accountsPartial({
        admin: admin.publicKey,
        stableMint: mint,
        core: core.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const adminAtaInfo = await getOrCreateAssociatedTokenAccount(
      conn,
      admin,
      mint,
      admin.publicKey
    );
    adminAta = adminAtaInfo.address;

    await mintTo(conn, admin, mint, adminAta, admin.publicKey, RAW_100);

    const traderInfo = await getOrCreateAssociatedTokenAccount(
      conn,
      admin,
      mint,
      trader.publicKey
    );
    traderAta = traderInfo.address;

    const coreColInfo = await getOrCreateAssociatedTokenAccount(
      conn,
      admin,
      mint,
      core.publicKey
    );
    coreCollateralAta = coreColInfo.address;
    await mintTo(conn, admin, mint, coreCollateralAta, admin.publicKey, RAW_50);
  });

  it("initialize — vault state + vault ATA wired correctly", async () => {
    const state = await program.account.vaultState.fetch(vaultStatePda);
    expect(state.admin.equals(admin.publicKey)).to.be.true;
    expect(state.core.equals(core.publicKey)).to.be.true;
    expect(state.stableMint.equals(mint)).to.be.true;
    expect(state.tokenVault.equals(vaultTokenAta)).to.be.true;
    expect(state.paused).to.be.false;

    const vt = await getAccount(provider.connection, vaultTokenAta);
    expect(vt.amount).to.equal(BigInt(0));
    expect(vt.owner.equals(vaultStatePda)).to.be.true;
  });

  it("initialize — cannot run twice", async () => {
    let failed = false;
    try {
      await program.methods
        .initialize()
        .accountsPartial({
          admin: admin.publicKey,
          stableMint: mint,
          core: core.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } catch {
      failed = true;
    }
    expect(
      failed,
      "second initialize must fail (vault PDA already initialized)"
    ).to.be.true;
  });

  it("deposit — vault up, admin down", async () => {
    const beforeVault = (await getAccount(provider.connection, vaultTokenAta))
      .amount;
    const beforeAdmin = (await getAccount(provider.connection, adminAta))
      .amount;

    await program.methods
      .deposit(TEN)
      .accountsPartial({
        admin: admin.publicKey,
        adminToken: adminAta,
        vaultToken: vaultTokenAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const afterVault = (await getAccount(provider.connection, vaultTokenAta))
      .amount;
    const afterAdmin = (await getAccount(provider.connection, adminAta)).amount;

    expect(afterVault - beforeVault).to.equal(BigInt(TEN.toString()));
    expect(beforeAdmin - afterAdmin).to.equal(BigInt(TEN.toString()));
  });

  it("withdraw — vault down, admin up (partial)", async () => {
    const withdrawAmt = new BN(3_000_000);
    const beforeVault = (await getAccount(provider.connection, vaultTokenAta))
      .amount;
    const beforeAdmin = (await getAccount(provider.connection, adminAta))
      .amount;

    await program.methods
      .withdraw(withdrawAmt)
      .accountsPartial({
        admin: admin.publicKey,
        adminToken: adminAta,
        vaultToken: vaultTokenAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const afterVault = (await getAccount(provider.connection, vaultTokenAta))
      .amount;
    const afterAdmin = (await getAccount(provider.connection, adminAta)).amount;

    expect(beforeVault - afterVault).to.equal(BigInt(withdrawAmt.toString()));
    expect(afterAdmin - beforeAdmin).to.equal(BigInt(withdrawAmt.toString()));
  });

  it("settle — profit to trader", async () => {
    const profit = new BN(2_000_000);
    const beforeVault = (await getAccount(provider.connection, vaultTokenAta))
      .amount;
    const beforeTrader = (await getAccount(provider.connection, traderAta))
      .amount;

    await program.methods
      .settle(profit, new BN(0))
      .accountsPartial({
        caller: core.publicKey,
        vaultState: vaultStatePda,
        vaultToken: vaultTokenAta,
        coreCollateralToken: coreCollateralAta,
        traderToken: traderAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([core])
      .rpc();

    const afterVault = (await getAccount(provider.connection, vaultTokenAta))
      .amount;
    const afterTrader = (await getAccount(provider.connection, traderAta))
      .amount;

    expect(beforeVault - afterVault).to.equal(BigInt(profit.toString()));
    expect(afterTrader - beforeTrader).to.equal(BigInt(profit.toString()));
  });

  it("settle — loss collected from core collateral", async () => {
    const loss = new BN(4_000_000);
    const beforeVault = (await getAccount(provider.connection, vaultTokenAta))
      .amount;
    const beforeCoreCol = (
      await getAccount(provider.connection, coreCollateralAta)
    ).amount;

    await program.methods
      .settle(new BN(0), loss)
      .accountsPartial({
        caller: core.publicKey,
        vaultState: vaultStatePda,
        vaultToken: vaultTokenAta,
        coreCollateralToken: coreCollateralAta,
        traderToken: traderAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([core])
      .rpc();

    const afterVault = (await getAccount(provider.connection, vaultTokenAta))
      .amount;
    const afterCoreCol = (
      await getAccount(provider.connection, coreCollateralAta)
    ).amount;
    expect(afterVault - beforeVault).to.equal(BigInt(loss.toString()));
    expect(beforeCoreCol - afterCoreCol).to.equal(BigInt(loss.toString()));
  });

  it("settle — break-even (no transfers)", async () => {
    const beforeVault = (await getAccount(provider.connection, vaultTokenAta))
      .amount;
    const beforeTrader = (await getAccount(provider.connection, traderAta))
      .amount;
    await program.methods
      .settle(new BN(0), new BN(0))
      .accountsPartial({
        caller: core.publicKey,
        vaultState: vaultStatePda,
        vaultToken: vaultTokenAta,
        coreCollateralToken: coreCollateralAta,
        traderToken: traderAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([core])
      .rpc();

    expect(
      (await getAccount(provider.connection, vaultTokenAta)).amount
    ).to.equal(beforeVault);
    expect((await getAccount(provider.connection, traderAta)).amount).to.equal(
      beforeTrader
    );
  });

  describe("constraint errors", () => {
    it("deposit — non-admin → NotOwner", async () => {
      const ata = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        attacker,
        mint,
        attacker.publicKey
      );
      await mintTo(
        provider.connection,
        admin,
        mint,
        ata.address,
        admin.publicKey,
        BigInt(ONE.toString())
      );

      try {
        await program.methods
          .deposit(ONE)
          .accountsPartial({
            admin: attacker.publicKey,
            adminToken: ata.address,
            vaultToken: vaultTokenAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([attacker])
          .rpc();
        expect.fail("expected NotOwner");
      } catch (e) {
        expectAnchorCode(e, "NotOwner");
      }
    });

    it("deposit — wrong mint on admin_token → InvalidVaultValue", async () => {
      const conn = provider.connection;
      const wrongMint = await createMint(
        conn,
        admin,
        admin.publicKey,
        null,
        6,
        undefined,
        undefined,
        TOKEN_PROGRAM_ID
      );
      const wrongAta = (
        await getOrCreateAssociatedTokenAccount(
          conn,
          admin,
          wrongMint,
          admin.publicKey
        )
      ).address;
      await mintTo(
        conn,
        admin,
        wrongMint,
        wrongAta,
        admin.publicKey,
        BigInt(10_000_000)
      );

      try {
        await program.methods
          .deposit(ONE)
          .accountsPartial({
            admin: admin.publicKey,
            adminToken: wrongAta,
            vaultToken: vaultTokenAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        expect.fail("expected InvalidVaultValue");
      } catch (e) {
        expectAnchorCode(e, "InvalidVaultValue");
      }
    });

    it("withdraw — wrong mint on admin_token → InvalidVaultValue", async () => {
      const conn = provider.connection;
      const wrongMint = await createMint(
        conn,
        admin,
        admin.publicKey,
        null,
        6,
        undefined,
        undefined,
        TOKEN_PROGRAM_ID
      );
      const wrongAta = (
        await getOrCreateAssociatedTokenAccount(
          conn,
          admin,
          wrongMint,
          admin.publicKey
        )
      ).address;
      await mintTo(
        conn,
        admin,
        wrongMint,
        wrongAta,
        admin.publicKey,
        BigInt(10_000_000)
      );

      try {
        await program.methods
          .withdraw(ONE)
          .accountsPartial({
            admin: admin.publicKey,
            adminToken: wrongAta,
            vaultToken: vaultTokenAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        expect.fail("expected InvalidVaultValue");
      } catch (e) {
        expectAnchorCode(e, "InvalidVaultValue");
      }
    });

    it("withdraw — non-admin → NotOwner", async () => {
      try {
        await program.methods
          .withdraw(ONE)
          .accountsPartial({
            admin: attacker.publicKey,
            adminToken: adminAta,
            vaultToken: vaultTokenAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([attacker])
          .rpc();
        expect.fail("expected NotOwner");
      } catch (e) {
        expectAnchorCode(e, "NotOwner");
      }
    });

    it("withdraw — amount exceeds vault balance → InsufficientBalance", async () => {
      const vaultBal = (await getAccount(provider.connection, vaultTokenAta))
        .amount;
      const tooMuch = new BN(vaultBal.toString()).add(new BN(1));
      try {
        await program.methods
          .withdraw(tooMuch)
          .accountsPartial({
            admin: admin.publicKey,
            adminToken: adminAta,
            vaultToken: vaultTokenAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        expect.fail("expected InsufficientBalance");
      } catch (e) {
        expectAnchorCode(e, "InsufficientBalance");
      }
    });

    it("deposit — zero amount → ZeroAmount", async () => {
      try {
        await program.methods
          .deposit(new BN(0))
          .accountsPartial({
            admin: admin.publicKey,
            adminToken: adminAta,
            vaultToken: vaultTokenAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        expect.fail("expected ZeroAmount");
      } catch (e) {
        expectAnchorCode(e, "ZeroAmount");
      }
    });

    it("withdraw — zero amount → ZeroAmount", async () => {
      try {
        await program.methods
          .withdraw(new BN(0))
          .accountsPartial({
            admin: admin.publicKey,
            adminToken: adminAta,
            vaultToken: vaultTokenAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        expect.fail("expected ZeroAmount");
      } catch (e) {
        expectAnchorCode(e, "ZeroAmount");
      }
    });

    it("settle — wrong caller → NotCore", async () => {
      try {
        await program.methods
          .settle(new BN(1), new BN(0))
          .accountsPartial({
            caller: trader.publicKey,
            vaultState: vaultStatePda,
            vaultToken: vaultTokenAta,
            coreCollateralToken: coreCollateralAta,
            traderToken: traderAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([trader])
          .rpc();
        expect.fail("expected NotCore");
      } catch (e) {
        expectAnchorCode(e, "NotCore");
      }
    });

    it("settle — profit exceeds vault balance → InsufficientBalance", async () => {
      const vaultBal = (await getAccount(provider.connection, vaultTokenAta))
        .amount;
      const tooMuch = new BN(vaultBal.toString()).add(new BN(1));
      try {
        await program.methods
          .settle(tooMuch, new BN(0))
          .accountsPartial({
            caller: core.publicKey,
            vaultState: vaultStatePda,
            vaultToken: vaultTokenAta,
            coreCollateralToken: coreCollateralAta,
            traderToken: traderAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([core])
          .rpc();
        expect.fail("expected InsufficientBalance");
      } catch (e) {
        expectAnchorCode(e, "InsufficientBalance");
      }
    });

    it("settle — profit and loss both non-zero → InvalidVaultValue", async () => {
      try {
        await program.methods
          .settle(new BN(1_000_000), new BN(1_000_000))
          .accountsPartial({
            caller: core.publicKey,
            vaultState: vaultStatePda,
            vaultToken: vaultTokenAta,
            coreCollateralToken: coreCollateralAta,
            traderToken: traderAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([core])
          .rpc();
        expect.fail("expected InvalidVaultValue");
      } catch (e) {
        expectAnchorCode(e, "InvalidVaultValue");
      }
    });

    it("paused — deposit / withdraw / settle reject with Paused", async () => {
      await program.methods
        .setPaused(true)
        .accountsPartial({
          admin: admin.publicKey,
        })
        .rpc();

      try {
        await program.methods
          .deposit(ONE)
          .accountsPartial({
            admin: admin.publicKey,
            adminToken: adminAta,
            vaultToken: vaultTokenAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        expect.fail("expected Paused");
      } catch (e) {
        expectAnchorCode(e, "Paused");
      }

      try {
        await program.methods
          .withdraw(ONE)
          .accountsPartial({
            admin: admin.publicKey,
            adminToken: adminAta,
            vaultToken: vaultTokenAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        expect.fail("expected Paused");
      } catch (e) {
        expectAnchorCode(e, "Paused");
      }

      try {
        await program.methods
          .settle(new BN(0), new BN(0))
          .accountsPartial({
            caller: core.publicKey,
            vaultState: vaultStatePda,
            vaultToken: vaultTokenAta,
            coreCollateralToken: coreCollateralAta,
            traderToken: traderAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([core])
          .rpc();
        expect.fail("expected Paused");
      } catch (e) {
        expectAnchorCode(e, "Paused");
      }

      await program.methods
        .setPaused(false)
        .accountsPartial({
          admin: admin.publicKey,
        })
        .rpc();
    });
  });
});
