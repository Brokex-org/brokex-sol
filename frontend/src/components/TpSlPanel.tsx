import React, { useState } from 'react';
import { useTheme } from '../ThemeContext';
import { formatPrice } from '../utils/ostium/utils';

// Ajout des couleurs dorées
const goldAccent = '#BC8961';
const goldAccentLight = 'rgba(188, 137, 97, 0.1)';

interface TpSlPanelProps {
  isTpSlOpen: boolean;
  setIsTpSlOpen: (val: boolean) => void;
  tpAmount: string;
  setTpAmount: (val: string) => void;
  slAmount: string;
  setSlAmount: (val: string) => void;
  side: 'buy' | 'sell';
  entryPrice: number;
  leverage: number;
  collateralNum: number;
}

export const TpSlPanel: React.FC<TpSlPanelProps> = ({
  isTpSlOpen,
  setIsTpSlOpen,
  tpAmount,
  setTpAmount,
  slAmount,
  setSlAmount,
  side,
  entryPrice,
  leverage,
  collateralNum,
}) => {
  const { themeControlBg, themeBorder, themeText, themeTextMuted, themeBg, buyColor, sellColor } = useTheme();

  const [activeTpPct, setActiveTpPct] = useState<number | null>(null);
  const [activeSlPct, setActiveSlPct] = useState<number | null>(null);

  // Calcul du PNL affiché
  let maxProfit = 0;
  if (entryPrice > 0 && tpAmount) {
    maxProfit = side === 'buy' 
      ? ((Number(tpAmount) - entryPrice) / entryPrice) * leverage * collateralNum 
      : ((entryPrice - Number(tpAmount)) / entryPrice) * leverage * collateralNum;
    maxProfit = Math.max(0, maxProfit);
  }

  let maxLoss = 0;
  if (entryPrice > 0 && slAmount) {
    maxLoss = side === 'buy' 
      ? ((entryPrice - Number(slAmount)) / entryPrice) * leverage * collateralNum 
      : ((Number(slAmount) - entryPrice) / entryPrice) * leverage * collateralNum;
    maxLoss = Math.max(0, maxLoss);
  }

  // Gestion des clics sur les boutons %
  const handleTpPercent = (pct: number) => {
    setActiveTpPct(pct);
    if (entryPrice <= 0) return;
    const delta = (pct * entryPrice) / leverage;
    const newTp = side === 'buy' ? entryPrice + delta : Math.max(0.0001, entryPrice - delta);
    setTpAmount(formatPrice(newTp));
  };

  const handleSlPercent = (pct: number | null) => {
    setActiveSlPct(pct);
    if (pct === null) {
      setSlAmount('');
      return;
    }
    if (entryPrice <= 0) return;
    const delta = (pct * entryPrice) / leverage;
    const newSl = side === 'buy' ? Math.max(0.0001, entryPrice - delta) : entryPrice + delta;
    setSlAmount(formatPrice(newSl));
  };

  const tpOptions = [
    { label: '25%', value: 0.25 },
    { label: '50%', value: 0.50 },
    { label: '75%', value: 0.75 },
    { label: '100%', value: 1.0 },
    { label: '500%', value: 5.0 },
    { label: '900%', value: 9.0 },
  ];

  const slOptions = [
    { label: '5%', value: 0.05 },
    { label: '10%', value: 0.10 },
    { label: '25%', value: 0.25 },
    { label: '50%', value: 0.50 },
    { label: '75%', value: 0.75 },
    { label: 'None', value: null },
  ];

  return (
    <div style={{ flexShrink: 0, backgroundColor: themeControlBg, borderRadius: '4px', border: `1px solid ${isTpSlOpen ? goldAccent : themeBorder}`, display: 'flex', flexDirection: 'column', overflow: 'hidden', transition: 'border-color 0.2s' }}>
      
      {/* Header Toggle avec la touche dorée lorsqu'il est actif */}
      <div 
        onClick={() => setIsTpSlOpen(!isTpSlOpen)}
        style={{ 
          padding: '0.5rem 0.6rem', 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          fontSize: '0.75rem', 
          cursor: 'pointer',
          backgroundColor: isTpSlOpen ? goldAccentLight : 'transparent',
          borderBottom: isTpSlOpen ? `1px solid ${themeBorder}` : 'none',
          transition: 'all 0.2s'
        }}>
        <span style={{ 
          color: isTpSlOpen ? goldAccent : themeTextMuted, 
          fontWeight: isTpSlOpen ? 600 : 400,
          transition: 'color 0.2s'
        }}>
          TP <span style={{ color: isTpSlOpen ? goldAccent : themeText }}>/</span> SL
        </span>
        <span style={{ 
          color: isTpSlOpen ? goldAccent : themeTextMuted, 
          transform: isTpSlOpen ? 'rotate(180deg)' : 'none', 
          transition: 'all 0.2s', 
          fontSize: '0.65rem' 
        }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 15l-6-6-6 6"/>
          </svg>
        </span>
      </div>

      {/* Contenu Ouvert */}
      {isTpSlOpen && (
        <div style={{ padding: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
          
          {/* Section Take Profit */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <span style={{ color: themeTextMuted, fontSize: '0.65rem', textDecoration: 'underline dotted', width: 'max-content' }}>
              Max Profit: <span className="font-mono" style={{ color: goldAccent, fontWeight: 600 }}>${maxProfit.toFixed(2)}</span>
            </span>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <input 
                type="number" 
                className="no-spinners font-mono"
                value={tpAmount} 
                onChange={(e) => { setTpAmount(e.target.value); setActiveTpPct(null); }} 
                placeholder="Take Profit" 
                style={{ flex: 1, backgroundColor: themeBg, border: `1px solid ${activeTpPct !== null ? buyColor : themeBorder}`, borderRadius: '4px', padding: '0.4rem 0.5rem', color: themeText, fontSize: '0.75rem', outline: 'none' }} 
              />
              <div className="font-mono" style={{ width: '65px', backgroundColor: themeBg, border: `1px solid ${themeBorder}`, borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: themeText, fontSize: '0.7rem' }}>
                {activeTpPct ? `${activeTpPct * 100}%` : 'ROI %'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '4px' }}>
              {tpOptions.map(opt => {
                const isActive = activeTpPct === opt.value;
                return (
                  <button 
                    key={opt.label} 
                    onClick={() => handleTpPercent(opt.value)}
                    className="font-mono"
                    style={{ flex: 1, padding: '0.2rem 0', fontSize: '0.6rem', borderRadius: '4px', border: `1px solid ${isActive ? buyColor : 'transparent'}`, backgroundColor: themeBg, color: isActive ? buyColor : themeTextMuted, cursor: 'pointer', transition: 'all 0.2s' }}>
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Section Stop Loss */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <span style={{ color: themeTextMuted, fontSize: '0.65rem', textDecoration: 'underline dotted', width: 'max-content' }}>
              Max Loss: <span className="font-mono" style={{ color: themeText }}>${maxLoss.toFixed(2)}</span>
            </span>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <input 
                type="number" 
                className="no-spinners font-mono"
                value={slAmount} 
                onChange={(e) => { setSlAmount(e.target.value); setActiveSlPct(null); }} 
                placeholder="Stop Loss" 
                style={{ flex: 1, backgroundColor: themeBg, border: `1px solid ${activeSlPct !== null ? sellColor : themeBorder}`, borderRadius: '4px', padding: '0.4rem 0.5rem', color: themeText, fontSize: '0.75rem', outline: 'none' }} 
              />
              <div className="font-mono" style={{ width: '65px', backgroundColor: themeBg, border: `1px solid ${themeBorder}`, borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: themeTextMuted, fontSize: '0.7rem' }}>
                {activeSlPct ? `${activeSlPct * 100}%` : 'Loss %'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '4px' }}>
              {slOptions.map(opt => {
                const isActive = activeSlPct === opt.value;
                return (
                  <button 
                    key={opt.label} 
                    onClick={() => handleSlPercent(opt.value)}
                    className="font-mono"
                    style={{ flex: 1, padding: '0.2rem 0', fontSize: '0.6rem', borderRadius: '4px', border: `1px solid ${isActive ? sellColor : 'transparent'}`, backgroundColor: themeBg, color: isActive ? sellColor : themeTextMuted, cursor: 'pointer', transition: 'all 0.2s' }}>
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

        </div>
      )}
    </div>
  );
};