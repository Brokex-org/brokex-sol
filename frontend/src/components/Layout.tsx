import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom'; // <-- Ajout de useNavigate
import { useDynamicContext } from '@dynamic-labs/sdk-react-core';
import { sharedStyle as style } from '../sharedStyle';
import { useTheme } from '../ThemeContext';
import { usePythBenchmarks } from '../hooks/usePythBenchmarks';

// Couleur d'accentuation dorée globale pour le Layout
const goldAccent = '#BC8961';
const goldAccentLight = 'rgba(188, 137, 97, 0.1)';

// SVG Icon for Wallet
const WalletIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4"></path>
    <path d="M4 6v12c0 1.1.9 2 2 2h14v-4"></path>
    <path d="M18 12a2 2 0 0 0-2 2c0 1.1.9 2 2 2h4v-4h-4z"></path>
  </svg>
);

const IconTrade = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>;
const IconMarket = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>;
const IconPortfolio = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path></svg>;

const IconX = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/></svg>;
const IconTelegram = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"></polygon></svg>;
const IconDiscord = () => <svg width="14" height="14" viewBox="0 0 127.14 96.36"><path fill="currentColor" d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77.89,77.89,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.31,60,73.31,53s5-12.74,11.43-12.74S96.2,46,96.12,53,91.08,65.69,84.69,65.69Z" /></svg>;
const IconDocs = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>;
const IconSun = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>;
const IconMoon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>;

export function Layout() {
  const { setShowAuthFlow, handleLogOut, user } = useDynamicContext();
  const { mode, setMode, themeBg, themeText, themeBorder, themeTextMuted, themeControlBg, buyColor, sellColor } = useTheme();

  const [phantomAddress, setPhantomAddress] = React.useState<string | null>(null);

  React.useEffect(() => {
    const p = (window as unknown as {
      solana?: {
        isPhantom?: boolean;
        publicKey?: { toBase58: () => string };
        connect?: () => Promise<unknown>;
        disconnect?: () => Promise<unknown>;
        on?: (e: string, fn: () => void) => void;
        removeListener?: (e: string, fn: () => void) => void;
      };
    }).solana;
    if (!p?.isPhantom) return;

    const sync = () => setPhantomAddress(p.publicKey ? p.publicKey.toBase58() : null);
    const onDisconnect = () => setPhantomAddress(null);
    sync();
    p.on?.('connect', sync);
    p.on?.('disconnect', onDisconnect);
    p.on?.('accountChanged', sync);
    return () => {
      p.removeListener?.('connect', sync);
      p.removeListener?.('disconnect', onDisconnect);
      p.removeListener?.('accountChanged', sync);
    };
  }, []);
  
  const { benchmarks, ASSET_TO_PYTH_SYMBOL } = usePythBenchmarks();
  
  const navigate = useNavigate(); // <-- Initialisation de useNavigate
  
  const [moverMode, setMoverMode] = useState<'gainers' | 'losers' | 'favorites'>('gainers');

  // Check if user has any favorites saved
  const hasFavorites = React.useMemo(() => {
    try {
      const stored = localStorage.getItem('assetFavorites');
      const favs: string[] = stored ? JSON.parse(stored) : [];
      return favs.length > 0;
    } catch { return false; }
  }, []);

  // If favorites were cleared and we're in favorites mode, fall back to gainers
  React.useEffect(() => {
    if (!hasFavorites && moverMode === 'favorites') setMoverMode('gainers');
  }, [hasFavorites, moverMode]);

  const moversList = React.useMemo(() => {
    if (moverMode === 'favorites') {
      try {
        const stored = localStorage.getItem('assetFavorites');
        const favs: string[] = stored ? JSON.parse(stored) : [];
        return favs.map(symbol => {
          const pythSymbol = ASSET_TO_PYTH_SYMBOL[symbol];
          const diffDecimal = pythSymbol ? benchmarks[pythSymbol]?.day_price_diff_decimal : undefined;
          return { symbol, change: diffDecimal !== undefined && diffDecimal !== null ? diffDecimal * 100 : 0 };
        });
      } catch { return []; }
    }
    const list: { symbol: string, change: number }[] = [];
    Object.keys(ASSET_TO_PYTH_SYMBOL).forEach(asset => {
      const pythSymbol = ASSET_TO_PYTH_SYMBOL[asset];
      const diffDecimal = benchmarks[pythSymbol]?.day_price_diff_decimal;
      if (diffDecimal !== undefined && diffDecimal !== null) {
        const changePercent = diffDecimal * 100;
        if (moverMode === 'gainers' && changePercent > 0) list.push({ symbol: asset, change: changePercent });
        else if (moverMode === 'losers' && changePercent < 0) list.push({ symbol: asset, change: changePercent });
      }
    });
    list.sort((a, b) => moverMode === 'gainers' ? b.change - a.change : a.change - b.change);
    return list;
  }, [benchmarks, moverMode]);

  const getNavLinkStyle = ({ isActive }: { isActive: boolean }) => {
    if (isActive) {
      return { 
        ...style.navLink, 
        ...style.navLinkActive, 
        borderLeft: `2px solid ${goldAccent}`, 
        backgroundColor: goldAccentLight, 
        color: goldAccent 
      } as any;
    }
    return { ...style.navLink, color: themeTextMuted } as any;
  };

  return (
    <div style={{ ...style.app, backgroundColor: themeBg, color: themeText } as any}>
      
      <style>{`
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        
        .nav-item-hover { transition: background-color 0.2s; }
        .nav-item-hover:hover { background-color: ${goldAccentLight} !important; color: ${goldAccent} !important; }

        .mover-item:hover {
          opacity: 0.8;
          transform: scale(1.02);
          transition: all 0.2s ease-in-out;
        }
      `}</style>

      {/* Sidebar */}
      <nav style={{ ...style.sidebar, borderRight: `1px solid ${themeBorder}`, justifyContent: 'space-between', zIndex: 50 } as any}>
        
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          {/* Logo avec espace réduit en haut */}
          <div style={{ padding: '0px 0 17px 0', display: 'flex', justifyContent: 'center' }}>
            <img 
              src="/logo.svg" 
              alt="Logo" 
              style={{ width: '34px', height: '34px', objectFit: 'contain' }} 
            />
          </div>
          <div style={style.navList as any}>
            <NavLink to="/" className={({isActive}) => isActive ? "" : "nav-item-hover"} style={getNavLinkStyle} end>
              <IconTrade /><span>Trade</span>
            </NavLink>
            <NavLink to="/market" className={({isActive}) => isActive ? "" : "nav-item-hover"} style={getNavLinkStyle}>
              <IconMarket /><span>Market</span>
            </NavLink>
            <NavLink to="/portfolio" className={({isActive}) => isActive ? "" : "nav-item-hover"} style={getNavLinkStyle}>
              <IconPortfolio /><span>Portfolio</span>
            </NavLink>
          </div>
        </div>

        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ width: '100%' }}>
            
            {/* Theme Toggle (Finition Dorée) */}
            <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 0', borderBottom: `1px solid ${themeBorder}` }}>
              <div 
                onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')}
                style={{ display: 'flex', alignItems: 'center', backgroundColor: themeControlBg, borderRadius: '12px', padding: '4px', cursor: 'pointer', position: 'relative', width: '60px', height: '32px', boxSizing: 'border-box' }}
              >
                <div style={{ position: 'absolute', top: '4px', left: mode === 'light' ? '4px' : '32px', width: '24px', height: '24px', backgroundColor: themeBg, borderRadius: '8px', transition: 'left 0.2s cubic-bezier(0.4, 0, 0.2, 1)', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}/>
                <div style={{ flex: 1, display: 'flex', justifyContent: 'center', zIndex: 1, color: mode === 'light' ? goldAccent : themeTextMuted, transition: 'color 0.2s' }}><IconSun /></div>
                <div style={{ flex: 1, display: 'flex', justifyContent: 'center', zIndex: 1, color: mode === 'dark' ? goldAccent : themeTextMuted, transition: 'color 0.2s' }}><IconMoon /></div>
              </div>
            </div>

            {/* Wallet Button */}
            <div style={{ height: '60px', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <button
                type="button"
                onClick={async () => {
                  const p = (window as unknown as {
                    solana?: {
                      isPhantom?: boolean;
                      publicKey?: { toBase58: () => string };
                      connect?: () => Promise<unknown>;
                      disconnect?: () => Promise<unknown>;
                    };
                  }).solana;
                  if (p?.isPhantom) {
                    try {
                      if (p.publicKey) await p.disconnect?.();
                      else await p.connect?.();
                    } catch (e) {
                      console.error(e);
                    }
                    return;
                  }
                  if (user) {
                    handleLogOut();
                    return;
                  }
                  setShowAuthFlow(true);
                }}
                className="nav-item-hover"
                style={{
                  background: 'none',
                  border: 'none',
                  color: phantomAddress ? goldAccent : themeTextMuted,
                  cursor: 'pointer',
                  height: '100%',
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'color 0.2s',
                }}
                title={
                  (window as unknown as { solana?: { isPhantom?: boolean } }).solana?.isPhantom
                    ? phantomAddress
                      ? `Phantom: ${phantomAddress.slice(0, 4)}…${phantomAddress.slice(-4)} (click to disconnect)`
                      : 'Connect Wallet'
                    : user
                      ? 'Disconnect wallet'
                      : 'Connect Wallet'
                }
              >
                <WalletIcon />
              </button>
            </div>

          </div>
        </div>
      </nav>

      {/* Main Content Wrapper - Bridé à 100vw - 80px */}
      <div style={{ 
        ...(style.mainContentWrapper as any), 
        flex: 1, 
        display: 'flex', 
        flexDirection: 'column', 
        minWidth: 0, 
        width: 'calc(100vw - 80px)', 
        maxWidth: 'calc(100vw - 80px)',
        overflow: 'hidden'
      }}>
        
        {/* Scrollable Content (Le composant de la route : Trade, Portfolio, etc.) */}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <Outlet />
        </div>

        {/* Global Footer (Bridé et protégé contre l'étirement) */}
        <footer style={{ 
          ...(style.bottomBar as any), 
          borderTop: `1px solid ${themeBorder}`, 
          backgroundColor: themeBg, 
          padding: '0 1rem', 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          height: '34px', 
          flexShrink: 0, 
          fontSize: '0.7rem', 
          color: themeTextMuted,
          width: '100%',
          maxWidth: 'calc(100vw - 80px)', 
          boxSizing: 'border-box'
        }}>
          
          {/* Status (Finition Dorée) - FIGÉ */}
          <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0, paddingRight: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', backgroundColor: goldAccentLight, padding: '2px 8px', borderRadius: '4px', border: `1px solid transparent` }}>
              <span style={{ color: goldAccent, fontSize: '0.4rem', lineHeight: 1 }}>●</span>
              <span style={{ color: goldAccent, fontWeight: 600, fontSize: '0.6rem', lineHeight: 1 }}>Operational</span>
            </div>
          </div>

          <div style={{ width: '1px', height: '14px', backgroundColor: themeBorder, flexShrink: 0 }}></div>

          {/* Gainers/Losers Ticker - COMPRESSIBLE & SCROLLABLE */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '1rem', padding: '0 1rem', overflow: 'hidden' }}>
            {/* Cycling toggle: click cycles gainers → losers → favorites → … */}
            <button
              onClick={() => {
                setMoverMode(m => {
                  if (m === 'gainers') return 'losers';
                  if (m === 'losers') return hasFavorites ? 'favorites' : 'gainers';
                  return 'gainers'; // from favorites back to gainers
                });
              }}
              style={{
                background: 'none',
                border: `1px solid ${themeBorder}`,
                borderRadius: '4px',
                color: moverMode === 'favorites' ? goldAccent : moverMode === 'gainers' ? buyColor : sellColor,
                fontSize: '0.6rem',
                fontWeight: 600,
                cursor: 'pointer',
                padding: '2px 8px',
                display: 'flex', alignItems: 'center', gap: '4px',
                flexShrink: 0,
                transition: 'color 0.2s, border-color 0.2s',
              }}
              title="Click to switch mode"
            >
              {moverMode === 'favorites' ? '★ Favorites' : moverMode === 'gainers' ? '↑ Top Gainers' : '↓ Top Losers'}
              <span style={{ fontSize: '0.5rem', opacity: 0.6 }}>↻</span>
            </button>
            <div className="hide-scrollbar" style={{ display: 'flex', alignItems: 'center', gap: '1.2rem', overflowX: 'auto', flex: 1, maskImage: 'linear-gradient(to right, black 80%, transparent 100%)' }}>
              {moversList.length > 0 ? (
                moversList.map(mover => (
                  <div 
                    key={mover.symbol} 
                    className="mover-item" // <-- Ajout de la classe pour le hover interactif
                    onClick={() => navigate(`/${mover.symbol}USD`)} // <-- Redirection dynamique ajoutée ici
                    style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexShrink: 0, cursor: 'pointer' }} // <-- Curseur modifié
                  >
                    <span style={{ color: themeText, fontWeight: 600, fontSize: '0.7rem' }}>{mover.symbol}/USD</span>
                    <span className="font-mono" style={{ color: mover.change >= 0 ? buyColor : sellColor, fontWeight: 600, fontSize: '0.7rem' }}>
                      {mover.change > 0 ? '+' : ''}{mover.change.toFixed(2)}%
                    </span>
                  </div>
                ))
              ) : (
                <span style={{ color: themeTextMuted, fontSize: '0.7rem' }}>Loading markets...</span>
              )}
            </div>
          </div>

          <div style={{ width: '1px', height: '14px', backgroundColor: themeBorder, flexShrink: 0 }}></div>

          {/* Socials & Customizers - FIGÉ À DROITE */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', flexShrink: 0, paddingLeft: '1rem' }}>
            <a href="#" className="nav-item-hover" style={{ color: 'inherit', display: 'flex' }}><IconX /></a>
            <a href="#" className="nav-item-hover" style={{ color: 'inherit', display: 'flex' }}><IconTelegram /></a>
            <a href="#" className="nav-item-hover" style={{ color: 'inherit', display: 'flex' }}><IconDiscord /></a>
            <a href="#" className="nav-item-hover" style={{ color: 'inherit', display: 'flex' }}><IconDocs /></a>
          </div>
        </footer>
      </div>
    </div>
  );
}