import { useEffect, useRef, useState } from 'react';
import { CandlestickSeries, ColorType, createChart, type UTCTimestamp } from 'lightweight-charts';

export const ORDERLY_API_URL = 'https://api.orderly.org'; // Mainnet

interface OrderlyChartProps {
  symbol?: string;
  resolution?: string; // '1', '5', '15', '60' (1h), 'D' (1 jour)
  days?: number; // Historique en jours
}

export default function OrderlyChart({ 
  symbol = 'PERP_ETH_USDC', 
  resolution = '60', 
  days = 7 
}: OrderlyChartProps) {
  
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // 1. Initialisation du graphique (Thème Sombre) — lightweight-charts v5 API
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#1e272e' },
        textColor: '#d1d4dc',
        fontFamily: 'Roboto, sans-serif',
      },
      grid: {
        vertLines: { color: 'rgba(42, 46, 57, 0.5)' },
        horzLines: { color: 'rgba(42, 46, 57, 0.5)' },
      },
      width: chartContainerRef.current.clientWidth,
      height: 400,
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
      },
    });

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#2ecc71',
      downColor: '#e74c3c',
      borderVisible: false,
      wickUpColor: '#2ecc71',
      wickDownColor: '#e74c3c',
    });

    // 2. Fonction pour récupérer les données de l'API Orderly
    const fetchHistory = async () => {
      setIsLoading(true);
      try {
        // Calcul des timestamps en secondes
        const to = Math.floor(Date.now() / 1000); 
        const from = to - (days * 24 * 60 * 60);

        const url = `${ORDERLY_API_URL}/v1/tv/history?symbol=${symbol}&resolution=${resolution}&from=${from}&to=${to}`;
        const response = await fetch(url);
        const data = await response.json();

        // 3. Formatage des données (Orderly -> TradingView)
        if (data.s === 'ok' && data.t && data.t.length > 0) {
          const formattedData = data.t.map((time: number, index: number) => ({
            time: time as UTCTimestamp,
            open: data.o[index],
            high: data.h[index],
            low: data.l[index],
            close: data.c[index],
          }));

          // TradingView exige que les données soient strictement triées par date croissante
          formattedData.sort((a: any, b: any) => a.time - b.time);
          
          candlestickSeries.setData(formattedData);
          chart.timeScale().fitContent(); // Zoom automatique pour tout voir
        }
      } catch (error) {
        console.error("Erreur lors de la récupération de l'historique:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchHistory();

    // 4. Rendre le graphique "Responsive" (s'adapte à la taille de la fenêtre)
    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    // Nettoyage lors de la destruction du composant
    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [symbol, resolution, days]);

  return (
    <div style={{ position: 'relative', width: '100%', borderRadius: '8px', overflow: 'hidden' }}>
      {/* Écran de chargement superposé */}
      {isLoading && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, 
          display: 'flex', justifyContent: 'center', alignItems: 'center', 
          backgroundColor: 'rgba(30, 39, 46, 0.8)', color: 'white', zIndex: 10
        }}>
          Chargement du graphique...
        </div>
      )}
      
      {/* Conteneur du graphique */}
      <div ref={chartContainerRef} style={{ width: '100%' }} />
    </div>
  );
}