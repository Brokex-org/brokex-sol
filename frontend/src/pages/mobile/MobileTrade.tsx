import { useState, useEffect, useMemo } from 'react';
import { useTheme } from '../../ThemeContext';
import { usePriceContext } from '../../contexts/PriceContext';
import { useOstiumSubgraph } from '../../hooks/useOstiumSubgraph';
import { usePythBenchmarks } from '../../hooks/usePythBenchmarks';
import { useToast } from '../../contexts/ToastContext';
import { useNetwork } from '../../contexts/NetworkContext';
import { mapPair } from '../../utils/ostium/utils';
import { AssetSelectionModal } from '../../components/AssetSelectionModal';
import { TpSlPanel } from '../../components/TpSlPanel';
import { TVChart } from '../../components/TVChart';
import { OrderForm } from '../../components/OrderForm';
import { PositionsPanel } from '../../components/PositionsPanel';

const goldAccent = '#BC8961';
const goldAccentLight = 'rgba(188, 137, 97, 0.15)';

// ── Mini sparkline ────────────────────────────────────────────────────────────
const MiniSparkline = ({ change }: { change: number | null }) => {
  const color = change === null ? '#555' : change >= 0 ? '#3b82f6' : '#ef4444';
  const fakeData = change === null
    ? [0, 0, 0, 0, 0]
    : change >= 0
      ? [2, 3, 2.5, 4, 5, 4.5, 6]
      : [6, 5, 4.5, 3.5, 3, 2, 1];

  const min = Math.min(...fakeData);
  const max = Math.max(...fakeData);
  const range = max - min || 1;
  const w = 48;
  const h = 20;
  const pts = fakeData.map((v, i) => {
    const x = (i / (fakeData.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x},${y}`;
  }).join(' L ');

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} fill="none">
      <path d={`M ${pts}`} stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

export function MobileTrade() {
  const {
    themeBg, themeControlBg, themeBorder, themeText, themeTextMuted,
    buyColor, sellColor, buyColorBg, sellColorBg,
  } = useTheme();

  const { currentPriceData, selectedAsset, setSelectedAsset, prices } = usePriceContext();
  const { isTestnet } = useNetwork();
  const { addToast } = useToast();
  const { getPairs } = useOstiumSubgraph();
  const { get24hChange } = usePythBenchmarks();

  // ── State ──────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<'chart' | 'positions'>('chart');
  const [isMobileOrderFormOpen, setIsMobileOrderFormOpen] = useState(false);
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [orderType, setOrderType] = useState<'market' | 'limit' | 'stop'>('market');
  const [leverage, setLeverage] = useState(10);
  const [collateralAmount, setCollateralAmount] = useState('100');
  const [targetPrice, setTargetPrice] = useState('');
  const [tpAmount, setTpAmount] = useState('');
  const [slAmount, setSlAmount] = useState('');
  const [isTpSlOpen, setIsTpSlOpen] = useState(false);
  const [solAddress, setSolAddress] = useState<string | null>(null);
  const [pairs, setPairs] = useState<any[]>([]);
  const [apiRates, setApiRates] = useState<any[]>([]);
  const [isAssetMenuOpen, setIsAssetMenuOpen] = useState(false);
  const [activeGroup, setActiveGroup] = useState('All');

  // ── Asset groups for modal ─────────────────────────────────────────────────
  const groups = useMemo(() => {
    const rawGroups = pairs.map((p) => p.group).filter(Boolean);
    const unique = Array.from(new Set(rawGroups));
    return ['All', ...unique.sort((a, b) => a.localeCompare(b))];
  }, [pairs]);

  useEffect(() => {
    const provider = (window as unknown as {
      solana?: {
        isPhantom?: boolean;
        publicKey?: { toBase58: () => string };
        connect?: () => Promise<unknown>;
        on?: (ev: string, fn: () => void) => void;
        removeListener?: (ev: string, fn: () => void) => void;
      };
    }).solana;
    if (!provider?.isPhantom) return;

    const onConnect = () => {
      setSolAddress(provider.publicKey ? provider.publicKey.toBase58() : null);
    };
    const onDisconnect = () => setSolAddress(null);
    const onAccountChanged = () => onConnect();

    onConnect();
    provider.on?.('connect', onConnect);
    provider.on?.('disconnect', onDisconnect);
    provider.on?.('accountChanged', onAccountChanged);

    return () => {
      provider.removeListener?.('connect', onConnect);
      provider.removeListener?.('disconnect', onDisconnect);
      provider.removeListener?.('accountChanged', onAccountChanged);
    };
  }, []);

  // ── Fetch pairs ────────────────────────────────────────────────────────────
  useEffect(() => {
    getPairs().then((data) => setPairs(data.map(mapPair))).catch(console.error);
  }, [getPairs]);

  // ── Fetch Funding Rates ───────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    const fetchRates = () => {
      fetch('/api/datalake/rates/current')
        .then(res => res.json())
        .then(res => {
          if (mounted && res.success) {
            setApiRates(res.data);
          }
        })
        .catch(console.error);
    };
    fetchRates();
    const interval = setInterval(fetchRates, 30000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  // ── Computed ───────────────────────────────────────────────────────────────
  const selectedPair = useMemo(() => pairs.find((p) => p.from === selectedAsset) || null, [pairs, selectedAsset]);
  const parseLev = (v: any) => { const n = Number(v); return isNaN(n) || n <= 0 ? 0 : Math.floor(n / 100); };
  const pairMax = parseLev(selectedPair?.maxLeverage);
  const groupMax = parseLev(selectedPair?.group?.maxLeverage);
  const maxLev = pairMax > 0 ? pairMax : (groupMax > 0 ? groupMax : 100);
  const minLev = Math.max(1, parseLev(selectedPair?.group?.minLeverage));

  const askPrice = currentPriceData?.ask != null ? Number(currentPriceData.ask).toFixed(currentPriceData.ask < 10 ? 4 : 2) : '---';
  const bidPrice = currentPriceData?.bid != null ? Number(currentPriceData.bid).toFixed(currentPriceData.bid < 10 ? 4 : 2) : '---';
  const currentPrice = currentPriceData?.mid != null ? Number(currentPriceData.mid) : 0;
  const dailyChange = get24hChange(selectedAsset);

  // ── Open Interest & Funding ──────────────────────────────────────────────
  const livePrice = currentPriceData?.mid ? Number(currentPriceData.mid) : 0;
  const longOIUsd = selectedPair ? (selectedPair.longOI * livePrice) : 0;
  const shortOIUsd = selectedPair ? (selectedPair.shortOI * livePrice) : 0;

  const currentAssetRates = apiRates.find(
    r => r.pairFrom?.toUpperCase() === selectedAsset?.toUpperCase()
  ) ?? null;

  const longFunding = currentAssetRates ? (Number(currentAssetRates.longRate) * (1 / 8)) : 0;
  const shortFunding = currentAssetRates ? (Number(currentAssetRates.shortRate) * (1 / 8)) : 0;

  const formatUsd = (val: number) => {
    if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
    if (val >= 1_000) return `$${(val / 1_000).toFixed(1)}k`;
    return `$${val.toFixed(0)}`;
  };

  const collatNum = Number(collateralAmount || 0);

  // ─── Fee Calculation ─────────────────────────────────────────────────────
  const ORACLE_FEE_USD = isTestnet ? 0.50 : 0.10;

  const rawFeeP = orderType === 'market'
    ? Number(selectedPair?.takerFeeP ?? 0)
    : Number(selectedPair?.makerFeeP ?? 0);

  const builderFeeRaw = Math.min(Math.floor((rawFeeP * 1_000_000) / 3), 500000);
  const totalRawFeeP = (rawFeeP * 1_000_000) + builderFeeRaw;
  const totalFeePct = totalRawFeeP / 1_000_000;
  const feeRatio = totalFeePct / 100;

  // ─── Net Size Calculation (Accounting for fees deducted from collateral) ───
  // Formula: Size = ((Collat - Oracle) * Lev) / (1 + Lev * FeeRatio)
  const netCollateralBase = Math.max(0, collatNum - ORACLE_FEE_USD);
  const estimatedSizeUSDNum = collatNum > 0
    ? (netCollateralBase * leverage) / (1 + (leverage * feeRatio))
    : 0;

  const tradingFeeUsd = estimatedSizeUSDNum * feeRatio;
  const totalFeesUsd = collatNum > 0 ? ORACLE_FEE_USD + tradingFeeUsd : 0;

  const liqPrice = currentPrice > 0 && leverage >= 1
    ? side === 'buy'
      ? currentPrice * (1 - 0.95 / leverage)
      : currentPrice * (1 + 0.95 / leverage)
    : 0;

  const pct = maxLev > minLev ? ((leverage - minLev) / (maxLev - minLev)) * 100 : 0;
  const sliderBg = `linear-gradient(to right, ${goldAccent} ${pct}%, ${themeBorder} ${pct}%)`;

  const connectPhantom = async () => {
    const p = (window as unknown as {
      solana?: { isPhantom?: boolean; connect?: () => Promise<unknown> };
    }).solana;
    if (!p?.isPhantom) {
      addToast({ type: 'warning', title: 'Phantom', message: 'Install Phantom for Solana.' });
      window.open('https://phantom.app/', '_blank', 'noopener,noreferrer');
      return;
    }
    try {
      await p.connect?.();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Connect failed';
      addToast({ type: 'error', title: 'Phantom', message: msg.slice(0, 80) });
    }
  };

  // ── Quick leverages ────────────────────────────────────────────────────────
  const quickLevs = useMemo(() => {
    let mids: number[] = maxLev <= 10 ? [2, 5] : maxLev <= 25 ? [5, 10, 20] : maxLev <= 50 ? [10, 25, 40] : [10, 25, 50, 75];
    return Array.from(new Set([minLev, ...mids.filter((s) => s > minLev && s < maxLev), maxLev])).sort((a, b) => a - b);
  }, [maxLev, minLev]);

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: themeBg,
        overflow: 'hidden',
        height: '100%',
        width: '100%',
      }}
    >
      <style>{`
        .m-hide-sb::-webkit-scrollbar { display: none; }
        .m-hide-sb { -ms-overflow-style: none; scrollbar-width: none; }
        .m-no-spin::-webkit-outer-spin-button, .m-no-spin::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        .m-no-spin { -moz-appearance: textfield; }
        .m-slider { -webkit-appearance: none; appearance: none; width: 100%; height: 4px; border-radius: 2px; outline: none; cursor: pointer; }
        .m-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 18px; height: 18px; border-radius: 50%; background: #fff; cursor: pointer; border: 2px solid ${goldAccent}; box-shadow: 0 0 6px rgba(188,137,97,0.4); }
      `}</style>

      {/* ── Asset Header / View Toggle Header ───────────────────────────────── */}
      <div
        style={{
          padding: '0.75rem 1rem',
          borderBottom: `1px solid ${themeBorder}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}
      >
        {isMobileOrderFormOpen ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button
              onClick={() => setIsMobileOrderFormOpen(false)}
              style={{ background: themeControlBg, border: `1px solid ${themeBorder}`, borderRadius: '8px', padding: '6px 10px', color: themeText, display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
              Chart
            </button>
            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: themeText }}>Trade {selectedAsset}</span>
          </div>
        ) : (
          <>
            {/* Asset selector trigger */}
            <button
              onClick={() => setIsAssetMenuOpen(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                background: themeControlBg,
                border: `1px solid ${themeBorder}`,
                borderRadius: '10px',
                padding: '6px 12px',
                cursor: 'pointer',
                color: themeText,
              }}
            >
              <div
                style={{
                  width: '22px',
                  height: '22px',
                  borderRadius: '50%',
                  background: `linear-gradient(135deg, ${goldAccent}, #8b5e3c)`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.65rem',
                  fontWeight: 700,
                  color: '#fff',
                }}
              >
                {selectedAsset.charAt(0)}
              </div>
              <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>{selectedAsset}/USD</span>
              <span style={{ fontSize: '0.55rem', color: themeTextMuted }}>▼</span>
            </button>

            {/* Price + change */}
            <div style={{ textAlign: 'right' }}>
              <div
                style={{
                  fontSize: '1.1rem',
                  fontWeight: 700,
                  color: themeText,
                  fontFamily: 'var(--mono)',
                  lineHeight: 1,
                }}
              >
                ${currentPrice > 0 ? currentPrice.toFixed(currentPrice < 10 ? 4 : 2) : '---'}
              </div>
              {dailyChange !== null && (
                <div
                  style={{
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    color: dailyChange >= 0 ? buyColor : sellColor,
                    marginTop: '3px',
                    fontFamily: 'var(--mono)',
                  }}
                >
                  {dailyChange > 0 ? '+' : ''}{dailyChange.toFixed(2)}%
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Content Area ─────────────────────────────────────────────────── */}
      <div
        className="m-hide-sb"
        style={{
          flex: 1,
          overflowY: isMobileOrderFormOpen || activeTab === 'positions' ? 'auto' : 'hidden',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
        }}
      >
        {isMobileOrderFormOpen ? (
          <div style={{ padding: '0.75rem', flexShrink: 0 }}>
            <OrderForm />
          </div>
        ) : isAssetMenuOpen ? (
          <div style={{ flex: 1, position: 'relative' }}>
            <AssetSelectionModal
              isOpen={isAssetMenuOpen}
              onClose={() => setIsAssetMenuOpen(false)}
              pairs={pairs}
              isLoading={false}
              groups={groups}
              activeGroup={activeGroup}
              setActiveGroup={setActiveGroup}
              selectedAsset={selectedAsset}
              setSelectedAsset={(a) => { setSelectedAsset(a); setIsAssetMenuOpen(false); }}
              prices={prices}
              get24hChange={get24hChange}
              themeBorder={themeBorder}
              themeText={themeText}
              themeTextMuted={themeTextMuted}
              themeControlBg={themeControlBg}
              themeBg={themeBg}
              buyColor={buyColor}
              sellColor={sellColor}
              inline={true}
            />
          </div>
        ) : (
          <>
            {/* ── Market stats strip ───────────────────────────────────────────── */}
            <div
              className="m-hide-sb"
              style={{
                display: 'flex',
                gap: '1.25rem',
                padding: '0.6rem 1rem',
                borderBottom: `1px solid ${themeBorder}`,
                overflowX: 'auto',
                flexShrink: 0,
                fontSize: '0.65rem',
                backgroundColor: themeBg,
              }}
            >
              {[
                { label: 'Ask', value: askPrice, color: sellColor },
                { label: 'Bid', value: bidPrice, color: buyColor },
                { label: 'Long OI', value: formatUsd(longOIUsd), color: themeText },
                { label: 'Short OI', value: formatUsd(shortOIUsd), color: themeText },
                { label: 'Funding L', value: `${longFunding.toFixed(4)}%`, color: longFunding < 0 ? sellColor : buyColor },
                { label: 'Funding S', value: `${shortFunding.toFixed(4)}%`, color: shortFunding < 0 ? sellColor : buyColor },
                { label: 'Liq.', value: liqPrice > 0 ? `$${liqPrice.toFixed(2)}` : '—', color: sellColor },
                { label: 'Size', value: `$${estimatedSizeUSDNum.toLocaleString('en-US', { maximumFractionDigits: 0 })}`, color: themeText },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ flexShrink: 0 }}>
                  <div style={{ color: themeTextMuted, marginBottom: '2px', fontSize: '0.6rem', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.02em' }}>{label}</div>
                  <div style={{ color, fontWeight: 700, fontFamily: 'var(--mono)', fontSize: '0.7rem' }}>{value}</div>
                </div>
              ))}
              <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                <MiniSparkline change={dailyChange} />
              </div>
            </div>

            {/* ── Tab Bar ──────────────────────────────────────────────────────── */}
            <div
              style={{
                display: 'flex',
                borderBottom: `1px solid ${themeBorder}`,
                flexShrink: 0,
              }}
            >
              {(['chart', 'positions'] as const).map((tab) => {
                const label = tab === 'chart' ? 'Chart' : 'Positions';
                const active = activeTab === tab;
                return (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    style={{
                      flex: 1,
                      padding: '0.6rem',
                      fontSize: '0.72rem',
                      fontWeight: active ? 700 : 400,
                      color: active ? goldAccent : themeTextMuted,
                      background: 'none',
                      border: 'none',
                      borderBottom: `2px solid ${active ? goldAccent : 'transparent'}`,
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {/* Sub-tab content */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, position: 'relative', width: '100%', height: '100%' }}>
              {activeTab === 'chart' && (
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                  height: '100%',
                  width: '100%'
                }}>
                  <TVChart />
                </div>
              )}

              {activeTab === 'positions' && (
                <div
                  style={{
                    flex: 1,
                    minHeight: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                  }}
                >
                  <PositionsPanel />
                </div>
              )}
            </div>
            {/* ── Mobile Trade Button (Integrated) ────────────────────────────── */}
            <div style={{ padding: '0.75rem', borderTop: `1px solid ${themeBorder}`, backgroundColor: themeBg, flexShrink: 0 }}>
              <button
                type="button"
                onClick={() => (solAddress ? setIsMobileOrderFormOpen(true) : void connectPhantom())}
                style={{ 
                  width: '100%',
                  backgroundColor: goldAccent, 
                  color: '#fff', 
                  border: 'none', 
                  borderRadius: '8px', 
                  padding: '0.75rem', 
                  fontSize: '0.9rem', 
                  fontWeight: 700, 
                  cursor: 'pointer',
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  gap: '10px',
                  textTransform: 'uppercase', 
                  letterSpacing: '0.05em'
                }}
              >
                {solAddress ? (
                  <>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"></polyline>
                      <polyline points="16 7 22 7 22 13"></polyline>
                    </svg>
                    Trade
                  </>
                ) : (
                  <>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><polyline points="10 17 15 12 10 7" /><line x1="15" y1="12" x2="3" y2="12" />
                    </svg>
                    Connect Phantom
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
