import { formatUnits } from 'viem';

export function normalize(value: string | null | undefined, decimals: number): number {
    if (!value) return 0;
    try {
        return parseFloat(formatUnits(BigInt(value), decimals));
    } catch (e) {
        return 0;
    }
}

export function formatCompactNumber(num: number): string {
    if (!num) return '0';
    if (num >= 1e9) return (num / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return Number(num).toFixed(2);
}

export function formatPrice(price: number | string | undefined | null): string {
    if (price === undefined || price === null) return '---';
    const num = typeof price === 'string' ? parseFloat(price) : price;
    if (isNaN(num)) return '---';
    if (num === 0) return '0.00';

    const absPrice = Math.abs(num);
    if (absPrice < 1) return num.toFixed(5);

    const digitsBefore = Math.floor(Math.log10(absPrice)) + 1;
    const decimals = Math.max(2, 5 - digitsBefore);
    return num.toFixed(decimals);
}

const CRYPTO_ASSETS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'TRX', 'ADA', 'HYPE', 'LINK'];
const FX_ASSETS = ['EUR', 'GBP', 'JPY', 'KRW', 'MXN', 'CAD', 'AUD', 'NZD', 'CHF', 'USD'];
const COMMODITY_ASSETS = ['XAG', 'XAU', 'XPT', 'XPD', 'HG', 'CL', 'BRENT', 'UNG'];
const EQUITY_ASSETS = [
  'HSI', 'NIK', 'SPX', 'DAX', 'NDX', 'FTSE', 'DJI',
  'NVDA', 'GOOG', 'AMZN', 'META', 'TSLA', 'COIN', 'MSTR', 'AAPL', 'MSFT', 'HOOD', 
  'CRCL', 'BABA', 'GLXY', 'SBET', 'BMNR', 'SHEL', 'GEV', 'PLTR', 'AMD', 'NFLX', 
  'ORCL', 'RIVN', 'COST', 'XOM', 'CVX', 'URA', 'KR2550', 'XLE'
];

export function getAssetLogo(symbol: string, quote?: string): string {
    if (!symbol) return '';
    const sym = symbol.toUpperCase();
    const q = quote?.toUpperCase() || 'USD';
    
    // 1. Indices & Special Asset Flag Mapping
    const indexFlags: Record<string, string> = {
        'DJI': 'US', 'SPX': 'US', 'NDX': 'US', 'DAX': 'DE', 'FTSE': 'GB', 
        'HSI': 'HK', 'NIK': 'JP', 'ASX': 'AU', 'KR2550': 'KR', 'URA': 'US',
        'XLE': 'US', 'UNG': 'US'
    };
    if (indexFlags[sym]) return `https://flagsapi.com/${indexFlags[sym]}/flat/64.png`;

    // 2. Forex Flag Logic (Handle USD pairs correctly)
    const isForex = FX_ASSETS.includes(sym) || FX_ASSETS.includes(q);
    if (isForex) {
        const flagMap: Record<string, string> = {
            'EUR': 'EU', 'GBP': 'GB', 'JPY': 'JP', 'USD': 'US', 
            'AUD': 'AU', 'NZD': 'NZ', 'CHF': 'CH', 'CAD': 'CA',
            'KRW': 'KR', 'MXN': 'MX'
        };
        // Non-USD part of the pair usually determines the flag the user wants to see
        const target = (sym === 'USD' && q !== 'USD') ? q : sym;
        const country = flagMap[target] || target.slice(0, 2);
        return `https://flagsapi.com/${country}/flat/64.png`;
    }

    // 3. Crypto Logos (Reliable Source)
    if (CRYPTO_ASSETS.includes(sym)) {
        return `https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/${sym.toLowerCase()}.png`;
    }

    // 4. Stock Logos (Clearbit domains for top techs)
    const stockDomains: Record<string, string> = {
        'NVDA': 'nvidia.com', 'GOOG': 'google.com', 'AMZN': 'amazon.com', 
        'META': 'meta.com', 'TSLA': 'tesla.com', 'AAPL': 'apple.com', 
        'MSFT': 'microsoft.com', 'COIN': 'coinbase.com', 'MSTR': 'microstrategy.com',
        'NFLX': 'netflix.com', 'BABA': 'alibaba.com', 'ORCL': 'oracle.com',
        'AMD': 'amd.com', 'PLTR': 'palantir.com', 'PYPL': 'paypal.com'
    };
    if (stockDomains[sym]) return `https://logo.clearbit.com/${stockDomains[sym]}`;

    // 5. Commodities (Try Pyth as secondary)
    if (COMMODITY_ASSETS.includes(sym)) return `https://assets.pyth.network/logos/commodity/${sym.toLowerCase()}.svg`;
    
    // 6. Generic Equity Fallback (US flag as requested for US companies)
    if (EQUITY_ASSETS.includes(sym)) return `https://flagsapi.com/US/flat/64.png`;

    return `https://assets.pyth.network/logos/cryptocurrency/${sym.toLowerCase()}.svg`;
}

export function safeDateFromSeconds(timestamp: string | null | undefined): Date | null {
    if (!timestamp) return null;
    try {
        return new Date(parseInt(timestamp) * 1000);
    } catch {
        return null;
    }
}

export function mapOrder(order: any) {
    return {
        id: order.id,
        trader: order.trader,
        vaultFee: normalize(order.vaultFee, 6),
        tradeNotional: normalize(order.tradeNotional, 18),
        tradeID: order.tradeID,
        totalProfitPercent: normalize(order.totalProfitPercent, 6),
        rolloverFee: normalize(order.rolloverFee, 6),
        profitPercent: normalize(order.profitPercent, 6),
        priceImpactP: normalize(order.priceImpactP, 18),
        priceAfterImpact: normalize(order.priceAfterImpact, 18),
        price: normalize(order.price, 18),
        orderType: order.orderType,
        orderAction: order.orderAction,
        oracleFee: normalize(order.oracleFee, 6),
        notional: normalize(order.notional, 6),
        liquidationFee: normalize(order.liquidationFee, 6),
        limitID: order.limitID ?? null,
        leverage: normalize(order.leverage, 2),
        isBuy: Boolean(order.isBuy),
        initiatedTx: order.initiatedTx,
        initiatedBlock: Number(order.initiatedBlock),
        initiatedAt: BigInt(order.initiatedAt || 0),
        fundingFee: normalize(order.fundingFee, 6),
        executedTx: order.executedTx,
        executedBlock: Number(order.executedBlock),
        executedAt: BigInt(order.executedAt || 0),
        devFee: normalize(order.devFee, 6),
        collateral: normalize(order.collateral, 6),
        closePercent: normalize(order.closePercent, 2),
        cancelReason: order.cancelReason ?? null,
        amountSentToTrader: normalize(order.amountSentToTrader, 6),
        pairId: order.pair?.id,
        pair: order.pair ? `${order.pair.from}${order.pair.to}` : 'Unknown',
        raw: order
    };
}

export function mapLimit(limit: any) {
    return {
        id: limit.id,
        block: Number(limit.block),
        collateral: normalize(limit.collateral, 6),
        executionStarted: Boolean(limit.executionStarted),
        initiatedAt: BigInt(limit.initiatedAt || 0),
        isActive: Boolean(limit.isActive),
        isBuy: Boolean(limit.isBuy),
        leverage: normalize(limit.leverage, 2),
        limitType: limit.limitType,
        notional: normalize(limit.notional, 6),
        openPrice: normalize(limit.openPrice, 18),
        orderId: limit.orderId,
        pairId: limit.pair?.id,
        trader: limit.trader,
        tradeNotional: normalize(limit.tradeNotional, 18),
        takeProfitPrice: limit.takeProfitPrice !== undefined ? normalize(limit.takeProfitPrice, 18) : null,
        stopLossPrice: limit.stopLossPrice !== undefined ? normalize(limit.stopLossPrice, 18) : null,
        uniqueId: limit.uniqueId,
        updatedAt: safeDateFromSeconds(limit.updatedAt) ?? new Date(0),
        raw: limit
    };
}

export function mapPosition(pos: any) {
    return {
        id: pos.id,
        isOpen: Boolean(pos.isOpen),
        leverage: normalize(pos.leverage, 2),
        notional: normalize(pos.notional, 6),
        openPrice: normalize(pos.openPrice, 18),
        isBuy: Boolean(pos.isBuy),
        index: Number(pos.index),
        highestLeverage: Number(pos.highestLeverage),
        funding: normalize(pos.funding, 18),
        collateral: normalize(pos.collateral, 6),
        pairId: pos.pair?.id,
        rollover: normalize(pos.rollover, 18),
        stopLossPrice: pos.stopLossPrice !== undefined ? normalize(pos.stopLossPrice, 18) : null,
        takeProfitPrice: pos.takeProfitPrice !== undefined ? normalize(pos.takeProfitPrice, 18) : null,
        timestamp: safeDateFromSeconds(pos.timestamp),
        tradeID: pos.tradeID,
        tradeNotional: normalize(pos.tradeNotional, 18),
        tradeType: pos.tradeType,
        trader: pos.trader,
        raw: pos
    };
}

export function mapPair(pair: any) {
    return {
        id: Number(pair.id),
        from: pair.from,
        to: pair.to,
        group: pair.group?.name,
        longOI: normalize(pair.longOI, 18),
        shortOI: normalize(pair.shortOI, 18),
        maxOI: normalize(pair.maxOI, 6),
        makerFeeP: normalize(pair.makerFeeP, 6),
        takerFeeP: normalize(pair.takerFeeP, 6),
        minLeverage: normalize(pair.group?.minLeverage, 2),
        maxLeverage: normalize(pair.maxLeverage, 2) || normalize(pair.group?.maxLeverage, 2),
        makerMaxLeverage: normalize(pair.makerMaxLeverage, 2),
        groupMaxCollateralP: normalize(pair.group?.maxCollateralP, 2),
        minLevPos: normalize(pair.fee?.minLevPos, 6),
        lastFundingRate: normalize(pair.lastFundingRate, 18),
        curFundingLong: normalize(pair.curFundingLong, 18),
        curFundingShort: normalize(pair.curFundingShort, 18),
        lastFundingBlock: Number(pair.lastFundingBlock),
        overnightMaxLeverage: parseInt(pair.overnightMaxLeverage) !== 0
            ? normalize(pair.overnightMaxLeverage, 2)
            : undefined
    };
}
