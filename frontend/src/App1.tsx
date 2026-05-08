import { useState, useEffect, useRef } from 'react';
import '@rainbow-me/rainbowkit/styles.css';
import { getDefaultConfig, RainbowKitProvider, ConnectButton } from '@rainbow-me/rainbowkit';
import { WagmiProvider, useAccount } from 'wagmi';
import { arbitrumSepolia } from 'wagmi/chains'; 
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';

// --- IMPORT DE TOUS NOS HOOKS ---
import { useOrderlyAuth } from './hooks/useOrderlyAuth';
import { useOrderlyDeposit } from './hooks/useOrderlyDeposit';
import { useOrderlyBalance } from './hooks/useOrderlyBalance';
import { useOrderlyWithdraw } from './hooks/useOrderlyWithdraw';
import { useOrderlyLeverage } from './hooks/useOrderlyLeverage';
import { useOrderlyOrder } from './hooks/useOrderlyOrder';

const config = getDefaultConfig({
  appName: 'Orderly Ultimate Terminal',
  projectId: 'test_project_id',
  chains: [arbitrumSepolia],
  ssr: false,
});
const queryClient = new QueryClient();

// ============================================================================
// WIDGET 1 : GESTION DES FONDS (DÉPÔT / RETRAIT)
// ============================================================================
function AssetManager({ accountId }: { accountId: string }) {
  const [amount, setAmount] = useState('');
  const { usdcBalance: walletBalance, deposit, isProcessing: isDepositing, logs: depLogs } = useOrderlyDeposit();
  const { usdcBalance: orderlyBalance, fetchBalance, isLoading: isFetchingBal } = useOrderlyBalance(accountId);
  const { withdraw, isWithdrawing, logs: wdLogs } = useOrderlyWithdraw(accountId);

  return (
    <div style={styles.widgetBox}>
      <h3 style={styles.widgetTitle}>🏦 Trésorerie (USDC)</h3>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px' }}>
        <div>
          <div style={{ fontSize: '12px', color: '#a4b0be' }}>Wallet (Arbitrum)</div>
          <div style={{ fontSize: '18px', color: '#26a69a', fontWeight: 'bold' }}>{walletBalance}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '12px', color: '#a4b0be' }}>Vault (Orderly)</div>
          <div style={{ fontSize: '18px', color: '#ef5350', fontWeight: 'bold' }}>
            {isFetchingBal ? '...' : orderlyBalance}
          </div>
        </div>
      </div>

      <input 
        type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
        placeholder="Montant en USDC" style={{...styles.input, width: '100%', marginBottom: '10px'}}
      />
      
      <div style={{ display: 'flex', gap: '10px' }}>
        <button style={styles.primaryBtn} onClick={() => deposit(amount)} disabled={isDepositing || !amount}>
          {isDepositing ? '...' : '⬇️ Déposer'}
        </button>
        <button style={styles.secondaryBtn} onClick={async () => { await withdraw(amount); fetchBalance(); }} disabled={isWithdrawing || !amount}>
          {isWithdrawing ? '...' : '⬆️ Retirer'}
        </button>
      </div>
      <div style={{ fontSize: '11px', color: '#a4b0be', marginTop: '10px', textAlign: 'center' }}>
        {depLogs || wdLogs}
      </div>
    </div>
  );
}

// ============================================================================
// WIDGET 2 : PANNEAU DE TRADING (LEVIER + ORDRES)
// ============================================================================
function TradingPanel({ accountId }: { accountId: string }) {
  const symbol = "PERP_ETH_USDC";
  const [tradeAmount, setTradeAmount] = useState('0.01');

  // Hook Levier
  const { availableLeverages, currentLeverage, fetchLeverageConfig, fetchMyLeverage, setMyLeverage } = useOrderlyLeverage(accountId);
  // Hook Ordres
  const { createOrder, isPlacingOrder, orderLogs } = useOrderlyOrder(accountId);

  useEffect(() => {
    fetchLeverageConfig();
    fetchMyLeverage(symbol);
  }, [fetchLeverageConfig, fetchMyLeverage]);

  const handleTrade = async (side: 'BUY' | 'SELL') => {
    await createOrder({
      symbol,
      order_type: 'MARKET',
      side,
      order_quantity: Number(tradeAmount)
    });
  };

  return (
    <div style={styles.widgetBox}>
      <h3 style={styles.widgetTitle}>⚡ Trading ({symbol})</h3>
      
      {/* Configuration du Levier */}
      <div style={{ marginBottom: '15px' }}>
        <div style={{ fontSize: '12px', color: '#a4b0be', marginBottom: '8px' }}>Levier actuel : <span style={{color: '#f39c12', fontWeight: 'bold'}}>x{currentLeverage}</span></div>
        <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
          {availableLeverages.slice(0, 5).map((lev) => (
            <button key={lev} onClick={() => setMyLeverage(symbol, lev)}
              style={{ padding: '6px 10px', background: currentLeverage === lev ? '#f39c12' : '#2f3542', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>
              x{lev}
            </button>
          ))}
        </div>
      </div>

      {/* Passage d'ordre */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
        <input 
          type="number" step="0.01" value={tradeAmount} onChange={(e) => setTradeAmount(e.target.value)}
          placeholder="Quantité ETH" style={{...styles.input, flex: 1}}
        />
        <div style={{ display: 'flex', alignItems: 'center', color: '#a4b0be', fontSize: '14px' }}>ETH</div>
      </div>

      <div style={{ display: 'flex', gap: '10px' }}>
        <button style={{...styles.primaryBtn, background: '#26a69a'}} onClick={() => handleTrade('BUY')} disabled={isPlacingOrder}>
          Acheter (Long)
        </button>
        <button style={{...styles.primaryBtn, background: '#ef5350'}} onClick={() => handleTrade('SELL')} disabled={isPlacingOrder}>
          Vendre (Short)
        </button>
      </div>
      
      <div style={{ fontSize: '11px', color: '#a4b0be', marginTop: '10px', textAlign: 'center' }}>{orderLogs}</div>
    </div>
  );
}

// ============================================================================
// WIDGET 3 : FLUX DE MARCHÉ EN DIRECT (WEBSOCKET)
// ============================================================================
function LiveMarketFeed({ accountId }: { accountId: string }) {
  const [price, setPrice] = useState<{ask: number | null, bid: number | null}>({ask: null, bid: null});
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!accountId) return;
    const ws = new WebSocket(`wss://testnet-ws-evm.orderly.org/ws/stream/${accountId}`);
    wsRef.current = ws;

    ws.onopen = () => ws.send(JSON.stringify({ id: "sub-ob", event: "subscribe", topic: "PERP_ETH_USDC@orderbook" }));
    ws.onmessage = (event) => {
      try {
        const res = JSON.parse(event.data);
        if (res.event === "ping") { ws.send(JSON.stringify({ event: "pong" })); return; }
        if (res.topic === "PERP_ETH_USDC@orderbook" && res.data) {
          setPrice({
            ask: res.data.asks?.[0]?.[0] || null,
            bid: res.data.bids?.[0]?.[0] || null,
          });
        }
      } catch (e) {}
    };
    return () => ws.close();
  }, [accountId]);

  return (
    <div style={styles.widgetBox}>
      <h3 style={styles.widgetTitle}>📡 Marché en direct (ETH)</h3>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '15px', background: '#1E222D', borderRadius: '8px' }}>
        <div>
          <div style={{ color: '#808e9b', fontSize: '12px' }}>Acheteurs (Bid)</div>
          <div style={{ color: '#26a69a', fontSize: '20px', fontFamily: 'var(--mono)' }}>{price.bid ? `$${price.bid.toFixed(2)}` : '...'}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ color: '#808e9b', fontSize: '12px' }}>Vendeurs (Ask)</div>
          <div style={{ color: '#ef5350', fontSize: '20px', fontFamily: 'var(--mono)' }}>{price.ask ? `$${price.ask.toFixed(2)}` : '...'}</div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// COMPOSANT MAÎTRE : LE TERMINAL COMPLET
// ============================================================================
function MasterTerminal() {
  const { isConnected } = useAccount();
  const { status, logs, isLoading, registerAccount, createKey, accountId } = useOrderlyAuth();

  if (!isConnected) {
    return (
      <div style={styles.centerContainer}>
        <h1>Terminal Kodiak</h1>
        <p>Connectez votre portefeuille pour commencer.</p>
        <ConnectButton />
      </div>
    );
  }

  if (status !== 'key_ready' || !accountId) {
    return (
      <div style={styles.centerContainer}>
        <h2>Authentification Orderly</h2>
        <div style={styles.logsBox}>{logs}</div>
        {status === 'unregistered' && <button style={styles.primaryBtn} onClick={registerAccount} disabled={isLoading}>1. Créer le compte</button>}
        {status === 'registered' && <button style={styles.secondaryBtn} onClick={createKey} disabled={isLoading}>2. Générer Clé API</button>}
        <div style={{ marginTop: '20px' }}><ConnectButton /></div>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', maxWidth: '1000px', padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', background: '#131722', padding: '15px 20px', borderRadius: '12px', border: '1px solid #2f3542' }}>
        <h2 style={{ margin: 0, color: 'white' }}>Terminal de Trading</h2>
        <ConnectButton />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
        {/* Colonne 1 : Finance & Marché */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <AssetManager accountId={accountId} />
          <LiveMarketFeed accountId={accountId} />
        </div>
        
        {/* Colonne 2 : Trading */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <TradingPanel accountId={accountId} />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          <div style={{ minHeight: '100vh', backgroundColor: '#0B0E14', display: 'flex', justifyContent: 'center', fontFamily: 'var(--sans)' }}>
            <MasterTerminal />
          </div>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

// ============================================================================
// STYLES
// ============================================================================
const styles = {
  centerContainer: { display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', background: '#131722', color: 'white', padding: '40px', borderRadius: '16px', border: '1px solid #2f3542', marginTop: '10vh', maxWidth: '450px', width: '100%' },
  logsBox: { padding: '12px', background: '#1E222D', borderRadius: '8px', color: '#a4b0be', fontSize: '14px', width: '100%', textAlign: 'center' as const, marginBottom: '20px' },
  primaryBtn: { width: '100%', padding: '12px', background: '#2962ff', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer' },
  secondaryBtn: { width: '100%', padding: '12px', background: '#1E222D', border: '1px solid #2f3542', color: '#fff', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer' },
  widgetBox: { background: '#131722', borderRadius: '12px', padding: '20px', border: '1px solid #2f3542', color: 'white' },
  widgetTitle: { color: '#ffffff', margin: '0 0 20px 0', fontSize: '16px', borderBottom: '1px solid #2f3542', paddingBottom: '10px' },
  input: { padding: '12px', borderRadius: '8px', border: '1px solid #2f3542', background: '#1e222d', color: 'white', fontSize: '14px', outline: 'none', boxSizing: 'border-box' as const }
};