import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../../ThemeContext';
import { usePriceContext } from '../../contexts/PriceContext';
import { useOstiumSubgraph } from '../../hooks/useOstiumSubgraph';
import { usePythBenchmarks } from '../../hooks/usePythBenchmarks';
import { mapPair } from '../../utils/ostium/utils';

const goldAccent = '#BC8961';
const goldAccentLight = 'rgba(188, 137, 97, 0.15)';

// ── Sparkline ─────────────────────────────────────────────────────────────────
const Sparkline = ({ data, color }: { data: number[]; color: string }) => {
  if (!data || data.length === 0)
    return <span style={{ color: '#555', fontSize: '0.6rem' }}>—</span>;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 44;
  const h = 16;
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x},${y}`;
    })
    .join(' L ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} fill="none">
      <path d={`M ${pts}`} stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

// ── Mobile Market ─────────────────────────────────────────────────────────────

export function MobileMarket() {
  const {
    themeBg,
    themeControlBg,
    themeBorder,
    themeText,
    themeTextMuted,
    buyColor,
    sellColor,
  } = useTheme();

  const navigate = useNavigate();
  const { prices } = usePriceContext();
  const { getPairs } = useOstiumSubgraph();
  const { benchmarks, get24hChange, ASSET_TO_PYTH_SYMBOL } = usePythBenchmarks();

  const [pairs, setPairs] = useState<any[]>([]);
  const [activeFilter, setActiveFilter] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    let mounted = true;
    getPairs()
      .then((data) => {
        if (mounted) setPairs(data.map(mapPair));
      })
      .catch(console.error);
    return () => {
      mounted = false;
    };
  }, [getPairs]);

  const groups = useMemo(() => {
    const raw = pairs.map((p) => p.group).filter(Boolean);
    const unique = Array.from(new Set(raw));
    return ['All', ...unique.sort((a, b) => a.localeCompare(b))];
  }, [pairs]);

  const filteredPairs = useMemo(() => {
    return pairs.filter((p) => {
      const matchGroup = activeFilter === 'All' || p.group === activeFilter;
      const matchSearch = p.from.toLowerCase().includes(searchTerm.toLowerCase());
      return matchGroup && matchSearch;
    });
  }, [pairs, activeFilter, searchTerm]);

  // Top stats from data
  const topGainers = useMemo(() => {
    return [...pairs]
      .map((p) => ({ ...p, change: get24hChange(p.from) || 0 }))
      .filter((p) => p.change > 0)
      .sort((a, b) => b.change - a.change)
      .slice(0, 3);
  }, [pairs, get24hChange]);

  return (
    <div
      style={{
        flex: 1,
        backgroundColor: themeBg,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <style>{`
        .mob-mkt-hide::-webkit-scrollbar { display: none; }
        .mob-mkt-hide { -ms-overflow-style: none; scrollbar-width: none; }
        .mob-mkt-row:active { background-color: ${themeControlBg} !important; }
      `}</style>

      {/* ── Banner ─────────────────────────────────────────────────────── */}
      <div
        style={{
          margin: '1rem',
          borderRadius: '14px',
          background: 'linear-gradient(135deg, #1a1a1a 0%, #3a2b1c 100%)',
          border: `1px solid ${themeBorder}`,
          padding: '1.2rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: '-20px',
            right: '-20px',
            width: '100px',
            height: '100px',
            borderRadius: '50%',
            background: `radial-gradient(circle, ${goldAccent}22, transparent 70%)`,
          }}
        />
        <span
          style={{
            alignSelf: 'flex-start',
            backgroundColor: goldAccent,
            color: '#000',
            padding: '0.2rem 0.5rem',
            borderRadius: '5px',
            fontWeight: 700,
            fontSize: '0.6rem',
          }}
        >
          No Fee
        </span>
        <div style={{ color: 'white', fontSize: '1rem', fontWeight: 700, lineHeight: 1.3 }}>
          March on BTC & BONK Markets
        </div>
        <div
          style={{ color: goldAccent, fontSize: '0.75rem', fontWeight: 500, cursor: 'pointer' }}
          onClick={() => navigate('/')}
        >
          Trade now →
        </div>
      </div>

      {/* ── Stats cards ────────────────────────────────────────────────── */}
      <div
        className="mob-mkt-hide"
        style={{
          display: 'flex',
          gap: '0.75rem',
          padding: '0 1rem 1rem 1rem',
          overflowX: 'auto',
        }}
      >
        {[
          { label: '24h Volume', value: '$128.6M', sub: 'Trading Volume' },
          { label: 'Open Interest', value: '$48.0M', sub: 'Current' },
          { label: '24h Fees', value: '$10.3K', sub: 'Generated' },
        ].map((stat) => (
          <div
            key={stat.label}
            style={{
              flexShrink: 0,
              backgroundColor: themeControlBg,
              border: `1px solid ${themeBorder}`,
              borderRadius: '12px',
              padding: '0.9rem 1rem',
              minWidth: '130px',
            }}
          >
            <div style={{ fontSize: '0.6rem', color: themeTextMuted, marginBottom: '0.3rem' }}>
              {stat.sub}
            </div>
            <div
              style={{
                fontSize: '1rem',
                fontWeight: 700,
                color: themeText,
                fontFamily: 'var(--mono)',
              }}
            >
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      {/* ── Top Gainers micro-section ───────────────────────────────────── */}
      {topGainers.length > 0 && (
        <div style={{ padding: '0 1rem 0.75rem 1rem' }}>
          <div
            style={{
              fontSize: '0.72rem',
              color: themeText,
              fontWeight: 700,
              marginBottom: '0.6rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
            }}
          >
            Top Gainers
            <span
              style={{
                backgroundColor: goldAccentLight,
                color: goldAccent,
                padding: '1px 6px',
                borderRadius: '4px',
                fontSize: '0.55rem',
                fontWeight: 700,
              }}
            >
              24H
            </span>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {topGainers.map((mover, idx) => {
              const priceData = prices[mover.from];
              const livePrice = priceData?.mid ? Number(priceData.mid).toFixed(2) : '---';
              void livePrice; // used via mover.from display only
              const change = mover.change;
              return (
                <div
                  key={idx}
                  className="mob-mkt-row"
                  onClick={() => navigate('/')}
                  style={{
                    flex: 1,
                    backgroundColor: themeControlBg,
                    border: `1px solid ${themeBorder}`,
                    borderRadius: '10px',
                    padding: '0.6rem 0.7rem',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.3rem',
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
                      fontSize: '0.6rem',
                      fontWeight: 700,
                      color: '#fff',
                    }}
                  >
                    {mover.from.charAt(0)}
                  </div>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: themeText }}>
                    {mover.from}
                  </div>
                  <div
                    style={{
                      fontSize: '0.65rem',
                      color: buyColor,
                      fontWeight: 600,
                      fontFamily: 'var(--mono)',
                    }}
                  >
                    +{change.toFixed(2)}%
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Filter + Search ─────────────────────────────────────────────── */}
      <div style={{ padding: '0 1rem 0.75rem 1rem' }}>
        {/* Search */}
        <div
          style={{
            position: 'relative',
            marginBottom: '0.6rem',
          }}
        >
          <span
            style={{
              position: 'absolute',
              left: '12px',
              top: '50%',
              transform: 'translateY(-50%)',
              color: goldAccent,
              fontSize: '1rem',
              lineHeight: 1,
            }}
          >
            ⌕
          </span>
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search markets…"
            style={{
              width: '100%',
              backgroundColor: themeControlBg,
              border: `1px solid ${themeBorder}`,
              borderRadius: '10px',
              padding: '0.55rem 1rem 0.55rem 2.2rem',
              color: themeText,
              fontSize: '0.8rem',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Group filters */}
        <div className="mob-mkt-hide" style={{ display: 'flex', gap: '0.4rem', overflowX: 'auto' }}>
          {groups.map((group) => {
            const display =
              group.toLowerCase() === 'etf'
                ? 'ETF'
                : group.charAt(0).toUpperCase() + group.slice(1);
            const active = activeFilter === group;
            return (
              <span
                key={group}
                onClick={() => setActiveFilter(group)}
                style={{
                  flexShrink: 0,
                  cursor: 'pointer',
                  backgroundColor: active ? themeControlBg : 'transparent',
                  color: active ? goldAccent : themeTextMuted,
                  border: `1px solid ${active ? themeBorder : 'transparent'}`,
                  padding: '0.25rem 0.75rem',
                  borderRadius: '20px',
                  fontSize: '0.72rem',
                  fontWeight: active ? 700 : 400,
                  transition: 'all 0.15s',
                }}
              >
                {display}
              </span>
            );
          })}
        </div>
      </div>

      {/* ── Pairs list ──────────────────────────────────────────────────── */}
      <div
        className="mob-mkt-hide"
        style={{ flex: 1, overflowY: 'auto', padding: '0 1rem 1rem 1rem' }}
      >
        {filteredPairs.map((pair) => {
          const priceData = prices[pair.from];
          const livePrice: string =
            priceData?.mid
              ? Number(priceData.mid).toFixed(Number(priceData.mid) < 10 ? 4 : 2)
              : '---';
          const change24h = get24hChange(pair.from);
          const chgColor =
            change24h === null ? themeTextMuted : change24h >= 0 ? buyColor : sellColor;
          const changeStr =
            change24h !== null
              ? `${change24h > 0 ? '+' : ''}${change24h.toFixed(2)}%`
              : '—';
          const pythSymbol = ASSET_TO_PYTH_SYMBOL[pair.from];
          const sparklineArr = pythSymbol ? benchmarks[pythSymbol]?.sparkline || [] : [];

          return (
            <div
              key={pair.id}
              className="mob-mkt-row"
              onClick={() => navigate('/')}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '0.7rem 0',
                borderBottom: `1px solid ${themeBorder}`,
                cursor: 'pointer',
                transition: 'background-color 0.15s',
              }}
            >
              {/* Icon */}
              <div
                style={{
                  width: '34px',
                  height: '34px',
                  borderRadius: '50%',
                  background: `linear-gradient(135deg, ${themeBorder}, ${themeControlBg})`,
                  border: `1px solid ${themeBorder}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  color: themeText,
                  flexShrink: 0,
                  marginRight: '0.75rem',
                }}
              >
                {pair.from.charAt(0)}
              </div>

              {/* Name + leverage */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: themeText, lineHeight: 1 }}>
                  {pair.from}/USD
                </div>
                <div
                  style={{
                    fontSize: '0.6rem',
                    color: goldAccent,
                    fontWeight: 600,
                    marginTop: '3px',
                    fontFamily: 'var(--mono)',
                  }}
                >
                  {pair.maxLeverage}×
                </div>
              </div>

              {/* Sparkline */}
              <div style={{ marginRight: '0.75rem' }}>
                <Sparkline data={sparklineArr} color={chgColor} />
              </div>

              {/* Price + change */}
              <div style={{ textAlign: 'right' }}>
                <div
                  style={{
                    fontSize: '0.82rem',
                    fontWeight: 700,
                    color: themeText,
                    fontFamily: 'var(--mono)',
                    lineHeight: 1,
                  }}
                >
                  ${livePrice}
                </div>
                <div
                  style={{
                    fontSize: '0.68rem',
                    fontWeight: 600,
                    color: chgColor,
                    fontFamily: 'var(--mono)',
                    marginTop: '3px',
                  }}
                >
                  {changeStr}
                </div>
              </div>
            </div>
          );
        })}

        {filteredPairs.length === 0 && (
          <div
            style={{
              padding: '3rem',
              textAlign: 'center',
              color: themeTextMuted,
              fontSize: '0.8rem',
            }}
          >
            {pairs.length === 0 ? 'Loading markets…' : 'No markets found.'}
          </div>
        )}

        <div style={{ height: '1rem' }} />
      </div>
    </div>
  );
}
