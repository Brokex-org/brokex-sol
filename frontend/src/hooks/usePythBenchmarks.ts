import { useState, useEffect, useCallback, useRef } from 'react';

// Le fameux dictionnaire centralisé
export const ASSET_TO_PYTH_SYMBOL: Record<string, string> = {
  "BTC": "Crypto.BTC/USD", "ETH": "Crypto.ETH/USD", "SPX": "Equity.US.SPY/USD", "DJI": "Equity.US.DIA/USD",
  "NDX": "Equity.US.QQQ/USD", "USD": "FX.USDXY", "NVDA": "Equity.US.NVDA/USD", "GOOG": "Equity.US.GOOG/USD",
  "EUR": "FX.EUR/USD", "AMZN": "Equity.US.AMZN/USD", "META": "Equity.US.META/USD", "TSLA": "Equity.US.TSLA/USD",
  "AAPL": "Equity.US.AAPL/USD", "MSFT": "Equity.US.MSFT/USD", "AUD": "FX.AUD/USD", "NZD": "FX.NZD/USD",
  "XPD": "Metal.XPD/USD", "XPT": "Metal.XPT/USD", "GBP": "FX.GBP/USD", "COIN": "Equity.US.COIN/USD",
  "HOOD": "Equity.US.HOOD/USD", "MSTR": "Equity.US.MSTR/USD", "CRCL": "Equity.US.CRCL/USD", "BMNR": "Equity.US.BMNR/USD",
  "SBET": "Equity.US.SBET/USD", "GLXY": "Equity.US.GLXY/USD", "BNB": "Crypto.BNB/USD", "XRP": "Crypto.XRP/USD",
  "TRX": "Crypto.TRX/USD", "HYPE": "Crypto.HYPE/USD", "LINK": "Crypto.LINK/USD", "ADA": "Crypto.ADA/USD",
  "PLTR": "Equity.US.PLTR/USD", "AMD": "Equity.US.AMD/USD", "NFLX": "Equity.US.NFLX/USD", "ORCL": "Equity.US.ORCL/USD",
  "RIVN": "Equity.US.RIVN/USD", "COST": "Equity.US.COST/USD", "XAU": "Metal.XAU/USD", "XOM": "Equity.US.XOM/USD",
  "CVX": "Equity.US.CVX/USD", "BRENT": "Commodities.UKOILSPOT", "CL": "Commodities.USOILSPOT",  "SOL": "Crypto.SOL/USD",
  "DAX": "Equity.US.GDAXI/USD",
  "XAG": "Metal.XAG/USD",
  "CAT": "Equity.US.CAT/USD", "ASML": "Equity.US.ASML/USD", "ARM": "Equity.US.ARM/USD", "INTC": "Equity.US.INTC/USD",
  "SMCI": "Equity.US.SMCI/USD", "TSM": "Equity.US.TSM/USD", "AVGO": "Equity.US.AVGO/USD"
};

export const usePythBenchmarks = () => {
  const [benchmarks, setBenchmarks] = useState<Record<string, any>>({});

  useEffect(() => {
    let active = true;
    
    const fetchBenchmarks = async () => {
      try {
        const res = await fetch('https://benchmarks.pyth.network/v1/price_differences/');
        const data = await res.json();
        
        if (active && Array.isArray(data)) {
          // On transforme le gros tableau en objet facile à lire : { "Crypto.BTC/USD": { ... } }
          const map: Record<string, any> = {};
          data.forEach((item) => {
            map[item.symbol] = item;
          });
          setBenchmarks(map);
        }
      } catch (err) {
        console.error('Failed to fetch Pyth benchmarks', err);
      }
    };

    fetchBenchmarks();
    const interval = setInterval(fetchBenchmarks, 60000); // Met à jour toutes les 60 secondes
    
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  // Fonction ultra-rapide pour récupérer le % de variation sur un actif précis
  const get24hChange = useCallback((assetStr: string) => {
    const pythSymbol = ASSET_TO_PYTH_SYMBOL[assetStr];
    if (!pythSymbol || !benchmarks[pythSymbol]) return null;

    const diffDecimal = benchmarks[pythSymbol].day_price_diff_decimal;
    if (diffDecimal === undefined || diffDecimal === null) return null;

    // L'API renvoie un format décimal (0.0074 -> 0.74%), donc on fait x100
    return diffDecimal * 100;
  }, [benchmarks]);

  return { benchmarks, get24hChange, ASSET_TO_PYTH_SYMBOL };
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface StreamPrice {
  price: number;
  time: number; // unix seconds
}

// ---------------------------------------------------------------------------
// usePythStream – connects to the Pyth NDJSON stream and returns a live
// price map keyed by the Pyth symbol id (e.g. "Crypto.BTC/USD").
// ---------------------------------------------------------------------------
export const usePythStream = () => {
  const [streamPrices, setStreamPrices] = useState<Record<string, StreamPrice>>({});
  // Keep a mutable ref so the stream reader can write without stale closures
  const bufferRef = useRef<Record<string, StreamPrice>>({});
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let mounted = true;

    // Flush buffered updates to React state every 500 ms to avoid re-render storms
    flushTimerRef.current = setInterval(() => {
      if (!mounted) return;
      const snap = bufferRef.current;
      if (Object.keys(snap).length > 0) {
        setStreamPrices((prev) => ({ ...prev, ...snap }));
        bufferRef.current = {};
      }
    }, 500);

    const connect = async () => {
      if (!mounted) return;
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch(
          'https://benchmarks.pyth.network/v1/shims/tradingview/streaming',
          { signal: controller.signal }
        );
        if (!res.body) throw new Error('No body');

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let partial = '';

        while (mounted) {
          const { done, value } = await reader.read();
          if (done) break;

          partial += decoder.decode(value, { stream: true });
          const lines = partial.split('\n');
          // Last element may be an incomplete line — keep it for next chunk
          partial = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const msg = JSON.parse(trimmed) as { id: string; p: number; t: number };
              if (msg.id && typeof msg.p === 'number') {
                bufferRef.current[msg.id] = { price: msg.p, time: msg.t };
              }
            } catch {
              // ignore malformed lines
            }
          }
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') return; // intentional disconnect
        console.warn('Pyth stream disconnected, reconnecting in 2s…', err);
      }

      // Auto-reconnect unless unmounted
      if (mounted) {
        reconnectRef.current = setTimeout(connect, 2000);
      }
    };

    connect();

    return () => {
      mounted = false;
      if (flushTimerRef.current) clearInterval(flushTimerRef.current);
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      abortRef.current?.abort();
    };
  }, []);

  return { streamPrices };
};