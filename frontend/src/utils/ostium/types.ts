export interface Group {
    id: string;
    name: string;
    minLeverage: string;
    maxLeverage: string;
    maxCollateralP: string;
    longCollateral: string;
    shortCollateral: string;
}

export interface Fee {
    minLevPos: string;
}

export interface Pair {
    id: string;
    from: string;
    to: string;
    feed: string;
    overnightMaxLeverage: string;
    longOI: string;
    shortOI: string;
    maxOI: string;
    makerFeeP: string;
    takerFeeP: string;
    makerMaxLeverage: string;
    curFundingLong: string;
    curFundingShort: string;
    curRollover: string;
    totalOpenTrades: string;
    totalOpenLimitOrders: string;
    accRollover: string;
    lastRolloverBlock: string;
    rolloverFeePerBlock: string;
    accFundingLong: string;
    accFundingShort: string;
    lastFundingBlock: string;
    maxFundingFeePerBlock: string;
    lastFundingRate: string;
    hillInflectionPoint: string;
    hillPosScale: string;
    hillNegScale: string;
    springFactor: string;
    sFactorUpScaleP: string;
    sFactorDownScaleP: string;
    lastTradePrice: string;
    maxLeverage: string;
    group: Group;
    fee: Fee;
}

export interface Trade {
    id?: string;
    tradeID: string;
    trader: string;
    pair: {
        id: string;
        from: string;
        to: string;
        feed: string;
        accRollover: string;
        lastRolloverBlock: string;
        rolloverFeePerBlock: string;
        accFundingLong: string;
        spreadP: string;
        accFundingShort: string;
        maxLeverage?: string;
    };
    index: string;
    tradeType?: string;
    openPrice: string;
    closePrice?: string;
    takeProfitPrice: string;
    stopLossPrice: string;
    collateral: string;
    notional: string;
    tradeNotional: string;
    highestLeverage: string;
    leverage: string;
    isBuy: boolean;
    isOpen: boolean;
    closeInitiated?: boolean;
    funding: string;
    rollover: string;
    timestamp: string;
}

export interface LimitOrder {
    id: string;
    trader: string;
    pair: {
        id: string;
        feed: string;
        from: string;
        to: string;
    };
    collateral: string;
    leverage: string;
    isBuy: boolean;
    isActive: boolean;
    openPrice: string;
    takeProfitPrice: string;
    stopLossPrice: string;
    initiatedAt: string;
    limitType: string;
    block?: string;
    executionStarted?: boolean;
    notional?: string;
    tradeNotional?: string;
    orderId?: string;
    uniqueId?: string;
    updatedAt?: string;
}

export interface Order {
    id: string;
    trader: string;
    pair: {
        id: string;
        from: string;
        to: string;
        feed: string;
    };
    tradeID?: string;
    limitID?: string;
    orderType: string;
    orderAction: string;
    price: string;
    priceAfterImpact?: string;
    priceImpactP?: string;
    collateral: string;
    notional: string;
    tradeNotional: string;
    profitPercent?: string;
    totalProfitPercent?: string;
    amountSentToTrader?: string;
    isBuy: boolean;
    initiatedAt: string;
    executedAt?: string;
    initiatedTx?: string;
    executedTx?: string;
    initiatedBlock?: string;
    executedBlock?: string;
    leverage: string;
    isPending: boolean;
    isCancelled: boolean;
    cancelReason?: string;
    devFee?: string;
    vaultFee?: string;
    oracleFee?: string;
    liquidationFee?: string;
    fundingFee?: string;
    rolloverFee?: string;
    closePercent?: string;
}

export interface MetaData {
    liqMarginThresholdP: string;
}
