import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
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
} from "@solana/spl-token";
import { assert } from "chai";
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

  const [configPda] = PublicKey.findProgramAddressSync(
    [CONFIG_SEED],
    coreProgram.programId
  );
  const assetId = "SOL/USD";
  const defaultSlPrice = new BN(55_000_000_000);
  const defaultTpPrice = new BN(65_000_000_000);
  const [assetPda] = PublicKey.findProgramAddressSync(
    [ASSET_SEED, Buffer.from(assetId)],
    coreProgram.programId
  );

  let usdcMint: PublicKey;
  let vaultStatePda: PublicKey;
  let vaultTokenAta: PublicKey;
  let traderAta: PublicKey;
  let settlementAuthorityPda: PublicKey;
  let coreCollateralAta: PublicKey;

  const oracle60 = findKeypairWithFirstByte(60);
  const oracle70 = findKeypairWithFirstByte(70);
  const oracle50 = findKeypairWithFirstByte(50);

  function findKeypairWithFirstByte(byte: number): Keypair {
    while (true) {
      const kp = Keypair.generate();
      if (kp.publicKey.toBuffer()[0] === byte) return kp;
    }
  }

  async function currentPositionId(): Promise<BN> {
    const cfg = await coreProgram.account.protocolConfig.fetch(configPda);
    return cfg.nextPositionId as BN;
  }

  async function ensureProtocolUnpaused(): Promise<void> {
    const cfg = await coreProgram.account.protocolConfig.fetch(configPda);
    if (cfg.isPaused) {
      await coreProgram.methods
        .toggleProtocolStatus(false)
        .accountsPartial({ config: configPda, admin: admin.publicKey })
        .rpc();
    }
  }

  async function assertAccountExists(pubkey: PublicKey, label: string): Promise<void> {
    const info = await provider.connection.getAccountInfo(pubkey);
    assert.ok(info, `${label} should exist`);
  }

  function derivePositionPda(
    traderPubkey: PublicKey,
    asset: string,
    tradeId: BN
  ) {
    return PublicKey.findProgramAddressSync(
      [
        POSITION_SEED,
        traderPubkey.toBuffer(),
        Buffer.from(asset),
        tradeId.toArrayLike(Buffer, "le", 8),
      ],
      coreProgram.programId
    )[0];
  }

  type BatchAction =
    | { marketClose: {} }
    | { liquidation: {} }
    | { stopLoss: {} }
    | { takeProfit: {} }
    | { conditionalOrderExecute: {} };

  function actionNeedsTraderToken(action: BatchAction): boolean {
    return !("conditionalOrderExecute" in action);
  }

  function buildBatchParams(
    items: Array<{
      tradeId: BN;
      action: BatchAction;
      position: PublicKey;
      traderToken?: PublicKey;
    }>
  ) {
    const tradeIds: BN[] = [];
    const actionTypes: BatchAction[] = [];
    const remainingAccounts: Array<{
      pubkey: PublicKey;
      isSigner: boolean;
      isWritable: boolean;
    }> = [];

    for (const item of items) {
      tradeIds.push(item.tradeId);
      actionTypes.push(item.action);
      remainingAccounts.push({
        pubkey: item.position,
        isSigner: false,
        isWritable: true,
      });

      if (actionNeedsTraderToken(item.action)) {
        if (!item.traderToken) {
          throw new Error(
            `Missing trader token account for action ${Object.keys(item.action)[0]}`
          );
        }
        remainingAccounts.push({
          pubkey: item.traderToken,
          isSigner: false,
          isWritable: true,
        });
      }
    }

    return { tradeIds, actionTypes, remainingAccounts };
  }

  before(async () => {
    for (const kp of [admin, trader]) {
      const sig = await provider.connection.requestAirdrop(
        kp.publicKey,
        10 * LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig, "confirmed");
    }

    usdcMint = await createMint(
      provider.connection,
      admin,
      admin.publicKey,
      null,
      6
    );
    vaultStatePda = PublicKey.findProgramAddressSync(
      [VAULT_SEED],
      vaultProgram.programId
    )[0];
    vaultTokenAta = getAssociatedTokenAddressSync(
      usdcMint,
      vaultStatePda,
      true
    );
    settlementAuthorityPda = PublicKey.findProgramAddressSync(
      [SETTLEMENT_SEED],
      coreProgram.programId
    )[0];

    for (const kp of [oracle60, oracle70, oracle50]) {
      const tx = new anchor.web3.Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: admin.publicKey,
          newAccountPubkey: kp.publicKey,
          lamports: await provider.connection.getMinimumBalanceForRentExemption(
            0
          ),
          space: 0,
          programId: SystemProgram.programId,
        })
      );
      await provider.sendAndConfirm(tx, [admin, kp]);
    }

    if (!(await provider.connection.getAccountInfo(vaultStatePda))) {
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

    if (!(await provider.connection.getAccountInfo(configPda))) {
      await coreProgram.methods
        .initializeProtocol(usdcMint, vaultTokenAta, vaultStatePda)
        .accountsPartial({
          config: configPda,
          admin: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }

    if (!(await provider.connection.getAccountInfo(assetPda))) {
      const addAssetBuilder = coreProgram.methods
        .addAsset(assetId, oracle60.publicKey, {
          commissionOpenBps: new anchor.BN(0),
        })
        .accountsPartial({
          asset: assetPda,
          config: configPda,
          admin: admin.publicKey,
          systemProgram: SystemProgram.programId,
        });
      await addAssetBuilder.rpc();
    }

    traderAta = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        admin,
        usdcMint,
        trader.publicKey
      )
    ).address;
    await mintTo(
      provider.connection,
      admin,
      usdcMint,
      traderAta,
      admin.publicKey,
      1_000_000_000
    );

    coreCollateralAta = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        admin,
        usdcMint,
        settlementAuthorityPda,
        true
      )
    ).address;

    const adminAta = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        admin,
        usdcMint,
        admin.publicKey
      )
    ).address;
    await mintTo(
      provider.connection,
      admin,
      usdcMint,
      adminAta,
      admin.publicKey,
      10_000_000_000
    );
    await vaultProgram.methods
      .deposit(new BN(5_000_000_000))
      .accountsPartial({
        admin: admin.publicKey,
        vaultState: vaultStatePda,
        adminToken: adminAta,
        vaultToken: vaultTokenAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
  });

  beforeEach(async () => {
    await ensureProtocolUnpaused();
  });

  it("initializes protocol and vault", async () => {
    const config = await coreProgram.account.protocolConfig.fetch(configPda);
    assert.equal(config.admin.toBase58(), admin.publicKey.toBase58());
    assert.equal(config.nextPositionId.toNumber(), 0);
  });

  it("opens position using on-chain counter id", async () => {
    const tradeId = await currentPositionId();
    const positionPda = derivePositionPda(trader.publicKey, assetId, tradeId);
    await coreProgram.methods
      .openPosition(
        assetId,
        new BN(100_000_000),
        10,
        { long: {} },
        { market: {} },
        new BN(0),
        defaultSlPrice,
        defaultTpPrice
      )
      .accountsPartial({
        trader: trader.publicKey,
        config: configPda,
        asset: assetPda,
        pythPriceUpdate: oracle60.publicKey,
        position: positionPda,
        traderTokenAccount: traderAta,
        vaultTokenAccount: vaultTokenAta,
        coreCollateralToken: coreCollateralAta,
        vaultState: vaultStatePda,
        settlementAuthority: settlementAuthorityPda,
        vaultProgram: vaultProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([trader])
      .rpc();
    await assertAccountExists(positionPda, "position");
  });

  it("opens and closes in profit", async () => {
    const tradeId = await currentPositionId();
    const positionPda = derivePositionPda(trader.publicKey, assetId, tradeId);
    await coreProgram.methods
      .openPosition(
        assetId,
        new BN(100_000_000),
        10,
        { long: {} },
        { market: {} },
        new BN(0),
        defaultSlPrice,
        defaultTpPrice
      )
      .accountsPartial({
        trader: trader.publicKey,
        config: configPda,
        asset: assetPda,
        pythPriceUpdate: oracle60.publicKey,
        position: positionPda,
        traderTokenAccount: traderAta,
        vaultTokenAccount: vaultTokenAta,
        coreCollateralToken: coreCollateralAta,
        vaultState: vaultStatePda,
        settlementAuthority: settlementAuthorityPda,
        vaultProgram: vaultProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([trader])
      .rpc();
    const beforeBal = (
      await provider.connection.getTokenAccountBalance(traderAta)
    ).value.uiAmount!;
    await coreProgram.methods
      .closePosition(assetId, tradeId)
      .accountsPartial({
        trader: trader.publicKey,
        config: configPda,
        asset: assetPda,
        position: positionPda,
        pythPriceUpdate: oracle70.publicKey,
        vaultTokenAccount: vaultTokenAta,
        traderTokenAccount: traderAta,
        coreCollateralToken: coreCollateralAta,
        settlementAuthority: settlementAuthorityPda,
        vaultProgram: vaultProgram.programId,
        vaultState: vaultStatePda,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([trader])
      .rpc();
    const afterBal = (
      await provider.connection.getTokenAccountBalance(traderAta)
    ).value.uiAmount!;
    assert.ok(afterBal! > beforeBal!, "long profit: balance should increase");
  });

  it("opens and closes at loss", async () => {
    const tradeId = await currentPositionId();
    const positionPda = derivePositionPda(trader.publicKey, assetId, tradeId);
    await coreProgram.methods
      .openPosition(
        assetId,
        new BN(100_000_000),
        2,
        { long: {} },
        { market: {} },
        new BN(0),
        defaultSlPrice,
        defaultTpPrice
      )
      .accountsPartial({
        trader: trader.publicKey,
        config: configPda,
        asset: assetPda,
        pythPriceUpdate: oracle60.publicKey,
        position: positionPda,
        traderTokenAccount: traderAta,
        vaultTokenAccount: vaultTokenAta,
        coreCollateralToken: coreCollateralAta,
        vaultState: vaultStatePda,
        settlementAuthority: settlementAuthorityPda,
        vaultProgram: vaultProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([trader])
      .rpc();

    const traderBefore = (
      await provider.connection.getTokenAccountBalance(traderAta)
    ).value.uiAmount!;

    await coreProgram.methods
      .closePosition(assetId, tradeId)
      .accountsPartial({
        trader: trader.publicKey,
        config: configPda,
        asset: assetPda,
        position: positionPda,
        pythPriceUpdate: oracle50.publicKey,
        vaultTokenAccount: vaultTokenAta,
        traderTokenAccount: traderAta,
        coreCollateralToken: coreCollateralAta,
        settlementAuthority: settlementAuthorityPda,
        vaultProgram: vaultProgram.programId,
        vaultState: vaultStatePda,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([trader])
      .rpc();

    const traderAfter = (
      await provider.connection.getTokenAccountBalance(traderAta)
    ).value.uiAmount!;

    assert.ok(
      traderAfter > traderBefore,
      "trader gets some collateral back on partial loss"
    );
    assert.ok(
      traderAfter < traderBefore + 100,
      "but less than full 100 USDC collateral"
    );
    await assertAccountExists(positionPda, "position");
  });

  it("emergency close returns full collateral when paused", async () => {
    const tradeId = await currentPositionId();
    const positionPda = derivePositionPda(trader.publicKey, assetId, tradeId);
    await coreProgram.methods
      .openPosition(
        assetId,
        new BN(100_000_000),
        10,
        { long: {} },
        { market: {} },
        new BN(0),
        defaultSlPrice,
        defaultTpPrice
      )
      .accountsPartial({
        trader: trader.publicKey,
        config: configPda,
        asset: assetPda,
        pythPriceUpdate: oracle60.publicKey,
        position: positionPda,
        traderTokenAccount: traderAta,
        vaultTokenAccount: vaultTokenAta,
        coreCollateralToken: coreCollateralAta,
        vaultState: vaultStatePda,
        settlementAuthority: settlementAuthorityPda,
        vaultProgram: vaultProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([trader])
      .rpc();

    const traderBefore = (
      await provider.connection.getTokenAccountBalance(traderAta)
    ).value.uiAmount!;

    await coreProgram.methods
      .toggleProtocolStatus(true)
      .accountsPartial({ config: configPda, admin: admin.publicKey })
      .rpc();

    try {
      await coreProgram.methods
        .emergencyClose(assetId, tradeId)
        .accountsPartial({
          trader: trader.publicKey,
          config: configPda,
          asset: assetPda,
          position: positionPda,
          vaultTokenAccount: vaultTokenAta,
          traderTokenAccount: traderAta,
          coreCollateralToken: coreCollateralAta,
          settlementAuthority: settlementAuthorityPda,
          vaultProgram: vaultProgram.programId,
          vaultState: vaultStatePda,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([trader])
        .rpc();
    } finally {
      await coreProgram.methods
        .toggleProtocolStatus(false)
        .accountsPartial({ config: configPda, admin: admin.publicKey })
        .rpc();
    }

    const traderAfter = (
      await provider.connection.getTokenAccountBalance(traderAta)
    ).value.uiAmount!;
    assert.ok(
      Math.abs(traderAfter - (traderBefore + 100)) < 0.01,
      "trader should receive full net collateral on emergency close"
    );

    await assertAccountExists(positionPda, "position");
  });

  it("supports multiple concurrent positions", async () => {
    const idA = await currentPositionId();
    const pdaA = derivePositionPda(trader.publicKey, assetId, idA);
    await coreProgram.methods
      .openPosition(
        assetId,
        new BN(100_000_000),
        2,
        { long: {} },
        { market: {} },
        new BN(0),
        defaultSlPrice,
        defaultTpPrice
      )
      .accountsPartial({
        trader: trader.publicKey,
        config: configPda,
        asset: assetPda,
        pythPriceUpdate: oracle60.publicKey,
        position: pdaA,
        traderTokenAccount: traderAta,
        vaultTokenAccount: vaultTokenAta,
        coreCollateralToken: coreCollateralAta,
        vaultState: vaultStatePda,
        settlementAuthority: settlementAuthorityPda,
        vaultProgram: vaultProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([trader])
      .rpc();

    const idB = await currentPositionId();
    const pdaB = derivePositionPda(trader.publicKey, assetId, idB);
    await coreProgram.methods
      .openPosition(
        assetId,
        new BN(100_000_000),
        5,
        { long: {} },
        { market: {} },
        new BN(0),
        defaultSlPrice,
        defaultTpPrice
      )
      .accountsPartial({
        trader: trader.publicKey,
        config: configPda,
        asset: assetPda,
        pythPriceUpdate: oracle60.publicKey,
        position: pdaB,
        traderTokenAccount: traderAta,
        vaultTokenAccount: vaultTokenAta,
        coreCollateralToken: coreCollateralAta,
        vaultState: vaultStatePda,
        settlementAuthority: settlementAuthorityPda,
        vaultProgram: vaultProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([trader])
      .rpc();

    await assertAccountExists(pdaA, "first position");
    await assertAccountExists(pdaB, "second position");
  });

  it("handles conditional orders lifecycle (Limit -> Execute)", async () => {
    const tradeId = await currentPositionId();
    const positionPda = derivePositionPda(trader.publicKey, assetId, tradeId);

    // Open a Limit Order
    await coreProgram.methods
      .openPosition(
        assetId,
        new BN(100_000_000),
        2,
        { long: {} },
        { limit: {} },
        new BN(50_000_000_000), // Target price $50,000
        new BN(45_000_000_000), // SL price $45,000
        new BN(65_000_000_000), // TP price $65,000
      )
      .accountsPartial({
        trader: trader.publicKey,
        config: configPda,
        asset: assetPda,
        pythPriceUpdate: oracle60.publicKey, // Current price is 60k, which > 50k (limit). It will stay pending.
        position: positionPda,
        traderTokenAccount: traderAta,
        vaultTokenAccount: vaultTokenAta,
        coreCollateralToken: coreCollateralAta,
        vaultState: vaultStatePda,
        settlementAuthority: settlementAuthorityPda,
        vaultProgram: vaultProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([trader])
      .rpc();

    await assertAccountExists(positionPda, "pending position");

    // Update SL/TP while Pending
    await coreProgram.methods
      .updateSlTp(
        assetId,
        tradeId,
        new BN(40_000_000_000),
        new BN(70_000_000_000),
      )
      .accountsPartial({
        trader: trader.publicKey,
        position: positionPda,
      })
      .signers([trader])
      .rpc();

    await assertAccountExists(positionPda, "position after sl/tp update");

    // Execute Batch (Trigger Limit Order)
    // Oracle price goes down to 50k, triggering the limit order
    const batch = buildBatchParams([
      {
        tradeId,
        action: { conditionalOrderExecute: {} },
        position: positionPda,
      },
    ]);
    await coreProgram.methods
      .executeBatch(assetId, batch.tradeIds, batch.actionTypes)
      .accountsPartial({
        keeper: admin.publicKey,
        config: configPda,
        asset: assetPda,
        pythPriceUpdate: oracle50.publicKey,
        vaultTokenAccount: vaultTokenAta,
        coreCollateralToken: coreCollateralAta,
        vaultState: vaultStatePda,
        settlementAuthority: settlementAuthorityPda,
        vaultProgram: vaultProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts(batch.remainingAccounts)
      .signers([admin])
      .rpc();

    await assertAccountExists(positionPda, "position after execute batch");
  });

  it("accepts openPosition and updateSlTp when SL or TP is zero", async () => {
    const tradeId = await currentPositionId();
    const positionPda = derivePositionPda(trader.publicKey, assetId, tradeId);
    await coreProgram.methods
      .openPosition(
        assetId,
        new BN(100_000_000),
        2,
        { long: {} },
        { market: {} },
        new BN(0),
        new BN(0),
        defaultTpPrice
      )
      .accountsPartial({
        trader: trader.publicKey,
        config: configPda,
        asset: assetPda,
        pythPriceUpdate: oracle60.publicKey,
        position: positionPda,
        traderTokenAccount: traderAta,
        vaultTokenAccount: vaultTokenAta,
        coreCollateralToken: coreCollateralAta,
        vaultState: vaultStatePda,
        settlementAuthority: settlementAuthorityPda,
        vaultProgram: vaultProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([trader])
      .rpc();

    await assertAccountExists(positionPda, "position with zero stop loss");

    await coreProgram.methods
      .updateSlTp(assetId, tradeId, defaultSlPrice, new BN(0))
      .accountsPartial({
        trader: trader.publicKey,
        position: positionPda,
      })
      .signers([trader])
      .rpc();

    await assertAccountExists(positionPda, "position after zero take profit update");
  });

  it("handles cancelling a pending order", async () => {
    const tradeId = await currentPositionId();
    const positionPda = derivePositionPda(trader.publicKey, assetId, tradeId);

    // Open a Stop Order
    await coreProgram.methods
      .openPosition(
        assetId,
        new BN(100_000_000),
        2,
        { long: {} },
        { stop: {} },
        new BN(70_000_000_000), // Target price $70,000
        new BN(45_000_000_000), // SL price $45,000
        new BN(85_000_000_000), // TP price $85,000
      )
      .accountsPartial({
        trader: trader.publicKey,
        config: configPda,
        asset: assetPda,
        pythPriceUpdate: oracle60.publicKey,
        position: positionPda,
        traderTokenAccount: traderAta,
        vaultTokenAccount: vaultTokenAta,
        coreCollateralToken: coreCollateralAta,
        vaultState: vaultStatePda,
        settlementAuthority: settlementAuthorityPda,
        vaultProgram: vaultProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([trader])
      .rpc();

    await assertAccountExists(positionPda, "pending stop order position");

    const traderBefore = (
      await provider.connection.getTokenAccountBalance(traderAta)
    ).value.uiAmount!;

    // Cancel the Order
    await coreProgram.methods
      .cancelOrder(assetId, tradeId)
      .accountsPartial({
        trader: trader.publicKey,
        position: positionPda,
        traderTokenAccount: traderAta,
        coreCollateralToken: coreCollateralAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([trader])
      .rpc();

    const traderAfter = (
      await provider.connection.getTokenAccountBalance(traderAta)
    ).value.uiAmount!;
    assert.ok(
      traderAfter > traderBefore,
      "Trader should receive collateral back",
    );

    await assertAccountExists(positionPda, "position after cancel");
  });
});
