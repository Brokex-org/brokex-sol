import React, { createContext, useContext, useState } from 'react';

type ThemeMode = 'dark' | 'light';
type TradingColorTheme = 'blue' | 'green';

interface ThemeContextProps {
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
  bgColor: string;
  setBgColor: (c: string) => void;
  tradingColorTheme: TradingColorTheme;
  setTradingColorTheme: (a: TradingColorTheme) => void;
  // Computed helpers
  themeBg: string;
  themeText: string;
  themeTextMuted: string;
  themeBorder: string;
  themeControlBg: string;
  themeAccent: string;
  buyColor: string;
  sellColor: string;
  buyColorBg: string;
  sellColorBg: string;
}

const ThemeContext = createContext<ThemeContextProps | undefined>(undefined);

export const ThemeProvider: React.FC<{children: React.ReactNode}> = ({ children }) => {
  const [mode, setMode] = useState<ThemeMode>('dark');
  const [bgColor, setBgColor] = useState<string>('#121212');
  const [tradingColorTheme, setTradingColorTheme] = useState<TradingColorTheme>('blue');

  const themeBg = mode === 'dark' ? bgColor : '#f9fafb';
  const themeText = mode === 'dark' ? '#ffffff' : '#111827';
  const themeTextMuted = mode === 'dark' ? '#a1a1aa' : '#6b7280';
  const themeBorder = mode === 'dark' ? '#27272a' : '#e5e7eb';
  const themeControlBg = mode === 'dark' ? '#18181b' : '#ffffff';
  
  const buyColor = tradingColorTheme === 'blue' ? '#3b82f6' : '#10b981';
  const buyColorBg = tradingColorTheme === 'blue' ? 'rgba(59, 130, 246, 0.1)' : 'rgba(16, 185, 129, 0.1)';
  const sellColor = '#ef4444';
  const sellColorBg = 'rgba(239, 68, 68, 0.1)';
  
  const themeAccent = buyColor;

  return (
    <ThemeContext.Provider value={{
      mode, setMode, bgColor, setBgColor, tradingColorTheme, setTradingColorTheme,
      themeBg, themeText, themeTextMuted, themeBorder, themeControlBg, themeAccent,
      buyColor, sellColor, buyColorBg, sellColorBg
    }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be wrapped in ThemeProvider');
  return context;
};
