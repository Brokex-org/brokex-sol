import { PublicKey } from '@solana/web3.js';

export type SolanaCluster = 'devnet' | 'testnet' | 'mainnet';

const DEFAULT_RPC = 'https://api.devnet.solana.com';
const DEFAULT_CORE_PROGRAM_ID = '2D2SpgCJqZquV5DD1jrXWL6cmuqoxFgsNjihkt9BUdNB';
const DEFAULT_VAULT_PROGRAM_ID = '6bo6uqoj77cHBMYg9FCbKYGc3iUzNW62RLK7Xmzqawk8';
const DEFAULT_USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

function readEnv(key: string, fallback: string): string {
  const value = import.meta.env[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function sanitizeKey(value: string): string {
  const trimmed = value.trim();
  // Handle accidentally quoted values in .env files.
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function normalizeBase58Candidate(value: string): string {
  // Drop invisible/non-base58 characters that can come from copy/paste.
  return sanitizeKey(value).replace(/[^1-9A-HJ-NP-Za-km-z]/g, '');
}

function safePublicKey(envKey: string, fallback: string): PublicKey {
  const raw = normalizeBase58Candidate(readEnv(envKey, fallback));
  try {
    return new PublicKey(raw);
  } catch (error) {
    console.warn(`[programConfig] Invalid ${envKey}, falling back to default`, error);
    try {
      return new PublicKey(normalizeBase58Candidate(fallback));
    } catch (fallbackError) {
      console.warn(`[programConfig] Invalid fallback for ${envKey}, using SystemProgram id`, fallbackError);
      return PublicKey.default;
    }
  }
}

export function getRpcEndpoint(): string {
  return readEnv('VITE_RPC_URL', DEFAULT_RPC);
}

export function getClusterFromEndpoint(endpoint: string): SolanaCluster {
  const lower = endpoint.toLowerCase();
  if (lower.includes('mainnet')) return 'mainnet';
  if (lower.includes('testnet')) return 'testnet';
  return 'devnet';
}

/** https://explorer.solana.com — mainnet omits `cluster`; others pass `?cluster=…`. */
export function solanaTxExplorerUrl(signature: string, cluster: SolanaCluster): string {
  const base = `https://explorer.solana.com/tx/${signature}`;
  if (cluster === 'mainnet') return base;
  return `${base}?cluster=${cluster}`;
}

export const SOLANA_PROGRAM_IDS = {
  core: safePublicKey('VITE_CORE_PROGRAM_ID', DEFAULT_CORE_PROGRAM_ID),
  vault: safePublicKey('VITE_VAULT_PROGRAM_ID', DEFAULT_VAULT_PROGRAM_ID),
} as const;

export const SOLANA_USDC_MINT = safePublicKey('VITE_USDC_MINT', DEFAULT_USDC_MINT);

/**
 * Pyth price feed IDs as 64-char hex (no 0x). Must match `add_asset` on-chain (`scripts/bootstrap-devnet.cjs`).
 * Pull oracle txs fetch fresh updates from Hermes and post to ephemeral PriceUpdateV2 accounts; these ids address Hermes, not static pubkeys.
 */
/** Hex ids must match Hermes `Crypto.*` / `FX.*` / `Metal.*` feeds (see https://hermes.pyth.network/v2/price_feeds). */
export const PYTH_FEED_ID_HEX: Record<string, string> = {
  BTC: 'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
  ETH: 'ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
  SOL: 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
  EUR: 'a995d00bb36a63cef7fd2c287dc105fc8f3d93779f062f09551b0af3e81ec30b',
  XAU: '765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2',
};

export function getExpectedPythFeedAsPubkey(assetSymbol: string): PublicKey {
  const hex = PYTH_FEED_ID_HEX[assetSymbol.toUpperCase()] ?? PYTH_FEED_ID_HEX.SOL;
  return new PublicKey(Buffer.from(hex.replace(/^0x/i, ''), 'hex'));
}

export function getPythFeedId0x(assetSymbol: string): string {
  const hex = PYTH_FEED_ID_HEX[assetSymbol.toUpperCase()] ?? PYTH_FEED_ID_HEX.SOL;
  return `0x${hex}`;
}

export function getHermesHttpBase(): string {
  return readEnv('VITE_HERMES_URL', 'https://hermes.pyth.network').replace(/\/$/, '');
}

/** Optional: static PriceUpdateV2 pubkeys for UIs/tests only; trading uses Hermes + Pyth receiver. */
export const PYTH_FEEDS = {
  SOL_USD: safePublicKey('VITE_PYTH_SOL_USD', 'H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG'),
  BTC_USD: safePublicKey('VITE_PYTH_BTC_USD', 'GVXRSBjFk6e909Wjy64QnbB1W3ToS4RCgbkqXEbBKVGA'),
  ETH_USD: safePublicKey('VITE_PYTH_ETH_USD', 'EdVCmQ9FSPcVe5YySXDPCRmc8aDQLKJ9xvYBMZPie1Vw'),
  EUR_USD: safePublicKey('VITE_PYTH_EUR_USD', '42amVS4KgzR9rA28tkVYqVXjq9Qa8dcZQMbH5EYFX6XC'),
  XAU_USD: safePublicKey('VITE_PYTH_XAU_USD', 'AtRCZhwikbMsDAEYgwHFuBzGQuRQUMAfYomMaKnkEGRS'),
} as const;
