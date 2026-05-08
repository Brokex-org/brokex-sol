import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi, CandlestickData, LineData, Time, CandlestickSeries, LineSeries } from 'lightweight-charts';
import { useTheme } from '../ThemeContext';
import { usePriceContext } from '../contexts/PriceContext';
import { ASSET_TO_PYTH_SYMBOL, usePythStream } from '../hooks/usePythBenchmarks';
import { formatPrice } from '../utils/ostium/utils';
import {
  OHLCBar, IndicatorConfig, IndicatorType,
  INDICATOR_COLORS, INDICATOR_PRESETS,
  calculateSMA, calculateEMA, calculateBollingerBands, calculateVWAP
} from '../utils/indicators';
import {
  DrawingToolType, Drawing, DrawingPoint, DRAWING_TOOLS,
  pixelToPoint, renderDrawings
} from '../utils/drawingTools';

// ============================================================================
// Configuration des Timeframes
// ============================================================================
const RESOLUTIONS = [
  { label: '1m', value: '1', sec: 60 },
  { label: '5m', value: '5', sec: 300 },
  { label: '15m', value: '15', sec: 900 },
  { label: '1H', value: '60', sec: 3600 },
  { label: '4H', value: '240', sec: 14400 },
  { label: '1D', value: 'D', sec: 86400 },
];

const goldAccent = '#BC8961';
const goldAccentLight = 'rgba(188, 137, 97, 0.15)';

// Ajout des props pour le bouton Layout
export const TVChart = ({ isOrderFormRight, setIsOrderFormRight }: any) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const mainContainerRef = useRef<HTMLDivElement>(null); // Pour le mode plein écran

  const { mode, setMode, bgColor, setBgColor, tradingColorTheme, setTradingColorTheme, themeControlBg, themeBorder, themeText, themeTextMuted, buyColor, sellColor, themeBg } = useTheme();
  const { selectedAsset, currentPriceData } = usePriceContext();

  const [resolution, setResolution] = useState(RESOLUTIONS[2]);
  const [isLoading, setIsLoading] = useState(true);
  const [chartType, setChartType] = useState<'candles' | 'line'>('candles');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const { streamPrices } = usePythStream();
  const pythSymbol = ASSET_TO_PYTH_SYMBOL[selectedAsset];
  const pythPriceData = pythSymbol ? streamPrices[pythSymbol] : null;
  const isMarketOpen = currentPriceData ? (currentPriceData.isMarketOpen && !currentPriceData.isDayTradingClosed) : true;

  const BG_PRESETS = [
    { name: 'Deep Black', color: '#0a0b0d' },
    { name: 'Standard Dark', color: '#121212' },
    { name: 'TradingView', color: '#1e222d' },
    { name: 'Navy Dark', color: '#151924' },
  ];

  const [ohlc, setOhlc] = useState<{ open: number, high: number, low: number, close: number } | null>(null);
  const [latestCandle, setLatestCandle] = useState<{ open: number, high: number, low: number, close: number } | null>(null);

  // ── Indicators state ──────────────────────────────────────────────────────
  const [activeIndicators, setActiveIndicators] = useState<IndicatorConfig[]>([]);
  const [isIndicatorMenuOpen, setIsIndicatorMenuOpen] = useState(false);
  const indicatorSeriesRef = useRef<Map<string, ISeriesApi<"Line">[]>>(new Map());
  const candleDataRef = useRef<CandlestickData[]>([]);

  // ── Drawing tools state ───────────────────────────────────────────────────
  const [isDrawingMenuOpen, setIsDrawingMenuOpen] = useState(false);
  const [drawingTool, setDrawingTool] = useState<DrawingToolType>('cursor');
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [drawingInProgress, setDrawingInProgress] = useState<{ type: DrawingToolType; points: DrawingPoint[]; color: string } | null>(null);
  const [cursorDrawPoint, setCursorDrawPoint] = useState<DrawingPoint | null>(null);
  const drawCanvasRef = useRef<HTMLCanvasElement>(null);
  const drawingColorRef = useRef('#E8A838');
  const DRAW_COLORS = ['#E8A838', '#5C9DFF', '#F06292', '#26C6DA', '#EF5350', '#66BB6A', '#FFFFFF'];

  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const lastCandleRef = useRef<{ time: number; open: number; high: number; low: number; close: number } | null>(null);

  // 1.5. Mise à jour des couleurs (réactif au thème)
  useEffect(() => {
    if (!chartRef.current || !candleSeriesRef.current || !lineSeriesRef.current) return;

    // Mise à jour de la mise en page globale
    chartRef.current.applyOptions({
      layout: {
        textColor: themeTextMuted,
      },
      grid: {
        vertLines: { color: themeBorder },
        horzLines: { color: themeBorder }
      },
      timeScale: { borderColor: themeBorder },
      rightPriceScale: { borderColor: themeBorder }
    });

    // Mise à jour des couleurs des séries
    candleSeriesRef.current.applyOptions({
      upColor: buyColor,
      borderUpColor: buyColor,
      wickUpColor: buyColor,
      downColor: sellColor,
      borderDownColor: sellColor,
      wickDownColor: sellColor,
    });

    lineSeriesRef.current.applyOptions({
      color: buyColor,
    });
  }, [buyColor, sellColor, themeBorder, themeTextMuted]);

  // 1. Initialisation du graphique
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: themeTextMuted,
        fontFamily: "'Source Code Pro', monospace",

      },
      grid: { vertLines: { color: themeBorder, style: 1 }, horzLines: { color: themeBorder, style: 1 } },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: themeBorder },
      rightPriceScale: { borderColor: themeBorder },
      width: chartContainerRef.current.clientWidth || 600,
      height: chartContainerRef.current.clientHeight || 400,
      localization: {
        priceFormatter: formatPrice,
      },
    });

    chartRef.current = chart;

    // Création des deux séries (on cache celle qui n'est pas active)
    candleSeriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor: buyColor, downColor: sellColor, borderDownColor: sellColor,
      borderUpColor: buyColor, wickDownColor: sellColor, wickUpColor: buyColor,
      priceFormat: {
        type: 'price',
        precision: 5,
        minMove: 0.00001,
      },
    });

    lineSeriesRef.current = chart.addSeries(LineSeries, {
      color: buyColor, lineWidth: 2, crosshairMarkerVisible: true,
      priceFormat: {
        type: 'price',
        precision: 5,
        minMove: 0.00001,
      },
    });

    if (chartType === 'line') {
      candleSeriesRef.current.applyOptions({ visible: false });
    } else {
      lineSeriesRef.current.applyOptions({ visible: false });
    }

    // Auto-redimensionnement
    let resizeTimeout: NodeJS.Timeout;
    const resizeObserver = new ResizeObserver((entries) => {
      if (entries.length === 0 || entries[0].target !== wrapperRef.current) return;
      const { width, height } = entries[0].contentRect;
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        if (chartRef.current) chartRef.current.applyOptions({ width, height });
      }, 50);
    });
    if (wrapperRef.current) resizeObserver.observe(wrapperRef.current);

    // Force une première passe de dimensionnement après un court délai
    const forceResize = () => {
      if (wrapperRef.current && chartRef.current) {
        const { width, height } = wrapperRef.current.getBoundingClientRect();
        if (width > 0 && height > 0) {
          chartRef.current.applyOptions({ width, height });
        }
      }
    };
    const t1 = setTimeout(forceResize, 100);
    const t2 = setTimeout(forceResize, 500);

    // Crosshair (OHLC)
    let lastOhlcJSON = '';
    chart.subscribeCrosshairMove((param) => {
      if (param.time && param.seriesData && param.seriesData.get(candleSeriesRef.current!)) {
        const data = param.seriesData.get(candleSeriesRef.current!) as any;
        const newData = { open: data.open, high: data.high, low: data.low, close: data.close };
        const newJSON = JSON.stringify(newData);
        if (newJSON !== lastOhlcJSON) {
          lastOhlcJSON = newJSON;
          setOhlc(newData);
        }
      } else {
        if (lastOhlcJSON !== 'null') {
          lastOhlcJSON = 'null';
          setOhlc(null);
        }
      }
    });

    return () => {
      clearTimeout(resizeTimeout);
      clearTimeout(t1);
      clearTimeout(t2);
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      lineSeriesRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2. Bascule du type de charte (Bougies / Ligne)
  useEffect(() => {
    if (!candleSeriesRef.current || !lineSeriesRef.current) return;
    if (chartType === 'candles') {
      candleSeriesRef.current.applyOptions({ visible: true });
      lineSeriesRef.current.applyOptions({ visible: false });
    } else {
      candleSeriesRef.current.applyOptions({ visible: false });
      lineSeriesRef.current.applyOptions({ visible: true });
    }
  }, [chartType]);

  // 3. Récupération des données
  useEffect(() => {
    let active = true;
    setIsLoading(true);

    const fetchData = async () => {
      if (!candleSeriesRef.current || !lineSeriesRef.current || !chartRef.current) return;

      const to = Math.floor(Date.now() / 1000);
      const from = to - (resolution.sec * 300); // ~300 candles visible on open

      try {
        const rawSymbol = ASSET_TO_PYTH_SYMBOL[selectedAsset] || 'Crypto.BTC/USD';
        const encodedSymbol = encodeURIComponent(rawSymbol);
        const proxyUrl = `/api/pyth/v1/shims/tradingview/history?symbol=${encodedSymbol}&resolution=${resolution.value}&from=${from}&to=${to}`;

        const res = await fetch(proxyUrl);
        if (!res.ok) throw new Error('Network error or CORS: ' + res.status);
        const data = await res.json();

        if (active) {
          if (data.s === 'ok' && data.t && data.t.length > 0) {
            const candleData: CandlestickData[] = [];
            const lineData: LineData[] = [];

            data.t.forEach((timestamp: number, index: number) => {
              const time = timestamp as Time;
              candleData.push({ time, open: data.o[index], high: data.h[index], low: data.l[index], close: data.c[index] });
              lineData.push({ time, value: data.c[index] });
            });

            const lastIdx = data.t.length - 1;
            const apiLastCandle = {
              time: data.t[lastIdx] as number,
              open: data.o[lastIdx],
              high: data.h[lastIdx],
              low: data.l[lastIdx],
              close: data.c[lastIdx],
            };
            // Seed the live-candle ref with the API's last candle so WSS
            // updates are applied ON TOP of it, never replacing it cold.
            lastCandleRef.current = apiLastCandle;
            setLatestCandle({ open: apiLastCandle.open, high: apiLastCandle.high, low: apiLastCandle.low, close: apiLastCandle.close });

            candleSeriesRef.current.setData(candleData);
            lineSeriesRef.current.setData(lineData);
            candleDataRef.current = candleData;
            chartRef.current.timeScale().fitContent();
          } else {
            candleSeriesRef.current.setData([]);
            lineSeriesRef.current.setData([]);
            lastCandleRef.current = null;
            setLatestCandle(null);
          }
        }
      } catch (err) {
        console.error("Erreur fetch Pyth:", err);
      } finally {
        if (active) setIsLoading(false);
      }
    };

    fetchData();
    lastCandleRef.current = null; // reset live-candle state for new symbol/resolution

    return () => { active = false; };
  }, [resolution, selectedAsset]);


  // ── Live candle update logic (supports WSS and Pyth fallback) ───────────────
  useEffect(() => {
    if (!candleSeriesRef.current || !lineSeriesRef.current) return;

    // Source selection: Use WSS if open, Pyth if closed
    let price = 0;
    let tickTime = Math.floor(Date.now() / 1000);

    if (isMarketOpen) {
      if (!currentPriceData || !currentPriceData.mid) return;
      price = currentPriceData.mid;
      tickTime = currentPriceData.timestampSeconds ?? tickTime;
    } else {
      if (!pythPriceData || !pythPriceData.price) return;
      price = pythPriceData.price;
      tickTime = pythPriceData.time || tickTime;
    }

    if (!price || price <= 0) return;

    // We only act if the API has already seeded the last candle.
    let candle = lastCandleRef.current;
    if (!candle) return;

    const bucketTime = Math.floor(tickTime / resolution.sec) * resolution.sec;

    if (bucketTime <= candle.time) {
      // Same (or older) bucket — patch close / H / L in place
      candle = {
        ...candle,
        high: Math.max(candle.high, price),
        low: Math.min(candle.low, price),
        close: price,
      };
    } else {
      // New candle period — open at previous close
      candle = {
        time: bucketTime,
        open: candle.close,
        high: Math.max(candle.close, price),
        low: Math.min(candle.close, price),
        close: price,
      };
    }

    lastCandleRef.current = candle;

    try {
      candleSeriesRef.current.update({ time: candle.time as import('lightweight-charts').Time, open: candle.open, high: candle.high, low: candle.low, close: candle.close });
      lineSeriesRef.current.update({ time: candle.time as import('lightweight-charts').Time, value: price });
      setLatestCandle({ open: candle.open, high: candle.high, low: candle.low, close: candle.close });
    } catch {
      // lightweight-charts throws if time <= last data point; safe to ignore.
    }
  }, [currentPriceData, pythPriceData, isMarketOpen, resolution]);

  // ── Indicator Management ──────────────────────────────────────────────────
  const addIndicator = useCallback((type: IndicatorType, period: number) => {
    const id = `${type}-${period}-${Date.now()}`;
    const colorIdx = activeIndicators.length % INDICATOR_COLORS.length;
    const label = type === 'VWAP' ? 'VWAP' : type === 'BB' ? `BB(${period})` : `${type}(${period})`;
    setActiveIndicators(prev => [...prev, { id, type, period, color: INDICATOR_COLORS[colorIdx], label }]);
  }, [activeIndicators.length]);

  const removeIndicator = useCallback((id: string) => {
    // Remove series from chart
    const chart = chartRef.current;
    const seriesList = indicatorSeriesRef.current.get(id);
    if (chart && seriesList) {
      seriesList.forEach(s => { try { chart.removeSeries(s); } catch { } });
    }
    indicatorSeriesRef.current.delete(id);
    setActiveIndicators(prev => prev.filter(i => i.id !== id));
  }, []);

  // ── Render / update indicator overlays when data or config changes ────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const bars = candleDataRef.current as OHLCBar[];
    if (bars.length === 0) return;

    // Remove old indicator series that are no longer in activeIndicators
    const activeIds = new Set(activeIndicators.map(i => i.id));
    indicatorSeriesRef.current.forEach((seriesList, id) => {
      if (!activeIds.has(id)) {
        seriesList.forEach(s => { try { chart.removeSeries(s); } catch { } });
        indicatorSeriesRef.current.delete(id);
      }
    });

    // Create or update each active indicator
    for (const ind of activeIndicators) {
      // Remove existing series for this indicator to recalculate
      const existing = indicatorSeriesRef.current.get(ind.id);
      if (existing) {
        existing.forEach(s => { try { chart.removeSeries(s); } catch { } });
      }

      const newSeries: ISeriesApi<"Line">[] = [];

      if (ind.type === 'SMA') {
        const smaData = calculateSMA(bars, ind.period);
        const s = chart.addSeries(LineSeries, { color: ind.color, lineWidth: 1, priceScaleId: 'right', lastValueVisible: false, priceLineVisible: false });
        s.setData(smaData);
        newSeries.push(s);
      } else if (ind.type === 'EMA') {
        const emaData = calculateEMA(bars, ind.period);
        const s = chart.addSeries(LineSeries, { color: ind.color, lineWidth: 1, priceScaleId: 'right', lastValueVisible: false, priceLineVisible: false });
        s.setData(emaData);
        newSeries.push(s);
      } else if (ind.type === 'BB') {
        const bb = calculateBollingerBands(bars, ind.period, 2);
        const sUpper = chart.addSeries(LineSeries, { color: ind.color, lineWidth: 1, lineStyle: 2, priceScaleId: 'right', lastValueVisible: false, priceLineVisible: false });
        const sMiddle = chart.addSeries(LineSeries, { color: ind.color, lineWidth: 1, priceScaleId: 'right', lastValueVisible: false, priceLineVisible: false });
        const sLower = chart.addSeries(LineSeries, { color: ind.color, lineWidth: 1, lineStyle: 2, priceScaleId: 'right', lastValueVisible: false, priceLineVisible: false });
        sUpper.setData(bb.upper);
        sMiddle.setData(bb.middle);
        sLower.setData(bb.lower);
        newSeries.push(sUpper, sMiddle, sLower);
      } else if (ind.type === 'VWAP') {
        const vwapData = calculateVWAP(bars);
        const s = chart.addSeries(LineSeries, { color: ind.color, lineWidth: 1, priceScaleId: 'right', lastValueVisible: false, priceLineVisible: false });
        s.setData(vwapData);
        newSeries.push(s);
      }

      indicatorSeriesRef.current.set(ind.id, newSeries);
    }
  }, [activeIndicators, candleDataRef.current.length]);

  // ── Canvas drawing render loop ──────────────────────────────────────────────
  useEffect(() => {
    const canvas = drawCanvasRef.current;
    const chart = chartRef.current;
    const series = candleSeriesRef.current;
    if (!canvas || !chart || !series) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Sync canvas size
    const parent = canvas.parentElement;
    if (parent) {
      const dpr = window.devicePixelRatio || 1;
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.scale(dpr, dpr);
      renderDrawings(ctx, chart, series, drawings, w, h, drawingInProgress, cursorDrawPoint);
    }
  });

  // Clean up indicator series on unmount / asset change
  useEffect(() => {
    return () => {
      const chart = chartRef.current;
      if (chart) {
        indicatorSeriesRef.current.forEach((seriesList) => {
          seriesList.forEach(s => { try { chart.removeSeries(s); } catch { } });
        });
      }
      indicatorSeriesRef.current.clear();
    };
  }, [selectedAsset, resolution]);

  // 4. Gestion du Plein Écran
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      mainContainerRef.current?.requestFullscreen().catch(err => console.error(err));
    } else {
      document.exitFullscreen();
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const displayOhlc = ohlc || latestCandle;


  return (
    <div ref={mainContainerRef} style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', backgroundColor: themeBg }}>

      {/* ========================================= */}
      {/* TOOLBAR AU DESSUS DU GRAPHIQUE            */}
      {/* ========================================= */}
      <div
        style={{
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          alignItems: isMobile ? 'stretch' : 'center',
          justifyContent: 'space-between',
          padding: isMobile ? '4px 8px' : '0.3rem 0.75rem',
          borderBottom: `1px solid ${themeBorder}`,
          backgroundColor: themeBg,
          flexShrink: 0,
          minHeight: isMobile ? 'auto' : '36px',
          boxSizing: 'border-box',
          gap: isMobile ? '4px' : '0'
        }}
      >

        {isDrawingMenuOpen ? (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
            overflowX: isMobile ? 'auto' : 'visible',
            paddingBottom: isMobile ? '2px' : '0'
          }} className="hide-scrollbar">
            <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '8px' : '4px' }}>
              {!isMobile && <span style={{ fontSize: '0.65rem', fontWeight: 600, color: themeTextMuted, marginRight: '8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Draw Mode</span>}
              {DRAWING_TOOLS.map(tool => {
                const isActive = drawingTool === tool.type;
                const iconMap: Record<string, React.ReactNode> = {
                  cursor: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" /></svg>,
                  trendline: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="4" y1="20" x2="20" y2="4" /></svg>,
                  horizontal: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="2" y1="12" x2="22" y2="12" /></svg>,
                  ray: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="4" y1="18" x2="20" y2="6" /><circle cx="4" cy="18" r="2" fill="currentColor" /></svg>,
                  fib: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="2" y1="4" x2="22" y2="4" /><line x1="2" y1="9" x2="22" y2="9" strokeDasharray="3 2" /><line x1="2" y1="14" x2="22" y2="14" strokeDasharray="3 2" /><line x1="2" y1="20" x2="22" y2="20" /></svg>,
                  rect: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="5" width="18" height="14" rx="1" /></svg>,
                };
                return (
                  <button
                    key={tool.type}
                    onClick={() => { setDrawingTool(tool.type); if (tool.type === 'cursor') { setDrawingInProgress(null); setCursorDrawPoint(null); } }}
                    style={{
                      backgroundColor: isActive ? goldAccentLight : 'transparent',
                      color: isActive ? goldAccent : themeTextMuted,
                      border: `1px solid ${isActive ? goldAccent : 'transparent'}`,
                      borderRadius: '4px',
                      padding: isMobile ? '6px' : '4px',
                      cursor: 'pointer', transition: 'all 0.12s',
                      width: isMobile ? '32px' : '26px',
                      height: isMobile ? '32px' : '26px',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box',
                      flexShrink: 0
                    }}
                    title={tool.label}
                  >
                    {iconMap[tool.type]}
                  </button>
                );
              })}

              <div style={{ width: '1px', height: '16px', backgroundColor: themeBorder, margin: '0 8px' }} />

              {/* Colors */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {DRAW_COLORS.map(c => (
                  <div
                    key={c}
                    onClick={() => { drawingColorRef.current = c; }}
                    style={{
                      width: '14px', height: '14px', borderRadius: '3px', backgroundColor: c, cursor: 'pointer',
                      border: drawingColorRef.current === c ? `2px solid ${goldAccent}` : '1px solid rgba(0,0,0,0.3)',
                      boxSizing: 'border-box',
                    }}
                    title="Color"
                  />
                ))}
              </div>

              {/* Clear All */}
              {drawings.length > 0 && (
                <>
                  <div style={{ width: '1px', height: '16px', backgroundColor: themeBorder, margin: '0 8px' }} />
                  <button
                    onClick={() => { setDrawings([]); setDrawingInProgress(null); }}
                    style={{ background: 'none', border: 'none', color: '#EF5350', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', gap: '4px', height: '26px', borderRadius: '4px' }}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(239, 83, 80, 0.1)'}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                    title="Clear all drawings"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
                    <span style={{ fontSize: '0.65rem', fontWeight: 600 }}>Clear</span>
                  </button>
                </>
              )}
            </div>

            <button
              onClick={() => setIsDrawingMenuOpen(false)}
              style={{
                background: 'transparent', color: themeText, border: `1px solid ${themeBorder}`, borderRadius: '4px',
                padding: '0 8px', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', transition: 'all 0.15s',
                height: '26px', fontSize: '0.65rem', fontWeight: 500
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = goldAccent; e.currentTarget.style.color = goldAccent; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = themeBorder; e.currentTarget.style.color = themeText; }}
            >
              Done
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
        ) : (
          <>
            {/* Gauche : ticker (fullscreen only) + OHLC */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: isMobile ? '0.5rem' : '1rem',
              flexWrap: isMobile ? 'wrap' : 'nowrap'
            }}>
              {isFullscreen && (
                <span style={{ fontWeight: 700, fontSize: isMobile ? '0.75rem' : '0.85rem', color: themeText, letterSpacing: '0.3px' }}>
                  {selectedAsset}/USD
                </span>
              )}
              {isFullscreen && displayOhlc && (
                <div style={{ width: '1px', height: '14px', backgroundColor: themeBorder }} />
              )}
              {(!isMobile && displayOhlc) ? (
                <div className="font-mono" style={{
                  display: 'flex',
                  gap: '0.8rem',
                  fontSize: '0.75rem',
                  color: themeText,
                  flexWrap: 'wrap'
                }}>
                  <span><span style={{ color: themeTextMuted }}>O</span> {formatPrice(displayOhlc.open)}</span>
                  <span><span style={{ color: themeTextMuted }}>H</span> {formatPrice(displayOhlc.high)}</span>
                  <span><span style={{ color: themeTextMuted }}>L</span> {formatPrice(displayOhlc.low)}</span>
                  <span><span style={{ color: themeTextMuted }}>C</span> <span style={{ color: displayOhlc.close >= displayOhlc.open ? buyColor : sellColor }}>{formatPrice(displayOhlc.close)}</span></span>
                </div>
              ) : (!isMobile) ? (
                <span style={{ fontSize: '0.75rem', color: themeTextMuted }}>{isLoading ? 'Loading data...' : 'No Data'}</span>
              ) : null}
            </div>

            {/* Droite : Timeframes + Contrôles */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: isMobile ? '8px' : '4px',
              overflowX: isMobile ? 'auto' : 'visible',
              padding: isMobile ? '4px 0' : '0'
            }} className="hide-scrollbar">

              {/* Timeframes (Finition Dorée) */}
              <div style={{
                display: 'flex',
                gap: '2px',
                backgroundColor: themeControlBg,
                padding: '2px',
                borderRadius: '4px',
                border: `1px solid ${themeBorder}`,
                height: isMobile ? '32px' : '26px',
                boxSizing: 'border-box',
                flexShrink: 0
              }}>
                {RESOLUTIONS.map(res => {
                  const isActive = resolution.value === res.value;
                  return (
                    <button
                      key={res.label}
                      onClick={() => setResolution(res)}
                      style={{
                        backgroundColor: isActive ? goldAccent : 'transparent',
                        color: isActive ? '#fff' : themeTextMuted,
                        border: 'none',
                        borderRadius: '3px',
                        padding: isMobile ? '0 8px' : '0 6px',
                        fontSize: isMobile ? '0.75rem' : '0.65rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                        height: '100%',
                        flexShrink: 0
                      }}
                    >
                      {res.label}
                    </button>
                  );
                })}
              </div>

              <div style={{ width: '1px', height: '16px', backgroundColor: themeBorder, margin: isMobile ? '0 4px' : '0 6px', flexShrink: 0 }} />

              {/* Type de Graphique */}
              <div style={{
                display: 'flex',
                gap: '2px',
                backgroundColor: themeControlBg,
                padding: '2px',
                borderRadius: '4px',
                border: `1px solid ${themeBorder}`,
                height: isMobile ? '32px' : '26px',
                boxSizing: 'border-box',
                flexShrink: 0
              }}>
                <button
                  onClick={() => setChartType('candles')}
                  style={{
                    backgroundColor: chartType === 'candles' ? goldAccentLight : 'transparent',
                    color: chartType === 'candles' ? goldAccent : themeTextMuted,
                    border: `1px solid ${chartType === 'candles' ? goldAccent : 'transparent'}`,
                    borderRadius: '2px', padding: isMobile ? '0 8px' : '0 6px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all 0.15s',
                    height: '100%', flexShrink: 0
                  }}
                  title="Candlestick Chart"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="9" y1="21" x2="9" y2="16"></line><line x1="9" y1="8" x2="9" y2="3"></line><line x1="15" y1="21" x2="15" y2="12"></line><line x1="15" y1="4" x2="15" y2="3"></line>
                    <rect x="7" y="8" width="4" height="8"></rect><rect x="13" y="4" width="4" height="8"></rect>
                  </svg>
                </button>
                <button
                  onClick={() => setChartType('line')}
                  style={{
                    backgroundColor: chartType === 'line' ? goldAccentLight : 'transparent',
                    color: chartType === 'line' ? goldAccent : themeTextMuted,
                    border: `1px solid ${chartType === 'line' ? goldAccent : 'transparent'}`,
                    borderRadius: '2px', padding: isMobile ? '0 8px' : '0 6px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all 0.15s',
                    height: '100%', flexShrink: 0
                  }}
                  title="Line Chart"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 17 9 11 15 15 21 7"></polyline>
                  </svg>
                </button>
              </div>

              <div style={{ height: '12px', width: '1px', backgroundColor: themeBorder, margin: '0 2px' }}></div>

              {/* Draw Toggle Button */}
              <button
                onClick={() => setIsDrawingMenuOpen(!isDrawingMenuOpen)}
                style={{
                  backgroundColor: isDrawingMenuOpen ? goldAccentLight : 'transparent',
                  color: isDrawingMenuOpen ? goldAccent : themeTextMuted,
                  border: `1px solid ${isDrawingMenuOpen ? goldAccent : themeBorder}`,
                  borderRadius: '4px',
                  padding: isMobile ? '0 10px' : '0 8px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all 0.15s',
                  height: isMobile ? '32px' : '26px',
                  boxSizing: 'border-box'
                }}
                title="Drawing Tools"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
                </svg>
              </button>

              <div style={{ height: '12px', width: '1px', backgroundColor: themeBorder, margin: '0 2px' }}></div>

              {/* Indicators Button */}
              <div style={{ position: 'relative' }}>
                <button
                  onClick={() => setIsIndicatorMenuOpen(!isIndicatorMenuOpen)}
                  style={{
                    backgroundColor: isIndicatorMenuOpen || activeIndicators.length > 0 ? goldAccentLight : 'transparent',
                    color: isIndicatorMenuOpen || activeIndicators.length > 0 ? goldAccent : themeTextMuted,
                    border: `1px solid ${isIndicatorMenuOpen || activeIndicators.length > 0 ? goldAccent : themeBorder}`,
                    borderRadius: '4px',
                    padding: isMobile ? '0 10px' : '0 8px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', cursor: 'pointer', transition: 'all 0.15s',
                    height: isMobile ? '32px' : '26px',
                    boxSizing: 'border-box',
                    fontSize: isMobile ? '0.75rem' : '0.6rem',
                    fontWeight: 600,
                  }}
                  title="Technical Indicators"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 3v18h18" /><path d="M7 16l4-8 4 4 4-6" />
                  </svg>
                  {!isMobile && "Indicators"}
                  {activeIndicators.length > 0 && (
                    <span style={{
                      backgroundColor: goldAccent,
                      color: isMobile ? '#fff' : '#000',
                      borderRadius: '50%',
                      width: '14px', height: '14px',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '0.55rem', fontWeight: 700
                    }}>
                      {activeIndicators.length}
                    </span>
                  )}
                </button>

                {isIndicatorMenuOpen && (
                  <>
                    <div onClick={() => setIsIndicatorMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 100 }} />
                    <div style={{
                      position: 'absolute', top: 'calc(100% + 8px)', right: 0, width: '240px',
                      backgroundColor: themeControlBg, border: `1px solid ${themeBorder}`,
                      borderRadius: '8px', padding: '8px', zIndex: 101, boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
                      maxHeight: '320px', overflowY: 'auto',
                    }}>
                      {/* Active Indicators */}
                      {activeIndicators.length > 0 && (
                        <>
                          <div style={{ fontSize: '0.55rem', color: themeTextMuted, textTransform: 'uppercase', fontWeight: 600, marginBottom: '6px', letterSpacing: '0.04em' }}>Active</div>
                          {activeIndicators.map(ind => (
                            <div key={ind.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 6px', borderRadius: '4px', marginBottom: '2px', backgroundColor: themeBg }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <div style={{ width: '8px', height: '8px', borderRadius: '2px', backgroundColor: ind.color }} />
                                <span style={{ fontSize: '0.62rem', color: themeText, fontWeight: 500 }}>{ind.label}</span>
                              </div>
                              <button
                                onClick={() => removeIndicator(ind.id)}
                                style={{ background: 'none', border: 'none', color: themeTextMuted, cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center', fontSize: '0.7rem', lineHeight: 1 }}
                                onMouseEnter={e => e.currentTarget.style.color = sellColor}
                                onMouseLeave={e => e.currentTarget.style.color = themeTextMuted}
                              >✕</button>
                            </div>
                          ))}
                          <div style={{ height: '1px', backgroundColor: themeBorder, margin: '8px 0' }} />
                        </>
                      )}

                      {/* Available Indicators */}
                      <div style={{ fontSize: '0.55rem', color: themeTextMuted, textTransform: 'uppercase', fontWeight: 600, marginBottom: '6px', letterSpacing: '0.04em' }}>Add Indicator</div>
                      {INDICATOR_PRESETS.map((preset, idx) => {
                        const label = preset.type === 'VWAP' ? 'VWAP' : preset.type === 'BB' ? `Bollinger Bands (${preset.defaultPeriod})` : `${preset.label} (${preset.defaultPeriod})`;
                        return (
                          <div
                            key={idx}
                            onClick={() => { addIndicator(preset.type, preset.defaultPeriod); }}
                            style={{ padding: '5px 6px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.62rem', color: themeText, transition: 'background 0.1s', display: 'flex', alignItems: 'center', gap: '6px' }}
                            onMouseEnter={e => e.currentTarget.style.backgroundColor = goldAccentLight}
                            onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={goldAccent} strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                            {label}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>

              <div style={{ height: '12px', width: '1px', backgroundColor: themeBorder, margin: '0 2px' }}></div>

              {/* Fullscreen Button */}
              {!isMobile && (
                <button
                  onClick={toggleFullscreen}
                  style={{
                    backgroundColor: 'transparent', color: themeTextMuted, border: `1px solid ${themeBorder}`, borderRadius: '4px',
                    padding: '0 6px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all 0.15s',
                    height: '26px', boxSizing: 'border-box'
                  }}
                  title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                  onMouseEnter={(e) => { e.currentTarget.style.color = goldAccent; e.currentTarget.style.borderColor = goldAccent; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = themeTextMuted; e.currentTarget.style.borderColor = themeBorder; }}
                >
                  {isFullscreen ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M8 3v3a2 2 0 0 1-2 2H3"></path><path d="M21 8h-3a2 2 0 0 1-2-2V3"></path><path d="M3 16h3a2 2 0 0 1 2 2v3"></path><path d="M16 21v-3a2 2 0 0 1 2-2h3"></path>
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M8 3H5a2 2 0 0 0-2 2v3"></path><path d="M21 8V5a2 2 0 0 0-2-2h-3"></path><path d="M3 16v3a2 2 0 0 0 2 2h3"></path><path d="M16 21h3a2 2 0 0 0 2-2v-3"></path>
                    </svg>
                  )}
                </button>
              )}

              {/* Settings Button */}
              <div style={{ position: 'relative' }}>
                <button
                  onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                  style={{
                    backgroundColor: isSettingsOpen ? goldAccentLight : 'transparent',
                    color: isSettingsOpen ? goldAccent : themeTextMuted,
                    border: `1px solid ${isSettingsOpen ? goldAccent : themeBorder}`,
                    borderRadius: '4px',
                    padding: '0 6px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all 0.15s',
                    height: isMobile ? '32px' : '26px',
                    width: isMobile ? '32px' : 'auto',
                    boxSizing: 'border-box'
                  }}
                  title="Chart Settings"
                  onMouseEnter={(e) => { if (!isSettingsOpen && !isMobile) { e.currentTarget.style.color = goldAccent; e.currentTarget.style.borderColor = goldAccent; } }}
                  onMouseLeave={(e) => { if (!isSettingsOpen && !isMobile) { e.currentTarget.style.color = themeTextMuted; e.currentTarget.style.borderColor = themeBorder; } }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3"></circle>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                  </svg>
                </button>

                {isSettingsOpen && (
                  <>
                    <div
                      onClick={() => setIsSettingsOpen(false)}
                      style={{ position: 'fixed', inset: 0, zIndex: 100 }}
                    />
                    <div style={{
                      position: 'absolute', top: 'calc(100% + 8px)', right: 0,
                      width: '200px', backgroundColor: themeControlBg, border: `1px solid ${themeBorder}`,
                      borderRadius: '8px', padding: '12px', zIndex: 101, boxShadow: '0 10px 25px rgba(0,0,0,0.5)'
                    }}>
                      <div style={{ marginBottom: '12px' }}>
                        <div style={{ fontSize: '0.65rem', color: themeTextMuted, marginBottom: '8px', textTransform: 'uppercase', fontWeight: 600 }}>Background</div>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          {BG_PRESETS.map(preset => (
                            <div
                              key={preset.color}
                              onClick={() => setBgColor(preset.color)}
                              style={{
                                width: '24px', height: '24px', backgroundColor: preset.color,
                                borderRadius: '4px', cursor: 'pointer', border: `2px solid ${bgColor === preset.color ? goldAccent : 'transparent'}`,
                                transition: 'transform 0.15s'
                              }}
                              title={preset.name}
                              onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.1)'}
                              onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                            />
                          ))}
                        </div>
                      </div>

                      <div style={{ width: '100%', height: '1px', backgroundColor: themeBorder, marginBottom: '12px' }}></div>

                      <div>
                        <div style={{ fontSize: '0.65rem', color: themeTextMuted, marginBottom: '8px', textTransform: 'uppercase', fontWeight: 600 }}>Candle Theme</div>
                        <div style={{ display: 'flex', gap: '4px', backgroundColor: themeBg, padding: '2px', borderRadius: '4px' }}>
                          <button
                            onClick={() => setTradingColorTheme('green')}
                            style={{
                              flex: 1, height: '24px', fontSize: '0.6rem', border: 'none', borderRadius: '3px', cursor: 'pointer',
                              backgroundColor: tradingColorTheme === 'green' ? goldAccentLight : 'transparent',
                              color: tradingColorTheme === 'green' ? goldAccent : themeTextMuted,
                              fontWeight: tradingColorTheme === 'green' ? 600 : 400
                            }}
                          >
                            Green/Red
                          </button>
                          <button
                            onClick={() => setTradingColorTheme('blue')}
                            style={{
                              flex: 1, height: '24px', fontSize: '0.6rem', border: 'none', borderRadius: '3px', cursor: 'pointer',
                              backgroundColor: tradingColorTheme === 'blue' ? goldAccentLight : 'transparent',
                              color: tradingColorTheme === 'blue' ? goldAccent : themeTextMuted,
                              fontWeight: tradingColorTheme === 'blue' ? 600 : 400
                            }}
                          >
                            Blue/Red
                          </button>
                        </div>
                      </div>

                      <div style={{ width: '100%', height: '1px', backgroundColor: themeBorder, margin: '12px 0' }}></div>

                      <button
                        onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')}
                        style={{
                          width: '100%', height: '28px', fontSize: '0.65rem', border: `1px solid ${themeBorder}`, borderRadius: '4px', cursor: 'pointer',
                          backgroundColor: 'transparent', color: themeText, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
                        }}
                      >
                        {mode === 'dark' ? (
                          <>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>
                            Light Mode
                          </>
                        ) : (
                          <>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
                            Dark Mode
                          </>
                        )}
                      </button>
                    </div>
                  </>
                )}
              </div>

              {/* Bouton Layout */}
              {!isMobile && setIsOrderFormRight && (
                <button
                  onClick={() => setIsOrderFormRight(!isOrderFormRight)}
                  style={{
                    background: 'transparent', border: `1px solid ${themeBorder}`, color: themeTextMuted, borderRadius: '4px', cursor: 'pointer',
                    padding: '0 8px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s',
                    height: '26px', boxSizing: 'border-box'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = goldAccent; e.currentTarget.style.borderColor = goldAccent; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = themeTextMuted; e.currentTarget.style.borderColor = themeBorder; }}
                  title={isOrderFormRight ? "Move Order Form to Left" : "Move Order Form to Right"}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: isOrderFormRight ? 'none' : 'scaleX(-1)' }}>
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="15" y1="3" x2="15" y2="21"></line>
                  </svg>
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* ========================================= */}
      {/* ZONE GRAPHIQUE PURE                       */}
      {/* ========================================= */}
      <div ref={wrapperRef} style={{ flex: 1, position: 'relative', width: '100%', minHeight: 0, overflow: 'hidden' }}>

        {/* Petit label Loading qui apparait au milieu si ça charge */}
        {isLoading && (
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 10, color: goldAccent, fontSize: '0.8rem', background: themeControlBg, padding: '8px 16px', borderRadius: '4px', border: `1px solid ${goldAccent}` }}>
            Fetching Data...
          </div>
        )}

        <div ref={chartContainerRef} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />

        {/* OHLC Mobile Overlay (Directly on chart, no background) */}
        {isMobile && displayOhlc && (
          <div className="font-mono" style={{
            position: 'absolute', top: '8px', left: '8px', zIndex: 10,
            display: 'flex', gap: '8px', fontSize: '0.65rem',
            color: themeText, flexWrap: 'wrap', pointerEvents: 'none',
            textShadow: '0px 1px 2px rgba(0,0,0,0.8)'
          }}>
            <span><span style={{ color: themeTextMuted }}>O</span> {formatPrice(displayOhlc.open)}</span>
            <span><span style={{ color: themeTextMuted }}>H</span> {formatPrice(displayOhlc.high)}</span>
            <span><span style={{ color: themeTextMuted }}>L</span> {formatPrice(displayOhlc.low)}</span>
            <span><span style={{ color: displayOhlc.close >= displayOhlc.open ? buyColor : sellColor }}>C {formatPrice(displayOhlc.close)}</span></span>
          </div>
        )}

        {/* Drawing canvas overlay */}
        <canvas
          ref={drawCanvasRef}
          style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            pointerEvents: drawingTool === 'cursor' ? 'none' : 'auto',
            cursor: drawingTool === 'cursor' ? 'default' : 'crosshair',
            zIndex: 5,
          }}
          onMouseDown={(e) => {
            if (drawingTool === 'cursor') return;
            const chart = chartRef.current;
            const series = candleSeriesRef.current;
            if (!chart || !series) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const px = e.clientX - rect.left;
            const py = e.clientY - rect.top;
            const pt = pixelToPoint(chart, series, px, py);
            if (!pt) return;

            if (drawingTool === 'horizontal') {
              // Single-click drawing
              setDrawings(prev => [...prev, { id: `d-${Date.now()}`, type: 'horizontal', points: [pt], color: drawingColorRef.current, lineWidth: 1.5 }]);
              return;
            }

            if (!drawingInProgress) {
              // Start a two-point drawing
              setDrawingInProgress({ type: drawingTool, points: [pt], color: drawingColorRef.current });
            } else {
              // Complete the drawing
              const finalPoints = [...drawingInProgress.points, pt];
              setDrawings(prev => [...prev, { id: `d-${Date.now()}`, type: drawingInProgress.type, points: finalPoints, color: drawingInProgress.color, lineWidth: 1.5 }]);
              setDrawingInProgress(null);
              setCursorDrawPoint(null);
            }
          }}
          onMouseMove={(e) => {
            if (drawingTool === 'cursor' || !drawingInProgress) return;
            const chart = chartRef.current;
            const series = candleSeriesRef.current;
            if (!chart || !series) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const pt = pixelToPoint(chart, series, e.clientX - rect.left, e.clientY - rect.top);
            if (pt) setCursorDrawPoint(pt);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            // Right-click cancels in-progress drawing
            setDrawingInProgress(null);
            setCursorDrawPoint(null);
          }}
        />
      </div>{/* Fin Zone Graphique */}

    </div>

  );
};