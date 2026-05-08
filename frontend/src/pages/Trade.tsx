import React, { useState, useEffect, useRef } from 'react';
import { useTheme } from '../ThemeContext';
import { OrderForm } from '../components/OrderForm';
import { PositionsPanel } from '../components/PositionsPanel';
import { TradeHeader } from '../components/TradeHeader';
import { TVChart } from '../components/TVChart';
import { useDynamicContext } from '@dynamic-labs/sdk-react-core';

export function Trade() {
  const { themeBorder, themeBg, themeText, themeTextMuted, themeControlBg } = useTheme();
  const { user } = useDynamicContext();
  
  // Layout OrderForm (Droite/Gauche)
  const [isOrderFormRight, setIsOrderFormRight] = useState(true);

  // Responsive state
  const [isMobile, setIsMobile] = useState(false);
  const [isMobileOrderFormOpen, setIsMobileOrderFormOpen] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // ---------------------------------------------------------
  // LOGIQUE DE REDIMENSIONNEMENT (DRAG & DROP)
  // ---------------------------------------------------------
  const [panelHeight, setPanelHeight] = useState(280); 
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Automatiquement réduire si pas de wallet connecté
  useEffect(() => {
    if (!user) {
      setPanelHeight(32);
    } else {
      setPanelHeight(280);
    }
  }, [user]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging || !containerRef.current) return;
      
      const containerRect = containerRef.current.getBoundingClientRect();
      const totalHeight = containerRect.height;
      let newHeight = containerRect.bottom - e.clientY;
      
      const maxPanelHeight = totalHeight * 0.60;
      if (newHeight > maxPanelHeight) newHeight = maxPanelHeight;
      
      const collapseThreshold = totalHeight * 0.20;
      if (newHeight < collapseThreshold) newHeight = 32;

      setPanelHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.body.style.userSelect = ''; 
    };

    if (isDragging) {
      document.body.style.userSelect = 'none'; 
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  return (
    <div style={{ 
      display: 'grid', 
      gridTemplateColumns: isMobile ? '1fr' : (isOrderFormRight ? '1fr 340px' : '340px 1fr'), 
      height: '100%',       
      width: '100%',        
      boxSizing: 'border-box', 
      overflow: 'hidden',   
      backgroundColor: themeBg,
      position: 'relative'
    }}>

      <style>{`
        .positions-dynamic-wrapper > div {
          height: 100% !important;
          border-top: none !important;
        }
      `}</style>

      {/* ========================================= */}
      {/* COLONNE CENTRALE (Header + Chart + Positions) */}
      {/* ========================================= */}
      <div style={{ 
        order: isOrderFormRight ? 1 : 2, 
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,        
        height: '100%',     
        borderRight: isOrderFormRight ? `1px solid ${themeBorder}` : 'none',
        borderLeft: !isOrderFormRight ? `1px solid ${themeBorder}` : 'none'
      }}>
        
        {/* 1. Header (Fixe) */}
        <div style={{ flexShrink: 0, width: '100%', minWidth: 0 }}>
          <TradeHeader />
        </div>

        {/* 2. Zone Redimensionnable */}
        <div ref={containerRef} style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          
          {/* Graphique - On passe les props pour le bouton de Layout ! */}
          <div id="tvchart-container" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative', width: '100%' }}>
            <TVChart 
              isOrderFormRight={isOrderFormRight} 
              setIsOrderFormRight={setIsOrderFormRight} 
            />
          </div>

          {/* DRAG HANDLE */}
          <div 
            onMouseDown={(e) => { e.preventDefault(); setIsDragging(true); }}
            style={{ 
              height: '8px', backgroundColor: isDragging ? themeControlBg : themeBg, borderTop: `1px solid ${themeBorder}`,
              cursor: 'row-resize', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 20, transition: 'background-color 0.2s', flexShrink: 0
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = themeControlBg}
            onMouseLeave={(e) => { if (!isDragging) e.currentTarget.style.backgroundColor = themeBg; }}
          >
            <div style={{ width: '40px', height: '2px', backgroundColor: isDragging ? themeTextMuted : themeBorder, borderRadius: '2px', transition: 'background-color 0.2s' }} />
          </div>

          {/* Positions Panel */}
          <div className="positions-dynamic-wrapper" style={{ height: `${panelHeight}px`, flexShrink: 0, width: '100%', overflow: 'hidden' }}>
            <PositionsPanel />
          </div>

        </div>
      </div>

      {/* ========================================= */}
      {/* COLONNE LATÉRALE (Order Form Uniquement)      */}
      {/* ========================================= */}
      {!isMobile && (
        <aside 
          id="order-form-container"
          style={{ 
            order: isOrderFormRight ? 2 : 1, 
            height: '100%', width: '100%', display: 'flex', flexDirection: 'column', backgroundColor: themeBg, minHeight: 0, position: 'relative'
          }}
        >
          <div className="hide-scrollbar" style={{ flex: 1, overflowY: 'auto', width: '100%', minHeight: 0 }}>
            <style>{`
              .hide-scrollbar::-webkit-scrollbar { display: none; }
              .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
            `}</style>
            
            <div style={{ paddingBottom: '2rem' }}>
              <OrderForm />
            </div>
          </div>
        </aside>
      )}

      {/* ========================================= */}
      {/* MOBILE TRADE OVERLAY                      */}
      {/* ========================================= */}
      {isMobile && isMobileOrderFormOpen && (
        <div style={{ 
          position: 'fixed', inset: 0, zIndex: 1000, 
          backgroundColor: 'rgba(0,0,0,0.85)', 
          backdropFilter: 'blur(4px)',
          display: 'flex', flexDirection: 'column', padding: '1rem', boxSizing: 'border-box' 
        }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: themeBg, borderRadius: '12px', border: `1px solid ${themeBorder}`, overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', borderBottom: `1px solid ${themeBorder}` }}>
              <span style={{ color: themeText, fontWeight: 600 }}>Execute Trade</span>
              <button 
                onClick={() => setIsMobileOrderFormOpen(false)}
                style={{ background: 'none', border: 'none', color: themeTextMuted, fontSize: '1.2rem', cursor: 'pointer' }}
              >✕</button>
            </div>
            <div className="hide-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '1rem' }}>
              <OrderForm />
            </div>
          </div>
        </div>
      )}

      {/* ========================================= */}
      {/* MOBILE TRADE BUTTON (GOLD)                 */}
      {/* ========================================= */}
      {isMobile && (
        <div style={{ position: 'fixed', bottom: '1.5rem', left: '0', right: '0', display: 'flex', justifyContent: 'center', zIndex: 500, pointerEvents: 'none' }}>
          <button 
            onClick={() => setIsMobileOrderFormOpen(true)}
            style={{ 
              pointerEvents: 'auto',
              backgroundColor: '#BC8961', color: '#fff', 
              border: 'none', borderRadius: '50px', 
              padding: '0.8rem 2.5rem', fontSize: '0.9rem', fontWeight: 700, 
              boxShadow: '0 4px 20px rgba(0,0,0,0.5)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: '8px',
              textTransform: 'uppercase', letterSpacing: '0.05em'
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"></polyline>
              <polyline points="16 7 22 7 22 13"></polyline>
            </svg>
            Trade
          </button>
        </div>
      )}

    </div>
  );
}