import React from 'react';
import { sharedStyle as style } from '../sharedStyle';
import { useTheme } from '../ThemeContext';

export const PortfolioSummary = () => {
  const [showBalance, setShowBalance] = React.useState(true);
  const { themeControlBg, themeBorder, themeText, themeTextMuted, themeAccent } = useTheme();

  return (
    <div style={{ ...(style.portfolioValueBlock as any), alignItems: 'stretch', justifyContent: 'flex-start', flexDirection: 'column', padding: '0.6rem 0.75rem', boxSizing: 'border-box', height: 'auto', backgroundColor: 'transparent', borderBottom: `1px solid ${themeBorder}` }}>
      
      {/* Metrics */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', fontSize: '0.65rem' }}>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: themeTextMuted, borderBottom: `1px dashed ${themeBorder}`, paddingBottom: '1px' }}>Portfolio Value</span>
          <span style={{ color: themeText, fontSize: '0.75rem', fontWeight: 'bold' }}>{showBalance ? '$0.00' : '****'}</span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: themeTextMuted, borderBottom: `1px dashed ${themeBorder}`, paddingBottom: '1px' }}>Free Collateral</span>
          <span style={{ color: themeText, fontSize: '0.7rem' }}>{showBalance ? '$0.00' : '****'}</span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: themeTextMuted, borderBottom: `1px dashed ${themeBorder}`, paddingBottom: '1px' }}>Margin Ratio</span>
          <span style={{ color: themeText, fontSize: '0.7rem' }}>0.00%</span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: themeTextMuted, borderBottom: `1px dashed ${themeBorder}`, paddingBottom: '1px' }}>Leverage</span>
          <span style={{ color: themeText, fontSize: '0.7rem' }}>1.00x</span>
        </div>

      </div>

      {/* Buttons */}
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.8rem' }}>
        <button style={{
          flex: 1,
          backgroundColor: themeAccent, 
          border: 'none',
          borderRadius: '4px',
          color: '#fff',
          padding: '0 0.5rem',
          height: '32px',
          fontSize: '0.75rem',
          fontWeight: 'bold',
          cursor: 'pointer'
        }}>
          Deposit
        </button>
        
        <button 
          onClick={() => setShowBalance(!showBalance)}
          style={{
          width: '32px',
          height: '32px',
          backgroundColor: 'transparent',
          border: `1px solid ${themeBorder}`,
          borderRadius: '4px',
          color: themeText,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer'
        }}>
          {showBalance ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
          )}
        </button>
      </div>

    </div>
  );
};
