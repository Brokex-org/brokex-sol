import { Time, LineData } from 'lightweight-charts';

// ============================================================================
// Indicator Calculation Utilities for Lightweight Charts
// ============================================================================

export interface OHLCBar {
  time: Time;
  open: number;
  high: number;
  low: number;
  close: number;
}

// ─── SMA ────────────────────────────────────────────────────────────────────
export function calculateSMA(data: OHLCBar[], period: number): LineData[] {
  const result: LineData[] = [];
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += data[i - j].close;
    }
    result.push({ time: data[i].time, value: sum / period });
  }
  return result;
}

// ─── EMA ────────────────────────────────────────────────────────────────────
export function calculateEMA(data: OHLCBar[], period: number): LineData[] {
  if (data.length < period) return [];
  const result: LineData[] = [];
  const multiplier = 2 / (period + 1);

  // Seed with SMA of first `period` bars
  let sum = 0;
  for (let i = 0; i < period; i++) sum += data[i].close;
  let ema = sum / period;
  result.push({ time: data[period - 1].time, value: ema });

  for (let i = period; i < data.length; i++) {
    ema = (data[i].close - ema) * multiplier + ema;
    result.push({ time: data[i].time, value: ema });
  }
  return result;
}

// ─── Bollinger Bands ────────────────────────────────────────────────────────
export interface BollingerBandsResult {
  upper: LineData[];
  middle: LineData[];
  lower: LineData[];
}

export function calculateBollingerBands(
  data: OHLCBar[],
  period: number = 20,
  stdDevMultiplier: number = 2
): BollingerBandsResult {
  const upper: LineData[] = [];
  const middle: LineData[] = [];
  const lower: LineData[] = [];

  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) sum += data[i - j].close;
    const mean = sum / period;

    let varianceSum = 0;
    for (let j = 0; j < period; j++) {
      const diff = data[i - j].close - mean;
      varianceSum += diff * diff;
    }
    const stdDev = Math.sqrt(varianceSum / period);

    const t = data[i].time;
    upper.push({ time: t, value: mean + stdDevMultiplier * stdDev });
    middle.push({ time: t, value: mean });
    lower.push({ time: t, value: mean - stdDevMultiplier * stdDev });
  }

  return { upper, middle, lower };
}

// ─── VWAP (simplified: uses (H+L+C)/3 as typical price, volume=1) ─────────
export function calculateVWAP(data: OHLCBar[]): LineData[] {
  const result: LineData[] = [];
  let cumulativeTPxVol = 0;
  let cumulativeVol = 0;

  for (let i = 0; i < data.length; i++) {
    const tp = (data[i].high + data[i].low + data[i].close) / 3;
    // Without real volume, use 1 as proxy – still useful as anchored avg
    cumulativeTPxVol += tp;
    cumulativeVol += 1;
    result.push({ time: data[i].time, value: cumulativeTPxVol / cumulativeVol });
  }
  return result;
}

// ─── Indicator configuration ────────────────────────────────────────────────
export type IndicatorType = 'SMA' | 'EMA' | 'BB' | 'VWAP';

export interface IndicatorConfig {
  id: string;        // unique key for React
  type: IndicatorType;
  period: number;
  color: string;
  label: string;
}

// Preset colors for multiple overlays
export const INDICATOR_COLORS = [
  '#E8A838', // amber
  '#5C9DFF', // blue
  '#F06292', // pink
  '#26C6DA', // cyan
  '#AB47BC', // purple
  '#66BB6A', // green
];

export const DEFAULT_INDICATORS: IndicatorConfig[] = [];

export const INDICATOR_PRESETS: { type: IndicatorType; label: string; defaultPeriod: number }[] = [
  { type: 'SMA', label: 'SMA', defaultPeriod: 20 },
  { type: 'SMA', label: 'SMA', defaultPeriod: 50 },
  { type: 'SMA', label: 'SMA', defaultPeriod: 200 },
  { type: 'EMA', label: 'EMA', defaultPeriod: 12 },
  { type: 'EMA', label: 'EMA', defaultPeriod: 26 },
  { type: 'BB', label: 'Bollinger Bands', defaultPeriod: 20 },
  { type: 'VWAP', label: 'VWAP', defaultPeriod: 0 },
];
