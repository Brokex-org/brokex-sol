import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import { useTheme } from '../ThemeContext';

import { useOstiumSubgraph } from '../hooks/useOstiumSubgraph';
import { useOstiumCalculations } from '../hooks/useOstiumCalculations';
import { usePriceContext } from '../contexts/PriceContext';
import { formatPrice } from '../utils/ostium/utils';
import { useToast } from '../contexts/ToastContext';
import { EditTradeModal } from './EditTradeModal';
import { EditLimitModal } from './EditLimitModal';
import {
  buildCancelOrderIx,
  buildClosePositionIx,
  buildCreateCoreCollateralAtaIxIfNeeded,
  buildUpdateSlTpIx,
} from '../utils/solana/trading';
import { getPythFeedId0x, getRpcEndpoint } from '../utils/solana/programConfig';
import { ix, sendHermesPythThenConsumeLegacy } from '../utils/solana/pythTradeTx';
import { validateAssetPythFeedAlignment } from '../utils/solana/assetPythAlignment';
import { fetchSolanaCorePositionsForTrader } from '../utils/solana/solanaPositions';

// ============================================================================
// 3. POSITIONS PANEL MAIN
// ============================================================================
export const PositionsPanel = () => {
  const theme = useTheme();
  const { themeBg, themeControlBg, themeBorder, themeText, themeTextMuted, buyColor, buyColorBg, sellColor, sellColorBg } = theme;
  
  const { getPairs } = useOstiumSubgraph();
  const { getTradeLiveMath } = useOstiumCalculations();
  const { addToast } = useToast();
  const { prices, selectedAsset } = usePriceContext();
  const [address, setAddress] = useState<string | undefined>(undefined);
  const [activeTab, setActiveTab] = useState('Open Positions');
  const [filterAsset, setFilterAsset] = useState('All');

  const [openTrades, setOpenTrades] = useState<any[]>([]);
  const [pendingOrders, setPendingOrders] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [pairsList, setPairsList] = useState<any[]>([]); 
  const [isLoading, setIsLoading] = useState(false);

  // Nouveaux états pour les modales dédiées
  const [activeTradeModal, setActiveTradeModal] = useState<any>(null);
  const [activeLimitModal, setActiveLimitModal] = useState<any>(null);

  useEffect(() => {
    const provider = (window as any).solana;
    if (!provider?.isPhantom) return;

    const sync = () => {
      setAddress(provider.publicKey ? provider.publicKey.toBase58() : undefined);
    };
    const onDisconnect = () => setAddress(undefined);

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

  const getBaseAsset = (item: any) => {
    if (item.pair?.from) return item.pair.from;
    if (item.raw?.pair?.from) return item.raw.pair.from;
    const pairIdStr = item.pair?.id || item.pairId?.toString();
    const p = pairsList.find(x => x.id === pairIdStr);
    if (p) return p.from;
    if (typeof item.pairId === 'string' && isNaN(Number(item.pairId))) return item.pairId;
    return '';
  };

  const getSymbol = (item: any) => {
    const from = getBaseAsset(item);
    if (from) {
       const to = item.pair?.to || item.raw?.pair?.to || pairsList.find(x => x.from === from)?.to || 'USD';
       return `${from}/${to}`;
    }
    return `Pair #${item.pair?.id || item.pairId || '?'}`;
  };

  const formatDate = (timestamp: any) => {
    if (!timestamp) return '---';
    const d = new Date(timestamp);
    return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  // ==================================================
  // MOTEUR D'EXECUTION DES TRANSACTIONS
  // ==================================================
  const executeAction = async (actionType: string, params: any, itemData: any) => {
    try {
      const provider = (window as any).solana;
      if (!provider?.isPhantom) throw new Error('Phantom wallet not found');
      if (!provider.publicKey) {
        await provider.connect();
      }
      const trader = new PublicKey(provider.publicKey.toBase58());
      setAddress(trader.toBase58());

      const baseAsset = getBaseAsset(itemData) || 'SOL';
      const tradeIdRaw = itemData.tradeID ?? itemData.tradeId ?? itemData.id;
      const tradeId = BigInt(String(tradeIdRaw));

      let txHash = '';
      let actionName = '';

      if (actionType === 'CLOSE') {
        actionName = 'Close Position';
        const connection = new Connection(getRpcEndpoint(), 'confirmed');
        const align = await validateAssetPythFeedAlignment(connection, baseAsset);
        if (!align.ok) {
          throw new Error(align.detail);
        }
        const feedId = getPythFeedId0x(baseAsset);
        const maybeCollateralAtaIx = await buildCreateCoreCollateralAtaIxIfNeeded(trader);
        const sigs = await sendHermesPythThenConsumeLegacy({
          connection,
          trader,
          phantom: provider,
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
      } 
      else if (actionType === 'UPDATE_TP') {
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
      }
      else if (actionType === 'UPDATE_SL') {
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
      }
      else if (actionType === 'CANCEL_LIMIT') {
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
        throw new Error(`Action ${actionType} is not migrated to Solana yet`);
      }
      
      addToast({
        type: 'success',
        title: actionName,
        pair: getSymbol(itemData),
        side: itemData.isBuy ? 'buy' : 'sell',
        txHash,
      });
      setActiveTradeModal(null);
      setActiveLimitModal(null);

    } catch (err: any) {
      console.error(err);
      let msg =
        err && typeof err === 'object' && 'message' in err && typeof err.message === 'string'
          ? err.message
          : 'Unknown transaction error';

      if (
        err &&
        typeof err === 'object' &&
        'getLogs' in err &&
        typeof (err as { getLogs: unknown }).getLogs === 'function'
      ) {
        try {
          const connection = new Connection(getRpcEndpoint(), 'confirmed');
          const logs = await (err as { getLogs: (c: Connection) => Promise<string[]> }).getLogs(connection);
          console.error('Simulation / send logs:', logs);
          if (logs?.length) {
            msg = `${msg}\n${logs.slice(-8).join('\n')}`;
          }
        } catch (logErr) {
          console.warn('Could not fetch transaction logs', logErr);
        }
      }

      addToast({
        type: 'error',
        title: 'Action Failed',
        message: msg.length > 400 ? `${msg.slice(0, 400)}…` : msg,
      });
    }
  };

  useEffect(() => {
    if (!address) { setOpenTrades([]); setPendingOrders([]); setHistory([]); setPairsList([]); return; }
    let isMounted = true;
    const fetchAll = async () => {
      setIsLoading(true);
      try {
        const traderPk = new PublicKey(address);
        const [sol, pList] = await Promise.all([
          fetchSolanaCorePositionsForTrader(traderPk),
          getPairs(),
        ]);
        if (isMounted) {
          setOpenTrades(sol.open || []);
          setPendingOrders(sol.pending || []);
          setHistory(sol.history || []);
          setPairsList(pList || []);
        }
      } catch (err) {
        console.error(err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };
    fetchAll();
    const iv = setInterval(fetchAll, 10000); 
    return () => { isMounted = false; clearInterval(iv); };
  }, [address, getPairs]);

  const filteredTrades = openTrades.filter(t => filterAsset === 'All' || getBaseAsset(t) === filterAsset);
  const filteredOrders = pendingOrders.filter(o => filterAsset === 'All' || getBaseAsset(o) === filterAsset);
  const filteredHistory = history.filter(h => filterAsset === 'All' || getBaseAsset(h) === filterAsset);

  const tabs = [
    { id: 'Open Positions', count: filteredTrades.length },
    { id: 'Pending Orders', count: filteredOrders.length },
    { id: 'History', count: filteredHistory.length },
  ];

  const panelStyle: React.CSSProperties = { backgroundColor: themeBg, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderTop: `1px solid ${themeBorder}`, height: '100%', flexShrink: 0, fontWeight: 300 };
  const thStyle: React.CSSProperties = { padding: '0.4rem 0.8rem', fontWeight: 500, color: themeTextMuted, fontSize: '0.6rem', textTransform: 'uppercase', borderBottom: `1px solid ${themeBorder}` };
  const tdStyle: React.CSSProperties = { padding: '0.4rem 0.8rem', whiteSpace: 'nowrap' };

  // ==================================================
  // RENDERING ROWS
  // ==================================================
  const renderPositionRow = (trade: any) => {
    const symbol = getSymbol(trade);
    const { pnl, pnlPercent, pnlColor, markPrice } = getTradeLiveMath(trade);
    const dynamicPnlColor = pnlColor === 'buyColor' ? buyColor : (pnlColor === 'sellColor' ? sellColor : themeTextMuted);

    return (
      <tr key={trade.tradeID || trade.id} style={{ borderBottom: `1px solid ${themeBorder}`, transition: 'background-color 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = themeControlBg} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
        <td style={tdStyle}>
          <span style={{ fontSize: '0.7rem', fontWeight: 600, color: themeText }}>{symbol}</span>
        </td>
        <td style={tdStyle}>
          <span style={{ backgroundColor: trade.isBuy ? buyColorBg : sellColorBg, color: trade.isBuy ? buyColor : sellColor, padding: '2px 6px', borderRadius: '4px', fontSize: '0.55rem', fontWeight: 600 }}>
            {trade.isBuy ? 'LONG' : 'SHORT'} {Number(trade.leverage).toFixed(1)}x
          </span>
        </td>
        <td style={tdStyle} className="font-mono">{Number(trade.tradeNotional || trade.notional || 0).toFixed(4)}</td>
        <td style={tdStyle} className="font-mono">${Number(trade.collateral).toFixed(2)}</td>
        <td style={tdStyle} className="font-mono">{formatPrice(trade.openPrice)}</td>
        <td style={tdStyle} className="font-mono">{markPrice}</td>
        <td style={tdStyle}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
            <span className="font-mono" style={{ color: buyColor, fontSize: '0.6rem' }}>TP: {trade.takeProfitPrice ? formatPrice(trade.takeProfitPrice) : 'None'}</span>
            <span className="font-mono" style={{ color: sellColor, fontSize: '0.6rem' }}>SL: {trade.stopLossPrice ? formatPrice(trade.stopLossPrice) : 'None'}</span>
          </div>
        </td>
        <td style={tdStyle}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
            <span className="font-mono" style={{ color: dynamicPnlColor, fontSize: '0.7rem', fontWeight: 600 }}>{pnl}</span>
            <span className="font-mono" style={{ color: dynamicPnlColor, fontSize: '0.55rem' }}>({pnlPercent})</span>
          </div>
        </td>
        <td style={{ ...tdStyle, textAlign: 'right' }}>
          <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
            <button onClick={() => setActiveTradeModal(trade)} style={{ padding: '0.3rem 0.6rem', backgroundColor: themeControlBg, color: themeText, border: `1px solid ${themeBorder}`, borderRadius: '4px', cursor: 'pointer', fontSize: '0.6rem' }}>Edit</button>
            <button onClick={() => executeAction('CLOSE', { percent: 100 }, trade)} style={{ padding: '0.3rem 0.6rem', backgroundColor: 'transparent', color: sellColor, border: `1px solid ${themeBorder}`, borderRadius: '4px', cursor: 'pointer', fontSize: '0.6rem' }}>Close</button>
          </div>
        </td>
      </tr>
    );
  };

  const renderOrderRow = (order: any) => {
    const symbol = getSymbol(order);
    return (
      <tr key={order.tradeID || order.id} style={{ borderBottom: `1px solid ${themeBorder}`, transition: 'background-color 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = themeControlBg} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
        <td style={tdStyle}>
          <span style={{ fontSize: '0.7rem', fontWeight: 600, color: themeText }}>{symbol}</span>
        </td>
        <td style={tdStyle}>
          <span style={{ backgroundColor: order.isBuy ? buyColorBg : sellColorBg, color: order.isBuy ? buyColor : sellColor, padding: '2px 6px', borderRadius: '4px', fontSize: '0.55rem', fontWeight: 600, textTransform: 'capitalize' }}>
            {order.limitType} {order.isBuy ? 'LONG' : 'SHORT'} {Number(order.leverage).toFixed(1)}x
          </span>
        </td>
        <td style={tdStyle} className="font-mono">{Number(order.tradeNotional || order.notional || 0).toFixed(4)}</td>
        <td style={tdStyle} className="font-mono">${Number(order.collateral).toFixed(2)}</td>
        <td style={tdStyle} className="font-mono">{formatPrice(order.openPrice)}</td>
        <td style={tdStyle}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
            <span className="font-mono" style={{ color: buyColor, fontSize: '0.6rem' }}>TP: {order.takeProfitPrice ? formatPrice(order.takeProfitPrice) : 'None'}</span>
            <span className="font-mono" style={{ color: sellColor, fontSize: '0.6rem' }}>SL: {order.stopLossPrice ? formatPrice(order.stopLossPrice) : 'None'}</span>
          </div>
        </td>
        <td style={{ ...tdStyle, textAlign: 'right' }}>
          <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
            <button onClick={() => setActiveLimitModal(order)} style={{ padding: '0.3rem 0.6rem', backgroundColor: themeControlBg, color: themeText, border: `1px solid ${themeBorder}`, borderRadius: '4px', cursor: 'pointer', fontSize: '0.6rem' }}>Edit</button>
            <button onClick={() => executeAction('CANCEL_LIMIT', {}, order)} style={{ padding: '0.3rem 0.6rem', backgroundColor: 'transparent', color: sellColor, border: `1px solid ${themeBorder}`, borderRadius: '4px', cursor: 'pointer', fontSize: '0.6rem' }}>Cancel</button>
          </div>
        </td>
      </tr>
    );
  };

  const renderHistoryRow = (hist: any) => {
    const symbol = getSymbol(hist);
    const profit = Number(hist.profitPercent || 0);
    const pnlColor = profit > 0 ? buyColor : (profit < 0 ? sellColor : themeText);
    return (
      <tr key={hist.id} style={{ borderBottom: `1px solid ${themeBorder}`, transition: 'background-color 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = themeControlBg} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
        <td style={{ ...tdStyle, color: themeTextMuted, fontSize: '0.6rem' }}>{formatDate(hist.timestamp)}</td>
        <td style={tdStyle}>
          <span style={{ fontSize: '0.7rem', fontWeight: 600, color: themeText }}>{symbol}</span>
        </td>
        <td style={tdStyle}>
          <span style={{ color: hist.isBuy ? buyColor : sellColor, fontSize: '0.6rem' }}>
            {hist.orderType} {hist.isBuy ? 'LONG' : 'SHORT'}
          </span>
        </td>
        <td style={tdStyle} className="font-mono">{hist.orderAction}</td>
        <td style={tdStyle} className="font-mono">${formatPrice(hist.price)}</td>
        <td style={{ ...tdStyle, textAlign: 'right' }}>
          <span className="font-mono" style={{ color: pnlColor, fontWeight: 600 }}>{profit > 0 ? `+${profit.toFixed(2)}` : profit.toFixed(2)}%</span>
        </td>
      </tr>
    );
  };

  return (
    <div style={panelStyle}>

      {/* Header Tabs & Filters */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${themeBorder}`, height: '32px', padding: '0 1rem', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: '1.5rem', height: '100%' }}>
          {tabs.map(tab => (
            <div key={tab.id} onClick={() => setActiveTab(tab.id)} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.65rem', cursor: 'pointer', color: activeTab === tab.id ? themeText : themeTextMuted, borderBottom: activeTab === tab.id ? `1px solid ${themeText}` : '1px solid transparent' }}>
              <span style={{ fontWeight: activeTab === tab.id ? 400 : 300 }}>{tab.id}</span>
              <span style={{ opacity: 0.5 }}>({tab.count})</span>
            </div>
          ))}
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {isLoading && <span style={{ color: themeTextMuted, fontSize: '0.6rem' }}>Loading...</span>}
          
          {/* Bouton Portfolio */}
          <button 
            onClick={() => window.location.href = '/portfolio'} 
            style={{ 
              height: '24px', 
              padding: '0 8px', 
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              backgroundColor: themeBg, border: `1px solid ${themeBorder}`, borderRadius: '4px', 
              color: themeText, fontSize: '0.6rem', cursor: 'pointer', transition: 'all 0.15s',
              boxSizing: 'border-box'
            }}
          >
            Portfolio ↗
          </button>
          
          {/* Bloc Filtres */}
          <div style={{ 
            height: '24px', 
            display: 'flex', backgroundColor: themeBg, border: `1px solid ${themeBorder}`, 
            borderRadius: '4px', overflow: 'hidden', fontSize: '0.6rem',
            boxSizing: 'border-box'
          }}>
            <div 
              onClick={() => setFilterAsset('All')} 
              style={{ 
                padding: '0 8px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                backgroundColor: filterAsset === 'All' ? themeControlBg : 'transparent', 
                color: filterAsset === 'All' ? themeText : themeTextMuted, 
                cursor: 'pointer', borderRight: `1px solid ${themeBorder}` 
              }}
            >
              All
            </div>
            <div 
              onClick={() => setFilterAsset(selectedAsset)} 
              style={{ 
                padding: '0 8px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                backgroundColor: filterAsset === selectedAsset ? themeControlBg : 'transparent', 
                color: filterAsset === selectedAsset ? themeText : themeTextMuted, 
                cursor: 'pointer' 
              }}
            >
              {selectedAsset}
            </div>
          </div>
          
        </div>
      </div>

      {/* List Content (Table Format) */}
      <div className="hide-scrollbar" style={{ flex: 1, overflowX: 'auto', overflowY: 'auto' }}>
        <style>{`
          .hide-scrollbar::-webkit-scrollbar { display: none; }
          .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        `}</style>

        {!address ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: themeTextMuted, fontSize: '0.75rem' }}>Please connect your wallet to view your positions.</div>
        ) : (
          <table style={{ width: '100%', minWidth: '850px', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.7rem' }}>
            
            {activeTab === 'Open Positions' && (
              <>
                <thead>
                  <tr>
                    <th style={thStyle}>Asset</th>
                    <th style={thStyle}>Side</th>
                    <th style={thStyle}>Size</th>
                    <th style={thStyle}>Margin</th>
                    <th style={thStyle}>Entry</th>
                    <th style={thStyle}>Mark</th>
                    <th style={thStyle}>TP / SL</th>
                    <th style={thStyle}>PNL</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTrades.length > 0 
                    ? filteredTrades.map(renderPositionRow) 
                    : <tr><td colSpan={9} style={{ padding: '2rem', textAlign: 'center', color: themeTextMuted }}>No open positions.</td></tr>}
                </tbody>
              </>
            )}

            {activeTab === 'Pending Orders' && (
              <>
                <thead>
                  <tr>
                    <th style={thStyle}>Asset</th>
                    <th style={thStyle}>Type & Side</th>
                    <th style={thStyle}>Size</th>
                    <th style={thStyle}>Margin</th>
                    <th style={thStyle}>Target Price</th>
                    <th style={thStyle}>TP / SL</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.length > 0 
                    ? filteredOrders.map(renderOrderRow) 
                    : <tr><td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: themeTextMuted }}>No pending orders.</td></tr>}
                </tbody>
              </>
            )}

            {activeTab === 'History' && (
              <>
                <thead>
                  <tr>
                    <th style={thStyle}>Time</th>
                    <th style={thStyle}>Asset</th>
                    <th style={thStyle}>Type & Side</th>
                    <th style={thStyle}>Action</th>
                    <th style={thStyle}>Price</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Profit %</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredHistory.length > 0 
                    ? filteredHistory.map(renderHistoryRow) 
                    : <tr><td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: themeTextMuted }}>No history available.</td></tr>}
                </tbody>
              </>
            )}

          </table>
        )}
      </div>

      {/* Integration Modales */}
      {(() => {
        const orderFormContainer = document.getElementById('order-form-container');
        const symbol = activeTradeModal ? getSymbol(activeTradeModal) : '';
        const tradePriceData = prices[symbol];
        const isMarketOpen = tradePriceData ? (tradePriceData.isMarketOpen && !tradePriceData.isDayTradingClosed) : true;
        
        const modalEl = (
          <EditTradeModal 
            inline={!!orderFormContainer}
            isOpen={!!activeTradeModal} 
            onClose={() => setActiveTradeModal(null)} 
            trade={activeTradeModal} 
            symbol={symbol}
            liveMath={activeTradeModal ? getTradeLiveMath(activeTradeModal) : {}}
            onAction={(type: string, params: any) => executeAction(type, params, activeTradeModal)}
            theme={theme}
            isMarketOpen={isMarketOpen}
          />
        );
        return activeTradeModal && orderFormContainer ? createPortal(modalEl, orderFormContainer) : modalEl;
      })()}

      {(() => {
        const orderFormContainer = document.getElementById('order-form-container');
        const symbol = activeLimitModal ? getSymbol(activeLimitModal) : '';

        const limitModalEl = (
          <EditLimitModal 
            inline={!!orderFormContainer}
            isOpen={!!activeLimitModal} 
            onClose={() => setActiveLimitModal(null)} 
            order={activeLimitModal} 
            symbol={symbol}
            onAction={(type: string, params: any) => executeAction(type, params, activeLimitModal)}
            theme={theme}
            isMarketOpen={prices[symbol] ? (prices[symbol].isMarketOpen && !prices[symbol].isDayTradingClosed) : true}
          />
        );
        return activeLimitModal && orderFormContainer ? createPortal(limitModalEl, orderFormContainer) : limitModalEl;
      })()}

    </div>
  );
};