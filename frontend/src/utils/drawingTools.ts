import { IChartApi, ISeriesApi, Time } from 'lightweight-charts';

// ============================================================================
// Drawing Tools for Lightweight Charts
// ============================================================================

export type DrawingToolType = 'cursor' | 'trendline' | 'horizontal' | 'ray' | 'fib' | 'rect';

export interface DrawingPoint {
  time: Time;
  price: number;
}

export interface Drawing {
  id: string;
  type: DrawingToolType;
  points: DrawingPoint[];
  color: string;
  lineWidth: number;
}

export const DRAWING_TOOLS: { type: DrawingToolType; label: string; icon: string }[] = [
  { type: 'cursor', label: 'Cursor', icon: 'cursor' },
  { type: 'trendline', label: 'Trend Line', icon: 'trendline' },
  { type: 'horizontal', label: 'Horizontal Line', icon: 'horizontal' },
  { type: 'ray', label: 'Ray', icon: 'ray' },
  { type: 'fib', label: 'Fib Retracement', icon: 'fib' },
  { type: 'rect', label: 'Rectangle', icon: 'rect' },
];

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

// ─── Coordinate helpers ─────────────────────────────────────────────────────

export function pointToPixel(
  chart: IChartApi,
  series: ISeriesApi<any>,
  point: DrawingPoint
): { x: number; y: number } | null {
  const x = chart.timeScale().timeToCoordinate(point.time);
  const y = series.priceToCoordinate(point.price);
  if (x === null || y === null) return null;
  return { x, y };
}

export function pixelToPoint(
  chart: IChartApi,
  series: ISeriesApi<any>,
  px: number,
  py: number
): DrawingPoint | null {
  const time = chart.timeScale().coordinateToTime(px);
  const price = series.coordinateToPrice(py);
  if (time === null || price === null) return null;
  return { time: time as Time, price };
}

// ─── Canvas rendering ───────────────────────────────────────────────────────

export function renderDrawings(
  ctx: CanvasRenderingContext2D,
  chart: IChartApi,
  series: ISeriesApi<any>,
  drawings: Drawing[],
  canvasWidth: number,
  canvasHeight: number,
  activeDrawing?: { type: DrawingToolType; points: DrawingPoint[]; color: string } | null,
  cursorPoint?: DrawingPoint | null
) {
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  // Render completed drawings
  for (const d of drawings) {
    renderSingleDrawing(ctx, chart, series, d.type, d.points, d.color, d.lineWidth, canvasWidth, canvasHeight);
  }

  // Render in-progress drawing
  if (activeDrawing && activeDrawing.points.length > 0 && cursorPoint) {
    const pts = [...activeDrawing.points, cursorPoint];
    renderSingleDrawing(ctx, chart, series, activeDrawing.type, pts, activeDrawing.color, 1.5, canvasWidth, canvasHeight);
  }
}

function renderSingleDrawing(
  ctx: CanvasRenderingContext2D,
  chart: IChartApi,
  series: ISeriesApi<any>,
  type: DrawingToolType,
  points: DrawingPoint[],
  color: string,
  lineWidth: number,
  canvasWidth: number,
  canvasHeight: number
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.setLineDash([]);

  if (type === 'trendline' && points.length >= 2) {
    const p1 = pointToPixel(chart, series, points[0]);
    const p2 = pointToPixel(chart, series, points[1]);
    if (!p1 || !p2) return;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
    // Draw small circles at endpoints
    drawEndpoint(ctx, p1.x, p1.y, color);
    drawEndpoint(ctx, p2.x, p2.y, color);
  }

  if (type === 'horizontal' && points.length >= 1) {
    const p1 = pointToPixel(chart, series, points[0]);
    if (!p1) return;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(0, p1.y);
    ctx.lineTo(canvasWidth, p1.y);
    ctx.stroke();
    ctx.setLineDash([]);
    // Price label
    ctx.fillStyle = color;
    ctx.font = '10px monospace';
    ctx.fillText(points[0].price.toFixed(2), 6, p1.y - 4);
  }

  if (type === 'ray' && points.length >= 2) {
    const p1 = pointToPixel(chart, series, points[0]);
    const p2 = pointToPixel(chart, series, points[1]);
    if (!p1 || !p2) return;
    // Extend line from p1 through p2 to canvas edge
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return;
    const scale = Math.max(canvasWidth, canvasHeight) * 2 / len;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p1.x + dx * scale, p1.y + dy * scale);
    ctx.stroke();
    drawEndpoint(ctx, p1.x, p1.y, color);
  }

  if (type === 'rect' && points.length >= 2) {
    const p1 = pointToPixel(chart, series, points[0]);
    const p2 = pointToPixel(chart, series, points[1]);
    if (!p1 || !p2) return;
    const x = Math.min(p1.x, p2.x);
    const y = Math.min(p1.y, p2.y);
    const w = Math.abs(p2.x - p1.x);
    const h = Math.abs(p2.y - p1.y);
    // Semi-transparent fill
    ctx.fillStyle = color + '18';
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
  }

  if (type === 'fib' && points.length >= 2) {
    const p1 = pointToPixel(chart, series, points[0]);
    const p2 = pointToPixel(chart, series, points[1]);
    if (!p1 || !p2) return;

    const highPrice = Math.max(points[0].price, points[1].price);
    const lowPrice = Math.min(points[0].price, points[1].price);
    const range = highPrice - lowPrice;

    for (const level of FIB_LEVELS) {
      const price = highPrice - range * level;
      const y = series.priceToCoordinate(price);
      if (y === null) continue;

      ctx.setLineDash(level === 0 || level === 1 ? [] : [4, 3]);
      ctx.globalAlpha = level === 0 || level === 1 ? 1 : 0.7;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvasWidth, y);
      ctx.stroke();

      // Level label
      ctx.fillStyle = color;
      ctx.font = '10px monospace';
      ctx.globalAlpha = 1;
      ctx.fillText(`${(level * 100).toFixed(1)}% — ${price.toFixed(2)}`, 6, y - 4);
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    // Vertical anchor line
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p1.x, p2.y);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function drawEndpoint(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, 3, 0, Math.PI * 2);
  ctx.fill();
}
