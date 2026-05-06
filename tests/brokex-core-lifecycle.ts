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

  it("initializes protocol and vault", async () => {
    const config = await coreProgram.account.protocolConfig.fetch(configPda);
    assert.equal(config.admin.toBase58(), admin.publicKey.toBase58());
    assert.equal(config.nextPositionId.toNumber(), 0);
  });

  it("opens position using on-chain counter id", async () => {
    const tradeId = await currentPositionId();
    const positionPda = derivePositionPda(trader.publicKey, assetId, tradeId);
    await coreProgram.methods
      .openPosition(assetId, new BN(100_000_000), 10, {
        long: {},
      })
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
    const pos = await coreProgram.account.position.fetch(positionPda);
    assert.ok(pos.state.hasOwnProperty("open"));
    assert.equal(pos.tradeId.toString(), tradeId.toString());
  });

  it("opens and closes in profit", async () => {
    const tradeId = await currentPositionId();
    const positionPda = derivePositionPda(trader.publicKey, assetId, tradeId);
    await coreProgram.methods
      .openPosition(assetId, new BN(100_000_000), 10, { long: {} })
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
      .openPosition(assetId, new BN(100_000_000), 2, { long: {} })
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
    const pos = await coreProgram.account.position.fetch(positionPda);
    assert.ok(pos.state.hasOwnProperty("closed"), "position should be closed");
  });

  it("emergency close returns full collateral when paused", async () => {
    const tradeId = await currentPositionId();
    const positionPda = derivePositionPda(trader.publicKey, assetId, tradeId);
    await coreProgram.methods
      .openPosition(assetId, new BN(100_000_000), 10, {
        long: {},
      })
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

    const traderAfter = (
      await provider.connection.getTokenAccountBalance(traderAta)
    ).value.uiAmount!;
    assert.ok(
      Math.abs(traderAfter - (traderBefore + 100)) < 0.01,
      "trader should receive full net collateral on emergency close"
    );

    const pos = await coreProgram.account.position.fetch(positionPda);
    assert.ok(
      pos.state.hasOwnProperty("emergencyClosed"),
      "position state should be emergencyClosed"
    );

    await coreProgram.methods
      .toggleProtocolStatus(false)
      .accountsPartial({ config: configPda, admin: admin.publicKey })
      .rpc();
  });

  it("supports multiple concurrent positions", async () => {
    const idA = await currentPositionId();
    const pdaA = derivePositionPda(trader.publicKey, assetId, idA);
    await coreProgram.methods
      .openPosition(assetId, new BN(100_000_000), 2, { long: {} })
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
      .openPosition(assetId, new BN(100_000_000), 5, { long: {} })
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

    const stateA = await coreProgram.account.position.fetch(pdaA);
    const stateB = await coreProgram.account.position.fetch(pdaB);
    assert.ok(stateA.state.hasOwnProperty("open"));
    assert.ok(stateB.state.hasOwnProperty("open"));
  });
});
