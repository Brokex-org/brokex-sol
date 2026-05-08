import React, { useState, useEffect } from 'react';
import { formatPrice } from '../utils/ostium/utils';

// Couleur d'accentuation dorée globale
const goldAccent = '#BC8961';
const goldAccentLight = 'rgba(188, 137, 97, 0.15)';

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"></line>
    <line x1="6" y1="6" x2="18" y2="18"></line>
  </svg>
);

const ShareIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: '4px', opacity: 0.7 }}>
    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path>
    <polyline points="16 6 12 2 8 6"></polyline>
    <line x1="12" y1="2" x2="12" y2="15"></line>
  </svg>
);

export const EditTradeModal = ({ isOpen, onClose, trade, onAction, theme, liveMath, symbol, inline, isMarketOpen }: any) => {
  if (!isOpen || !trade) return null;

  const [activeTab, setActiveTab] = useState('Details');
  const [isProcessingClose, setIsProcessingClose] = useState(false);

  const [closePercent, setClosePercent] = useState<number>(100);
  const [tpPrice, setTpPrice] = useState(trade.takeProfitPrice ? formatPrice(trade.takeProfitPrice) : '');
  const [slPrice, setSlPrice] = useState(trade.stopLossPrice ? formatPrice(trade.stopLossPrice) : '');

  const { themeBg, themeControlBg, themeBorder, themeText, themeTextMuted, buyColor, sellColor } = theme;

  const isBuy = trade.isBuy;
  const leverage = Number(trade.leverage);
  const entryPrice = Number(trade.openPrice);
  const collateral = Number(trade.collateral);
  const sizeAsset = Number(trade.tradeNotional || trade.notional || 0);
  const notionalUsd = sizeAsset * entryPrice;

  const liqPrice = isBuy ? entryPrice * (1 - 0.95 / leverage) : entryPrice * (1 + 0.95 / leverage);

  const closePnlUsd = (Number(liveMath.pnl.replace(/[^0-9.-]+/g, "")) || 0) * (closePercent / 100);

  const formatDate = (timestamp: any) => {
    if (!timestamp) return '---';
    const d = new Date(timestamp);
    return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear().toString().slice(2)} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  const handleExecuteClose = async () => {
    if (isProcessingClose) return;
    setIsProcessingClose(true);
    try {
      await onAction('CLOSE', { percent: closePercent });
    } catch (e) {
      console.error(e);
      setIsProcessingClose(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      window.dispatchEvent(new CustomEvent('closeAssetModal'));
    }
  }, [isOpen]);

  const applyTpPercent = (percent: string) => {
    const roePercent = parseInt(percent.replace('%', ''));
    if (isNaN(roePercent)) return;
    const roe = roePercent / 100;
    const calculatedPrice = isBuy ? entryPrice * (1 + (roe / leverage)) : entryPrice * (1 - (roe / leverage));
    setTpPrice(formatPrice(calculatedPrice));
  };

  const applySlPercent = (percent: string) => {
    if (percent === 'None') { setSlPrice(''); return; }
    const roePercent = parseInt(percent.replace('%', ''));
    if (isNaN(roePercent)) return;
    const roe = roePercent / 100;
    const calculatedPrice = isBuy ? entryPrice * (1 - (roe / leverage)) : entryPrice * (1 + (roe / leverage));
    setSlPrice(formatPrice(calculatedPrice));
  };

  const InputRow = ({ label, value, color, secondary }: { label: string, value: string, color?: string, secondary?: string }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.1rem 0' }}>
      <span style={{ color: themeTextMuted, fontSize: '0.75rem' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
        <span className="font-mono" style={{ color: color || themeText, fontSize: '0.8rem' }}>{value}</span>
        {secondary && <span className="font-mono" style={{ color: themeTextMuted, fontSize: '0.65rem' }}>{secondary}</span>}
      </div>
    </div>
  );

  const sharedStyles = (
    <style>{`
      .hide-scrollbar::-webkit-scrollbar { display: none; }
      .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      .no-spinners::-webkit-outer-spin-button, .no-spinners::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
      .no-spinners { -moz-appearance: textfield; }
      .range-slider { -webkit-appearance: none; width: 100%; height: 3px; background: ${themeBorder}; border-radius: 1.5px; outline: none; }
      .range-slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 14px; height: 14px; border-radius: 50%; background: ${goldAccent}; cursor: pointer; transition: transform 0.1s; border: 1px solid #333; box-shadow: 0 0 4px rgba(0,0,0,0.3); }
      .range-slider::-webkit-slider-thumb:hover { transform: scale(1.2); }
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
              {isBuy ? 'Long' : 'Short'} {leverage.toFixed(1)}x
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
          <span style={{ fontSize: '0.65rem', color: themeTextMuted }}>Unrealized PNL</span>
          <span className="font-mono" style={{ fontSize: '0.85rem', fontWeight: 600, color: liveMath.pnlColor === 'buyColor' ? buyColor : sellColor, lineHeight: 1 }}>
            {liveMath.pnl} <span style={{ fontSize: '0.65rem', fontWeight: 400 }}>{liveMath.pnlPercent}</span>
          </span>
        </div>
      </div>

      {/* 2. Tabs */}
      <div style={{ display: 'flex', flexShrink: 0, backgroundColor: themeControlBg, borderRadius: '4px', padding: '2px', border: `1px solid ${themeBorder}` }}>
        {['Details', 'Close', 'TP / SL'].map(tab => (
          <div
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              flex: 1, textAlign: 'center', padding: '0.4rem 0.2rem', cursor: 'pointer', borderRadius: '3px',
              backgroundColor: activeTab === tab ? goldAccentLight : 'transparent',
              color: activeTab === tab ? goldAccent : themeTextMuted,
              border: `1px solid ${activeTab === tab ? goldAccent : 'transparent'}`,
              fontSize: '0.7rem', fontWeight: activeTab === tab ? 600 : 400, transition: 'all 0.15s'
            }}>
            {tab}
          </div>
        ))}
      </div>

      {/* 3. Content Area */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: '0.6rem' }}>

        {/* --- DETAILS TAB --- */}
        {activeTab === 'Details' && (
          <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.7rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.2rem 0' }}>
              <span style={{ color: themeTextMuted, borderBottom: `1px dashed ${themeBorder}` }}>Time</span>
              <span className="font-mono" style={{ color: themeText }}>{formatDate(trade.timestamp)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.2rem 0' }}>
              <span style={{ color: themeTextMuted, borderBottom: `1px dashed ${themeBorder}` }}>Collateral</span>
              <span className="font-mono" style={{ color: themeText }}>${collateral.toFixed(4)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.2rem 0' }}>
              <span style={{ color: themeTextMuted, borderBottom: `1px dashed ${themeBorder}` }}>Exposure</span>
              <span className="font-mono" style={{ color: themeText }}>${notionalUsd.toFixed(4)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.2rem 0' }}>
              <span style={{ color: themeTextMuted, borderBottom: `1px dashed ${themeBorder}` }}>Entry Price</span>
              <span className="font-mono" style={{ color: themeText }}>{formatPrice(entryPrice)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.2rem 0' }}>
              <span style={{ color: themeTextMuted, borderBottom: `1px dashed ${themeBorder}` }}>Market Price</span>
              <span className="font-mono" style={{ color: themeText }}>{liveMath.markPrice}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.2rem 0' }}>
              <span style={{ color: themeTextMuted, borderBottom: `1px dashed ${themeBorder}` }}>Take Profit</span>
              <span className="font-mono" style={{ color: tpPrice ? buyColor : themeTextMuted }}>{tpPrice || 'None'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.2rem 0' }}>
              <span style={{ color: themeTextMuted, borderBottom: `1px dashed ${themeBorder}` }}>Stop Loss</span>
              <span className="font-mono" style={{ color: slPrice ? sellColor : themeTextMuted }}>{slPrice || 'None'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.2rem 0' }}>
              <span style={{ color: themeTextMuted, borderBottom: `1px dashed ${themeBorder}` }}>Liquidation Price</span>
              <span className="font-mono" style={{ color: sellColor }}>{formatPrice(liqPrice)}</span>
            </div>
            <button style={{ width: '100%', padding: '0.7rem', background: 'transparent', color: goldAccent, border: `1px solid ${goldAccent}`, borderRadius: '4px', cursor: 'pointer', marginTop: '0.5rem', fontSize: '0.75rem', fontWeight: 600, transition: 'all 0.2s', backgroundColor: goldAccentLight }}>
              Share Trade Details
            </button>
          </div>
        )}

        {/* --- CLOSE TAB --- */}
        {activeTab === 'Close' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            <div style={{ flexShrink: 0, backgroundColor: themeControlBg, borderRadius: '4px', border: `1px solid ${themeBorder}`, display: 'flex', flexDirection: 'column' }}>

              <div style={{ padding: '0.5rem 0.6rem', borderBottom: `1px solid ${themeBorder}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
                  <span style={{ fontSize: '0.65rem', color: themeTextMuted }}>Size to Close</span>
                  <span style={{ fontSize: '0.65rem', color: goldAccent, cursor: 'pointer' }} onClick={() => setClosePercent(100)}>Max</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <input type="number" className="no-spinners font-mono" value={((closePercent / 100) * sizeAsset).toFixed(6)} readOnly style={{ fontSize: '0.9rem', color: themeText, backgroundColor: 'transparent', border: 'none', outline: 'none', padding: 0, width: '150px' }} />
                  <div className="font-mono" style={{ color: themeText, fontWeight: 600, fontSize: '0.8rem' }}>{closePercent}%</div>
                </div>
              </div>

              <div style={{ padding: '0.5rem 0.6rem' }}>
                <input type="range" min="0" max="100" value={closePercent} onChange={(e) => setClosePercent(Number(e.target.value))} className="range-slider" style={{ background: `linear-gradient(to right, ${goldAccent} ${closePercent}%, ${themeBorder} ${closePercent}%)` }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.4rem', gap: '4px' }}>
                  {[25, 50, 75, 100].map(pct => (
                    <button key={pct} onClick={() => setClosePercent(pct)} style={{ flex: 1, padding: '0.15rem 0', fontSize: '0.65rem', border: `1px solid ${closePercent === pct ? goldAccent : themeBorder}`, borderRadius: '4px', backgroundColor: closePercent === pct ? goldAccentLight : themeBg, color: closePercent === pct ? goldAccent : themeTextMuted, cursor: 'pointer' }}>{pct}%</button>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '0.2rem', fontSize: '0.65rem', marginTop: '0.2rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: themeTextMuted, borderBottom: `1px dashed ${themeBorder}` }}>Mark Price</span>
                <span className="font-mono" style={{ color: themeText }}>${liveMath.markPrice}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: themeTextMuted, borderBottom: `1px dashed ${themeBorder}` }}>Est. PNL</span>
                <span className="font-mono" style={{ color: closePnlUsd >= 0 ? buyColor : sellColor }}>{closePnlUsd >= 0 ? '+' : ''}{closePnlUsd.toFixed(4)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2px', paddingTop: '4px', borderTop: `1px solid ${themeBorder}` }}>
                <span style={{ color: themeText, fontWeight: 600 }}>To Receive</span>
                <span className="font-mono" style={{ color: goldAccent, fontWeight: 600 }}>${(collateral * (closePercent / 100) + closePnlUsd).toFixed(4)}</span>
              </div>
            </div>

            <button onClick={handleExecuteClose} disabled={isProcessingClose || closePercent <= 0 || !isMarketOpen} style={{ padding: '0.7rem', backgroundColor: isProcessingClose || closePercent <= 0 || !isMarketOpen ? themeControlBg : 'rgba(239, 68, 68, 0.1)', color: isProcessingClose || closePercent <= 0 || !isMarketOpen ? themeTextMuted : sellColor, border: `1px solid ${isProcessingClose || closePercent <= 0 || !isMarketOpen ? themeBorder : sellColor}`, borderRadius: '4px', fontWeight: 600, cursor: isProcessingClose || closePercent <= 0 || !isMarketOpen ? 'not-allowed' : 'pointer', fontSize: '0.8rem', transition: 'all 0.2s', marginTop: '0.2rem' }}>
              {!isMarketOpen ? 'Market is Closed' : (isProcessingClose ? 'Processing...' : `Close ${closePercent}%`)}
            </button>
          </div>
        )}

        {/* --- TP / SL TAB --- */}
        {activeTab === 'TP / SL' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
            <div style={{ flexShrink: 0, backgroundColor: themeControlBg, borderRadius: '4px', border: `1px solid ${themeBorder}`, padding: '0.5rem 0.6rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.65rem', color: themeTextMuted }}>Take Profit</span>
                <span style={{ fontSize: '0.65rem', color: goldAccent, cursor: 'pointer' }} onClick={() => onAction('UPDATE_TP', { price: tpPrice })}>Save</span>
              </div>
              <input type="number" className="no-spinners font-mono" value={tpPrice} placeholder="0 to disable" onChange={e => setTpPrice(e.target.value)} style={{ fontSize: '0.9rem', color: themeText, backgroundColor: 'transparent', border: 'none', outline: 'none' }} />
              <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                {['25%', '50%', '100%', '500%'].map((pct) => (
                  <button key={pct} onClick={() => applyTpPercent(pct)} style={{ flex: 1, padding: '0.2rem 0', backgroundColor: themeBg, color: themeTextMuted, border: `1px solid ${themeBorder}`, borderRadius: '4px', fontSize: '0.6rem', cursor: 'pointer' }}>{pct}</button>
                ))}
              </div>
            </div>

            <div style={{ flexShrink: 0, backgroundColor: themeControlBg, borderRadius: '4px', border: `1px solid ${themeBorder}`, padding: '0.5rem 0.6rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.65rem', color: themeTextMuted }}>Stop Loss</span>
                <span style={{ fontSize: '0.65rem', color: goldAccent, cursor: 'pointer' }} onClick={() => onAction('UPDATE_SL', { price: slPrice })}>Save</span>
              </div>
              <input type="number" className="no-spinners font-mono" value={slPrice} placeholder="0 to disable" onChange={e => setSlPrice(e.target.value)} style={{ fontSize: '0.9rem', color: themeText, backgroundColor: 'transparent', border: 'none', outline: 'none' }} />
              <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                {['5%', '10%', '25%', '50%', 'None'].map((pct) => (
                  <button key={pct} onClick={() => applySlPercent(pct)} style={{ flex: 1, padding: '0.2rem 0', backgroundColor: themeBg, color: themeTextMuted, border: `1px solid ${themeBorder}`, borderRadius: '4px', fontSize: '0.6rem', cursor: 'pointer' }}>{pct}</button>
                ))}
              </div>
            </div>

            <div style={{ backgroundColor: goldAccentLight, padding: '0.5rem', borderRadius: '4px', color: goldAccent, fontSize: '0.6rem', border: `1px solid ${goldAccent}`, textAlign: 'center' }}>
              SLs and TPs are executed as market orders.
            </div>
          </div>
        )}

      </div>

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
    <div onClick={onClose} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, backdropFilter: 'blur(2px)' }}>
      {sharedStyles}
      {innerContent}
    </div>
  );
};