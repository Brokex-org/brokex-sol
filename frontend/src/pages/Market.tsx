import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../ThemeContext';
import { usePriceContext } from '../contexts/PriceContext';
import { useOstiumSubgraph } from '../hooks/useOstiumSubgraph';
import { usePythBenchmarks } from '../hooks/usePythBenchmarks';
import { mapPair, formatPrice } from '../utils/ostium/utils';
import { AssetIcon } from '../components/AssetIcon';

const goldAccent = '#BC8961';
const goldAccentLight = 'rgba(188, 137, 97, 0.12)';

// ─── Sparkline ───────────────────────────────────────────────────────────────
const Sparkline = ({ data, color }: { data: number[]; color: string }) => {
  if (!data || data.length < 2) return <span style={{ color: '#444', fontSize: '0.55rem' }}>—</span>;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const W = 52, H = 18;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * W},${H - ((v - min) / range) * H}`).join(' L ');
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} fill="none">
      <path d={`M ${pts}`} stroke={color} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

// ─── Funding rate display: annualized % with color ───────────────────────────
const FundingCell = ({ rate, themeTextMuted, buyColor, sellColor }: { rate: number; themeTextMuted: string; buyColor: string; sellColor: string }) => {
  if (rate === 0 || isNaN(rate)) return <span style={{ color: themeTextMuted }}>—</span>;
  // rate is per-block, annualize: blocks/yr ≈ 2_628_000 on Arbitrum (2s blocks)
  const annualized = rate * 2_628_000 * 100;
  const isPos = annualized >= 0;
  return (
    <span className="font-mono" style={{
      color: isPos ? buyColor : sellColor,
      fontSize: '0.68rem',
      fontWeight: 600,
    }}>
      {isPos ? '+' : ''}{annualized.toFixed(4)}%
    </span>
  );
};

// ─── Sortable header cell ─────────────────────────────────────────────────────
type SortKey = 'name' | 'price' | 'change24h' | 'spread' | 'leverage' | 'fundingLong' | 'takerFee';
const SortTh = ({
  label, col, sortKey, sortDir, onSort, align = 'right', style = {}
}: {
  label: string; col: SortKey; sortKey: SortKey; sortDir: 'asc' | 'desc';
  onSort: (c: SortKey) => void; align?: 'left' | 'right'; style?: React.CSSProperties;
}) => {
  const active = sortKey === col;
  return (
    <th onClick={() => onSort(col)} style={{
      padding: '0.5rem 0.6rem', textAlign: align, fontWeight: 500, fontSize: '0.58rem',
      color: active ? goldAccent : '#666', cursor: 'pointer', userSelect: 'none',
      whiteSpace: 'nowrap', letterSpacing: '0.04em', ...style
    }}>
      {label}{' '}
      <span style={{ fontSize: '0.45rem', opacity: active ? 1 : 0.4, color: active ? goldAccent : 'inherit' }}>
        {active ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
      </span>
    </th>
  );
};

// ─── Main ─────────────────────────────────────────────────────────────────────
export function Market() {
  const { themeBg, themeControlBg, themeBorder, themeText, themeTextMuted, buyColor, sellColor } = useTheme();
  const navigate = useNavigate();
  const { prices } = usePriceContext();
  const { getPairs } = useOstiumSubgraph();
  const { benchmarks, get24hChange, ASSET_TO_PYTH_SYMBOL } = usePythBenchmarks();

  const [pairs, setPairs] = useState<any[]>([]);
  const [apiRates, setApiRates] = useState<any[]>([]);
  const [activeFilter, setActiveFilter] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('assetFavorites') || '[]')); }
    catch { return new Set(); }
  });

  const toggleFavorite = useCallback((sym: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setFavorites(prev => {
      const next = new Set(prev);
      if (next.has(sym)) next.delete(sym); else next.add(sym);
      try { localStorage.setItem('assetFavorites', JSON.stringify([...next])); } catch {}
      return next;
    });
  }, []);

  useEffect(() => {
    let m = true;
    getPairs().then(d => { if (m) setPairs(d.map(mapPair)); }).catch(console.error);
    return () => { m = false; };
  }, [getPairs]);

  // ─── Fetch API Rates (1h rates logic) ──────────────────────────────────
  useEffect(() => {
    let mounted = true;
    const fetchRates = () => {
      fetch('/api/datalake/rates/current')
        .then(res => res.json())
        .then(res => {
          if (mounted && res.success) setApiRates(res.data);
        })
        .catch(console.error);
    };
    fetchRates();
    const interval = setInterval(fetchRates, 30000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  const groups = useMemo(() => {
    const raw = pairs.map(p => p.group).filter(Boolean);
    return ['All', 'Favorites', ...Array.from(new Set(raw)).sort((a, b) => a.localeCompare(b))];
  }, [pairs]);

  const onSort = (col: SortKey) => {
    if (sortKey === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(col); setSortDir('asc'); }
  };

  const enriched = useMemo(() => pairs.map(pair => {
    const pd = prices[pair.from];
    const mid = pd?.mid ? Number(pd.mid) : 0;
    const ask = pd?.ask ? Number(pd.ask) : 0;
    const bid = pd?.bid ? Number(pd.bid) : 0;
    const spread = ask && bid ? ask - bid : null;
    const spreadPct = mid > 0 && spread !== null ? (spread / mid) * 100 : null;
    const change24h = get24hChange(pair.from);
    const pythSym = ASSET_TO_PYTH_SYMBOL[pair.from];
    const sparkline = pythSym && benchmarks[pythSym]?.sparkline ? benchmarks[pythSym].sparkline : [];
    
    const takerFeePct = Number(pair.takerFeeP ?? 0); 
    const makerFeePct = Number(pair.makerFeeP ?? 0);

    // Funding from API (1h rate = base / 8)
    const assetRates = apiRates.find(r => r.pairFrom?.toUpperCase() === pair.from?.toUpperCase());
    const fundingLong1h = assetRates ? (Number(assetRates.longRate) / 8) : 0;
    const fundingShort1h = assetRates ? (Number(assetRates.shortRate) / 8) : 0;

    return {
      ...pair, mid, ask, bid, spread, spreadPct, change24h, sparkline, takerFeePct, makerFeePct,
      fundingLong1h, fundingShort1h
    };
  }), [pairs, prices, get24hChange, benchmarks, ASSET_TO_PYTH_SYMBOL, apiRates]);

  const filtered = useMemo(() => {
    let list = enriched.filter(p => {
      if (activeFilter === 'Favorites') return favorites.has(p.from);
      const matchGroup = activeFilter === 'All' || p.group === activeFilter;
      const matchSearch = `${p.from}${p.to}`.toLowerCase().includes(searchTerm.toLowerCase());
      return matchGroup && matchSearch;
    });
    list = [...list].sort((a, b) => {
      let va: any, vb: any;
      switch (sortKey) {
        case 'name': va = a.from; vb = b.from; break;
        case 'price': va = a.mid; vb = b.mid; break;
        case 'change24h': va = a.change24h ?? -Infinity; vb = b.change24h ?? -Infinity; break;
        case 'spread': va = a.spreadPct ?? Infinity; vb = b.spreadPct ?? Infinity; break;
        case 'leverage': va = a.maxLeverage ?? 0; vb = b.maxLeverage ?? 0; break;
        case 'fundingLong': va = a.fundingLong1h ?? 0; vb = b.fundingLong1h ?? 0; break;
        case 'takerFee': va = a.takerFeePct ?? 0; vb = b.takerFeePct ?? 0; break;
      }
      const m = sortDir === 'asc' ? 1 : -1;
      return typeof va === 'string' ? va.localeCompare(vb) * m : (va - vb) * m;
    });
    return list;
  }, [enriched, activeFilter, searchTerm, favorites, sortKey, sortDir]);

  const topGainers = useMemo(() => [...enriched].filter(p => p.change24h !== null && p.mid > 0).sort((a, b) => (b.change24h ?? 0) - (a.change24h ?? 0)).slice(0, 4), [enriched]);
  const topLosers = useMemo(() => [...enriched].filter(p => p.change24h !== null && p.mid > 0).sort((a, b) => (a.change24h ?? 0) - (b.change24h ?? 0)).slice(0, 4), [enriched]);
  const favList = useMemo(() => enriched.filter(p => favorites.has(p.from)).slice(0, 4), [enriched, favorites]);

  const MoverCard = ({ p, color, icon }: { p: any; color: string; icon: string }) => {
    const chg = p.change24h ?? 0;
    return (
      <div onClick={() => navigate(`/${p.from}USD`)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0.25rem 1rem 0.25rem 1rem', cursor: 'pointer', borderBottom: `1px solid ${themeBorder}`,
          transition: 'background 0.12s',
        }}
        onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.backgroundColor = goldAccentLight}
        onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent'}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <AssetIcon symbol={`${p.from}${p.to || 'USD'}`} size="20px" borderRadius="4px" themeControlBg={themeControlBg} themeText={themeText} themeBorder={themeBorder} />
          <span style={{ fontWeight: 700, fontSize: '0.72rem', color: themeText }}>{p.from}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '0.68rem', fontWeight: 600, color: themeTextMuted }}>${formatPrice(p.mid)}</span>
          <span style={{
            fontFamily: 'var(--mono)', fontSize: '0.62rem', fontWeight: 700, color,
            backgroundColor: `${color}15`, padding: '1px 6px', borderRadius: '3px',
          }}>
            {icon}{Math.abs(chg).toFixed(2)}%
          </span>
        </div>
      </div>
    );
  };

  const SectionHeader = ({ title, badge, badgeColor }: { title: string; badge: string; badgeColor: string }) => (
    <div style={{ padding: '0.3rem 0.65rem 0.3rem 1rem', borderBottom: `1px solid ${themeBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
        <span style={{ fontSize: '0.62rem', fontWeight: 700, color: themeText, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{title}</span>
        <span style={{ fontSize: '0.48rem', color: badgeColor, fontWeight: 700, backgroundColor: `${badgeColor}18`, padding: '1px 5px', borderRadius: '3px' }}>{badge}</span>
      </div>
    </div>
  );

  return (
    <div style={{ flex: 1, backgroundColor: themeBg, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', fontFamily: 'var(--sans)' }}>
      <style>{`
        .mk-sb::-webkit-scrollbar { display: none; }
        .mk-sb { -ms-overflow-style: none; scrollbar-width: none; }
        .mk-tr:hover { background-color: rgba(188,137,97,0.06) !important; cursor: pointer; }
        .mk-filter-btn { transition: all 0.15s; }
        .mk-filter-btn:hover { color: ${goldAccent}; }
      `}</style>

      {/* ── Top Layout: Movers + Favorites ───────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', borderBottom: `1px solid ${themeBorder}` }}>

        {/* Gainers */}
        <div style={{ borderRight: `1px solid ${themeBorder}` }}>
          <SectionHeader title="Top Gainers" badge="24H" badgeColor={buyColor} />
          {topGainers.map(p => <MoverCard key={p.from} p={p} color={buyColor} icon="+" />)}
        </div>

        {/* Losers */}
        <div style={{ borderRight: `1px solid ${themeBorder}` }}>
          <SectionHeader title="Top Losers" badge="24H" badgeColor={sellColor} />
          {topLosers.map(p => <MoverCard key={p.from} p={p} color={sellColor} icon="−" />)}
        </div>

        {/* Favorites */}
        <div>
          <SectionHeader title="Favorites" badge={`${favList.length}`} badgeColor={goldAccent} />
          {favList.length > 0 ? (
            favList.map(p => <MoverCard key={p.from} p={p} color={goldAccent} icon="★" />)
          ) : (
            <div style={{ padding: '1.2rem 0.65rem', textAlign: 'center', fontSize: '0.58rem', color: themeTextMuted, lineHeight: 1.4 }}>
              Bookmark assets to track them here.
            </div>
          )}
        </div>
      </div>

      {/* ── Filters + Search ──────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.55rem 1rem', borderBottom: `1px solid ${themeBorder}`, gap: '1rem' }}>
        <div className="mk-sb" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', overflowX: 'auto', flexShrink: 1 }}>
          {groups.map(g => {
            const label = g.toLowerCase() === 'etf' ? 'ETF' : g.charAt(0).toUpperCase() + g.slice(1);
            const active = activeFilter === g;
            return (
              <button key={g} onClick={() => setActiveFilter(g)} className="mk-filter-btn" style={{
                flexShrink: 0, padding: '0.22rem 0.7rem', borderRadius: '3px', cursor: 'pointer',
                fontSize: '0.67rem', fontWeight: active ? 700 : 400,
                color: active ? goldAccent : themeTextMuted,
                backgroundColor: active ? goldAccentLight : 'transparent',
                border: `1px solid ${active ? goldAccent : 'transparent'}`,
              }}>
                {label}
                {g === 'Favorites' && favorites.size > 0 &&
                  <span style={{ marginLeft: '4px', backgroundColor: goldAccent, color: '#000', borderRadius: '3px', padding: '0 3px', fontSize: '0.5rem', fontWeight: 700 }}>{favorites.size}</span>
                }
              </button>
            );
          })}
        </div>
        <div style={{ position: 'relative', flexShrink: 0, width: '200px' }}>
          <span style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', color: goldAccent, fontSize: '0.75rem', pointerEvents: 'none' }}>⌕</span>
          <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Search markets…"
            style={{ width: '100%', boxSizing: 'border-box', backgroundColor: themeControlBg, border: `1px solid ${themeBorder}`, borderRadius: '3px', padding: '0.3rem 0.8rem 0.3rem 2rem', color: themeText, fontSize: '0.7rem', outline: 'none' }} />
        </div>
      </div>

      {/* ── Table ─────────────────────────────────────────────────────────────── */}
      <div className="mk-sb" style={{ flex: 1, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.7rem', color: themeText, minWidth: '980px' }}>
          <thead style={{ position: 'sticky', top: 0, zIndex: 5 }}>
            <tr style={{ borderBottom: `1px solid ${themeBorder}`, backgroundColor: themeControlBg }}>
              <SortTh label="ASSET" col="name" sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="left" style={{ paddingLeft: '1rem' }} />
              <SortTh label="PRICE" col="price" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <th style={{ padding: '0.3rem 0.6rem', textAlign: 'right', fontSize: '0.58rem', fontWeight: 500, color: '#666', letterSpacing: '0.04em' }}>ASK</th>
              <th style={{ padding: '0.3rem 0.6rem', textAlign: 'right', fontSize: '0.58rem', fontWeight: 500, color: '#666', letterSpacing: '0.04em' }}>BID</th>
              <SortTh label="SPREAD" col="spread" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <SortTh label="24H" col="change24h" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <SortTh label="FUND L (1H)" col="fundingLong" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <th style={{ padding: '0.3rem 0.6rem', textAlign: 'right', fontSize: '0.58rem', fontWeight: 500, color: '#666', letterSpacing: '0.04em' }}>FUND S (1H)</th>
              <th style={{ padding: '0.3rem 0.6rem', textAlign: 'right', fontSize: '0.58rem', fontWeight: 500, color: '#666', letterSpacing: '0.04em' }}>TREND</th>
              <th style={{ padding: '0.5rem 0.6rem', width: '28px' }} />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={10} style={{ padding: '3rem', textAlign: 'center', color: themeTextMuted, fontSize: '0.78rem' }}>
                {searchTerm ? `No results for "${searchTerm}"` : 'No markets found.'}
              </td></tr>
            )}
            {filtered.map((pair, idx) => {
              const chg = pair.change24h;
              const chgColor = chg !== null ? (chg >= 0 ? buyColor : sellColor) : themeTextMuted;
              const chgStr = chg !== null ? `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%` : '—';
              const spreadStr = pair.spreadPct !== null ? `${pair.spreadPct.toFixed(4)}%` : '—';
              const isFav = favorites.has(pair.from);

              const fundingLongAnn = (pair.curFundingLong ?? 0) * 2_628_000 * 100;
              const fundingShortAnn = (pair.curFundingShort ?? 0) * 2_628_000 * 100;
              const fLongColor = fundingLongAnn >= 0 ? buyColor : sellColor;
              const fShortColor = fundingShortAnn >= 0 ? buyColor : sellColor;

              const rowBg = idx % 2 === 1 ? `rgba(255,255,255,0.012)` : 'transparent';

              return (
                <tr key={pair.id ?? pair.from} className="mk-tr" onClick={() => navigate(`/${pair.from}USD`)}
                  style={{ borderBottom: `1px solid ${themeBorder}`, backgroundColor: rowBg, transition: 'background 0.12s' }}>

                  <td style={{ padding: '0.3rem 0.6rem 0.3rem 1rem', textAlign: 'left' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <AssetIcon symbol={`${pair.from}${pair.to || 'USD'}`} size="24px" borderRadius="4px" themeControlBg={themeControlBg} themeText={themeText} themeBorder={themeBorder} />
                      <div style={{ fontWeight: 700, fontSize: '0.75rem', color: themeText }}>{pair.from}/{pair.to || 'USD'}</div>
                    </div>
                  </td>

                  <td style={{ padding: '0.3rem 0.6rem', textAlign: 'right' }}>
                    <span className="font-mono" style={{ fontWeight: 700, fontSize: '0.75rem' }}>${formatPrice(pair.mid || 0)}</span>
                  </td>

                  <td style={{ padding: '0.3rem 0.6rem', textAlign: 'right' }}>
                    <span className="font-mono" style={{ color: sellColor, fontSize: '0.7rem' }}>{pair.ask > 0 ? formatPrice(pair.ask) : '—'}</span>
                  </td>

                  <td style={{ padding: '0.3rem 0.6rem', textAlign: 'right' }}>
                    <span className="font-mono" style={{ color: buyColor, fontSize: '0.7rem' }}>{pair.bid > 0 ? formatPrice(pair.bid) : '—'}</span>
                  </td>

                  <td style={{ padding: '0.3rem 0.6rem', textAlign: 'right' }}>
                    <span className="font-mono" style={{ color: themeTextMuted, fontSize: '0.68rem' }}>{spreadStr}</span>
                  </td>

                  <td style={{ padding: '0.3rem 0.6rem', textAlign: 'right' }}>
                    <span className="font-mono" style={{ color: chgColor, fontWeight: 700, fontSize: '0.72rem' }}>{chgStr}</span>
                  </td>

                  <td style={{ padding: '0.3rem 0.6rem', textAlign: 'right' }}>
                    {pair.fundingLong1h !== 0
                      ? <span className="font-mono" style={{ color: pair.fundingLong1h >= 0 ? buyColor : sellColor, fontSize: '0.68rem', fontWeight: 600 }}>
                          {pair.fundingLong1h >= 0 ? '+' : ''}{pair.fundingLong1h.toFixed(4)}%
                        </span>
                      : <span style={{ color: themeTextMuted }}>—</span>
                    }
                  </td>

                  <td style={{ padding: '0.3rem 0.6rem', textAlign: 'right' }}>
                    {pair.fundingShort1h !== 0
                      ? <span className="font-mono" style={{ color: pair.fundingShort1h >= 0 ? buyColor : sellColor, fontSize: '0.68rem', fontWeight: 600 }}>
                          {pair.fundingShort1h >= 0 ? '+' : ''}{pair.fundingShort1h.toFixed(4)}%
                        </span>
                      : <span style={{ color: themeTextMuted }}>—</span>
                    }
                  </td>

                  <td style={{ padding: '0.3rem 0.6rem', textAlign: 'right' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <Sparkline data={pair.sparkline} color={chgColor} />
                    </div>
                  </td>

                  <td style={{ padding: '0.3rem 0.6rem', textAlign: 'center', width: '28px' }} onClick={e => e.stopPropagation()}>
                    <button onClick={e => toggleFavorite(pair.from, e)}
                      style={{ background: 'none', border: 'none', padding: '2px', cursor: 'pointer', color: isFav ? goldAccent : themeTextMuted, opacity: isFav ? 1 : 0.3, transition: 'all 0.15s', display: 'flex', alignItems: 'center' }}
                      onMouseEnter={e => { const b = e.currentTarget as HTMLButtonElement; b.style.color = goldAccent; b.style.opacity = '1'; }}
                      onMouseLeave={e => { const b = e.currentTarget as HTMLButtonElement; b.style.color = isFav ? goldAccent : themeTextMuted; b.style.opacity = isFav ? '1' : '0.3'; }}>
                      <svg width="10" height="13" viewBox="0 0 11 14" fill={isFav ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 1.75C1 1.336 1.336 1 1.75 1h7.5C9.664 1 10 1.336 10 1.75V13L5.5 10.5 1 13V1.75z" />
                      </svg>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

    </div>
  );
}