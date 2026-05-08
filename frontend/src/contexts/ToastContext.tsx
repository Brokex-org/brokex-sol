import React, { createContext, useContext, useState, useCallback } from 'react';
import { useTheme } from '../ThemeContext';
import { useNetwork } from './NetworkContext';
import { solanaTxExplorerUrl } from '../utils/solana/programConfig';

export interface ToastProps {
  id: string;
  type: 'success' | 'error' | 'pending' | 'warning';
  title: string;
  message?: React.ReactNode;
  pair?: string;
  side?: 'buy' | 'sell';
  leverage?: number;
  txHash?: string;
}

interface ToastContextType {
  addToast: (toast: Omit<ToastProps, 'id'>) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastProps[]>([]);
  const { themeBg, themeBorder, themeText, themeTextMuted, buyColor, sellColor } = useTheme();
  const { cluster } = useNetwork();

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((toast: Omit<ToastProps, 'id'>) => {
    const id = Math.random().toString(36).substr(2, 9);
    setToasts((prev) => [...prev, { ...toast, id }]);
    
    // Auto-remove after 6 seconds unless it's a persistent error
    if (toast.type !== 'error') {
      setTimeout(() => removeToast(id), toast.type === 'warning' ? 5000 : 6000);
    }
  }, [removeToast]);

  return (
    <ToastContext.Provider value={{ addToast, removeToast }}>
      {children}
      <div style={{ position: 'fixed', bottom: '20px', right: '20px', display: 'flex', flexDirection: 'column', gap: '10px', zIndex: 9999 }}>
        {toasts.map((toast) => (
          <div key={toast.id} style={{ 
            backgroundColor: themeBg, 
            border: `1px solid ${toast.type === 'warning' ? 'rgba(188,137,97,0.4)' : themeBorder}`, 
            borderLeft: toast.type === 'warning' ? '3px solid #BC8961' : undefined,
            borderRadius: '8px', 
            padding: '16px', 
            minWidth: '300px',
            maxWidth: '350px',
            color: themeText,
            boxShadow: toast.type === 'warning' ? '0 8px 24px rgba(188,137,97,0.12)' : '0 8px 24px rgba(0,0,0,0.5)',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            position: 'relative'
          }}>
            <button 
              onClick={() => removeToast(toast.id)}
              style={{ position: 'absolute', top: '12px', right: '12px', background: 'none', border: 'none', color: themeTextMuted, cursor: 'pointer', fontSize: '1rem' }}>
              &times;
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {toast.type === 'success' && <span style={{ color: buyColor }}>✓</span>}
              {toast.type === 'error' && <span style={{ color: sellColor }}>✗</span>}
              {toast.type === 'pending' && <span style={{ color: themeTextMuted }}>⏳</span>}
              {toast.type === 'warning' && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#BC8961" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/>
                  <line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
              )}
              <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 500, color: toast.type === 'warning' ? '#BC8961' : themeText }}>{toast.title}</h4>
            </div>
            
            {toast.pair && (
              <div style={{ display: 'flex', gap: '8px', fontSize: '0.8rem', color: themeTextMuted, marginTop: '2px' }}>
                 <span style={{ color: themeText }}>{toast.pair}</span>
                 {toast.side && <span style={{ color: toast.side === 'buy' ? buyColor : sellColor }}>{toast.side === 'buy' ? 'LONG' : 'SHORT'}</span>}
                 {toast.leverage && <span>{toast.leverage}x</span>}
              </div>
            )}
            
            {toast.message && <div style={{ margin: 0, fontSize: '0.8rem', color: themeTextMuted }}>{toast.message}</div>}
            {toast.txHash && (
              <a
                href={solanaTxExplorerUrl(toast.txHash, cluster)}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: '0.75rem',
                  color: '#BC8961',
                  textDecoration: 'none',
                  fontWeight: 500,
                  width: 'fit-content',
                }}
              >
                View on Explorer ↗
              </a>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within ToastProvider");
  return context;
}
