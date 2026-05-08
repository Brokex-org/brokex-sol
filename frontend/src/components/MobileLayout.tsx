import { useEffect, useState } from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import { useTheme } from '../ThemeContext';
import { useNetwork } from '../contexts/NetworkContext';


const goldContrast = '#BC8961';

// ── SVG Icons ────────────────────────────────────────────────────────────────

const IconTrade = ({ active }: { active: boolean }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.5} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
);

const IconPoints = ({ active }: { active: boolean }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.5} strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

const IconPortfolio = ({ active }: { active: boolean }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.5} strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
  </svg>
);

const WalletIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4" />
    <path d="M4 6v12c0 1.1.9 2 2 2h14v-4" />
    <path d="M18 12a2 2 0 0 0-2 2c0 1.1.9 2 2 2h4v-4h-4z" />
  </svg>
);

// ── Mobile Layout ─────────────────────────────────────────────────────────────

function clusterLabel(cluster: string): string {
  if (cluster === 'mainnet') return 'Solana Mainnet';
  if (cluster === 'testnet') return 'Solana Testnet';
  return 'Solana Devnet';
}

export function MobileLayout() {
  const { themeBg, themeBorder, themeText, themeTextMuted, themeControlBg } = useTheme();
  const { cluster } = useNetwork();
  const [solAddress, setSolAddress] = useState<string | null>(null);

  useEffect(() => {
    const provider = (window as unknown as { solana?: {
      isPhantom?: boolean;
      publicKey?: { toBase58: () => string };
      connect?: () => Promise<unknown>;
      disconnect?: () => Promise<unknown>;
      on?: (e: string, fn: () => void) => void;
      removeListener?: (e: string, fn: () => void) => void;
    } }).solana;
    if (!provider?.isPhantom) return;

    const sync = () => {
      setSolAddress(provider.publicKey ? provider.publicKey.toBase58() : null);
    };
    const onConnect = () => sync();
    const onDisconnect = () => setSolAddress(null);
    const onAccountChanged = () => sync();

    sync();
    provider.on?.('connect', onConnect);
    provider.on?.('disconnect', onDisconnect);
    provider.on?.('accountChanged', onAccountChanged);

    return () => {
      provider.removeListener?.('connect', onConnect);
      provider.removeListener?.('disconnect', onDisconnect);
      provider.removeListener?.('accountChanged', onAccountChanged);
    };
  }, []);

  const tabs = [
    { to: '/', label: 'Trade', Icon: IconTrade, end: true },
    { to: '/market', label: 'Market', Icon: IconPoints },
    { to: '/portfolio', label: 'Portfolio', Icon: IconPortfolio },
  ];


  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100dvh',
        width: '100vw',
        backgroundColor: themeBg,
        color: themeText,
        overflow: 'hidden',
        fontFamily: 'var(--sans)',
      }}
    >
      <style>{`
        .mob-hide-sb::-webkit-scrollbar { display: none; }
        .mob-hide-sb { -ms-overflow-style: none; scrollbar-width: none; }
        .mob-tab-btn { transition: color 0.18s, background 0.18s; }
        .mob-tab-btn:active { opacity: 0.7; }
      `}</style>

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <header
        style={{
          minHeight: '56px',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 1rem',
          borderBottom: `1px solid ${themeBorder}`,
          backgroundColor: themeBg,
          zIndex: 50,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '1px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <img src="/logo.svg" alt="Logo" style={{ width: '26px', height: '26px', objectFit: 'contain', flexShrink: 0 }} />
            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: themeText, letterSpacing: '-0.01em' }}>
              Brokex
            </span>
          </div>
          <span
            style={{
              fontSize: '0.58rem',
              fontWeight: 600,
              color: themeTextMuted,
              paddingLeft: '30px',
              letterSpacing: '0.02em',
            }}
          >
            {clusterLabel(cluster)}
          </span>
        </div>

        {/* Phantom (Solana) */}
        <button
          type="button"
          onClick={async () => {
            const p = (window as unknown as {
              solana?: { isPhantom?: boolean; connect?: () => Promise<unknown>; disconnect?: () => Promise<unknown> };
            }).solana;
            if (!p?.isPhantom) {
              window.open('https://phantom.app/', '_blank', 'noopener,noreferrer');
              return;
            }
            try {
              if (solAddress) await p.disconnect?.();
              else await p.connect?.();
            } catch (e) {
              console.error(e);
            }
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            backgroundColor: solAddress ? themeControlBg : goldContrast,
            border: solAddress ? `1px solid ${themeBorder}` : 'none',
            borderRadius: '8px',
            padding: '6px 12px',
            cursor: 'pointer',
            color: solAddress ? themeText : '#fff',
            fontSize: '0.72rem',
            fontWeight: 600,
            flexShrink: 0,
            maxWidth: '46%',
          }}
        >
          <WalletIcon />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {solAddress ? `${solAddress.slice(0, 4)}…${solAddress.slice(-4)}` : 'Phantom'}
          </span>
        </button>
      </header>

      {/* ── Page content ─────────────────────────────────────────────────── */}
      <main
        className="mob-hide-sb"
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}
      >
        <Outlet />
      </main>


      {/* ── Bottom Nav ────────────────────────────────────────────────────── */}
      <nav
        style={{
          height: '64px',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'stretch',
          borderTop: `1px solid ${themeBorder}`,
          backgroundColor: themeBg,
          zIndex: 50,
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        {tabs.map(({ to, label, Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className="mob-tab-btn"
            style={({ isActive }) => ({
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '3px',
              textDecoration: 'none',
              color: isActive ? goldContrast : themeTextMuted,
              backgroundColor: 'transparent',
              transition: 'all 0.15s',
            })}
          >
            {({ isActive }) => (
              <>
                <Icon active={isActive} />
                <span
                  style={{
                    fontSize: '0.58rem',
                    fontWeight: isActive ? 700 : 400,
                    letterSpacing: '0.01em',
                    color: isActive ? goldContrast : themeTextMuted,
                  }}
                >
                  {label}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
