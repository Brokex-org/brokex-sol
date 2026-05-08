import React, { useState, useEffect, useMemo } from 'react';
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import { useTheme } from '../ThemeContext';
import { useDynamicContext } from '@dynamic-labs/sdk-react-core';
import { useOstiumSubgraph } from '../hooks/useOstiumSubgraph';
import { useOstiumCalculations } from '../hooks/useOstiumCalculations';
import { usePriceContext } from '../contexts/PriceContext';
import { getChainConfig, ERC20_ABI, OSTIUM_ABI } from '../utils/ostium/abi';
import { parseUnits, createWalletClient, custom, createPublicClient, http } from 'viem';
import { useToast } from '../contexts/ToastContext';
import { EditTradeModal } from '../components/EditTradeModal';
import { EditLimitModal } from '../components/EditLimitModal';
import {
  buildCancelOrderIx,
  buildClosePositionIx,
  buildCreateCoreCollateralAtaIxIfNeeded,
  buildUpdateSlTpIx,
} from '../utils/solana/trading';
import { getPythFeedId0x, getRpcEndpoint, solanaTxExplorerUrl } from '../utils/solana/programConfig';
import { useNetwork } from '../contexts/NetworkContext';
import { ix, sendHermesPythThenConsumeLegacy } from '../utils/solana/pythTradeTx';
import { validateAssetPythFeedAlignment } from '../utils/solana/assetPythAlignment';
import { fetchSolanaCorePositionsForTrader } from '../utils/solana/solanaPositions';

const goldAccent = '#BC8961';

export function Portfolio() {
  const { themeBg, themeControlBg, themeBorder, themeText, themeTextMuted, buyColor, buyColorBg, sellColor, sellColorBg } = useTheme();
  const { primaryWallet, network } = useDynamicContext();
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

  /** Phantom (Solana) when present, else Dynamic EVM — matches Trade / PositionsPanel. */
  const portfolioViewerAddress = phantomAddress || evmAddress;
  const isSolanaViewer =
    Boolean(portfolioViewerAddress) && !/^0x[a-fA-F0-9]{40}$/.test(portfolioViewerAddress!);

  const { getOpenTrades, getOrders, getRecentHistory, getPairs } = useOstiumSubgraph();
  const { getTradeLiveMath } = useOstiumCalculations();
  const { addToast } = useToast();
  const { prices } = usePriceContext();
  const { cluster: solanaCluster } = useNetwork();

  const [activeTab, setActiveTab] = useState('Trades');
  const [openTrades, setOpenTrades] = useState<any[]>([]);
  const [pendingOrders, setPendingOrders] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [pairsList, setPairsList] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [historyFilter, setHistoryFilter] = useState('All');
  const [sortConfig, setSortConfig] = useState<{ key: string | null; direction: 'asc' | 'desc' }>({ key: null, direction: 'asc' });
  const [activeTradeModal, setActiveTradeModal] = useState<any>(null);
  const [activeLimitModal, setActiveLimitModal] = useState<any>(null);

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

  const toggleGroup = (id: string) => setExpandedGroups((prev) => ({ ...prev, [id]: prev[id] === false ? true : false }));

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

  // ── Sorting ────────────────────────────────────────────────────────────────
  const handleSort = (key: string) => {
    if (sortConfig.key === key) {
      if (sortConfig.direction === 'asc') setSortConfig({ key, direction: 'desc' });
      else setSortConfig({ key: null, direction: 'asc' });
    } else {
      setSortConfig({ key, direction: 'asc' });
    }
  };

  const sortData = (data: any[], getVal: (item: any) => any) => {
    if (!sortConfig.key) return data;
    return [...data].sort((a, b) => {
      const av = getVal(a); const bv = getVal(b);
      if (av < bv) return sortConfig.direction === 'asc' ? -1 : 1;
      if (av > bv) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  };

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
        const tradeIdRaw = itemData.tradeID ?? itemData.tradeId ?? itemData.id;
        const tradeId = BigInt(String(tradeIdRaw));
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
        } else if (actionType === 'UPDATE_TP') {
          actionName = 'Update TP';
          const { connection, instruction } = await buildUpdateSlTpIx({
            trader,
            assetSymbol: baseAsset,
            tradeId,
            slPriceMicro:
              itemData.stopLossPrice && Number(itemData.stopLossPrice) > 0
                ? BigInt(Math.floor(Number(itemData.stopLossPrice) * 1_000_000))
                : 0n,
            tpPriceMicro:
              Number(params.price) > 0 ? BigInt(Math.floor(Number(params.price) * 1_000_000)) : 0n,
          });
          const latest = await connection.getLatestBlockhash('confirmed');
          const tx = new Transaction({
            feePayer: trader,
            blockhash: latest.blockhash,
            lastValidBlockHeight: latest.lastValidBlockHeight,
          }).add(instruction);
          const signed = await provider.signTransaction(tx);
          txHash = await connection.sendRawTransaction(signed.serialize(), {
            skipPreflight: false,
            preflightCommitment: 'confirmed',
          });
          await connection.confirmTransaction(
            { signature: txHash, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
            'confirmed'
          );
        } else if (actionType === 'UPDATE_SL') {
          actionName = 'Update SL';
          const { connection, instruction } = await buildUpdateSlTpIx({
            trader,
            assetSymbol: baseAsset,
            tradeId,
            slPriceMicro:
              Number(params.price) > 0 ? BigInt(Math.floor(Number(params.price) * 1_000_000)) : 0n,
            tpPriceMicro:
              itemData.takeProfitPrice && Number(itemData.takeProfitPrice) > 0
                ? BigInt(Math.floor(Number(itemData.takeProfitPrice) * 1_000_000))
                : 0n,
          });
          const latest = await connection.getLatestBlockhash('confirmed');
          const tx = new Transaction({
            feePayer: trader,
            blockhash: latest.blockhash,
            lastValidBlockHeight: latest.lastValidBlockHeight,
          }).add(instruction);
          const signed = await provider.signTransaction(tx);
          txHash = await connection.sendRawTransaction(signed.serialize(), {
            skipPreflight: false,
            preflightCommitment: 'confirmed',
          });
          await connection.confirmTransaction(
            { signature: txHash, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
            'confirmed'
          );
        } else if (actionType === 'CANCEL_LIMIT') {
          actionName = 'Cancel Limit Order';
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
              View on Explorer ↗
            </a>
          ),
        });
        setActiveTradeModal(null);
        setActiveLimitModal(null);
        return;
      }

      let walletClient: any;
      if ('getWalletClient' in (primaryWallet?.connector || {})) {
        walletClient = await (primaryWallet?.connector as any).getWalletClient();
      } else if (typeof window !== 'undefined' && 'ethereum' in window) {
        walletClient = createWalletClient({
          account: evmAddress as `0x${string}`,
          transport: custom((window as any).ethereum),
        });
      }
      if (!walletClient) throw new Error('No wallet client');
      if (!evmAddress) throw new Error('Connect an EVM wallet (Dynamic) for Ostium actions');

      const chainIdNum = Number(network) || 421614;
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
        txHash = await walletClient.writeContract({ address: cfg.tradingAddress as `0x${string}`, abi: OSTIUM_ABI, functionName: 'closeTradeMarket', args: [pairIndex, index, cp, mktPrice, 100n], account: evmAddress as `0x${string}`, chain: cfg.chain as any, ...gas });
      } else if (actionType === 'TOP_UP') {
        actionName = 'Add Margin';
        const amt = parseUnits(params.amount, 6);
        const ah = await walletClient.writeContract({ address: cfg.usdcAddress as `0x${string}`, abi: ERC20_ABI, functionName: 'approve', args: [cfg.tradingStorageAddress as `0x${string}`, amt], account: evmAddress as `0x${string}`, chain: cfg.chain as any, ...gas });
        await publicClient.waitForTransactionReceipt({ hash: ah });
        txHash = await walletClient.writeContract({ address: cfg.tradingAddress as `0x${string}`, abi: OSTIUM_ABI, functionName: 'topUpCollateral', args: [pairIndex, index, amt], account: evmAddress as `0x${string}`, chain: cfg.chain as any, ...gas });
      } else if (actionType === 'REMOVE_MARGIN') {
        actionName = 'Remove Margin';
        txHash = await walletClient.writeContract({ address: cfg.tradingAddress as `0x${string}`, abi: OSTIUM_ABI, functionName: 'removeCollateral', args: [pairIndex, index, parseUnits(params.amount, 6)], account: evmAddress as `0x${string}`, chain: cfg.chain as any, ...gas });
      } else if (actionType === 'UPDATE_TP') {
        actionName = 'Update TP';
        const px = Number(params.price) > 0 ? parseUnits(params.price, 18) : 0n;
        txHash = await walletClient.writeContract({ address: cfg.tradingAddress as `0x${string}`, abi: OSTIUM_ABI, functionName: 'updateTp', args: [pairIndex, index, px], account: evmAddress as `0x${string}`, chain: cfg.chain as any, ...gas });
      } else if (actionType === 'UPDATE_SL') {
        actionName = 'Update SL';
        const px = Number(params.price) > 0 ? parseUnits(params.price, 18) : 0n;
        txHash = await walletClient.writeContract({ address: cfg.tradingAddress as `0x${string}`, abi: OSTIUM_ABI, functionName: 'updateSl', args: [pairIndex, index, px], account: evmAddress as `0x${string}`, chain: cfg.chain as any, ...gas });
      } else if (actionType === 'CANCEL_LIMIT') {
        actionName = 'Cancel Order';
        txHash = await walletClient.writeContract({ address: cfg.tradingAddress as `0x${string}`, abi: OSTIUM_ABI, functionName: 'cancelOpenLimitOrder', args: [pairIndex, index], account: evmAddress as `0x${string}`, chain: cfg.chain as any, ...gas });
      }

      const evmExplorerBase = cfg.chain.blockExplorers?.default?.url;
      const txLinkStyle: React.CSSProperties = {
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
            View on Explorer ↗
          </a>
        ) : (
          <span className="font-mono" style={{ fontSize: '0.75rem', color: themeTextMuted, marginTop: '6px', display: 'inline-block' }}>
            {txHash}
          </span>
        ),
      });
      setActiveTradeModal(null); setActiveLimitModal(null);
    } catch (e: any) {
      addToast({ type: 'error', title: 'Action Failed', message: e.message?.substring(0, 100) });
    }
  };

  // ── Group trades by symbol ─────────────────────────────────────────────────
  const groupedBySymbol = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const t of openTrades) {
      const math = getTradeLiveMath(t) || { pnl: '0', markPrice: '0' };
      const sym = getSymbol(t);
      const levNum =
        t.source === 'solana-core' ? Number(t.leverage || 0) : Number(t.leverage || 0) / 100;
      const entryNum = Number(t.openPrice || 0);

      // Liquidation based on 95% margin loss
      let liqPrice: string | null = null;
      if (entryNum > 0 && levNum >= 1) {
        const liq = t.isBuy ? entryNum * (1 - 0.95 / levNum) : entryNum * (1 + 0.95 / levNum);
        liqPrice = liq > 0 ? liq.toFixed(2) : null;
      }

      const enriched = { ...t, math, sym, levNum, entryNum, liqPrice };
      if (!map[sym]) map[sym] = [];
      map[sym].push(enriched);
    }
    return map;
  }, [openTrades, getTradeLiveMath, pairsList]);

  // ── Sorted orders & history ────────────────────────────────────────────────
  const sortedOrders = useMemo(() => {
    return sortData(pendingOrders, (o) => {
      if (sortConfig.key === 'asset') return getSymbol(o);
      if (sortConfig.key === 'margin') return Number(o.collateral || 0);
      if (sortConfig.key === 'target') return Number(o.openPrice || 0);
      return 0;
    });
  }, [pendingOrders, sortConfig]);

  const filteredHistory = useMemo(() =>
    history.filter(h => historyFilter === 'All' || h.orderAction === historyFilter),
    [history, historyFilter]);

  const sortedHistory = useMemo(() => {
    return sortData(filteredHistory, (h) => {
      if (sortConfig.key === 'profit') return Number(h.profitPercent || 0);
      return 0;
    });
  }, [filteredHistory, sortConfig]);

  // ── Styles ─────────────────────────────────────────────────────────────────
  const thStyle: React.CSSProperties = {
    padding: '0.3rem 0.6rem', // Ligne plus fine
    fontWeight: 500, 
    color: themeTextMuted,
    fontSize: '0.5rem', // Police plus petite
    textTransform: 'uppercase', 
    whiteSpace: 'nowrap',
    borderBottom: `1px solid ${themeBorder}`, 
    cursor: 'pointer', 
    userSelect: 'none',
    textAlign: 'left' // Centré sur la gauche
  };

  const SortIcon = ({ k }: { k: string }) => (
    <span style={{ fontSize: '0.4rem', marginLeft: '3px', opacity: 0.5 }}>
      {sortConfig.key === k ? (sortConfig.direction === 'asc' ? '▲' : '▼') : '⇅'}
    </span>
  );

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: themeBg, overflow: 'hidden' }}>
      <style>{`
        .port-scrollbar::-webkit-scrollbar { display: none; }
        .port-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        .port-row:hover { background-color: ${themeControlBg}88 !important; }
      `}</style>

      {/* ── Tab bar ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 1.5rem', borderBottom: `1px solid ${themeBorder}`, flexShrink: 0, height: '44px' }}>
        <div style={{ display: 'flex', height: '100%', gap: '0' }}>
          {[
            { key: 'Trades', label: 'Trades', count: openTrades.length },
            { key: 'Orders', label: 'Orders', count: pendingOrders.length },
            { key: 'History', label: 'History', count: history.length },
          ].map(({ key, label, count }) => {
            const isActive = activeTab === key;
            return (
              <button key={key} onClick={() => setActiveTab(key)} style={{
                background: 'none', border: 'none', cursor: 'pointer',
                height: '100%', padding: '0 1rem',
                color: isActive ? themeText : themeTextMuted,
                borderBottom: `2px solid ${isActive ? goldAccent : 'transparent'}`,
                fontSize: '0.78rem', fontWeight: isActive ? 600 : 400, transition: 'all 0.15s',
              }}>
                {label}{count > 0 ? <span style={{ marginLeft: '5px', fontSize: '0.6rem', opacity: 0.6 }}>({count})</span> : null}
              </button>
            );
          })}
        </div>

        {/* Right controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
          {activeTab === 'History' && (
            <select value={historyFilter} onChange={e => setHistoryFilter(e.target.value)}
              style={{ backgroundColor: themeControlBg, color: themeText, border: `1px solid ${themeBorder}`, borderRadius: '4px', padding: '4px 8px', fontSize: '0.68rem', outline: 'none' }}>
              <option value="All">All</option>
              <option value="Open">Open</option>
              <option value="Close">Close</option>
              <option value="TakeProfit">TakeProfit</option>
              <option value="StopLoss">StopLoss</option>
              <option value="Liquidation">Liquidation</option>
            </select>
          )}
        </div>
      </div>

      {/* ── Content ────────────────────────────────────────────────── */}
      <div className="port-scrollbar" style={{ flex: 1, overflowY: 'auto', overflowX: 'auto' }}>
        {!portfolioViewerAddress ? (
          <div style={{ padding: '5rem', textAlign: 'center', color: themeTextMuted, fontSize: '0.85rem' }}>
            Connect Phantom (Solana) or your EVM wallet (Dynamic) to view your portfolio.
          </div>
        ) : isLoading ? (
          <div style={{ padding: '5rem', textAlign: 'center', color: themeTextMuted, fontSize: '0.85rem' }}>Loading…</div>
        ) : (

          // ─────────────────────────────────────────────────────────────
          // TRADES TAB — grouped by asset
          // ─────────────────────────────────────────────────────────────
          activeTab === 'Trades' ? (
            <table style={{ width: '100%', minWidth: '960px', borderCollapse: 'collapse', fontSize: '0.7rem', color: themeText }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, paddingLeft: '1rem', width: '180px' }}>Asset</th>
                  <th style={{ ...thStyle }} onClick={() => handleSort('lev')}>Leverage / KO <SortIcon k="lev" /></th>
                  <th style={{ ...thStyle }} onClick={() => handleSort('entry')}>Entry <SortIcon k="entry" /></th>
                  <th style={{ ...thStyle }}>Last Price</th>
                  <th style={{ ...thStyle }}>Stop Loss</th>
                  <th style={{ ...thStyle }}>Take Profit</th>
                  <th style={{ ...thStyle }}>Liq. Price</th>
                  <th style={{ ...thStyle }} onClick={() => handleSort('margin')}>Margin / Value <SortIcon k="margin" /></th>
                  <th style={{ ...thStyle, textAlign: 'right' }} onClick={() => handleSort('pnl')}>P&L <SortIcon k="pnl" /></th>
                  <th style={{ ...thStyle, textAlign: 'right', paddingRight: '1rem' }}></th>
                </tr>
              </thead>
              <tbody>
                {Object.keys(groupedBySymbol).length === 0 ? (
                  <tr><td colSpan={10} style={{ padding: '4rem', textAlign: 'center', color: themeTextMuted }}>No open trades.</td></tr>
                ) : Object.entries(groupedBySymbol).map(([sym, trades]) => {
                  const isExpanded = expandedGroups[sym] !== false; // default open
                  
                  // Calculate aggregate PnL and Margin
                  const totalPnl = trades.reduce((acc, t) => {
                    const pnlStr = t.math.pnl || '0';
                    const v = parseFloat(pnlStr.replace(/[^0-9.-]/g, '')) || 0;
                    return acc + (pnlStr.startsWith('-') ? -Math.abs(v) : Math.abs(v));
                  }, 0);
                  const totalMargin = trades.reduce((acc, t) => acc + Number(t.collateral || 0), 0);
                  const totalDynamicMargin = totalMargin + totalPnl;

                  const pnlColor = totalPnl >= 0 ? buyColor : sellColor;
                  const pnlStr = `${totalPnl >= 0 ? '+' : ''}$${Math.abs(totalPnl).toFixed(2)}`;

                  // Aggregate Size calculation
                  const netSize = trades.reduce((acc, t) => {
                    const size = Number(t.tradeNotional || t.notional || 0);
                    return acc + (t.isBuy ? size : -size);
                  }, 0);
                  const aggSideColor = netSize >= 0 ? buyColor : sellColor;
                  const aggSideBg = netSize >= 0 ? buyColorBg : sellColorBg;

                  // Aggregate averages
                  const avgLev = trades.reduce((acc, t) => acc + t.levNum, 0) / trades.length;
                  const avgEntry = trades.reduce((acc, t) => acc + t.entryNum, 0) / trades.length;
                  const markPrice = trades[0]?.math?.markPrice || '';

                  return (
                    <React.Fragment key={sym}>
                      {/* ── Row 1: Title Only ── */}
                      <tr style={{ backgroundColor: themeBg }}>
                        <td colSpan={10} style={{ padding: '1.2rem 1rem 0.3rem 1rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                            <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: `linear-gradient(135deg, ${themeBorder}, ${themeControlBg})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', fontWeight: 700, color: themeText, border: `1px solid ${themeBorder}`, flexShrink: 0 }}>
                              {sym.charAt(0)}
                            </div>
                            <span style={{ fontWeight: 700, fontSize: '0.85rem', color: themeText }}>{sym}</span>
                          </div>
                        </td>
                      </tr>

                      {/* ── Row 2: Aggregate & Toggle ── */}
                      <tr style={{ backgroundColor: themeControlBg, borderBottom: `1px solid ${themeBorder}` }} className="port-row">
                        <td style={{ padding: '0.6rem 0.6rem 0.6rem 1rem', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                            <button
                              onClick={() => toggleGroup(sym)}
                              style={{ 
                                width: '22px', height: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', 
                                backgroundColor: '#2a2a2a', border: `1px solid ${themeBorder}`, borderRadius: '4px', 
                                cursor: 'pointer', color: goldAccent, fontSize: '1.2rem', fontWeight: 300, lineHeight: 1 
                              }}
                            >
                              {isExpanded ? '-' : '+'}
                            </button>
                            <span style={{ 
                                backgroundColor: aggSideBg, color: aggSideColor, padding: '3px 8px', borderRadius: '4px', 
                                fontSize: '0.65rem', fontWeight: 700, border: `1px solid ${aggSideColor}40`,
                                boxShadow: trades.length > 1 ? `2px 2px 0px ${aggSideBg}` : 'none'
                              }}>
                              {netSize >= 0 ? '+' : ''}{netSize.toFixed(2)}
                            </span>
                          </div>
                        </td>
                        <td style={{ padding: '0.6rem', color: themeText, fontSize: '0.65rem' }} className="font-mono">1:{Math.round(avgLev)}</td>
                        <td style={{ padding: '0.6rem', color: themeText, fontSize: '0.65rem' }} className="font-mono">{avgEntry.toFixed(2)}</td>
                        <td style={{ padding: '0.6rem', color: themeText, fontSize: '0.65rem' }} className="font-mono">{markPrice}</td>
                        <td style={{ padding: '0.6rem', color: themeTextMuted, fontSize: '0.65rem' }}></td>
                        <td style={{ padding: '0.6rem', color: themeTextMuted, fontSize: '0.65rem' }}></td>
                        <td style={{ padding: '0.6rem', color: themeTextMuted, fontSize: '0.65rem' }}></td>
                        <td style={{ padding: '0.6rem', fontWeight: 600, fontSize: '0.7rem', color: themeText }}>
                          ${Math.max(0, totalDynamicMargin).toFixed(2)}
                        </td>
                        <td style={{ padding: '0.6rem', textAlign: 'right', fontWeight: 700, fontSize: '0.72rem', color: pnlColor }}>
                          {pnlStr}
                        </td>
                        <td style={{ padding: '0.6rem 1rem 0.6rem 0.6rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <button
                            onClick={(e) => { 
                              e.stopPropagation(); 
                              trades.forEach(t => executeAction('CLOSE', { percent: 100 }, t)); 
                            }}
                            style={{ backgroundColor: 'transparent', color: themeText, border: `1px solid ${themeBorder}`, borderRadius: '4px', padding: '0.22rem 0.6rem', cursor: 'pointer', fontSize: '0.6rem', fontWeight: 600 }}
                          >
                            Close All
                          </button>
                        </td>
                      </tr>

                      {/* ── Sub rows for each trade ── */}
                      {isExpanded && trades.map((trade) => {
                        const math = trade.math;
                        const pnlStr = math.pnl || '0';
                        const pnlVal = parseFloat(pnlStr.replace(/[^0-9.-]/g, '')) || 0;
                        const tradePnl = pnlStr.startsWith('-') ? -Math.abs(pnlVal) : Math.abs(pnlVal);
                        const dynamicMargin = Number(trade.collateral || 0) + tradePnl;
                        
                        const pColor = tradePnl >= 0 ? buyColor : sellColor;
                        const sideColor = trade.isBuy ? buyColor : sellColor;
                        const sideBg = trade.isBuy ? buyColorBg : sellColorBg;
                        const levNum = trade.levNum;
                        const entryNum = trade.entryNum;

                        return (
                          <tr
                            key={trade.tradeID || trade.id}
                            className="port-row"
                            style={{ borderBottom: `1px solid ${themeBorder}80`, backgroundColor: themeBg, transition: 'background-color 0.12s' }}
                          >
                            {/* Side badge with hierarchy connector */}
                            <td style={{ padding: '0.5rem 0.6rem 0.5rem 1.6rem', whiteSpace: 'nowrap' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <svg width="14" height="18" viewBox="0 0 14 18" fill="none" style={{ opacity: 0.4, flexShrink: 0, transform: 'translateY(-3px)' }}>
                                  <path d="M4 0V10H14" stroke={themeTextMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="2 3"/>
                                </svg>
                                <span style={{ backgroundColor: sideBg, color: sideColor, padding: '2px 8px', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 700 }}>
                                  {trade.isBuy ? '+' : '-'}{Number(trade.tradeNotional || trade.notional || 0).toFixed(2)}
                                </span>
                              </div>
                            </td>
                            {/* Lev / KO */}
                            <td style={{ padding: '0.5rem 0.6rem', fontSize: '0.65rem' }} className="font-mono">
                              1:{Math.round(levNum)}
                            </td>
                            {/* Entry */}
                            <td style={{ padding: '0.5rem 0.6rem', fontSize: '0.65rem' }} className="font-mono">
                              {entryNum.toFixed(2)}
                            </td>
                            {/* Last price (mark) */}
                            <td style={{ padding: '0.5rem 0.6rem', fontSize: '0.65rem' }} className="font-mono">
                              {math.markPrice}
                            </td>
                            {/* Stop loss */}
                            <td style={{ padding: '0.5rem 0.6rem', whiteSpace: 'nowrap' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <button
                                  onClick={() => setActiveTradeModal(trade)}
                                  style={{ backgroundColor: 'transparent', border: `1px solid ${themeBorder}`, borderRadius: '4px', color: themeTextMuted, padding: '2px 8px', cursor: 'pointer', fontSize: '0.6rem', minWidth: '45px' }}
                                >
                                  {trade.stopLossPrice ? Number(trade.stopLossPrice).toFixed(2) : 'Add'}
                                </button>
                              </div>
                            </td>
                            {/* Take profit */}
                            <td style={{ padding: '0.5rem 0.6rem', whiteSpace: 'nowrap' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span style={{ fontSize: '0.5rem', fontWeight: 700, color: themeTextMuted }}>TP</span>
                                <button
                                  onClick={() => setActiveTradeModal(trade)}
                                  style={{ backgroundColor: 'transparent', border: `1px solid ${themeBorder}`, borderRadius: '4px', color: themeTextMuted, padding: '2px 8px', cursor: 'pointer', fontSize: '0.6rem', minWidth: '45px' }}
                                >
                                  {trade.takeProfitPrice ? Number(trade.takeProfitPrice).toFixed(2) : 'Add'}
                                </button>
                              </div>
                            </td>
                            {/* Liq price */}
                            <td style={{ padding: '0.5rem 0.6rem', fontSize: '0.65rem' }} className="font-mono">
                              <span style={{ color: sellColor }}>{trade.liqPrice ?? ''}</span>
                            </td>
                            {/* Margin Dynamic */}
                            <td style={{ padding: '0.5rem 0.6rem', fontSize: '0.65rem' }} className="font-mono">
                              ${Math.max(0, dynamicMargin).toFixed(2)}
                            </td>
                            {/* PNL */}
                            <td style={{ padding: '0.5rem 0.6rem', textAlign: 'right', fontSize: '0.65rem' }}>
                              <span className="font-mono" style={{ color: pColor, fontWeight: 600 }}>{tradePnl >= 0 ? '+' : ''}${Math.abs(tradePnl).toFixed(2)}</span>
                            </td>
                            {/* Close */}
                            <td style={{ padding: '0.5rem 1rem 0.5rem 0.6rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                              <button
                                onClick={() => executeAction('CLOSE', { percent: 100 }, trade)}
                                style={{ background: 'transparent', border: `1px solid ${themeBorder}`, color: themeText, borderRadius: '4px', padding: '0.2rem 0.7rem', cursor: 'pointer', fontSize: '0.6rem' }}
                              >
                                Close
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>

          // ─────────────────────────────────────────────────────────────
          // ORDERS TAB
          // ─────────────────────────────────────────────────────────────
          ) : activeTab === 'Orders' ? (
            <table style={{ width: '100%', minWidth: '860px', borderCollapse: 'collapse', fontSize: '0.7rem', color: themeText }}>
              <thead>
                <tr>
                  {['Asset', 'Type/Side', 'Leverage', 'Margin', 'Target', 'Market Price', 'Take Profit', 'Stop Loss', 'Actions'].map((h, i) => (
                    <th key={h} style={{ ...thStyle, paddingLeft: i === 0 ? '1.5rem' : '0.6rem', paddingRight: i === 8 ? '1.5rem' : '0.6rem', textAlign: i === 8 ? 'right' : 'left' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedOrders.length === 0 ? (
                  <tr><td colSpan={9} style={{ padding: '4rem', textAlign: 'center', color: themeTextMuted }}>
                    {isSolanaViewer
                      ? 'No open limit or stop orders. Unfilled limit orders appear here; market positions are under Trades.'
                      : 'No pending orders.'}
                  </td></tr>
                ) : sortedOrders.map((order: any) => {
                  const sym = getSymbol(order).replace(' CFD', '');
                  const sideColor = order.isBuy ? buyColor : sellColor;
                  const sideBg = order.isBuy ? buyColorBg : sellColorBg;
                  const mktPrice = prices[getBaseAsset(order)]?.mid?.toFixed(4) || '';
                  const td = { padding: '0.5rem 0.6rem', whiteSpace: 'nowrap' as any, fontSize: '0.65rem' };
                  return (
                    <tr key={order.id} className="port-row" style={{ borderBottom: `1px solid ${themeBorder}`, transition: 'background-color 0.12s' }}>
                      <td style={{ ...td, paddingLeft: '1.5rem' }}><span style={{ fontWeight: 600 }}>{sym}</span></td>
                      <td style={td}><span style={{ backgroundColor: sideBg, color: sideColor, padding: '2px 5px', borderRadius: '4px', fontSize: '0.6rem', textTransform: 'capitalize' }}>{order.limitType} {order.isBuy ? 'Long' : 'Short'}</span></td>
                      <td style={td} className="font-mono">
                        1:
                        {Math.round(
                          order.source === 'solana-core'
                            ? Number(order.leverage || 0)
                            : Number(order.leverage || 0) / 100
                        )}
                      </td>
                      <td style={td} className="font-mono">${Number(order.collateral).toFixed(2)}</td>
                      <td style={td} className="font-mono">{Number(order.openPrice).toFixed(4)}</td>
                      <td style={td} className="font-mono">{mktPrice}</td>
                      <td style={{ ...td, color: buyColor }} className="font-mono">{order.takeProfitPrice ? Number(order.takeProfitPrice).toFixed(4) : ''}</td>
                      <td style={{ ...td, color: sellColor }} className="font-mono">{order.stopLossPrice ? Number(order.stopLossPrice).toFixed(4) : ''}</td>
                      <td style={{ ...td, paddingRight: '1.5rem', textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
                          <button onClick={() => setActiveLimitModal(order)} style={{ backgroundColor: themeControlBg, border: `1px solid ${themeBorder}`, color: themeText, padding: '0.25rem 0.6rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.6rem' }}>Edit</button>
                          <button onClick={() => executeAction('CANCEL_LIMIT', {}, order)} style={{ background: 'transparent', border: `1px solid ${themeBorder}`, color: sellColor, padding: '0.25rem 0.6rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.6rem' }}>Cancel</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

          // ─────────────────────────────────────────────────────────────
          // HISTORY TAB
          // ─────────────────────────────────────────────────────────────
          ) : (
            <table style={{ width: '100%', minWidth: '760px', borderCollapse: 'collapse', fontSize: '0.7rem', color: themeText }}>
              <thead>
                <tr>
                  {['Asset', 'Operation', 'Side', 'Leverage', 'Price', 'TP', 'SL', 'Profit %'].map((h, i) => (
                    <th key={h} onClick={h === 'Profit %' ? () => handleSort('profit') : undefined}
                      style={{ ...thStyle, paddingLeft: i === 0 ? '1.5rem' : '0.6rem', paddingRight: i === 7 ? '1.5rem' : '0.6rem', textAlign: i === 7 ? 'right' : 'left', cursor: h === 'Profit %' ? 'pointer' : 'default' }}>
                      {h}{h === 'Profit %' && <SortIcon k="profit" />}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedHistory.length === 0 ? (
                  <tr><td colSpan={8} style={{ padding: '4rem', textAlign: 'center', color: themeTextMuted }}>
                    {isSolanaViewer
                      ? 'No closed trades loaded from chain yet (closes, liquidations, and cancels appear here).'
                      : 'No history.'}
                  </td></tr>
                ) : sortedHistory.map((h: any) => {
                  const sym = getSymbol(h).replace(' CFD', '');
                  const profit = Number(h.profitPercent || 0);
                  const pColor = profit > 0 ? buyColor : profit < 0 ? sellColor : themeTextMuted;
                  const td = { padding: '0.5rem 0.6rem', whiteSpace: 'nowrap' as any, fontSize: '0.65rem' };
                  return (
                    <tr key={h.id} className="port-row" style={{ borderBottom: `1px solid ${themeBorder}`, transition: 'background-color 0.12s' }}>
                      <td style={{ ...td, paddingLeft: '1.5rem' }}><span style={{ fontWeight: 600 }}>{sym}</span></td>
                      <td style={td} className="font-mono">{h.orderAction}</td>
                      <td style={td}><span style={{ color: h.isBuy ? buyColor : sellColor, fontSize: '0.6rem' }}>{h.isBuy ? 'Long' : 'Short'}</span></td>
                      <td style={td} className="font-mono">
                    1:
                    {Math.round(
                      h.source === 'solana-core' ? Number(h.leverage || 0) : Number(h.leverage || 0) / 100
                    )}
                  </td>
                      <td style={td} className="font-mono">${Number(h.price).toFixed(4)}</td>
                      <td style={{ ...td, color: buyColor }} className="font-mono">{h.tp ? Number(h.tp).toFixed(4) : ''}</td>
                      <td style={{ ...td, color: sellColor }} className="font-mono">{h.sl ? Number(h.sl).toFixed(4) : ''}</td>
                      <td style={{ ...td, paddingRight: '1.5rem', textAlign: 'right' }}>
                        <span className="font-mono" style={{ color: pColor, fontWeight: 600 }}>{profit > 0 ? '+' : ''}{profit.toFixed(2)}%</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        )}
      </div>

      <EditTradeModal
        isOpen={!!activeTradeModal} onClose={() => setActiveTradeModal(null)}
        trade={activeTradeModal} symbol={activeTradeModal ? getSymbol(activeTradeModal).replace(' CFD', '') : ''}
        liveMath={activeTradeModal ? getTradeLiveMath(activeTradeModal) : {}}
        onAction={(type: string, params: any) => executeAction(type, params, activeTradeModal)}
        theme={{ themeBg, themeControlBg, themeBorder, themeText, themeTextMuted, buyColor, sellColor }}
      />
      <EditLimitModal
        isOpen={!!activeLimitModal} onClose={() => setActiveLimitModal(null)}
        order={activeLimitModal} symbol={activeLimitModal ? getSymbol(activeLimitModal).replace(' CFD', '') : ''}
        onAction={(type: string, params: any) => executeAction(type, params, activeLimitModal)}
        theme={{ themeBg, themeControlBg, themeBorder, themeText, themeTextMuted, buyColor, sellColor }}
      />
    </div>
  );
}