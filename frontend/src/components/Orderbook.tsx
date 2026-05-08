import React from 'react';
import { useTheme } from '../ThemeContext';

export const Orderbook = () => {
  const { themeText, themeBorder } = useTheme();

  return (
    <div style={{ 
      flex: 1, 
      backgroundColor: 'transparent', 
      color: themeText, 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center',
      borderLeft: `1px solid ${themeBorder}`,
      height: '100%'
    }}>
      Orderbook Placeholder
    </div>
  );
};
