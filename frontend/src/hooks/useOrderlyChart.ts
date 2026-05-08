import { useState, useEffect, useCallback } from 'react';

const ORDERLY_API_URL = 'https://api.orderly.org'; // Mainnet

// Le format parfait attendu par Lightweight Charts
export interface ChartCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export function useOrderlyChart(symbol: string = 'PERP_ETH_USDC', resolution: string = '60', days: number = 3) {
  const [data, setData] = useState<ChartCandle[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchChartData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const to = Math.floor(Date.now() / 1000); 
      const from = to - (days * 24 * 60 * 60);

      const url = `${ORDERLY_API_URL}/v1/tv/history?symbol=${symbol}&resolution=${resolution}&from=${from}&to=${to}`;
      
      const response = await fetch(url);
      const json = await response.json();

      if (json.s === 'ok' && json.t && json.t.length > 0) {
        // Transformation des données brutes en objets propres
        const formattedData: ChartCandle[] = json.t.map((time: number, index: number) => ({
          time: time,
          open: json.o[index],
          high: json.h[index],
          low: json.l[index],
          close: json.c[index],
        }));

        // TradingView exige un tri chronologique strict
        formattedData.sort((a, b) => a.time - b.time);
        
        setData(formattedData);
      } else {
        setError(json.errmsg || "Aucune donnée disponible pour cette période.");
      }
    } catch (err: any) {
      console.error("Erreur API Graphique:", err);
      setError(err.message || "Erreur de connexion à l'API Orderly.");
    } finally {
      setIsLoading(false);
    }
  }, [symbol, resolution, days]);

  // Chargement automatique quand les paramètres changent
  useEffect(() => {
    fetchChartData();
  }, [fetchChartData]);

  // On retourne les données, l'état, et la fonction pour rafraîchir manuellement si besoin
  return { data, isLoading, error, refetch: fetchChartData };
}