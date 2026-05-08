import bs58 from 'bs58';
import { Connection, PublicKey } from '@solana/web3.js';
import { deriveConfigPda, derivePositionPda } from './pdas';
import { getRpcEndpoint, PYTH_FEED_ID_HEX, SOLANA_PROGRAM_IDS } from './programConfig';
import { readNextPositionIdFromConfig } from './trading';

/** Anchor `account:Position` discriminator (brokex_core idl). */
const POSITION_DISCRIMINATOR = Buffer.from([170, 188, 143, 228, 122, 64, 247, 208]);

/** `PositionState` enum order in program (`brokex-core` state.rs). */
const POSITION_STATE_OPEN = 0;
const POSITION_STATE_CLOSED = 1;
const POSITION_STATE_LIQUIDATED = 2;
const POSITION_STATE_EMERGENCY_CLOSED = 3;
const POSITION_STATE_PENDING = 4;
const POSITION_STATE_CANCELED = 5;

const TERMINAL_STATES = new Set<number>([
  POSITION_STATE_CLOSED,
  POSITION_STATE_LIQUIDATED,
  POSITION_STATE_EMERGENCY_CLOSED,
  POSITION_STATE_CANCELED,
]);

export type DecodedPosition = {
  trade_id: bigint;
  trader: PublicKey;
  asset_id: string;
  direction: number;
  collateral: bigint;
  leverage: number;
  size: bigint;
  entry_price: bigint;
  lp_locked_capital: bigint;
  state: number;
  order_type: number;
  target_price: bigint;
  execution_status: number;
  sl_price: bigint;
  tp_price: bigint;
  liquidation_price: bigint;
  open_time: bigint;
  close_time: bigint;
  close_price: bigint;
  bump: number;
};

function decodePositionAccount(data: Buffer): DecodedPosition | null {
  if (data.length < 120 || !POSITION_DISCRIMINATOR.equals(data.subarray(0, 8))) return null;
  let o = 8;
  const trade_id = data.readBigUInt64LE(o);
  o += 8;
  const trader = new PublicKey(data.subarray(o, o + 32));
  o += 32;
  const strLen = data.readUInt32LE(o);
  o += 4;
  if (strLen < 0 || o + strLen > data.length) return null;
  const asset_id = data.subarray(o, o + strLen).toString('utf8');
  o += strLen;
  const direction = data.readUInt8(o);
  o += 1;
  const collateral = data.readBigUInt64LE(o);
  o += 8;
  const leverage = data.readUInt8(o);
  o += 1;
  const size = data.readBigUInt64LE(o);
  o += 8;
  const entry_price = data.readBigUInt64LE(o);
  o += 8;
  const lp_locked_capital = data.readBigUInt64LE(o);
  o += 8;
  const state = data.readUInt8(o);
  o += 1;
  const order_type = data.readUInt8(o);
  o += 1;
  const target_price = data.readBigUInt64LE(o);
  o += 8;
  const execution_status = data.readUInt8(o);
  o += 1;
  const sl_price = data.readBigUInt64LE(o);
  o += 8;
  const tp_price = data.readBigUInt64LE(o);
  o += 8;
  const liquidation_price = data.readBigUInt64LE(o);
  o += 8;
  const open_time = data.readBigInt64LE(o);
  o += 8;
  const close_time = data.readBigInt64LE(o);
  o += 8;
  const close_price = data.readBigUInt64LE(o);
  o += 8;
  const bump = data.readUInt8(o);
  return {
    trade_id,
    trader,
    asset_id,
    direction,
    collateral,
    leverage,
    size,
    entry_price,
    lp_locked_capital,
    state,
    order_type,
    target_price,
    execution_status,
    sl_price,
    tp_price,
    liquidation_price,
    open_time,
    close_time,
    close_price,
    bump,
  };
}

function baseFromAssetId(assetId: string): string {
  const i = assetId.indexOf('/');
  return i === -1 ? assetId : assetId.slice(0, i);
}

const ORDER_TYPE_LABELS = ['Market', 'Limit', 'Stop'] as const;

/**
 * Shape compatible with `PositionsPanel` + `useOstiumCalculations.getTradeLiveMath` (`trade.raw`).
 */
function mapToPanelTrade(decoded: DecodedPosition, positionKey: PublicKey): Record<string, unknown> {
  const base = baseFromAssetId(decoded.asset_id);
  const priceMicro = decoded.entry_price > 0n ? decoded.entry_price : decoded.target_price;
  const openPrice18 = (priceMicro * 1_000_000_000_000n).toString();
  const levScaled = decoded.leverage * 100;
  const leverageStr = String(levScaled);
  const collateralStr = decoded.collateral.toString();
  const isBuy = decoded.direction === 0;
  const openPriceHuman = Number(priceMicro) / 1e6;
  const notionalUsd = Number(decoded.size) / 1e6;

  const raw = {
    pair: {
      id: `${base}/USD`,
      from: base,
      to: 'USD',
      maxLeverage: '100000000000000000000',
    },
    openPrice: openPrice18,
    isBuy,
    leverage: leverageStr,
    highestLeverage: leverageStr,
    collateral: collateralStr,
    rollover: '0',
    funding: '0',
  };

  return {
    id: positionKey.toBase58(),
    tradeID: decoded.trade_id.toString(),
    isOpen: decoded.state === POSITION_STATE_OPEN,
    leverage: decoded.leverage,
    notional: notionalUsd,
    openPrice: openPriceHuman,
    isBuy,
    collateral: Number(decoded.collateral) / 1e6,
    pair: { id: `${base}/USD`, from: base, to: 'USD' },
    tradeNotional: notionalUsd,
    stopLossPrice: decoded.sl_price > 0n ? Number(decoded.sl_price) / 1e6 : null,
    takeProfitPrice: decoded.tp_price > 0n ? Number(decoded.tp_price) / 1e6 : null,
    timestamp: new Date(Number(decoded.open_time) * 1000),
    raw,
    /** Used to tune UI later (e.g. hide broken Ostium-only flows). */
    source: 'solana-core' as const,
  };
}

function mapToPanelPendingOrder(decoded: DecodedPosition, positionKey: PublicKey): Record<string, unknown> {
  const row = mapToPanelTrade(decoded, positionKey);
  const ot = decoded.order_type;
  return {
    ...row,
    limitType: ORDER_TYPE_LABELS[ot] ?? 'Limit',
    openPrice: decoded.target_price > 0n ? Number(decoded.target_price) / 1e6 : Number(row.openPrice),
  };
}

/** Approximate ROE % on collateral from entry vs exit and integer leverage (matches UI ballpark). */
function approxProfitPercent(decoded: DecodedPosition): number {
  const entry = Number(decoded.entry_price);
  const exit = Number(decoded.close_price);
  const lev = decoded.leverage;
  if (entry <= 0 || exit <= 0 || lev <= 0) return 0;
  const isLong = decoded.direction === 0;
  const delta = isLong ? exit - entry : entry - exit;
  return (delta / entry) * lev * 100;
}

/**
 * Rows for Portfolio / History tab — shape aligned with Ostium `mapOrder` usage in UI.
 */
function mapToPanelHistory(decoded: DecodedPosition, positionKey: PublicKey): Record<string, unknown> {
  const base = baseFromAssetId(decoded.asset_id);
  const isLong = decoded.direction === 0;
  const st = decoded.state;
  let orderAction: string;
  if (st === POSITION_STATE_CLOSED) orderAction = 'Close';
  else if (st === POSITION_STATE_LIQUIDATED) orderAction = 'Liquidation';
  else if (st === POSITION_STATE_EMERGENCY_CLOSED) orderAction = 'Close';
  else if (st === POSITION_STATE_CANCELED) orderAction = 'Canceled';
  else orderAction = 'Unknown';

  const entryMicro = Number(decoded.entry_price);
  const closeMicro = Number(decoded.close_price);
  const priceHuman =
    st === POSITION_STATE_CANCELED
      ? (decoded.target_price > 0n ? Number(decoded.target_price) : entryMicro) / 1e6
      : closeMicro > 0
        ? closeMicro / 1e6
        : entryMicro / 1e6;

  const profitPercent = TERMINAL_STATES.has(st) && st !== POSITION_STATE_CANCELED ? approxProfitPercent(decoded) : 0;

  const sortTs = Number(decoded.close_time || decoded.open_time);

  const createdAt = new Date(sortTs * 1000);

  return {
    id: `${positionKey.toBase58()}-${decoded.trade_id.toString()}`,
    orderAction,
    orderType: ORDER_TYPE_LABELS[decoded.order_type] ?? 'Market',
    isBuy: isLong,
    leverage: decoded.leverage,
    price: priceHuman,
    tp: decoded.tp_price > 0n ? Number(decoded.tp_price) / 1e6 : 0,
    sl: decoded.sl_price > 0n ? Number(decoded.sl_price) / 1e6 : 0,
    profitPercent,
    timestamp: createdAt,
    createdAt,
    pair: { id: `${base}/USD`, from: base, to: 'USD' },
    raw: {
      pair: { id: `${base}/USD`, from: base, to: 'USD' },
    },
    source: 'solana-core' as const,
  };
}

async function fetchByProgramScan(connection: Connection, trader: PublicKey): Promise<{ open: any[]; pending: any[]; history: any[] }> {
  const configPda = deriveConfigPda();
  const cfg = await connection.getAccountInfo(configPda, 'confirmed');
  if (!cfg?.data) return { open: [], pending: [], history: [] };

  const nextId = readNextPositionIdFromConfig(cfg.data);
  const symbols = Object.keys(PYTH_FEED_ID_HEX);
  const open: any[] = [];
  const pending: any[] = [];
  const history: any[] = [];

  const maxProbe = nextId > 512n ? 512n : nextId;
  const keys: { pubkey: PublicKey; tid: bigint; sym: string }[] = [];
  for (let tid = 0n; tid < maxProbe; tid += 1n) {
    for (const sym of symbols) {
      const assetId = `${sym}/USD`;
      keys.push({ pubkey: derivePositionPda(trader, assetId, tid), tid, sym });
    }
  }

  const chunk = 100;
  for (let i = 0; i < keys.length; i += chunk) {
    const slice = keys.slice(i, i + chunk);
    const infos = await connection.getMultipleAccountsInfo(
      slice.map((k) => k.pubkey),
      'confirmed'
    );
    for (let j = 0; j < infos.length; j++) {
      const info = infos[j];
      if (!info?.data || !info.owner.equals(SOLANA_PROGRAM_IDS.core)) continue;
      const dec = decodePositionAccount(info.data);
      if (!dec || !dec.trader.equals(trader)) continue;
      if (dec.state === POSITION_STATE_OPEN) {
        open.push(mapToPanelTrade(dec, slice[j].pubkey));
      } else if (dec.state === POSITION_STATE_PENDING) {
        pending.push(mapToPanelPendingOrder(dec, slice[j].pubkey));
      } else if (TERMINAL_STATES.has(dec.state)) {
        history.push(mapToPanelHistory(dec, slice[j].pubkey));
      }
    }
  }

  history.sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
  return { open, pending, history };
}

/**
 * Loads open, pending, and terminal (history) positions for a trader from brokex-core on Solana.
 * Uses `getProgramAccounts` when the RPC allows it; otherwise falls back to a bounded PDA scan.
 */
export async function fetchSolanaCorePositionsForTrader(trader: PublicKey): Promise<{ open: any[]; pending: any[]; history: any[] }> {
  const connection = new Connection(getRpcEndpoint(), 'confirmed');

  try {
    const accounts = await connection.getProgramAccounts(SOLANA_PROGRAM_IDS.core, {
      commitment: 'confirmed',
      filters: [
        { memcmp: { offset: 0, bytes: bs58.encode(POSITION_DISCRIMINATOR) } },
        { memcmp: { offset: 16, bytes: trader.toBase58() } },
      ],
    });

    const open: any[] = [];
    const pending: any[] = [];
    const history: any[] = [];
    for (const { pubkey, account } of accounts) {
      if (!account.data) continue;
      const dec = decodePositionAccount(account.data);
      if (!dec || !dec.trader.equals(trader)) continue;
      if (dec.state === POSITION_STATE_OPEN) {
        open.push(mapToPanelTrade(dec, pubkey));
      } else if (dec.state === POSITION_STATE_PENDING) {
        pending.push(mapToPanelPendingOrder(dec, pubkey));
      } else if (TERMINAL_STATES.has(dec.state)) {
        history.push(mapToPanelHistory(dec, pubkey));
      }
    }
    history.sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
    return { open, pending, history };
  } catch (e) {
    console.warn('[solanaPositions] getProgramAccounts failed, using PDA scan:', e);
    return fetchByProgramScan(connection, trader);
  }
}
