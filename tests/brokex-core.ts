/**
 * Integration tests for `brokex-core` (localnet via `anchor test`).
 */
import * as anchor from "@anchor-lang/core";
import { Program, AnchorProvider } from "@anchor-lang/core";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { assert } from "chai";
import type { BrokexCore } from "../target/types/brokex_core";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

const idl = require("../target/idl/brokex_core.json") as BrokexCore;

const CONFIG_SEED = Buffer.from("config");
const ASSET_SEED = Buffer.from("asset");
const POSITION_SEED = Buffer.from("position");

describe("brokex-core", () => {
  const provider = AnchorProvider.env();
  anchor.setProvider(provider);

  const program = new Program(idl, provider) as Program<BrokexCore>;
  const admin = provider.wallet;

  const [configPda] = PublicKey.findProgramAddressSync(
    [CONFIG_SEED],
    program.programId,
  );

  const assetId = "SOL/USD";
  const pythFeed = Keypair.generate().publicKey;
  const [assetPda] = PublicKey.findProgramAddressSync(
    [ASSET_SEED, Buffer.from(assetId)],
    program.programId,
  );

  const usdcMint = Keypair.generate();
  const vault = getAssociatedTokenAddressSync(
    configPda,
    usdcMint.publicKey,
    true,
  );

  const configInput = {
    minLeverage: new anchor.BN(1),
    maxLeverage: new anchor.BN(100),
    minTradeSize: new anchor.BN(10000000),
    commissionOpenBps: new anchor.BN(10),
    baseSpreadBps: new anchor.BN(20),
    maxOpenInterest: new anchor.BN(1000000000000),
    maxOiPerTrader: new anchor.BN(100000000000),
    alphaMin: new anchor.BN(500000),
    alphaScale: new anchor.BN(1000000000),
    k: new anchor.BN(100000000),
    profitCapBps: new anchor.BN(5000),
  };

  it("initializes the protocol config", async () => {
    await program.methods
      .initializeProtocol(usdcMint.publicKey, vault, PublicKey.unique())
      .accountsPartial({
        config: configPda,
        admin: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const config = await program.account.protocolConfig.fetch(configPda);
    assert.equal(config.admin.toBase58(), admin.publicKey.toBase58());
    assert.isFalse(config.isPaused);
    assert.isNull(config.pendingAdmin);
  });

  it("registers a new asset", async () => {
    await program.methods
      .addAsset(assetId, pythFeed, configInput)
      .accountsPartial({
        asset: assetPda,
        config: configPda,
        admin: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const asset = await program.account.asset.fetch(assetPda);
    assert.equal(asset.assetId, assetId);
    assert.isTrue(asset.isEnabled);
  });

  it("disables a registered asset", async () => {
    await program.methods
      .toggleAssetStatus(false)
      .accountsPartial({
        asset: assetPda,
        config: configPda,
        admin: admin.publicKey,
      })
      .rpc();

    const asset = await program.account.asset.fetch(assetPda);
    assert.isFalse(asset.isEnabled);
  });

  it("re-enables a disabled asset", async () => {
    await program.methods
      .toggleAssetStatus(true)
      .accountsPartial({
        asset: assetPda,
        config: configPda,
        admin: admin.publicKey,
      })
      .rpc();

    const asset = await program.account.asset.fetch(assetPda);
    assert.isTrue(asset.isEnabled);
  });

  it("pauses the protocol", async () => {
    await program.methods
      .toggleProtocolStatus(true)
      .accountsPartial({ config: configPda, admin: admin.publicKey })
      .rpc();

    const config = await program.account.protocolConfig.fetch(configPda);
    assert.isTrue(config.isPaused);
  });

  it("unpauses the protocol", async () => {
    await program.methods
      .toggleProtocolStatus(false)
      .accountsPartial({ config: configPda, admin: admin.publicKey })
      .rpc();

    const config = await program.account.protocolConfig.fetch(configPda);
    assert.isFalse(config.isPaused);
  });

  it("proposes a new admin", async () => {
    const newAdmin = Keypair.generate();

    await program.methods
      .proposeAdmin(newAdmin.publicKey)
      .accountsPartial({ config: configPda, admin: admin.publicKey })
      .rpc();

    const config = await program.account.protocolConfig.fetch(configPda);
    const pending = config.pendingAdmin;
    if (pending === null) assert.fail("expected pendingAdmin after propose");
    assert.equal(pending.toBase58(), newAdmin.publicKey.toBase58());
    assert.equal(config.admin.toBase58(), admin.publicKey.toBase58());
  });

  it("accepts the admin handover", async () => {
    const newAdmin = Keypair.generate();

    await program.methods
      .proposeAdmin(newAdmin.publicKey)
      .accountsPartial({ config: configPda, admin: admin.publicKey })
      .rpc();

    const sig = await provider.connection.requestAirdrop(
      newAdmin.publicKey,
      LAMPORTS_PER_SOL,
    );
    await provider.connection.confirmTransaction(sig, "confirmed");

    await program.methods
      .acceptAdmin()
      .accountsPartial({ config: configPda, pendingAdmin: newAdmin.publicKey })
      .signers([newAdmin])
      .rpc();

    const config = await program.account.protocolConfig.fetch(configPda);
    assert.equal(config.admin.toBase58(), newAdmin.publicKey.toBase58());
    assert.isNull(config.pendingAdmin);
  });

  it("rejects toggle_protocol_status from a non-admin", async () => {
    const rogue = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(
      rogue.publicKey,
      LAMPORTS_PER_SOL,
    );
    await provider.connection.confirmTransaction(sig, "confirmed");

    try {
      await program.methods
        .toggleProtocolStatus(true)
        .accountsPartial({ config: configPda, admin: rogue.publicKey })
        .signers([rogue])
        .rpc();

      assert.fail("Expected transaction to be rejected");
    } catch (err: unknown) {
      const msg: string = err instanceof Error ? err.message : String(err);
      assert.ok(
        msg.includes("Unauthorized") ||
          msg.includes("2000") ||
          msg.includes("constraint"),
        `Unexpected error: ${msg}`,
      );
    }
  });

  it("derives position PDA with tradeId", async () => {
    const tradeId = new anchor.BN(42);
    const [positionPda] = PublicKey.findProgramAddressSync(
      [
        POSITION_SEED,
        admin.publicKey.toBuffer(),
        Buffer.from(assetId),
        tradeId.toArrayLike(Buffer, "le", 8),
      ],
      program.programId,
    );
    assert.ok(positionPda);
  });
});
