import { Connection, PublicKey } from '@solana/web3.js';
import { deriveAssetPda } from './pdas';
import { getExpectedPythFeedAsPubkey } from './programConfig';

/** `sha256("account:Asset")` first 8 bytes — matches `target/idl/brokex_core.json`. */
const ASSET_DISCRIMINATOR = Buffer.from([234, 180, 241, 252, 139, 224, 160, 8]);

function decodePythFeedFromAssetData(data: Buffer): PublicKey {
  if (data.length < 8 + 4 + 32 + 32) {
    throw new Error('Asset account data too small');
  }
  if (!data.subarray(0, 8).equals(ASSET_DISCRIMINATOR)) {
    throw new Error('Not a brokex Asset account (wrong discriminator)');
  }
  let o = 8;
  const strLen = data.readUInt32LE(o);
  o += 4;
  if (strLen > 64 || data.length < o + strLen + 32) {
    throw new Error('Invalid Asset account string length');
  }
  o += strLen;
  return new PublicKey(data.subarray(o, o + 32));
}

export async function fetchOnChainAssetPythFeed(
  connection: Connection,
  assetId: string,
): Promise<PublicKey | null> {
  const pda = deriveAssetPda(assetId);
  const info = await connection.getAccountInfo(pda, 'confirmed');
  if (!info?.data) return null;
  return decodePythFeedFromAssetData(Buffer.from(info.data));
}

export type PythFeedAlignment =
  | { ok: true }
  | {
      ok: false;
      assetId: string;
      onChain: PublicKey;
      expected: PublicKey;
      detail: string;
    };

function baseSymbolFromArg(assetSymbol: string): string {
  const t = assetSymbol.trim();
  if (t.includes('/')) return t.split('/')[0]!.trim();
  return t;
}

/**
 * Ensures the chain's stored Pyth feed id for this market matches the app's `PYTH_FEED_ID_HEX`
 * (Hermes pull uses the latter). Mismatch → trades will fail with `FeedIdMismatch`.
 */
export async function validateAssetPythFeedAlignment(
  connection: Connection,
  assetSymbol: string,
): Promise<PythFeedAlignment> {
  const base = baseSymbolFromArg(assetSymbol);
  const pairId = `${base.toUpperCase()}/USD`;
  const expected = getExpectedPythFeedAsPubkey(base);

  let onChain: PublicKey | null;
  try {
    onChain = await fetchOnChainAssetPythFeed(connection, pairId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      assetId: pairId,
      onChain: PublicKey.default,
      expected,
      detail: `Could not read asset account for ${pairId}: ${msg}`,
    };
  }

  if (!onChain) {
    return {
      ok: false,
      assetId: pairId,
      onChain: PublicKey.default,
      expected,
      detail: `No asset account on-chain for ${pairId}. Bootstrap add_asset first.`,
    };
  }

  if (!onChain.equals(expected)) {
    return {
      ok: false,
      assetId: pairId,
      onChain,
      expected,
      detail:
        `On-chain pyth_feed for ${pairId} is ${onChain.toBase58()} but this app expects ${expected.toBase58()} (Hermes feed bytes). ` +
        `Sync feeds with admin bootstrap (scripts/bootstrap-devnet.cjs) or update_asset_pyth_feed on-chain.`,
    };
  }

  return { ok: true };
}
