/**
 * Integration tests for `brokex-core` (localnet via `anchor test`).
 * Uses IDL `address` like `tests/brokex_vault.ts` so it stays aligned with `declare_id!`.
 */
import * as anchor from "@anchor-lang/core";
import { Program, AnchorProvider } from "@anchor-lang/core";
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { assert } from "chai";
import type { BrokexCore } from "../target/types/brokex_core";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const idl = require("../target/idl/brokex_core.json") as BrokexCore;

const CONFIG_SEED = Buffer.from("config");
const ASSET_SEED = Buffer.from("asset");

describe("brokex-core", () => {
  const provider = AnchorProvider.env();
  anchor.setProvider(provider);

  const program = new Program(idl, provider) as Program<BrokexCore>;
  const admin = provider.wallet;

  const [configPda] = PublicKey.findProgramAddressSync(
    [CONFIG_SEED],
    program.programId
  );

  const assetId = "SOL/USD";
  const pythFeed = Keypair.generate().publicKey;
  const [assetPda] = PublicKey.findProgramAddressSync(
    [ASSET_SEED, Buffer.from(assetId)],
    program.programId
  );

  it("initializes the protocol config", async () => {
    await program.methods
      .initializeProtocol()
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
      .addAsset(assetId, pythFeed)
      .accountsPartial({
        asset: assetPda,
        config: configPda,
        admin: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const asset = await program.account.asset.fetch(assetPda);
    assert.equal(asset.assetId, assetId);
    assert.equal(asset.pythFeed.toBase58(), pythFeed.toBase58());
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
      LAMPORTS_PER_SOL
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
      LAMPORTS_PER_SOL
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
      const msg: string =
        err instanceof Error ? err.message : String(err);
      assert.ok(
        msg.includes("Unauthorized") ||
          msg.includes("2000") ||
          msg.includes("constraint"),
        `Unexpected error: ${msg}`
      );
    }
  });
});
