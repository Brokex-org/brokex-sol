import React, { useState, useEffect } from 'react';
import { formatPrice } from '../utils/ostium/utils';

const goldAccent = '#BC8961';
const goldAccentLight = 'rgba(188, 137, 97, 0.15)';

const CloseIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"></line>
    <line x1="6" y1="6" x2="18" y2="18"></line>
  </svg>
);

export const EditLimitModal = ({ isOpen, onClose, order, onAction, theme, symbol, inline, isMarketOpen }: any) => {
  if (!isOpen || !order) return null;

  const [targetPrice, setTargetPrice] = useState(formatPrice(order.openPrice));

  const [tpPrice, setTpPrice] = useState(order.takeProfitPrice ? formatPrice(order.takeProfitPrice) : '');
  const [slPrice, setSlPrice] = useState(order.stopLossPrice ? formatPrice(order.stopLossPrice) : '');

  const [tpPercent, setTpPercent] = useState('');
  const [slPercent, setSlPercent] = useState('');

  const { themeBg, themeControlBg, themeBorder, themeText, themeTextMuted, buyColor, sellColor, buyColorBg, sellColorBg } = theme;

  const isBuy = order.isBuy;
  const leverage = Number(order.leverage);

  const activeColor = isBuy ? buyColor : sellColor;
  const activeColorBg = isBuy ? buyColorBg : sellColorBg;

  // =========================================================================
  // LOGIQUE DE CALCUL TP / SL DYNAMIQUE (Depuis le %)
  // =========================================================================
  const handleTpPercentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setTpPercent(val);

    if (!val) {
      setTpPrice('');
      return;
    }

    const entryPx = Number(targetPrice);
    const roe = Number(val) / 100;

    if (entryPx > 0 && roe > 0) {
      const px = isBuy ? entryPx * (1 + (roe / leverage)) : entryPx * (1 - (roe / leverage));
      setTpPrice(formatPrice(px));
    }
  };

  const handleSlPercentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSlPercent(val);

    if (!val) {
      setSlPrice('');
      return;
    }

    const entryPx = Number(targetPrice);
    const roe = Number(val) / 100;

    if (entryPx > 0 && roe > 0) {
      const px = isBuy ? entryPx * (1 - (roe / leverage)) : entryPx * (1 + (roe / leverage));
      setSlPrice(formatPrice(px));
    }
  };

  useEffect(() => {
    if (isOpen) {
      window.dispatchEvent(new CustomEvent('closeAssetModal'));
    }
  }, [isOpen]);

  const sharedStyles = (
    <style>{`
      .hide-scrollbar::-webkit-scrollbar { display: none; }
      .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      .no-spinners::-webkit-outer-spin-button, .no-spinners::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
      .no-spinners { -moz-appearance: textfield; }
    `}</style>
  );

  const innerContent = (
    <div className="hide-scrollbar" style={{ display: 'flex', flexDirection: 'column', height: inline ? '100%' : 'auto', maxHeight: inline ? '100%' : '90vh', overflowY: 'auto', padding: '0.5rem', boxSizing: 'border-box', gap: '0.6rem', backgroundColor: themeBg, color: themeText, fontFamily: 'var(--sans)', borderRadius: inline ? 0 : '8px', border: inline ? 'none' : `1px solid ${themeBorder}` }} onClick={(e) => e.stopPropagation()}>

      {/* 1. Header Block */}
      <div style={{ display: 'flex', flexShrink: 0, justifyContent: 'space-between', alignItems: 'center', backgroundColor: themeControlBg, borderRadius: '4px', padding: '0.5rem 0.6rem', border: `1px solid ${themeBorder}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '28px', height: '28px', borderRadius: '50%', backgroundColor: '#F7931A', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${themeBorder}`, fontSize: '0.9rem', fontWeight: 600, color: '#fff' }}>
            {symbol.charAt(0)}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 700, lineHeight: 1 }}>{symbol}</span>
            <span className="font-mono" style={{ backgroundColor: isBuy ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)', color: isBuy ? buyColor : sellColor, padding: '1px 3px', borderRadius: '3px', fontSize: '0.55rem', fontWeight: 600, width: 'fit-content' }}>
              {order.limitType === 1 ? 'LIMIT' : 'STOP'} {isBuy ? 'Long' : 'Short'} {leverage.toFixed(1)}x
            </span>
          </div>
        </div>
      </div>

      {/* Target Price */}
      <div style={{ flexShrink: 0, backgroundColor: themeControlBg, borderRadius: '4px', border: `1px solid ${themeBorder}`, padding: '0.5rem 0.6rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
        <span style={{ fontSize: '0.65rem', color: themeTextMuted, borderBottom: `1px dashed ${themeBorder}`, width: 'max-content' }}>
          Limit Price
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '1.1rem', fontWeight: 600, color: activeColor, marginTop: '-2px' }}>
            {isBuy ? '≤' : '≥'}
          </span>
          <input
            type="number"
            className="no-spinners font-mono"
            value={targetPrice}
            onChange={(e) => setTargetPrice(e.target.value)}
            style={{ fontSize: '0.9rem', color: themeText, backgroundColor: 'transparent', border: 'none', outline: 'none', width: '100%', fontWeight: 600 }}
          />
        </div>
      </div>

      {/* TP Block */}
      <div style={{ flexShrink: 0, backgroundColor: themeControlBg, borderRadius: '4px', border: `1px solid ${themeBorder}`, padding: '0.5rem 0.6rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.65rem', color: themeTextMuted }}>Take Profit</span>
        </div>
        <input type="number" className="no-spinners font-mono" value={tpPrice} placeholder="0 to disable" onChange={e => { setTpPrice(e.target.value); setTpPercent(''); }} style={{ fontSize: '0.9rem', color: themeText, backgroundColor: 'transparent', border: 'none', outline: 'none' }} />
        <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
          {['25%', '50%', '100%', '500%'].map((pct) => (
            <button key={pct} onClick={() => handleTpPercentChange({ target: { value: pct.replace('%', '') } } as any)} style={{ flex: 1, padding: '0.3rem 0', backgroundColor: themeBg, color: themeTextMuted, border: `1px solid ${themeBorder}`, borderRadius: '4px', fontSize: '0.65rem', cursor: 'pointer' }}>{pct}</button>
          ))}
        </div>
      </div>

      {/* SL Block */}
      <div style={{ flexShrink: 0, backgroundColor: themeControlBg, borderRadius: '4px', border: `1px solid ${themeBorder}`, padding: '0.5rem 0.6rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.65rem', color: themeTextMuted }}>Stop Loss</span>
        </div>
        <input type="number" className="no-spinners font-mono" value={slPrice} placeholder="0 to disable" onChange={e => { setSlPrice(e.target.value); setSlPercent(''); }} style={{ fontSize: '0.9rem', color: themeText, backgroundColor: 'transparent', border: 'none', outline: 'none' }} />
        <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
          {['5%', '10%', '25%', '50%'].map((pct) => (
            <button key={pct} onClick={() => handleSlPercentChange({ target: { value: pct.replace('%', '') } } as any)} style={{ flex: 1, padding: '0.3rem 0', backgroundColor: themeBg, color: themeTextMuted, border: `1px solid ${themeBorder}`, borderRadius: '4px', fontSize: '0.65rem', cursor: 'pointer' }}>{pct}</button>
          ))}
        </div>
      </div>

      <div style={{ backgroundColor: activeColorBg, padding: '0.5rem', borderRadius: '4px', color: activeColor, fontSize: '0.6rem', border: `1px solid ${activeColor}`, textAlign: 'center' }}>
        SLs and TPs are executed as market orders once the limit is hit.
      </div>

      {/* ACTION BUTTON
          Out of scope for current Solana program:
          there is no single instruction equivalent to "UPDATE_LIMIT_ORDER"
          (price + TP + SL update in one call). Kept disabled intentionally. */}
      <button
        disabled
        style={{
          padding: '0.7rem',
          backgroundColor: themeControlBg,
          color: themeTextMuted,
          border: `1px solid ${themeBorder}`,
          borderRadius: '4px',
          fontWeight: 600,
          cursor: 'not-allowed',
          marginTop: '0.3rem',
          fontSize: '0.75rem',
          transition: 'all 0.2s',
          opacity: 0.8
        }}
      >
        Update Order (Not available on Solana yet)
      </button>

      {inline && (
        <button onClick={onClose} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', padding: '0.5rem', backgroundColor: 'transparent', color: themeTextMuted, border: `1px solid ${themeBorder}`, borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600, marginTop: 'auto' }}>
          Back to Order Form
        </button>
      )}

    </div>
  );

  if (inline) {
    return (
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: themeBg, zIndex: 100, display: 'flex', flexDirection: 'column' }}>
        {sharedStyles}
        {innerContent}
      </div>
    );
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, backdropFilter: 'blur(2px)' }}>
      {sharedStyles}
      {innerContent}
    </div>
  );
};