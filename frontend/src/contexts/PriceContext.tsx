import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { formatPrice } from '../utils/ostium/utils';

export interface PriceData {
  feed_id: string;
  bid: number;
  mid: number;
  ask: number;
  isMarketOpen: boolean;
  isDayTradingClosed: boolean;
  secondsToToggleIsDayTradingClosed: number;
  from: string;
  to: string;
  timestampSeconds: number;
}

interface PriceContextType {
  prices: Record<string, PriceData>;
  selectedAsset: string;
  setSelectedAsset: (asset: string) => void;
  currentPriceData: PriceData | null;
}

const PriceContext = createContext<PriceContextType | undefined>(undefined);

export const PriceProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [prices, setPrices] = useState<Record<string, PriceData>>({});
  const [selectedAsset, setSelectedAsset] = useState<string>('BTC');

  useEffect(() => {
    let socket: WebSocket;
    let reconnectTimer: NodeJS.Timeout;

    // Buffer pour ne pas spammer React avec 100 rendus par seconde
    const pricesBuffer: Record<string, PriceData> = {};
    let hasNewData = false;

    // Flush le buffer vers le state React toutes les 500ms
    const flushInterval = setInterval(() => {
      if (hasNewData) {
        setPrices((prev) => {
          // On s'assure de ne mettre à jour que ce qui a changé
          return { ...prev, ...pricesBuffer };
        });
        hasNewData = false;
      }
    }, 500);

    const connect = () => {
      socket = new WebSocket('wss://backend.brokex.trade/ws/ostium-prices');

      socket.onopen = () => {
        console.log('Price WebSocket connected');
      };

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          
          if (payload && payload.data && Array.isArray(payload.data)) {
            const data: PriceData[] = payload.data;
            data.forEach((item) => {
              pricesBuffer[item.from] = item;
            });
            hasNewData = true; // Signal qu'il y a de nouvelles données
          }
        } catch (error) {
          console.error("Error parsing WS data", error);
        }
      };

      socket.onclose = () => {
        console.log('Price WebSocket disconnected, attempting reconnect...');
        reconnectTimer = setTimeout(connect, 3000);
      };

      socket.onerror = (error) => {
        console.error('Price WebSocket error', error);
        socket.close();
      };
    };

    connect();

    return () => {
      clearInterval(flushInterval);
      clearTimeout(reconnectTimer);
      if (socket) {
        socket.close();
      }
    };
  }, []); // Run once on mount

  // Initialize selectedAsset if BTC is not present but others are
  useEffect(() => {
      if (Object.keys(prices).length > 0) {
          if (!prices[selectedAsset]) {
             setSelectedAsset(Object.keys(prices).sort()[0] || 'BTC');
          }
      }
  }, [prices, selectedAsset]);

  const currentPriceData = prices[selectedAsset] || null;

  useEffect(() => {
    if (currentPriceData) {
      const priceStr = formatPrice(currentPriceData.mid);
      const ticker = `${selectedAsset}/${currentPriceData.to || 'USD'}`;
      document.title = `$${priceStr} ${ticker} | Brokex`;
    } else {
      document.title = 'Brokex | Trading';
    }
  }, [currentPriceData, selectedAsset]);

  return (
    <PriceContext.Provider value={{ prices, selectedAsset, setSelectedAsset, currentPriceData }}>
      {children}
    </PriceContext.Provider>
  );
};

export const usePriceContext = () => {
  const context = useContext(PriceContext);
  if (context === undefined) {
    throw new Error('usePriceContext must be used within a PriceProvider');
  }
  return context;
};
