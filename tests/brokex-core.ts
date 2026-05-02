/**
 * Brokex Core – TypeScript integration tests
 *
 * Runs against a real Solana validator (started by `anchor test`).
 * Tests the full client → IDL → program → validator → account state roundtrip.
 *
 * Tests:
 *   1. initialize_protocol  – creates ProtocolConfig PDA
 *   2. add_asset            – registers a tradable asset
 *   3. toggle_asset_status  – enable / disable an asset
 *   4. toggle_protocol_status – pause / unpause protocol
 *   5. propose_admin / accept_admin – two-step admin handover
 *   6. Unauthorized-access guard – non-admin must be rejected
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
import { BrokexSolana } from "../target/types/brokex_solana";

// ── PDA seeds (must match constants.rs) ─────────────────────────────────────
const CONFIG_SEED = Buffer.from("config");
const ASSET_SEED  = Buffer.from("asset");

// ────────────────────────────────────────────────────────────────────────────

describe("brokex-core", () => {
  const provider = AnchorProvider.env();
  anchor.setProvider(provider);

  const program  = anchor.workspace.BrokexSolana as Program<BrokexSolana>;
  const admin    = provider.wallet;

  const [configPda] = PublicKey.findProgramAddressSync(
    [CONFIG_SEED],
    program.programId
  );

  const assetId  = "SOL/USD";
  const pythFeed = Keypair.generate().publicKey;

  const [assetPda] = PublicKey.findProgramAddressSync(
    [ASSET_SEED, Buffer.from(assetId)],
    program.programId
  );

  // ── 1. Protocol initialization ───────────────────────────────────────────

  it("initializes the protocol config", async () => {
    await program.methods
      .initializeProtocol()
      .accounts({
        config:        configPda,
        admin:         admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const config = await program.account.protocolConfig.fetch(configPda);
    assert.equal(config.admin.toBase58(), admin.publicKey.toBase58(), "admin mismatch");
    assert.isFalse(config.isPaused, "protocol should start unpaused");
    assert.isNull(config.pendingAdmin, "no pending admin on init");
  });

  // ── 2. Asset registration ────────────────────────────────────────────────

  it("registers a new asset", async () => {
    await program.methods
      .addAsset(assetId, pythFeed)
      .accounts({
        asset:         assetPda,
        config:        configPda,
        admin:         admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const asset = await program.account.asset.fetch(assetPda);
    assert.equal(asset.assetId, assetId, "asset_id mismatch");
    assert.equal(asset.pythFeed.toBase58(), pythFeed.toBase58(), "pyth_feed mismatch");
    assert.isTrue(asset.isEnabled, "new assets should be enabled by default");
  });

  // ── 3. Toggle asset status ───────────────────────────────────────────────

  it("disables a registered asset", async () => {
    await program.methods
      .toggleAssetStatus(false)
      .accounts({ asset: assetPda, config: configPda, admin: admin.publicKey })
      .rpc();

    const asset = await program.account.asset.fetch(assetPda);
    assert.isFalse(asset.isEnabled, "asset should be disabled");
  });

  it("re-enables a disabled asset", async () => {
    await program.methods
      .toggleAssetStatus(true)
      .accounts({ asset: assetPda, config: configPda, admin: admin.publicKey })
      .rpc();

    const asset = await program.account.asset.fetch(assetPda);
    assert.isTrue(asset.isEnabled, "asset should be re-enabled");
  });

  // ── 4. Protocol pause / unpause ──────────────────────────────────────────

  it("pauses the protocol", async () => {
    await program.methods
      .toggleProtocolStatus(true)
      .accounts({ config: configPda, admin: admin.publicKey })
      .rpc();

    const config = await program.account.protocolConfig.fetch(configPda);
    assert.isTrue(config.isPaused, "protocol should be paused");
  });

  it("unpauses the protocol", async () => {
    await program.methods
      .toggleProtocolStatus(false)
      .accounts({ config: configPda, admin: admin.publicKey })
      .rpc();

    const config = await program.account.protocolConfig.fetch(configPda);
    assert.isFalse(config.isPaused, "protocol should be unpaused");
  });

  // ── 5. Two-step admin handover ───────────────────────────────────────────

  it("proposes a new admin", async () => {
    const newAdmin = Keypair.generate();

    await program.methods
      .proposeAdmin(newAdmin.publicKey)
      .accounts({ config: configPda, admin: admin.publicKey })
      .rpc();

    const config = await program.account.protocolConfig.fetch(configPda);
    assert.equal(config.pendingAdmin.toBase58(), newAdmin.publicKey.toBase58(), "pending_admin mismatch");
    assert.equal(config.admin.toBase58(), admin.publicKey.toBase58(), "current admin should be unchanged");
  });

  it("accepts the admin handover", async () => {
    // Read pending admin from state first
    const config0 = await program.account.protocolConfig.fetch(configPda);
    const newAdminKey = config0.pendingAdmin as PublicKey;

    // Fund the new admin via an airdrop so it can sign
    const sig = await provider.connection.requestAirdrop(newAdminKey, LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig, "confirmed");

    const newAdminKeypair = /* in real testing this comes from a stored keypair */
      // For this test we only proposed a pubkey we don't have the keypair for.
      // Re-run the proposal with a known keypair to complete the handover.
      Keypair.generate();

    // Re-propose with a keypair we control
    await program.methods
      .proposeAdmin(newAdminKeypair.publicKey)
      .accounts({ config: configPda, admin: admin.publicKey })
      .rpc();

    const sig2 = await provider.connection.requestAirdrop(newAdminKeypair.publicKey, LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig2, "confirmed");

    await program.methods
      .acceptAdmin()
      .accounts({ config: configPda, pendingAdmin: newAdminKeypair.publicKey })
      .signers([newAdminKeypair])
      .rpc();

    const config = await program.account.protocolConfig.fetch(configPda);
    assert.equal(config.admin.toBase58(), newAdminKeypair.publicKey.toBase58(), "admin should be updated");
    assert.isNull(config.pendingAdmin, "pending_admin should be cleared");
  });

  // ── 6. Authorization guard ───────────────────────────────────────────────

  it("rejects toggle_protocol_status from a non-admin", async () => {
    const rogue = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(rogue.publicKey, LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig, "confirmed");

    try {
      await program.methods
        .toggleProtocolStatus(true)
        .accounts({ config: configPda, admin: rogue.publicKey })
        .signers([rogue])
        .rpc();

      assert.fail("Expected the transaction to be rejected");
    } catch (err: any) {
      const msg: string = err.message ?? err.toString();
      assert.ok(
        msg.includes("Unauthorized") || msg.includes("2000") || msg.includes("constraint"),
        `Expected an Unauthorized error, got: ${msg}`
      );
    }
  });
});
