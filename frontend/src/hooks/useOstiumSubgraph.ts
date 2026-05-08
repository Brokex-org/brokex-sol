import { useCallback } from 'react';
import { mapPosition, mapLimit, mapOrder } from '../utils/ostium/utils';
import { useNetwork } from '../contexts/NetworkContext';

// Configuration du réseau (Mainnet / Testnet)
export const OSTIUM_NETWORK_CONFIG = {
  mainnet: {
    graphUrl: "https://api.subgraph.ormilabs.com/api/public/67a599d5-c8d2-4cc4-9c4d-2975a97bc5d8/subgraphs/ost-prod/live/gn",
    contracts: {
      usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      trading: "0x6D0bA1f9996DBD8885827e1b2e8f6593e7702411",
      tradingStorage: "0xcCd5891083A8acD2074690F65d3024E7D13d66E7"
    }
  },
  testnet: {
    graphUrl: "https://api.subgraph.ormilabs.com/api/public/67a599d5-c8d2-4cc4-9c4d-2975a97bc5d8/subgraphs/ost-sep/live/gn",
    contracts: {
      usdc: "0xe73B11Fb1e3eeEe8AF2a23079A4410Fe1B370548",
      trading: "0x2A9B9c988393f46a2537B0ff11E98c2C15a95afe",
      tradingStorage: "0x0b9F5243B29938668c9Cfbd7557A389EC7Ef88b8"
    }
  }
};

export const useOstiumSubgraph = (forcedIsTestnet?: boolean) => {
  // ── Consume the shared NetworkContext (single source of truth) ───────────
  const { chainId: currentChainId, isTestnet: contextIsTestnet } = useNetwork();

  const isTestnet = forcedIsTestnet !== undefined && forcedIsTestnet !== null
    ? forcedIsTestnet
    : contextIsTestnet;

  const config = isTestnet ? OSTIUM_NETWORK_CONFIG.testnet : OSTIUM_NETWORK_CONFIG.mainnet;

  // Méthode générique pour exécuter n'importe quelle requête GraphQL
  const executeQuery = useCallback(async (query: string, variables: Record<string, any> = {}) => {
    try {
      const response = await fetch(config.graphUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables })
      });
      
      const json = await response.json();
      
      if (json.errors) {
        throw new Error(`GraphQL Error: ${JSON.stringify(json.errors)}`);
      }
      
      return json.data;
    } catch (error) {
      console.error("Erreur réseau ou GQL Subgraph Ostium:", error);
      throw error;
    }
  }, [config.graphUrl, currentChainId]);

  const getPairs = useCallback(async () => {
    const query = `
      query getPairs {
        pairs(first: 1000) {
          id
          from
          to    
          feed
          overnightMaxLeverage                
          longOI
          shortOI
          maxOI
          makerFeeP
          takerFeeP
          makerMaxLeverage    
          curFundingLong  
          curFundingShort
          curRollover
          totalOpenTrades
          totalOpenLimitOrders
          accRollover
          lastRolloverBlock
          rolloverFeePerBlock
          accFundingLong
          accFundingShort
          lastFundingBlock
          maxFundingFeePerBlock
          lastFundingRate              
          hillInflectionPoint
          hillPosScale
          hillNegScale
          springFactor
          sFactorUpScaleP
          sFactorDownScaleP
          lastTradePrice
          maxLeverage              
          group {
            id
            name
            minLeverage
            maxLeverage
            maxCollateralP
            longCollateral
            shortCollateral
          }
          fee {
            minLevPos                
          }
        }
      }
    `;
    const data = await executeQuery(query);
    return data?.pairs || [];
  }, [executeQuery]);

  const getPairDetails = useCallback(async (pair_id: string) => {
    const query = `
      query getPairDetails($pair_id: ID!) {
        pair(id: $pair_id) {
          id
          from
          to    
          overnightMaxLeverage                
          longOI
          shortOI
          maxOI
          makerFeeP
          takerFeeP
          makerMaxLeverage    
          curFundingLong  
          curFundingShort
          curRollover
          totalOpenTrades
          totalOpenLimitOrders
          accRollover
          lastRolloverBlock
          rolloverFeePerBlock
          accFundingLong
          accFundingShort
          lastFundingBlock
          maxFundingFeePerBlock
          lastFundingRate              
          hillInflectionPoint
          hillPosScale
          hillNegScale
          springFactor
          sFactorUpScaleP
          sFactorDownScaleP
          lastTradePrice
          maxLeverage              
          group {
            id
            name
            minLeverage
            maxLeverage
            maxCollateralP
            longCollateral
            shortCollateral
          }
          fee {
            minLevPos                
          }
        }
      }
    `;
    const data = await executeQuery(query, { pair_id });
    if (!data?.pair) {
      throw new Error(`No pair details found for pair ID: ${pair_id}`);
    }
    return data.pair;
  }, [executeQuery]);

  const getLiqMarginThresholdP = useCallback(async () => {
    const query = `
      query metaDatas {
        metaDatas {              
          liqMarginThresholdP
        }
      }
    `;
    const data = await executeQuery(query);
    return data?.metaDatas?.[0]?.liqMarginThresholdP;
  }, [executeQuery]);

  const getOpenTrades = useCallback(async (traderAddress: string) => {
    const query = `
      query trades($trader: Bytes!) {
        trades(        
          where: { isOpen: true, trader: $trader }
        ) {
          id
          tradeID
          collateral
          leverage
          highestLeverage
          openPrice
          stopLossPrice
          takeProfitPrice
          isOpen
          timestamp
          isBuy
          notional
          tradeNotional
          funding
          rollover
          trader
          index
          pair {
            id
            feed
            from
            to
            accRollover
            lastRolloverBlock
            rolloverFeePerBlock
            accFundingLong
            spreadP
            accFundingShort
            longOI
            shortOI
            maxOI
            maxLeverage
            hillInflectionPoint
            hillPosScale
            hillNegScale
            springFactor
            sFactorUpScaleP
            sFactorDownScaleP
            lastFundingBlock
            maxFundingFeePerBlock
            lastFundingRate
          }
        }
      }
    `;
    const data = await executeQuery(query, { trader: traderAddress.toLowerCase() });
    return (data?.trades || []).map(mapPosition);
  }, [executeQuery]);

  const getOrders = useCallback(async (traderAddress: string) => {
    const query = `
      query orders($trader: Bytes!) {
        limits(
          where: { trader: $trader, isActive: true }
          orderBy: initiatedAt
          orderDirection: asc
        ) {
          collateral
          leverage
          isBuy
          isActive
          id
          openPrice
          takeProfitPrice
          stopLossPrice
          trader
          initiatedAt
          limitType
          uniqueId
          executionStarted
          tradeNotional
          orderId
          block
          updatedAt
          pair {
            id
            feed
            from
            to
            accRollover
            lastRolloverBlock
            rolloverFeePerBlock
            accFundingLong
            spreadP
            accFundingShort
            longOI
            shortOI
            lastFundingBlock
            maxFundingFeePerBlock
            lastFundingRate
          }
        }
      }
    `;
    const data = await executeQuery(query, { trader: traderAddress.toLowerCase() });
    return (data?.limits || []).map(mapLimit);
  }, [executeQuery]);

  const getRecentHistory = useCallback(async (traderAddress: string, last_n_orders: number = 10) => {
    const query = `
      query ListOrdersHistory($trader: Bytes, $last_n_orders: Int) {
        orders(
          where: { trader: $trader, isPending: false}
          first: $last_n_orders
          orderBy: executedAt
          orderDirection: desc
        ) {
          id
          isBuy
          trader
          notional
          tradeNotional
          collateral
          leverage
          orderType
          orderAction
          price
          priceImpactP
          priceAfterImpact
          initiatedAt
          executedAt
          executedTx
          initiatedTx
          initiatedBlock
          executedBlock
          isCancelled
          cancelReason
          profitPercent
          totalProfitPercent
          isPending
          amountSentToTrader
          rolloverFee
          fundingFee
          devFee
          vaultFee
          oracleFee
          liquidationFee
          closePercent
          tradeID
          limitID
          pair {
            id
            from
            to
            feed
            longOI
            shortOI
            group {
                name
            }
          }
        }
      }
    `;
    const data = await executeQuery(query, { trader: traderAddress.toLowerCase(), last_n_orders });
    return (data?.orders || []).reverse().map(mapOrder);
  }, [executeQuery]);

  const getOrderById = useCallback(async (order_id: string) => {
    const query = `
      query GetOrder($order_id: ID!) {
        orders(where: {id: $order_id}) {
          id
          trader
          pair {
            id
            from
            to
            feed
          }
          tradeID
          limitID
          orderType
          orderAction
          price
          priceAfterImpact
          priceImpactP
          collateral
          notional
          tradeNotional
          profitPercent
          totalProfitPercent
          amountSentToTrader
          isBuy
          initiatedAt
          executedAt
          initiatedTx
          executedTx
          initiatedBlock
          executedBlock
          leverage
          isPending
          isCancelled
          cancelReason
          devFee
          vaultFee
          oracleFee
          liquidationFee
          fundingFee
          rolloverFee
          closePercent
        }
      }
    `;
    const data = await executeQuery(query, { order_id });
    return data?.orders?.[0] ? mapOrder(data.orders[0]) : null;
  }, [executeQuery]);

  const getTradeById = useCallback(async (trade_id: string) => {
    const query = `
      query GetTrade($trade_id: ID!) {
        trades(where: {id: $trade_id}) {
          id
          trader
          pair {
            id
            from
            to
            feed
          }
          index
          tradeID
          tradeType
          openPrice
          closePrice
          takeProfitPrice
          stopLossPrice
          collateral
          notional
          tradeNotional
          highestLeverage
          leverage
          isBuy
          isOpen
          closeInitiated
          funding
          rollover
          timestamp
        }
      }
    `;
    const data = await executeQuery(query, { trade_id });
    return data?.trades?.[0] ? mapPosition(data.trades[0]) : null;
  }, [executeQuery]);

  return {
    config,
    executeQuery,
    getPairs,
    getPairDetails,
    getLiqMarginThresholdP,
    getOpenTrades,
    getOrders,
    getRecentHistory,
    getOrderById,
    getTradeById
  };
};