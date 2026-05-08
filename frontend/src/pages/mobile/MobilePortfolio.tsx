import { useState, useEffect, useMemo, type CSSProperties } from 'react';
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import { useTheme } from '../../ThemeContext';
import { useDynamicContext } from '@dynamic-labs/sdk-react-core';
import { useOstiumSubgraph } from '../../hooks/useOstiumSubgraph';
import { useOstiumCalculations } from '../../hooks/useOstiumCalculations';
import { usePriceContext } from '../../contexts/PriceContext';
import { getChainConfig, OSTIUM_ABI } from '../../utils/ostium/abi';
import { parseUnits, createWalletClient, custom, createPublicClient, http } from 'viem';
import { useToast } from '../../contexts/ToastContext';
import { EditTradeModal } from '../../components/EditTradeModal';
import { EditLimitModal } from '../../components/EditLimitModal';
import {
  buildCancelOrderIx,
  buildClosePositionIx,
  buildCreateCoreCollateralAtaIxIfNeeded,
} from '../../utils/solana/trading';
import { getPythFeedId0x, getRpcEndpoint, solanaTxExplorerUrl } from '../../utils/solana/programConfig';
import { useNetwork } from '../../contexts/NetworkContext';
import { ix, sendHermesPythThenConsumeLegacy } from '../../utils/solana/pythTradeTx';
import { validateAssetPythFeedAlignment } from '../../utils/solana/assetPythAlignment';
import { fetchSolanaCorePositionsForTrader } from '../../utils/solana/solanaPositions';

const goldAccent = '#BC8961';
const goldAccentLight = 'rgba(188, 137, 97, 0.12)';

// ── PnL Badge ────────────────────────────────────────────────────────────────
const PnlBadge = ({ value, color }: { value: string; color: string }) => (
  <span
    style={{
      backgroundColor: color + '22',
      color,
      padding: '3px 8px',
      borderRadius: '6px',
      fontSize: '0.72rem',
      fontWeight: 700,
      fontFamily: 'var(--mono)',
    }}
  >
    {value}
  </span>
);

export function MobilePortfolio() {
  const {
    themeBg,
    themeControlBg,
    themeBorder,
    themeText,
    themeTextMuted,
    buyColor,
    buyColorBg,
    sellColor,
    sellColorBg,
  } = useTheme();
  const { primaryWallet, setShowAuthFlow, network } = useDynamicContext();
  const evmAddress = primaryWallet?.address;
  const [phantomAddress, setPhantomAddress] = useState<string | undefined>(undefined);

  useEffect(() => {
    const provider = (window as unknown as {
      solana?: {
        isPhantom?: boolean;
        publicKey?: { toBase58: () => string };
        on?: (e: string, fn: () => void) => void;
        removeListener?: (e: string, fn: () => void) => void;
      };
    }).solana;
    if (!provider?.isPhantom) return;
    const sync = () => setPhantomAddress(provider.publicKey ? provider.publicKey.toBase58() : undefined);
    const onDisconnect = () => setPhantomAddress(undefined);
    sync();
    provider.on?.('connect', sync);
    provider.on?.('disconnect', onDisconnect);
    provider.on?.('accountChanged', sync);
    return () => {
      provider.removeListener?.('connect', sync);
      provider.removeListener?.('disconnect', onDisconnect);
      provider.removeListener?.('accountChanged', sync);
    };
  }, []);

  const portfolioViewerAddress = phantomAddress || evmAddress;
  const isSolanaViewer =
    Boolean(portfolioViewerAddress) && !/^0x[a-fA-F0-9]{40}$/.test(portfolioViewerAddress!);

  const { getOpenTrades, getOrders, getRecentHistory, getPairs } = useOstiumSubgraph();
  const { getTradeLiveMath } = useOstiumCalculations();
  const { addToast } = useToast();
  const { prices } = usePriceContext();
  const { cluster: solanaCluster } = useNetwork();

  // ── State ──────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<'Trades' | 'Orders' | 'History'>('Trades');
  const [openTrades, setOpenTrades] = useState<any[]>([]);
  const [pendingOrders, setPendingOrders] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [pairsList, setPairsList] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTradeModal, setActiveTradeModal] = useState<any>(null);
  const [activeLimitModal, setActiveLimitModal] = useState<any>(null);
  const [expandedTrade, setExpandedTrade] = useState<string | null>(null);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const getBaseAsset = (item: any) => {
    if (item.pair?.from) return item.pair.from;
    if (item.raw?.pair?.from) return item.raw.pair.from;
    const p = pairsList.find((x) => x.id === (item.pair?.id || item.pairId?.toString()));
    return p?.from || '';
  };
  const getSymbol = (item: any) => {
    const from = getBaseAsset(item);
    if (from) {
      const to = item.pair?.to || pairsList.find((x) => x.from === from)?.to || 'USD';
      return `${from}/${to}`;
    }
    return `Pair #${item.pair?.id || item.pairId || '?'}`;
  };
  const formatDate = (ts: any) => {
    if (!ts) return '—';
    const d = new Date(ts);
    return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  // ── Fetch ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!portfolioViewerAddress) {
      setOpenTrades([]); setPendingOrders([]); setHistory([]); setPairsList([]);
      setIsLoading(false);
      return;
    }
    let mounted = true;
    const fetchAll = async (bg = false) => {
      if (!bg) setIsLoading(true);
      try {
        if (isSolanaViewer) {
          const traderPk = new PublicKey(portfolioViewerAddress);
          const [sol, pList] = await Promise.all([
            fetchSolanaCorePositionsForTrader(traderPk),
            getPairs(),
          ]);
          if (mounted) {
            setOpenTrades(sol.open || []);
            setPendingOrders(sol.pending || []);
            setHistory(sol.history || []);
            setPairsList(pList || []);
          }
        } else {
          const [trades, orders, hist, pList] = await Promise.all([
            getOpenTrades(portfolioViewerAddress),
            getOrders(portfolioViewerAddress),
            getRecentHistory(portfolioViewerAddress, 50),
            getPairs(),
          ]);
          if (mounted) {
            setOpenTrades(trades || []);
            setPendingOrders(orders || []);
            setHistory(hist || []);
            setPairsList(pList || []);
          }
        }
      } catch (e) { console.error(e); }
      finally { if (mounted && !bg) setIsLoading(false); }
    };
    fetchAll(false);
    const iv = setInterval(() => fetchAll(true), 10000);
    return () => { mounted = false; clearInterval(iv); };
  }, [portfolioViewerAddress, isSolanaViewer, getOpenTrades, getOrders, getRecentHistory, getPairs]);

  // ── Execute ────────────────────────────────────────────────────────────────
  const executeAction = async (actionType: string, params: any, itemData: any) => {
    try {
      if (itemData.source === 'solana-core') {
        const provider = (window as unknown as {
          solana?: {
            isPhantom?: boolean;
            publicKey?: { toBase58: () => string };
            connect?: () => Promise<unknown>;
            signTransaction: <T extends Transaction>(tx: T) => Promise<T>;
            signAllTransactions?: <T extends Transaction>(txs: T[]) => Promise<T[]>;
          };
        }).solana;
        if (!provider?.isPhantom) throw new Error('Phantom wallet not found');
        if (!provider.publicKey) await provider.connect?.();
        const trader = new PublicKey(provider.publicKey!.toBase58());
        const baseAsset = getBaseAsset(itemData) || 'SOL';
        const tradeId = BigInt(String(itemData.tradeID ?? itemData.tradeId ?? itemData.id));
        let txHash = '';
        let actionName = '';

        if (actionType === 'CLOSE') {
          actionName = 'Close Position';
          const connection = new Connection(getRpcEndpoint(), 'confirmed');
          const align = await validateAssetPythFeedAlignment(connection, baseAsset);
          if (!align.ok) throw new Error(align.detail);
          const feedId = getPythFeedId0x(baseAsset);
          const maybeCollateralAtaIx = await buildCreateCoreCollateralAtaIxIfNeeded(trader);
          const sigs = await sendHermesPythThenConsumeLegacy({
            connection,
            trader,
            phantom: provider as any,
            pythFeedId0x: feedId,
            buildConsumerInstructions: async (getPriceUpdateAccount) => {
              const pythPk = getPriceUpdateAccount(feedId);
              const { instruction } = await buildClosePositionIx({
                trader,
                assetSymbol: baseAsset,
                tradeId,
                pythPriceUpdate: pythPk,
              });
              const prep = maybeCollateralAtaIx ? [ix(maybeCollateralAtaIx)] : [];
              return [...prep, ix(instruction)];
            },
          });
          txHash = sigs[sigs.length - 1];
        } else if (actionType === 'CANCEL_LIMIT') {
          actionName = 'Cancel Order';
          const maybeCollateralAtaIx = await buildCreateCoreCollateralAtaIxIfNeeded(trader);
          const { connection, instruction } = await buildCancelOrderIx({
            trader,
            assetSymbol: baseAsset,
            tradeId,
          });
          const latest = await connection.getLatestBlockhash('confirmed');
          const tx = new Transaction({
            feePayer: trader,
            blockhash: latest.blockhash,
            lastValidBlockHeight: latest.lastValidBlockHeight,
          });
          if (maybeCollateralAtaIx) tx.add(maybeCollateralAtaIx);
          tx.add(instruction);
          const signed = await provider.signTransaction(tx);
          txHash = await connection.sendRawTransaction(signed.serialize(), {
            skipPreflight: false,
            preflightCommitment: 'confirmed',
          });
          await connection.confirmTransaction(
            { signature: txHash, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
            'confirmed'
          );
        } else {
          throw new Error(`Action ${actionType} is not available on Solana yet`);
        }

        addToast({
          type: 'success',
          title: actionName,
          pair: getSymbol(itemData),
          side: itemData.isBuy ? 'buy' : 'sell',
          txHash,
          message: (
            <a
              href={solanaTxExplorerUrl(txHash, solanaCluster)}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-block',
                marginTop: '6px',
                padding: '5px 10px',
                backgroundColor: '#3b82f6',
                color: '#fff',
                borderRadius: '4px',
                textDecoration: 'none',
                fontSize: '0.75rem',
              }}
            >
              View →
            </a>
          ),
        });
        setActiveTradeModal(null);
        setActiveLimitModal(null);
        return;
      }

      const eth = (window as any).ethereum;
      if (!eth) throw new Error('No wallet');
      if (!evmAddress) throw new Error('Connect an EVM wallet for this action');
      const walletClient = createWalletClient({ account: evmAddress as `0x${string}`, transport: custom(eth) });
      const chainIdNum = Number(network as unknown as string) || 421614;
      const cfg = getChainConfig(chainIdNum);
      if (!cfg?.tradingAddress) throw new Error('Chain not configured');
      const pairIndex = Number(itemData.pairId ?? itemData.pair?.id ?? 0);
      const index = Number(itemData.index ?? itemData.orderId ?? itemData.limitID ?? 0);
      const publicClient = createPublicClient({ chain: cfg.chain, transport: http() });
      const feeData = await publicClient.estimateFeesPerGas();
      const gas = feeData.maxFeePerGas
        ? { maxFeePerGas: (feeData.maxFeePerGas * 150n) / 100n, maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ? (feeData.maxPriorityFeePerGas * 150n) / 100n : undefined }
        : {};

      let txHash = ''; let actionName = '';

      if (actionType === 'CLOSE') {
        actionName = 'Close Position';
        let cp = Math.floor(Number(params.percent) * 100);
        if (Number(params.percent) === 100 || Number(params.percent) === 0) cp = 0;
        const base = getBaseAsset(itemData);
        let mktPrice = 0n;
        if (base && prices[base]) mktPrice = parseUnits(itemData.isBuy ? prices[base].bid.toFixed(4) : prices[base].ask.toFixed(4), 18);
        txHash = await walletClient.writeContract({ address: cfg.tradingAddress as `0x${string}`, abi: OSTIUM_ABI, functionName: 'closeTradeMarket', args: [pairIndex, index, BigInt(cp), mktPrice, 100n] as any, account: evmAddress as `0x${string}`, chain: cfg.chain as any, ...gas });
      } else if (actionType === 'CANCEL_LIMIT') {
        actionName = 'Cancel Order';
        txHash = await walletClient.writeContract({ address: cfg.tradingAddress as `0x${string}`, abi: OSTIUM_ABI, functionName: 'cancelOpenLimitOrder', args: [pairIndex, index], account: evmAddress as `0x${string}`, chain: cfg.chain as any, ...gas });
      }

      const evmExplorerBase = cfg.chain.blockExplorers?.default?.url;
      const txLinkStyle: CSSProperties = {
        display: 'inline-block',
        marginTop: '6px',
        padding: '5px 10px',
        backgroundColor: '#3b82f6',
        color: '#fff',
        borderRadius: '4px',
        textDecoration: 'none',
        fontSize: '0.75rem',
      };
      addToast({
        type: 'success',
        title: actionName,
        pair: getSymbol(itemData),
        side: itemData.isBuy ? 'buy' : 'sell',
        txHash,
        message: evmExplorerBase ? (
          <a href={`${evmExplorerBase}/tx/${txHash}`} target="_blank" rel="noopener noreferrer" style={txLinkStyle}>
            View →
          </a>
        ) : (
          <span className="font-mono" style={{ fontSize: '0.75rem', color: themeTextMuted, marginTop: '6px', display: 'inline-block' }}>
            {txHash}
          </span>
        ),
      });
      setActiveTradeModal(null); setActiveLimitModal(null);
    } catch (e: any) {
      addToast({ type: 'error', title: 'Failed', message: e.message?.substring(0, 100) });
    }
  };

  // ── Grouped trades ─────────────────────────────────────────────────────────
  const enrichedTrades = useMemo(() =>
    openTrades.map((t) => {
      const math = getTradeLiveMath(t);
      const sym = getSymbol(t);
      const levNum =
        t.source === 'solana-core' ? Number(t.leverage || 0) : Number(t.leverage || 0) / 100;
      const entryNum = Number(t.openPrice || 0);
      let liqPrice: string | null = null;
      if (entryNum > 0 && levNum >= 1) {
        const liq = t.isBuy ? entryNum * (1 - 0.95 / levNum) : entryNum * (1 + 0.95 / levNum);
        liqPrice = liq > 0 ? liq.toFixed(2) : null;
      }
      return { ...t, math, sym, levNum, entryNum, liqPrice };
    }),
    [openTrades, getTradeLiveMath, pairsList]
  );

  // ── Total PnL ──────────────────────────────────────────────────────────────
  const totalPnl = useMemo(() =>
    enrichedTrades.reduce((acc, t) => {
      const v = parseFloat(t.math.pnl.replace(/[^0-9.-]/g, '')) || 0;
      return acc + (t.math.pnl.startsWith('-') ? -Math.abs(v) : Math.abs(v));
    }, 0),
    [enrichedTrades]
  );
  const totalMargin = useMemo(() =>
    enrichedTrades.reduce((acc, t) => acc + Number(t.collateral || 0), 0),
    [enrichedTrades]
  );
  const totalPnlColor = totalPnl >= 0 ? buyColor : sellColor;
  const totalPnlStr = `${totalPnl >= 0 ? '+' : ''}$${Math.abs(totalPnl).toFixed(2)}`;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: themeBg, overflow: 'hidden' }}>
      <style>{`
        .mob-port-hide::-webkit-scrollbar { display: none; }
        .mob-port-hide { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>

      {/* ── Summary card ─────────────────────────────────────────────────── */}
      {portfolioViewerAddress && !isLoading && (
        <div
          style={{
            margin: '1rem 1rem 0 1rem',
            backgroundColor: themeControlBg,
            border: `1px solid ${themeBorder}`,
            borderRadius: '14px',
            padding: '1rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <div style={{ fontSize: '0.62rem', color: themeTextMuted, marginBottom: '0.3rem' }}>
              Total Margin
            </div>
            <div
              style={{
                fontSize: '1.1rem',
                fontWeight: 700,
                color: themeText,
                fontFamily: 'var(--mono)',
              }}
            >
              ${totalMargin.toFixed(2)}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '0.62rem', color: themeTextMuted, marginBottom: '0.3rem' }}>
              Unrealized P&L
            </div>
            <div
              style={{
                fontSize: '1.2rem',
                fontWeight: 700,
                color: totalPnlColor,
                fontFamily: 'var(--mono)',
              }}
            >
              {totalPnlStr}
            </div>
          </div>
        </div>
      )}

      {/* ── Tab Bar ──────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          margin: '0.75rem 1rem 0 1rem',
          backgroundColor: themeControlBg,
          border: `1px solid ${themeBorder}`,
          borderRadius: '10px',
          padding: '3px',
          flexShrink: 0,
        }}
      >
        {([
          { key: 'Trades', label: 'Positions', count: openTrades.length },
          { key: 'Orders', label: 'Orders', count: pendingOrders.length },
          { key: 'History', label: 'History', count: history.length },
        ] as const).map(({ key, label, count }) => {
          const active = activeTab === key;
          return (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              style={{
                flex: 1,
                padding: '0.5rem',
                borderRadius: '8px',
                border: `1px solid ${active ? goldAccent : 'transparent'}`,
                background: active ? goldAccentLight : 'transparent',
                color: active ? goldAccent : themeTextMuted,
                cursor: 'pointer',
                fontSize: '0.72rem',
                fontWeight: active ? 700 : 400,
                transition: 'all 0.15s',
              }}
            >
              {label}
              {count > 0 && (
                <span style={{ marginLeft: '4px', fontSize: '0.6rem', opacity: 0.7 }}>({count})</span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Content ──────────────────────────────────────────────────────── */}
      <div
        className="mob-port-hide"
        style={{ flex: 1, overflowY: 'auto', padding: '0.75rem 1rem', minHeight: 0 }}
      >
        {/* Not connected */}
        {!portfolioViewerAddress && (
          <div
            style={{
              paddingTop: '3rem',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '1rem',
            }}
          >
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke={themeTextMuted}
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4" />
              <path d="M4 6v12c0 1.1.9 2 2 2h14v-4" />
              <path d="M18 12a2 2 0 0 0-2 2c0 1.1.9 2 2 2h4v-4h-4z" />
            </svg>
            <p style={{ margin: 0, color: themeTextMuted, fontSize: '0.85rem', textAlign: 'center' }}>
              Connect Phantom (header) or an EVM wallet to view your portfolio.
            </p>
            <button
              type="button"
              onClick={async () => {
                const p = (window as unknown as { solana?: { isPhantom?: boolean; connect?: () => Promise<unknown> } })
                  .solana;
                if (p?.isPhantom) {
                  try {
                    await p.connect?.();
                  } catch (e) {
                    console.error(e);
                  }
                } else {
                  setShowAuthFlow(true);
                }
              }}
              style={{
                padding: '0.7rem 1.5rem',
                borderRadius: '10px',
                border: 'none',
                background: `linear-gradient(135deg, ${goldAccent}, #d4a96b)`,
                color: '#000',
                fontWeight: 700,
                fontSize: '0.85rem',
                cursor: 'pointer',
              }}
            >
              Connect Phantom or EVM
            </button>
          </div>
        )}

        {/* Loading */}
        {portfolioViewerAddress && isLoading && (
          <div
            style={{ padding: '3rem', textAlign: 'center', color: themeTextMuted, fontSize: '0.8rem' }}
          >
            Loading…
          </div>
        )}

        {/* ── TRADES TAB ──────────────────────────────────────────────── */}
        {portfolioViewerAddress && !isLoading && activeTab === 'Trades' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
            {enrichedTrades.length === 0 ? (
              <div
                style={{
                  padding: '3rem',
                  textAlign: 'center',
                  color: themeTextMuted,
                  fontSize: '0.8rem',
                }}
              >
                No open positions.
              </div>
            ) : (
              enrichedTrades.map((trade) => {
                const math = trade.math;
                const pnlVal = parseFloat(math.pnl.replace(/[^0-9.-]/g, '')) || 0;
                const tradePnl = math.pnl.startsWith('-') ? -Math.abs(pnlVal) : Math.abs(pnlVal);
                const pColor = tradePnl >= 0 ? buyColor : sellColor;
                const sideColor = trade.isBuy ? buyColor : sellColor;
                const sideBg = trade.isBuy ? buyColorBg : sellColorBg;
                const tradeKey = trade.tradeID || trade.id;
                const expanded = expandedTrade === tradeKey;

                return (
                  <div
                    key={tradeKey}
                    style={{
                      backgroundColor: themeControlBg,
                      border: `1px solid ${themeBorder}`,
                      borderRadius: '12px',
                      overflow: 'hidden',
                    }}
                  >
                    {/* Card header */}
                    <div
                      onClick={() => setExpandedTrade(expanded ? null : tradeKey)}
                      style={{
                        padding: '0.85rem 1rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <div
                          style={{
                            width: '30px',
                            height: '30px',
                            borderRadius: '50%',
                            background: `linear-gradient(135deg, ${themeBorder}, ${themeBg})`,
                            border: `1px solid ${themeBorder}`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '0.72rem',
                            fontWeight: 700,
                            color: themeText,
                          }}
                        >
                          {trade.sym.charAt(0)}
                        </div>
                        <div>
                          <div style={{ fontSize: '0.82rem', fontWeight: 700, color: themeText }}>
                            {trade.sym}
                          </div>
                          <span
                            style={{
                              backgroundColor: sideBg,
                              color: sideColor,
                              padding: '1px 6px',
                              borderRadius: '4px',
                              fontSize: '0.58rem',
                              fontWeight: 700,
                            }}
                          >
                            {trade.isBuy ? 'LONG' : 'SHORT'} {trade.levNum.toFixed(1)}×
                          </span>
                        </div>
                      </div>

                      <div style={{ textAlign: 'right' }}>
                        <PnlBadge value={math.pnl} color={pColor} />
                        <div style={{ fontSize: '0.55rem', color: themeTextMuted, marginTop: '3px' }}>
                          {expanded ? '▲ Less' : '▼ More'}
                        </div>
                      </div>
                    </div>

                    {/* Expanded details */}
                    {expanded && (
                      <div
                        style={{
                          borderTop: `1px solid ${themeBorder}`,
                          padding: '0.85rem 1rem',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.6rem',
                        }}
                      >
                        {[
                          { label: 'Entry', value: `$${trade.entryNum.toFixed(2)}` },
                          { label: 'Mark', value: math.markPrice },
                          { label: 'Liq.', value: trade.liqPrice ? `$${trade.liqPrice}` : '—', color: sellColor },
                          { label: 'Margin', value: `$${Number(trade.collateral || 0).toFixed(2)}` },
                          { label: 'SL', value: trade.stopLossPrice ? `$${Number(trade.stopLossPrice).toFixed(2)}` : '—', color: sellColor },
                          { label: 'TP', value: trade.takeProfitPrice ? `$${Number(trade.takeProfitPrice).toFixed(2)}` : '—', color: buyColor },
                        ].map(({ label, value, color }) => (
                          <div
                            key={label}
                            style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem' }}
                          >
                            <span style={{ color: themeTextMuted }}>{label}</span>
                            <span style={{ color: color || themeText, fontWeight: 600, fontFamily: 'var(--mono)' }}>{value}</span>
                          </div>
                        ))}

                        {/* Actions */}
                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.4rem' }}>
                          <button
                            onClick={() => setActiveTradeModal(trade)}
                            style={{
                              flex: 1,
                              padding: '0.5rem',
                              borderRadius: '8px',
                              border: `1px solid ${themeBorder}`,
                              background: themeControlBg,
                              color: themeText,
                              cursor: 'pointer',
                              fontSize: '0.72rem',
                              fontWeight: 600,
                            }}
                          >
                            Edit SL/TP
                          </button>
                          <button
                            onClick={() => executeAction('CLOSE', { percent: 100 }, trade)}
                            style={{
                              flex: 1,
                              padding: '0.5rem',
                              borderRadius: '8px',
                              border: `1px solid ${sellColor}`,
                              background: 'transparent',
                              color: sellColor,
                              cursor: 'pointer',
                              fontSize: '0.72rem',
                              fontWeight: 700,
                            }}
                          >
                            Close
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* ── ORDERS TAB ──────────────────────────────────────────────── */}
        {portfolioViewerAddress && !isLoading && activeTab === 'Orders' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
            {pendingOrders.length === 0 ? (
              <div
                style={{ padding: '3rem', textAlign: 'center', color: themeTextMuted, fontSize: '0.8rem' }}
              >
                {isSolanaViewer
                  ? 'No open limit or stop orders. Market positions are under Trades.'
                  : 'No pending orders.'}
              </div>
            ) : (
              pendingOrders.map((order: any) => {
                const sym = getSymbol(order);
                const sideColor = order.isBuy ? buyColor : sellColor;
                const sideBg = order.isBuy ? buyColorBg : sellColorBg;
                const mktPrice = prices[getBaseAsset(order)]?.mid?.toFixed(4) || '—';
                return (
                  <div
                    key={order.id}
                    style={{
                      backgroundColor: themeControlBg,
                      border: `1px solid ${themeBorder}`,
                      borderRadius: '12px',
                      padding: '0.85rem 1rem',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
                      <div>
                        <div style={{ fontSize: '0.82rem', fontWeight: 700, color: themeText }}>
                          {sym}
                        </div>
                        <span
                          style={{
                            backgroundColor: sideBg,
                            color: sideColor,
                            padding: '1px 6px',
                            borderRadius: '4px',
                            fontSize: '0.6rem',
                            fontWeight: 700,
                            textTransform: 'capitalize',
                          }}
                        >
                          {order.limitType} {order.isBuy ? 'Long' : 'Short'}
                        </span>
                      </div>
                      <div style={{ textAlign: 'right', fontSize: '0.7rem' }}>
                        <div style={{ color: themeTextMuted, marginBottom: '2px' }}>Leverage</div>
                        <div style={{ color: goldAccent, fontWeight: 700, fontFamily: 'var(--mono)' }}>
                          {(
                            order.source === 'solana-core'
                              ? Number(order.leverage || 0)
                              : Number(order.leverage || 0) / 100
                          ).toFixed(1)}
                          ×
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '0.6rem' }}>
                      {[
                        { label: 'Target Price', value: `$${Number(order.openPrice).toFixed(4)}` },
                        { label: 'Market Price', value: `$${mktPrice}` },
                        { label: 'Margin', value: `$${Number(order.collateral).toFixed(2)}` },
                        { label: 'TP', value: order.takeProfitPrice ? `$${Number(order.takeProfitPrice).toFixed(4)}` : '—', color: buyColor },
                        { label: 'SL', value: order.stopLossPrice ? `$${Number(order.stopLossPrice).toFixed(4)}` : '—', color: sellColor },
                      ].map(({ label, value, color }) => (
                        <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem' }}>
                          <span style={{ color: themeTextMuted }}>{label}</span>
                          <span style={{ color: color || themeText, fontWeight: 600, fontFamily: 'var(--mono)' }}>{value}</span>
                        </div>
                      ))}
                    </div>

                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        onClick={() => setActiveLimitModal(order)}
                        style={{
                          flex: 1,
                          padding: '0.5rem',
                          borderRadius: '8px',
                          border: `1px solid ${themeBorder}`,
                          background: themeControlBg,
                          color: themeText,
                          cursor: 'pointer',
                          fontSize: '0.72rem',
                          fontWeight: 600,
                        }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => executeAction('CANCEL_LIMIT', {}, order)}
                        style={{
                          flex: 1,
                          padding: '0.5rem',
                          borderRadius: '8px',
                          border: `1px solid ${sellColor}`,
                          background: 'transparent',
                          color: sellColor,
                          cursor: 'pointer',
                          fontSize: '0.72rem',
                          fontWeight: 700,
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* ── HISTORY TAB ─────────────────────────────────────────────── */}
        {portfolioViewerAddress && !isLoading && activeTab === 'History' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
            {history.length === 0 ? (
              <div
                style={{ padding: '3rem', textAlign: 'center', color: themeTextMuted, fontSize: '0.8rem' }}
              >
                {isSolanaViewer
                  ? 'No on-chain history yet (closed, liquidated, or canceled positions).'
                  : 'No history.'}
              </div>
            ) : (
              history.map((h: any) => {
                const sym = getSymbol(h);
                const profit = Number(h.profitPercent || 0);
                const pColor = profit > 0 ? buyColor : profit < 0 ? sellColor : themeTextMuted;
                return (
                  <div
                    key={h.id}
                    style={{
                      backgroundColor: themeControlBg,
                      border: `1px solid ${themeBorder}`,
                      borderRadius: '12px',
                      padding: '0.85rem 1rem',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                      <div>
                        <div style={{ fontSize: '0.82rem', fontWeight: 700, color: themeText }}>
                          {sym}
                        </div>
                        <div style={{ fontSize: '0.6rem', color: themeTextMuted, marginTop: '2px' }}>
                          {formatDate(h.createdAt)} · {h.orderAction}
                        </div>
                      </div>
                      <PnlBadge value={`${profit > 0 ? '+' : ''}${profit.toFixed(2)}%`} color={pColor} />
                    </div>

                    <div style={{ display: 'flex', gap: '1rem', fontSize: '0.68rem' }}>
                      {[
                        { label: 'Side', value: h.isBuy ? 'Long' : 'Short', color: h.isBuy ? buyColor : sellColor },
                        { label: 'Lev', value: `${(h.source === 'solana-core' ? Number(h.leverage || 0) : Number(h.leverage || 0) / 100).toFixed(1)}×` },
                        { label: 'Price', value: `$${Number(h.price).toFixed(4)}` },
                      ].map(({ label, value, color }) => (
                        <div key={label}>
                          <div style={{ color: themeTextMuted, marginBottom: '2px' }}>{label}</div>
                          <div style={{ color: color || themeText, fontWeight: 600, fontFamily: 'var(--mono)' }}>
                            {value}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
            <div style={{ height: '1rem' }} />
          </div>
        )}
      </div>

      {/* ── Modals ────────────────────────────────────────────────────────── */}
      <EditTradeModal
        isOpen={!!activeTradeModal}
        onClose={() => setActiveTradeModal(null)}
        trade={activeTradeModal}
        symbol={activeTradeModal ? getSymbol(activeTradeModal) : ''}
        liveMath={activeTradeModal ? getTradeLiveMath(activeTradeModal) : {}}
        onAction={(type: string, params: any) => executeAction(type, params, activeTradeModal)}
        theme={{ themeBg, themeControlBg, themeBorder, themeText, themeTextMuted, buyColor, sellColor }}
      />
      <EditLimitModal
        isOpen={!!activeLimitModal}
        onClose={() => setActiveLimitModal(null)}
        order={activeLimitModal}
        symbol={activeLimitModal ? getSymbol(activeLimitModal) : ''}
        onAction={(type: string, params: any) => executeAction(type, params, activeLimitModal)}
        theme={{ themeBg, themeControlBg, themeBorder, themeText, themeTextMuted, buyColor, sellColor }}
      />
    </div>
  );
}
