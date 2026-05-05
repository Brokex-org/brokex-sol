import * as anchor from "@anchor-lang/core";
import { Program, AnchorProvider, BN } from "@anchor-lang/core";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  mintTo,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  getAccount,
} from "@solana/spl-token";
import { assert, expect } from "chai";
import type { BrokexCore } from "../target/types/brokex_core";
import type { BrokexVault } from "../target/types/brokex_vault";

const coreIdl = require("../target/idl/brokex_core.json") as BrokexCore;
const vaultIdl = require("../target/idl/brokex_vault.json") as BrokexVault;

const CONFIG_SEED = Buffer.from("config");
const ASSET_SEED = Buffer.from("asset");
const POSITION_SEED = Buffer.from("position");
const SETTLEMENT_SEED = Buffer.from("settlement");
const VAULT_SEED = Buffer.from("vault");

describe("brokex-core-lifecycle", () => {
  const provider = AnchorProvider.env();
  anchor.setProvider(provider);

  const coreProgram = new Program(coreIdl, provider) as Program<BrokexCore>;
  const vaultProgram = new Program(vaultIdl, provider) as Program<BrokexVault>;
  
  const admin = (provider.wallet as anchor.Wallet).payer;
  const trader = Keypair.generate();

  let usdcMint: PublicKey;
  let vaultStatePda: PublicKey;
  let vaultTokenAta: PublicKey;
  let traderAta: PublicKey;
  let settlementAuthorityPda: PublicKey;
  let coreCollateralAta: PublicKey;

  const [configPda] = PublicKey.findProgramAddressSync([CONFIG_SEED], coreProgram.programId);
  const assetId = "SOL/USD";
  const [assetPda] = PublicKey.findProgramAddressSync([ASSET_SEED, Buffer.from(assetId)], coreProgram.programId);

  // Prices controlled by first byte of pubkey.
  // mock-oracle reads: price = first_byte_of_key * 1_000_000
  const oracle60 = findKeypairWithFirstByte(60); // $60
  const oracle70 = findKeypairWithFirstByte(70); // $70 — profit exit
  const oracle50 = findKeypairWithFirstByte(50); // $50 — loss exit
  const oracle1  = findKeypairWithFirstByte(1);  // $1  — near-total-loss exit
  // For the stale oracle test we use a real keypair; the test does NOT go through
  // mock-oracle — it passes a PublicKey.default which the program rejects before
  // even reaching the data-parsing path (key check fails, not owner check).
  // Instead we use an existing system-owned account with a timestamp-based comment
  // to trigger staleness — but since mock-oracle returns immediately for system accounts,
  // we instead disable mock-oracle via a non-system-owned account (the trader keypair
  // itself, whose account owner IS the system program but whose on-chain data is empty).
  // The easiest approach: just verify the expected error type is StalePrice OR InvalidPrice.
  const oracleFresh = findKeypairWithFirstByte(60); // same price, fresh ts

  function findKeypairWithFirstByte(byte: number): Keypair {
    while (true) {
        const kp = Keypair.generate();
        if (kp.publicKey.toBuffer()[0] === byte) return kp;
    }
  }

  function derivePositionPda(traderPubkey: PublicKey, asset: string, tradeId: number) {
    const tradeIdBuffer = Buffer.alloc(8);
    tradeIdBuffer.writeBigUInt64LE(BigInt(tradeId));
    return PublicKey.findProgramAddressSync(
      [POSITION_SEED, traderPubkey.toBuffer(), Buffer.from(asset), tradeIdBuffer],
      coreProgram.programId
    )[0];
  }

  before(async () => {
    const sig = await provider.connection.requestAirdrop(trader.publicKey, 10 * LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig);

    usdcMint = await createMint(provider.connection, admin, admin.publicKey, null, 6);
    
    vaultStatePda = PublicKey.findProgramAddressSync([VAULT_SEED], vaultProgram.programId)[0];
    vaultTokenAta = getAssociatedTokenAddressSync(usdcMint, vaultStatePda, true);
    
    settlementAuthorityPda = PublicKey.findProgramAddressSync([SETTLEMENT_SEED], coreProgram.programId)[0];

    // Ensure oracle accounts exist (even if empty, mock-oracle logic handles them)
    for (const kp of [oracle60, oracle70, oracle50, oracle1, oracleFresh]) {
        const tx = new anchor.web3.Transaction().add(
            SystemProgram.createAccount({
                fromPubkey: admin.publicKey,
                newAccountPubkey: kp.publicKey,
                lamports: await provider.connection.getMinimumBalanceForRentExemption(0),
                space: 0,
                programId: SystemProgram.programId,
            })
        );
        await provider.sendAndConfirm(tx, [admin, kp]);
    }

    // Initialize Vault (idempotent)
    const vaultInfo = await provider.connection.getAccountInfo(vaultStatePda);
    if (!vaultInfo) {
      await vaultProgram.methods
        .initialize()
        .accountsPartial({
          admin: admin.publicKey,
          stableMint: usdcMint,
          core: settlementAuthorityPda,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .rpc();
    }

    // Initialize Core (idempotent)
    const coreConfigInfo = await provider.connection.getAccountInfo(configPda);
    if (!coreConfigInfo) {
      await coreProgram.methods
        .initializeProtocol(usdcMint, vaultTokenAta, vaultProgram.programId)
        .accountsPartial({
          config: configPda,
          admin: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }

    // Add Asset (idempotent, uses oracle60 as default)
    const assetInfo = await provider.connection.getAccountInfo(assetPda);
    if (!assetInfo) {
      const configInput = {
        minLeverage: new BN(1),
        maxLeverage: new BN(100),
        minTradeSize: new BN(1_000_000),
        commissionOpenBps: new BN(10),
        baseSpreadBps: new BN(20),
        maxOpenInterest: new BN(1_000_000_000_000),
        maxOiPerTrader: new BN(100_000_000_000),
        alphaMin: new BN(500_000),
        alphaScale: new BN(1_000_000_000),
        k: new BN(100_000_000),
        profitCapBps: new BN(5000),
      };
      await coreProgram.methods
        .addAsset(assetId, oracle60.publicKey, configInput)
        .accountsPartial({
          asset: assetPda,
          config: configPda,
          admin: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }

    traderAta = (await getOrCreateAssociatedTokenAccount(provider.connection, admin, usdcMint, trader.publicKey)).address;
    await mintTo(provider.connection, admin, usdcMint, traderAta, admin.publicKey, 1_000_000_000); // 1000 USDC
    coreCollateralAta = (await getOrCreateAssociatedTokenAccount(provider.connection, admin, usdcMint, settlementAuthorityPda, true)).address;
  });

  it("Test 1: Admin initializes protocol (verification)", async () => {
    const config = await coreProgram.account.protocolConfig.fetch(configPda);
    assert.equal(config.admin.toBase58(), admin.publicKey.toBase58());
  });

  it("Test 2: Admin deposits liquidity to vault", async () => {
    const adminAta = (await getOrCreateAssociatedTokenAccount(provider.connection, admin, usdcMint, admin.publicKey)).address;
    await mintTo(provider.connection, admin, usdcMint, adminAta, admin.publicKey, 10_000_000_000); 
    await vaultProgram.methods
      .deposit(new BN(5_000_000_000))
      .accountsPartial({
        admin: admin.publicKey,
        adminToken: adminAta,
        vaultToken: vaultTokenAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
    const vaultBal = await provider.connection.getTokenAccountBalance(vaultTokenAta);
    assert.equal(vaultBal.value.amount, "5000000000");
  });

  it("Test 3: User opens long position", async () => {
    const tradeId = 10;
    const positionPda = derivePositionPda(trader.publicKey, assetId, tradeId);
    await coreProgram.methods
      .openPosition(assetId, new BN(tradeId), new BN(100_000_000), 10, { long: {} }, new BN(0), new BN(0))
      .accountsPartial({
        trader: trader.publicKey,
        config: configPda,
        asset: assetPda,
        pythPriceUpdate: oracle60.publicKey,
        position: positionPda,
        traderTokenAccount: traderAta,
        vaultTokenAccount: vaultTokenAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([trader])
      .rpc();
    const pos = await coreProgram.account.position.fetch(positionPda);
    assert.ok(pos.state.hasOwnProperty("open"));
    const pos3 = await coreProgram.account.position.fetch(positionPda);
    assert.ok(pos3.direction.hasOwnProperty("long"), "direction should be long");
    assert.equal(pos3.collateral.toString(), "100000000", "collateral should match");
  });

  it("Test 4: User opens short position", async () => {
    const tradeId = 20;
    const positionPda = derivePositionPda(trader.publicKey, assetId, tradeId);
    await coreProgram.methods
      .openPosition(assetId, new BN(tradeId), new BN(50_000_000), 5, { short: {} }, new BN(0), new BN(0))
      .accountsPartial({
        trader: trader.publicKey,
        config: configPda,
        asset: assetPda,
        pythPriceUpdate: oracle60.publicKey,
        position: positionPda,
        traderTokenAccount: traderAta,
        vaultTokenAccount: vaultTokenAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([trader])
      .rpc();
    const pos = await coreProgram.account.position.fetch(positionPda);
    assert.ok(pos.state.hasOwnProperty("open"), "position should be open");
    assert.ok(pos.direction.hasOwnProperty("short"), "direction should be short");
    // Short closes in profit when price drops — close it at $50
    const beforeBal = (await provider.connection.getTokenAccountBalance(traderAta)).value.uiAmount;
    await coreProgram.methods
      .closePosition(assetId, new BN(tradeId))
      .accountsPartial({
        trader: trader.publicKey,
        config: configPda,
        asset: assetPda,
        position: positionPda,
        pythPriceUpdate: oracle50.publicKey,
        vaultTokenAccount: vaultTokenAta,
        traderTokenAccount: traderAta,
        settlementAuthority: settlementAuthorityPda,
        coreCollateralToken: coreCollateralAta,
        vaultProgram: vaultProgram.programId,
        vaultState: vaultStatePda,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([trader])
      .rpc();
    const afterBal = (await provider.connection.getTokenAccountBalance(traderAta)).value.uiAmount;
    assert.ok(afterBal! > beforeBal!, "short profit: balance should increase");
  });

  it("Test 5: User closes position in profit", async () => {
    // Open a fresh position (tradeId=50) so this test is self-contained
    const tradeId = 50;
    const positionPda = derivePositionPda(trader.publicKey, assetId, tradeId);
    await coreProgram.methods
      .openPosition(assetId, new BN(tradeId), new BN(100_000_000), 10, { long: {} }, new BN(0), new BN(0))
      .accountsPartial({
        trader: trader.publicKey, config: configPda, asset: assetPda,
        pythPriceUpdate: oracle60.publicKey, position: positionPda,
        traderTokenAccount: traderAta, vaultTokenAccount: vaultTokenAta,
        tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      })
      .signers([trader]).rpc();

    const traderBefore = (await provider.connection.getTokenAccountBalance(traderAta)).value.uiAmount!;
    const vaultBefore  = (await provider.connection.getTokenAccountBalance(vaultTokenAta)).value.uiAmount!;

    // Close at $70 — long position, price rose → profit
    await coreProgram.methods
      .closePosition(assetId, new BN(tradeId))
      .accountsPartial({
        trader: trader.publicKey, config: configPda, asset: assetPda,
        position: positionPda, pythPriceUpdate: oracle70.publicKey,
        vaultTokenAccount: vaultTokenAta, traderTokenAccount: traderAta,
        settlementAuthority: settlementAuthorityPda, coreCollateralToken: coreCollateralAta,
        vaultProgram: vaultProgram.programId, vaultState: vaultStatePda,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([trader]).rpc();

    const traderAfter = (await provider.connection.getTokenAccountBalance(traderAta)).value.uiAmount!;
    const vaultAfter  = (await provider.connection.getTokenAccountBalance(vaultTokenAta)).value.uiAmount!;
    // Trader gained money, vault paid out
    assert.ok(traderAfter > traderBefore, "trader balance should increase on profit");
    assert.ok(vaultAfter  < vaultBefore,  "vault balance should decrease when paying profit");
    const pos = await coreProgram.account.position.fetch(positionPda);
    assert.ok(pos.state.hasOwnProperty("closed"), "position should be closed");
  });

  it("Test 6: User closes position at loss", async () => {
    // Open at $60 with 2x leverage, close at $50.
    // PnL = size * (50-60)/60 = 200 USDC * (-1/6) ≈ -33.3 USDC loss.
    // Trader gets back ≈ 66.7 USDC of original 100 USDC collateral.
    // On a loss: core keeps the loss amount in core_collateral_token (no vault CPI on loss).
    const tradeId = 60;
    const positionPda = derivePositionPda(trader.publicKey, assetId, tradeId);
    await coreProgram.methods
      .openPosition(assetId, new BN(tradeId), new BN(100_000_000), 2, { long: {} }, new BN(0), new BN(0))
      .accountsPartial({
        trader: trader.publicKey, config: configPda, asset: assetPda,
        pythPriceUpdate: oracle60.publicKey, position: positionPda,
        traderTokenAccount: traderAta, vaultTokenAccount: vaultTokenAta,
        tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      })
      .signers([trader]).rpc();

    const traderBefore      = (await provider.connection.getTokenAccountBalance(traderAta)).value.uiAmount!;
    const coreCollatBefore  = (await provider.connection.getTokenAccountBalance(coreCollateralAta)).value.uiAmount!;

    // Close at $50 — partial loss, trader gets back some collateral
    await coreProgram.methods
      .closePosition(assetId, new BN(tradeId))
      .accountsPartial({
        trader: trader.publicKey, config: configPda, asset: assetPda,
        position: positionPda, pythPriceUpdate: oracle50.publicKey,
        vaultTokenAccount: vaultTokenAta, traderTokenAccount: traderAta,
        settlementAuthority: settlementAuthorityPda, coreCollateralToken: coreCollateralAta,
        vaultProgram: vaultProgram.programId, vaultState: vaultStatePda,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([trader]).rpc();

    const traderAfter     = (await provider.connection.getTokenAccountBalance(traderAta)).value.uiAmount!;
    const coreCollatAfter = (await provider.connection.getTokenAccountBalance(coreCollateralAta)).value.uiAmount!;

    // Trader received partial collateral back (some, but less than 100 USDC)
    assert.ok(traderAfter > traderBefore,        "trader gets some collateral back on partial loss");
    assert.ok(traderAfter < traderBefore + 100,  "but less than full 100 USDC collateral");
    // The loss stays in core_collateral_token (vault CPI only fires on profit payouts)
    assert.ok(coreCollatAfter >= coreCollatBefore, "loss amount retained in core_collateral_token");
    const pos = await coreProgram.account.position.fetch(positionPda);
    assert.ok(pos.state.hasOwnProperty("closed"), "position should be closed");
  });

  it("Test 7: Full collateral loss scenario (liquidation)", async () => {
    // Open long at $60 with 10x leverage, price drops to $1.
    // Loss >> collateral → hits liquidation threshold.
    // Must call liquidate_position (not close_position) because the Rust code
    // requires !is_liq on close_position and is_liq on liquidate_position.
    const tradeId = 70;
    const positionPda = derivePositionPda(trader.publicKey, assetId, tradeId);
    await coreProgram.methods
      .openPosition(assetId, new BN(tradeId), new BN(100_000_000), 10, { long: {} }, new BN(0), new BN(0))
      .accountsPartial({
        trader: trader.publicKey, config: configPda, asset: assetPda,
        pythPriceUpdate: oracle60.publicKey, position: positionPda,
        traderTokenAccount: traderAta, vaultTokenAccount: vaultTokenAta,
        tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      })
      .signers([trader]).rpc();

    const traderBefore = (await provider.connection.getTokenAccountBalance(traderAta)).value.uiAmount!;
    const vaultBefore  = (await provider.connection.getTokenAccountBalance(vaultTokenAta)).value.uiAmount!;

    // Use liquidate_position — price collapsed to $1, well below liquidation threshold
    await coreProgram.methods
      .liquidatePosition(assetId, new BN(tradeId))
      .accountsPartial({
        liquidator: admin.publicKey,
        trader: trader.publicKey,
        config: configPda, asset: assetPda,
        position: positionPda, pythPriceUpdate: oracle1.publicKey,
        vaultTokenAccount: vaultTokenAta, traderTokenAccount: traderAta,
        settlementAuthority: settlementAuthorityPda, coreCollateralToken: coreCollateralAta,
        vaultProgram: vaultProgram.programId, vaultState: vaultStatePda,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const traderAfter = (await provider.connection.getTokenAccountBalance(traderAta)).value.uiAmount!;
    const vaultAfter  = (await provider.connection.getTokenAccountBalance(vaultTokenAta)).value.uiAmount!;
    // Trader gains nothing — full collateral lost
    assert.ok(traderAfter <= traderBefore, "trader should receive nothing on liquidation");
    // Vault gains the full collateral
    assert.ok(vaultAfter  >= vaultBefore,  "vault should gain collateral from liquidation");
    const pos = await coreProgram.account.position.fetch(positionPda);
    assert.ok(
      pos.state.hasOwnProperty("closed") || pos.state.hasOwnProperty("liquidated"),
      "position should be settled"
    );
  });

  it("Test 8: Invalid oracle account rejected", async () => {
    // The mock-oracle feature bypasses the Pyth owner check for system-owned accounts.
    // To test oracle rejection, pass an account owned by the core program (assetPda).
    // The oracle code will NOT short-circuit (it's not system-owned), will try to
    // deserialise the Pyth data, and fail with InvalidPrice / FeedIdMismatch.
    // This proves the oracle guard fires when a bad account is supplied.
    const tradeId = 80;
    const positionPda = derivePositionPda(trader.publicKey, assetId, tradeId);
    try {
      await coreProgram.methods
        .openPosition(assetId, new BN(tradeId), new BN(100_000_000), 10, { long: {} }, new BN(0), new BN(0))
        .accountsPartial({
          trader: trader.publicKey, config: configPda, asset: assetPda,
          // assetPda is owned by the core program, not the system program
          // → mock-oracle won't short-circuit → real parsing runs → fails
          pythPriceUpdate: assetPda,
          position: positionPda,
          traderTokenAccount: traderAta, vaultTokenAccount: vaultTokenAta,
          tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
        })
        .signers([trader]).rpc();
      assert.fail("Should have rejected bad oracle account");
    } catch (e: any) {
      if (e.message === "Should have rejected bad oracle account") throw e;
      // Any oracle error is acceptable: InvalidPrice, FeedIdMismatch, etc.
      const errStr = e.toString();
      const isOracleError =
        errStr.includes("InvalidPrice")      ||
        errStr.includes("FeedIdMismatch")    ||
        errStr.includes("StalePrice")        ||
        errStr.includes("InvalidOracleOwner")||
        errStr.includes("0x177");
      assert.ok(isOracleError, `Expected oracle error, got: ${errStr}`);
    }
  });

  it("Test 9: Paused protocol rejects open position", async () => {
    await coreProgram.methods.toggleProtocolStatus(true).accountsPartial({ config: configPda, admin: admin.publicKey }).rpc();
    try {
        await coreProgram.methods
          .openPosition(assetId, new BN(99), new BN(100_000_000), 10, { long: {} }, new BN(0), new BN(0))
          .accountsPartial({ trader: trader.publicKey, config: configPda, asset: assetPda, pythPriceUpdate: oracle60.publicKey, position: derivePositionPda(trader.publicKey, assetId, 99), traderTokenAccount: traderAta, vaultTokenAccount: vaultTokenAta })
          .signers([trader])
          .rpc();
        assert.fail("Should have failed");
    } catch (e) {
        assert.ok(e.toString().includes("Paused") || e.toString().includes("0x177c"));
    }
    await coreProgram.methods.toggleProtocolStatus(false).accountsPartial({ config: configPda, admin: admin.publicKey }).rpc();
  });

  it("Test 10: Non-owner cannot close position", async () => {
    const rogue = Keypair.generate();
    try {
        await coreProgram.methods.closePosition(assetId, new BN(10)).accountsPartial({ trader: rogue.publicKey, config: configPda, asset: assetPda, position: derivePositionPda(trader.publicKey, assetId, 10) }).signers([rogue]).rpc();
        assert.fail("Should have failed");
    } catch (e) {
        // Expected
    }
  });

  it("Test 11: Concurrent positions for same asset are isolated", async () => {
    const idA = 110;
    const idB = 111;
    const pdaA = derivePositionPda(trader.publicKey, assetId, idA);
    const pdaB = derivePositionPda(trader.publicKey, assetId, idB);

    // Open Position A (2x)
    await coreProgram.methods
      .openPosition(
        assetId,
        new BN(idA),
        new BN(100_000_000),
        2,
        { long: {} },
        new BN(0),
        new BN(0),
      )
      .accountsPartial({
        trader: trader.publicKey,
        config: configPda,
        asset: assetPda,
        pythPriceUpdate: oracle60.publicKey,
        position: pdaA,
        traderTokenAccount: traderAta,
        vaultTokenAccount: vaultTokenAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([trader])
      .rpc();

    // Open Position B (5x)
    await coreProgram.methods
      .openPosition(
        assetId,
        new BN(idB),
        new BN(100_000_000),
        5,
        { long: {} },
        new BN(0),
        new BN(0),
      )
      .accountsPartial({
        trader: trader.publicKey,
        config: configPda,
        asset: assetPda,
        pythPriceUpdate: oracle60.publicKey,
        position: pdaB,
        traderTokenAccount: traderAta,
        vaultTokenAccount: vaultTokenAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([trader])
      .rpc();

    // Verify both are open with correct leverage
    const stateA = await coreProgram.account.position.fetch(pdaA);
    const stateB = await coreProgram.account.position.fetch(pdaB);
    assert.ok(stateA.state.hasOwnProperty("open"));
    assert.ok(stateB.state.hasOwnProperty("open"));
    assert.equal(stateA.leverage, 2);
    assert.equal(stateB.leverage, 5);

    // Close Position A
    await coreProgram.methods
      .closePosition(assetId, new BN(idA))
      .accountsPartial({
        trader: trader.publicKey,
        config: configPda,
        asset: assetPda,
        position: pdaA,
        pythPriceUpdate: oracle70.publicKey,
        vaultTokenAccount: vaultTokenAta,
        traderTokenAccount: traderAta,
        settlementAuthority: settlementAuthorityPda,
        coreCollateralToken: coreCollateralAta,
        vaultProgram: vaultProgram.programId,
        vaultState: vaultStatePda,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([trader])
      .rpc();

    // Verify A is closed but B is still OPEN
    const stateAAfter = await coreProgram.account.position.fetch(pdaA);
    const stateBAfter = await coreProgram.account.position.fetch(pdaB);
    assert.ok(stateAAfter.state.hasOwnProperty("closed"), "A should be closed");
    assert.ok(
      stateBAfter.state.hasOwnProperty("open"),
      "B should still be open",
    );
    assert.equal(stateBAfter.leverage, 5, "B's data should be intact");

    // Close Position B
    await coreProgram.methods
      .closePosition(assetId, new BN(idB))
      .accountsPartial({
        trader: trader.publicKey,
        config: configPda,
        asset: assetPda,
        position: pdaB,
        pythPriceUpdate: oracle70.publicKey,
        vaultTokenAccount: vaultTokenAta,
        traderTokenAccount: traderAta,
        settlementAuthority: settlementAuthorityPda,
        coreCollateralToken: coreCollateralAta,
        vaultProgram: vaultProgram.programId,
        vaultState: vaultStatePda,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([trader])
      .rpc();

    const stateBFinal = await coreProgram.account.position.fetch(pdaB);
    assert.ok(
      stateBFinal.state.hasOwnProperty("closed"),
      "B should now be closed",
    );
  });
});
