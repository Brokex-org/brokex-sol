import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { assert } from "chai";
import { BrokexCore } from "../target/types/brokex_core";

const CONFIG_SEED = Buffer.from("config");
const ASSET_SEED  = Buffer.from("asset");

describe("brokex-core", () => {
  const provider = AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.BrokexCore as Program<BrokexCore>;
  const admin   = provider.wallet;

  const [configPda] = PublicKey.find_program_addressSync([CONFIG_SEED], program.programId);

  const assetId  = "SOL/USD";
  const pythFeed = Keypair.generate().publicKey;
  const [assetPda] = PublicKey.find_program_addressSync(
    [ASSET_SEED, Buffer.from(assetId)],
    program.programId
  );

  it("initializes the protocol config", async () => {
    await program.methods
      .initializeProtocol()
      .accounts({ config: configPda, admin: admin.publicKey, systemProgram: SystemProgram.programId })
      .rpc();

    const config = await program.account.protocolConfig.fetch(configPda);
    assert.equal(config.admin.toBase58(), admin.publicKey.toBase58());
    assert.isFalse(config.isPaused);
    assert.isNull(config.pendingAdmin);
  });

  it("registers a new asset", async () => {
    await program.methods
      .addAsset(assetId, pythFeed)
      .accounts({ asset: assetPda, config: configPda, admin: admin.publicKey, systemProgram: SystemProgram.programId })
      .rpc();

    const asset = await program.account.asset.fetch(assetPda);
    assert.equal(asset.assetId, assetId);
    assert.equal(asset.pythFeed.toBase58(), pythFeed.toBase58());
    assert.isTrue(asset.isEnabled);
  });

  it("disables a registered asset", async () => {
    await program.methods
      .toggleAssetStatus(false)
      .accounts({ asset: assetPda, config: configPda, admin: admin.publicKey })
      .rpc();

    const asset = await program.account.asset.fetch(assetPda);
    assert.isFalse(asset.isEnabled);
  });

  it("re-enables a disabled asset", async () => {
    await program.methods
      .toggleAssetStatus(true)
      .accounts({ asset: assetPda, config: configPda, admin: admin.publicKey })
      .rpc();

    const asset = await program.account.asset.fetch(assetPda);
    assert.isTrue(asset.isEnabled);
  });

  it("pauses the protocol", async () => {
    await program.methods
      .toggleProtocolStatus(true)
      .accounts({ config: configPda, admin: admin.publicKey })
      .rpc();

    const config = await program.account.protocolConfig.fetch(configPda);
    assert.isTrue(config.isPaused);
  });

  it("unpauses the protocol", async () => {
    await program.methods
      .toggleProtocolStatus(false)
      .accounts({ config: configPda, admin: admin.publicKey })
      .rpc();

    const config = await program.account.protocolConfig.fetch(configPda);
    assert.isFalse(config.isPaused);
  });

  it("proposes a new admin", async () => {
    const newAdmin = Keypair.generate();

    await program.methods
      .proposeAdmin(newAdmin.publicKey)
      .accounts({ config: configPda, admin: admin.publicKey })
      .rpc();

    const config = await program.account.protocolConfig.fetch(configPda);
    assert.equal(config.pendingAdmin.toBase58(), newAdmin.publicKey.toBase58());
    assert.equal(config.admin.toBase58(), admin.publicKey.toBase58());
  });

  it("accepts the admin handover", async () => {
    const newAdmin = Keypair.generate();

    await program.methods
      .proposeAdmin(newAdmin.publicKey)
      .accounts({ config: configPda, admin: admin.publicKey })
      .rpc();

    const sig = await provider.connection.requestAirdrop(newAdmin.publicKey, LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig, "confirmed");

    await program.methods
      .acceptAdmin()
      .accounts({ config: configPda, pendingAdmin: newAdmin.publicKey })
      .signers([newAdmin])
      .rpc();

    const config = await program.account.protocolConfig.fetch(configPda);
    assert.equal(config.admin.toBase58(), newAdmin.publicKey.toBase58());
    assert.isNull(config.pendingAdmin);
  });

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

      assert.fail("Expected transaction to be rejected");
    } catch (err: any) {
      const msg: string = err.message ?? err.toString();
      assert.ok(
        msg.includes("Unauthorized") || msg.includes("2000") || msg.includes("constraint"),
        `Unexpected error: ${msg}`
      );
    }
  });
});
