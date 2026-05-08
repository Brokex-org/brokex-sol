import { useCallback } from 'react';
import { usePriceContext } from '../contexts/PriceContext';
import { GetTradeLiquidationPrice, CurrentTotalProfitRaw, CurrentTotalProfitP } from '../utils/ostium/tradeUtils';
import { parseUnits, formatUnits } from 'viem';
import { formatPrice } from '../utils/ostium/utils';

export const useOstiumCalculations = () => {
  const { prices } = usePriceContext();

  const getTradeLiveMath = useCallback((trade: any) => {
    // 1. Get raw values for specific deep-math utils
    const rawTrade = trade.raw || trade;
    
    // 2. Get Mark Price
    const pairFrom = rawTrade.pair?.from || '';
    const pythPrice = prices[pairFrom]?.mid;

    if (!pythPrice || !trade.openPrice || !trade.collateral || !trade.leverage) {
      return { pnl: '--', pnlPercent: '--', pnlColor: '', liqPrice: '--', markPrice: '--' };
    }

    try {
      // === PREPARE RAW VALUES FOR UTILS ===
      const currentPriceStr = parseUnits(pythPrice.toFixed(6), 18).toString();
      const maxL = rawTrade.pair?.maxLeverage || rawTrade.highestLeverage || "100000000000000000000"; 
      
      // Utils formulas expect rollover/funding to be subtracted directly from collateral, 
      // thus they must be scaled by 6 decimals (collateral is 6 decimals).
      // trade.rollover and trade.funding are UI numbers. We cast them to 6-decimal strings.
      const rolloverSafe = trade.rollover ? parseUnits(trade.rollover.toFixed(6), 6).toString() : "0";
      const fundingSafe = trade.funding ? parseUnits(trade.funding.toFixed(6), 6).toString() : "0";

      // === PNL CALCULATION (Using Ostium Utils) ===
      const rawProfit = CurrentTotalProfitRaw(
        rawTrade.openPrice,
        currentPriceStr,
        rawTrade.isBuy,
        rawTrade.leverage,
        rawTrade.highestLeverage || rawTrade.leverage,
        rawTrade.collateral,
        rolloverSafe,
        fundingSafe
      );
      const pnl = Number(formatUnits(BigInt(rawProfit || "0"), 6));
      
      const rawProfitP = CurrentTotalProfitP(rawProfit, rawTrade.collateral);
      const pnlPercent = Number(formatUnits(BigInt(rawProfitP || "0"), 6)); // Already percent

      // === LIQUIDATION CALCULATION ===
      const rawLiqPrice = GetTradeLiquidationPrice(
        rawTrade.openPrice,
        rawTrade.isBuy,
        rawTrade.collateral,
        rawTrade.leverage,
        rolloverSafe,
        fundingSafe,
        maxL
      );
      
      const liqPrice = Number(formatUnits(BigInt(rawLiqPrice), 18));

      return {
        pnl: pnl > 0 ? `+${pnl.toFixed(2)}` : pnl.toFixed(2),
        pnlPercent: pnlPercent > 0 ? `+${pnlPercent.toFixed(2)}%` : `${pnlPercent.toFixed(2)}%`,
        pnlColor: pnl >= 0 ? 'buyColor' : 'sellColor',
        liqPrice: formatPrice(liqPrice),
        markPrice: formatPrice(pythPrice),
        rawPnl: pnl
      };

    } catch (err) {
      console.warn("Calculations error:", err);
      return { pnl: '--', pnlPercent: '--', pnlColor: '', liqPrice: '--', markPrice: formatPrice(pythPrice) || '--', rawPnl: 0 };
    }
  }, [prices]);

  return { getTradeLiveMath };
};
