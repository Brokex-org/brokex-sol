/**
 * One-time (or idempotent) devnet bootstrap for Brokex:
 *   vault.initialize → core.initialize_protocol → add_asset (per market) → vault.deposit
 *
 * Prerequisites:
 *   - anchor build   (generates target/idl/*.json)
 *   - Admin keypair with devnet SOL (+ enough USDC on VITE_USDC_MINT for deposit)
 *
 * Usage (from repo root):
 *   ANCHOR_WALLET=keys/your-devnet.json node scripts/bootstrap-devnet.cjs
 *
 * Env:
 *   ANCHOR_PROVIDER_URL  (default https://api.devnet.solana.com)
 *   ANCHOR_WALLET        (default keys/localnet-authority.json)
 *   USDC_MINT            (default Circle devnet USDC)
 *   DEPOSIT_USDC         (default 1000 = 1000.0 USDC raw 1e6)
 *
 * After this, config PDA exists and the frontend "Protocol config account not found" error goes away.
 *
 * Trading still needs a live Pyth PriceUpdateV2 account in the open_position instruction whose
 * payload feed_id matches each asset (see Pyth Solana pull / Hermes post flow).
 */

const fs = require("fs");
const path = require("path");
const anchor = require("@coral-xyz/anchor");
const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} = require("@solana/web3.js");
const {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
} = require("@solana/spl-token");

const CONFIG_SEED = Buffer.from("config");
const ASSET_SEED = Buffer.from("asset");
const VAULT_SEED = Buffer.from("vault");
const SETTLEMENT_SEED = Buffer.from("settlement");

/** Pyth price feed IDs (32-byte hex, no 0x). Must match Pyth docs for the feed. */
const ASSETS = [
  {
    id: "BTC/USD",
    feedHex:
      "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  },
  {
    id: "ETH/USD",
    feedHex:
      "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  },
  {
    id: "SOL/USD",
    feedHex:
      "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
  },
  {
    id: "EUR/USD",
    feedHex:
      "a995d00bb36a63cef7fd2c287dc105fc8f3d93779f062f09551b0af3e81ec30b",
  },
  {
    id: "XAU/USD",
    feedHex:
      "765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2",
  },
];

function feedHexToPubkey(hex) {
  const clean = hex.replace(/^0x/i, "").toLowerCase();
  if (clean.length > 64 || !/^[0-9a-f]+$/.test(clean)) {
    throw new Error(`Bad feed hex: ${hex}`);
  }
  const padded = clean.length === 64 ? clean : clean.padStart(64, "0");
  if (padded.length !== 64) throw new Error(`Bad feed hex length: ${hex}`);
  return new PublicKey(Buffer.from(padded, "hex"));
}

function loadKeypair(keyPath) {
  const raw = JSON.parse(fs.readFileSync(keyPath, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function main() {
  const repoRoot = path.join(__dirname, "..");
  const idlCore = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "target/idl/brokex_core.json"), "utf8")
  );
  const idlVault = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "target/idl/brokex_vault.json"), "utf8")
  );

  const rpc =
    process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";
  const walletPath = path.isAbsolute(process.env.ANCHOR_WALLET || "")
    ? process.env.ANCHOR_WALLET
    : path.join(
        repoRoot,
        process.env.ANCHOR_WALLET || "keys/localnet-authority.json"
      );

  if (!fs.existsSync(walletPath)) {
    throw new Error(
      `Wallet not found: ${walletPath}\nSet ANCHOR_WALLET to a funded devnet keypair.`
    );
  }

  const admin = loadKeypair(walletPath);
  const connection = new Connection(rpc, "confirmed");
  const wallet = new anchor.Wallet(admin);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const coreProgram = new anchor.Program(idlCore, provider);
  const vaultProgram = new anchor.Program(idlVault, provider);

  const usdcMint = new PublicKey(
    process.env.USDC_MINT ||
      "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
  );

  const vaultStatePda = PublicKey.findProgramAddressSync(
    [VAULT_SEED],
    vaultProgram.programId
  )[0];
  const [configPda] = PublicKey.findProgramAddressSync(
    [CONFIG_SEED],
    coreProgram.programId
  );
  const settlementAuthorityPda = PublicKey.findProgramAddressSync(
    [SETTLEMENT_SEED],
    coreProgram.programId
  )[0];

  const bal = await connection.getBalance(admin.publicKey);
  if (bal < 0.1 * anchor.web3.LAMPORTS_PER_SOL) {
    console.log("Requesting airdrop (devnet)...");
    const sig = await connection.requestAirdrop(
      admin.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(sig, "confirmed");
  }

  if (!(await connection.getAccountInfo(vaultStatePda))) {
    console.log("Initializing vault...");
    await vaultProgram.methods
      .initialize()
      .accounts({
        admin: admin.publicKey,
        vaultState: vaultStatePda,
        stableMint: usdcMint,
        core: settlementAuthorityPda,
        vaultToken: getAssociatedTokenAddressSync(
          usdcMint,
          vaultStatePda,
          true
        ),
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("Vault initialized:", vaultStatePda.toBase58());
  } else {
    console.log("Vault already initialized, skipping.");
  }

  const vaultTokenAta = getAssociatedTokenAddressSync(
    usdcMint,
    vaultStatePda,
    true
  );

  if (!(await connection.getAccountInfo(configPda))) {
    console.log("Initializing brokex_core protocol...");
    // Third pubkey is vault *state* PDA (IDL field name is vault_program — Rust stores it as vault_state).
    await coreProgram.methods
      .initializeProtocol(usdcMint, vaultTokenAta, vaultStatePda)
      .accounts({
        config: configPda,
        admin: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("Protocol config PDA:", configPda.toBase58());
  } else {
    console.log("Protocol already initialized, skipping.");
  }

  for (const { id: assetId, feedHex } of ASSETS) {
    const [assetPda] = PublicKey.findProgramAddressSync(
      [ASSET_SEED, Buffer.from(assetId)],
      coreProgram.programId
    );
    const desiredFeed = feedHexToPubkey(feedHex);
    const existing = await connection.getAccountInfo(assetPda);
    if (!existing) {
      console.log(`Adding asset ${assetId} (feed ${desiredFeed.toBase58()})...`);
      await coreProgram.methods
        .addAsset(assetId, desiredFeed, { commissionOpenBps: new anchor.BN(0), baseSpreadBps: new anchor.BN(0) })
        .accounts({
          asset: assetPda,
          config: configPda,
          admin: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } else {
      const assetAcc = await coreProgram.account.asset.fetch(assetPda);
      const onChain = assetAcc.pythFeed;
      if (!onChain.equals(desiredFeed)) {
        console.log(
          `Updating ${assetId} pyth_feed: ${onChain.toBase58()} -> ${desiredFeed.toBase58()}`
        );
        await coreProgram.methods
          .updateAssetPythFeed(desiredFeed)
          .accounts({
            asset: assetPda,
            config: configPda,
            admin: admin.publicKey,
          })
          .rpc();
      } else {
        console.log(`Asset ${assetId} already registered with correct pyth_feed, skipping.`);
      }
    }
  }

  const depositUi = parseFloat(process.env.DEPOSIT_USDC || "1000", 10);
  const depositRaw = new anchor.BN(Math.floor(depositUi * 1_000_000));

  const adminAta = await getOrCreateAssociatedTokenAccount(
    connection,
    admin,
    usdcMint,
    admin.publicKey
  ).then((x) => x.address);

  const tokenBal = await connection.getTokenAccountBalance(adminAta);
  const have = BigInt(tokenBal.value.amount);
  const need = BigInt(depositRaw.toString());
  if (have < need) {
    console.warn(
      `\nSkipping deposit: admin USDC balance ${have} raw < required ${need}.\n` +
        `Fund ${admin.publicKey.toBase58()} with mint ${usdcMint.toBase58()} (e.g. Circle faucet), then re-run.\n`
    );
  } else {
    console.log(`Depositing ${depositUi} USDC into vault...`);
    await vaultProgram.methods
      .deposit(depositRaw)
      .accounts({
        admin: admin.publicKey,
        vaultState: vaultStatePda,
        adminToken: adminAta,
        vaultToken: vaultTokenAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
    console.log("Deposit complete.");
  }

  console.log("\nDone. Config:", configPda.toBase58());
  console.log(
    "\nNext: ensure the app posts or uses a valid Pyth PriceUpdateV2 per feed before open_position;\n" +
      "feed IDs above are what on-chain assets expect (see Pyth Hermes → Solana receiver)."
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
