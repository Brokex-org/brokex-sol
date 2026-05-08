import { BigNumber } from '@ethersproject/bignumber'
import { parseUnits } from 'viem'
import { PRECISION_18, PRECISION_12, PRECISION_2, PRECISION_6, LIQ_MARGIN_P, MAX_PROFIT_P, MIN_LOSS_P, MAX_PRICE_IMPACT_P, PRECISION_16, MAX_UINT256, MAX_LOCK_DURATION } from './const';

export function GetCollateralInputFromNotional(
  notional: string,
  isOpen: boolean,
  isLong: boolean,
  leverage: string,
  price: string,
  makerMaxLeverage: string,
  makerFeeP: string,
  takerFeeP: string,
  oiDelta: string,
  toleranceP: string,
  maxIterations: number,
): { collateral: string; notional: string } {
  const notionalBN = BigNumber.from(notional)
  const leverageBN = BigNumber.from(leverage)
  const priceBN = BigNumber.from(price)
  const makerMaxLeverageBN = BigNumber.from(makerMaxLeverage)
  const makerFeePBN = BigNumber.from(makerFeeP)
  const takerFeePBN = BigNumber.from(takerFeeP)
  const oiDeltaBN = BigNumber.from(oiDelta)

  const sign = isOpen == isLong ? BigNumber.from(1) : BigNumber.from(-1)

  let tradeSize = notionalBN.mul(priceBN).div(PRECISION_18).div(PRECISION_12)
  const collateral = tradeSize.mul(PRECISION_2).div(leverageBN)

  let iteration = 0
  let initialFee = (takerFeePBN.lt(makerFeePBN) ? takerFeePBN : makerFeePBN)
    .mul(tradeSize)
    .div(PRECISION_6)
    .div(PRECISION_2)
  let newCollateralInput = collateral.add(initialFee)
  let newNotional = notionalBN

  while (iteration < maxIterations) {
    const { baseFee, takerAmount, makerAmount } = _getBaseOpeningFee(
      makerMaxLeverageBN,
      tradeSize.mul(sign),
      leverageBN,
      oiDeltaBN,
      makerFeePBN,
      takerFeePBN,
    )
    const newNotional = newCollateralInput
      .sub(baseFee)
      .mul(leverageBN)
      .div(PRECISION_2)
      .mul(PRECISION_18)
      .mul(PRECISION_12)
      .div(priceBN)

    if (newNotional.sub(notionalBN).abs().mul(100).mul(PRECISION_18).div(notionalBN).lte(toleranceP)) break

    newCollateralInput = collateral.add(baseFee)
    tradeSize = newCollateralInput.mul(leverageBN).div(PRECISION_2)

    iteration++
  }

  return { collateral: newCollateralInput.toString(), notional: newNotional.toString() }
}

export function GetTradeLiquidationPrice(
  openPrice: string,
  long: boolean,
  collateral: string,
  leverage: string,
  rolloverFee: string,
  fundingFee: string,
  maxLeverage: string,
): string {
  if (!openPrice || !collateral || !leverage || !maxLeverage) return '0';
  let liqPrice = BigNumber.from(0)
  try {
    const openPriceBN = BigNumber.from(openPrice)

    const liqMarginValue = GetTradeLiquidationMargin(collateral, leverage, maxLeverage)
    const targetCollateralAfterFees = BigNumber.from(collateral).sub(liqMarginValue).sub(rolloverFee).sub(fundingFee)

    const liqPriceDistance = openPriceBN.mul(targetCollateralAfterFees).div(collateral).mul(PRECISION_2).div(leverage)

    liqPrice = long ? openPriceBN.sub(liqPriceDistance) : openPriceBN.add(liqPriceDistance)
  } catch (error) {
    console.warn(`Unable to compute Liquidation Price:`, error)
    return '0';
  }

  return liqPrice.gt(BigNumber.from(0)) ? liqPrice.toString() : '0'
}

export function GetTradeLiquidationMargin(collateral: string, leverage: string, maxLeverage: string): string {
  if (!collateral || !leverage || !maxLeverage) return '0';
  const rawAdjustedThreshold = BigNumber.from(LIQ_MARGIN_P).mul(leverage).mul(PRECISION_6).div(maxLeverage)
  return BigNumber.from(collateral).mul(rawAdjustedThreshold).div(PRECISION_6).div(PRECISION_2).toString()
}

export function CurrentTradeProfitP(
  openPrice: string,
  currentPrice: string,
  long: boolean,
  leverage: string,
  highestLeverage: string,
): string {
  if (!openPrice || !currentPrice || !leverage || !highestLeverage) return '0';
  let profitP = BigNumber.from(0)
  try {
    const openPriceBN = BigNumber.from(openPrice)
    const currentPriceBN = BigNumber.from(currentPrice)
    const leverageBN = BigNumber.from(leverage)
    const highestLeverageBN = BigNumber.from(highestLeverage)

    const leverageToUseBN = leverageBN.lt(highestLeverageBN) ? leverageBN : highestLeverageBN

    if (openPriceBN.eq(0)) return '0';

    profitP = (long ? currentPriceBN.sub(openPriceBN) : openPriceBN.sub(currentPriceBN))
      .mul(PRECISION_6)
      .mul(100)
      .mul(leverageToUseBN)
      .div(PRECISION_2)
      .div(openPriceBN)

    profitP = profitP.gte(MAX_PROFIT_P) ? MAX_PROFIT_P : profitP

    profitP = profitP.mul(leverageBN).div(leverageToUseBN)
  } catch (error) {
    console.warn(`Unable to compute Trade Profit Percentage:`, error)
    return '0';
  }

  return profitP.toString()
}

export function CurrentTradeProfitRaw(
  openPrice: string,
  currentPrice: string,
  long: boolean,
  leverage: string,
  highestLeverage: string,
  collateral: string,
): string {
  let profit: string = '0';
  try {
    const profitP = CurrentTradeProfitP(openPrice, currentPrice, long, leverage, highestLeverage)

    profit = CurrentTradeProfit(profitP, collateral)
  } catch (error) {
    console.warn(`Unable to compute Trade Profit Raw:`, error)
  }

  return profit;
}

export function CurrentTradeProfit(profitP: string, collateral: string): string {
  let profit = BigNumber.from(0)
  try {
    profit = BigNumber.from(collateral).mul(profitP).div(PRECISION_6).div(100)
  } catch (error) {
    console.warn(`Unable to compute Trade Profit:`, error)
  }

  return profit.toString()
}

export function CurrentTotalProfitRaw(
  openPrice: string,
  currentPrice: string,
  long: boolean,
  leverage: string,
  highestLeverage: string,
  collateral: string,
  rolloverFee: string,
  fundingFee: string,
): string {
  let profit: string = '0';
  try {
    const tradeProfit = CurrentTradeProfitRaw(openPrice, currentPrice, long, leverage, highestLeverage, collateral)
    profit = CurrentTotalProfit(tradeProfit, rolloverFee, fundingFee)
  } catch (error) {
    console.warn(`Unable to compute Total Profit:`, error)
  }
  return profit.toString();
}

export function GetTradeValue(
  openPrice: string,
  currentPrice: string,
  long: boolean,
  leverage: string,
  highestLeverage: string,
  maxLeverage: string,
  collateral: string,
  rolloverFee: string,
  fundingFee: string,
): { tradeValue: string; liqMargin: string } {
  try {
      const totalProfit = CurrentTotalProfitRaw(
        openPrice,
        currentPrice,
        long,
        leverage,
        highestLeverage,
        collateral,
        rolloverFee,
        fundingFee,
      )
    return {
      tradeValue: BigNumber.from(collateral).add(totalProfit).toString(),
      liqMargin: GetTradeLiquidationMargin(collateral, leverage, maxLeverage),
    }
  } catch (error) {
    console.warn(`Unable to compute Trade Value:`, error)
    return { tradeValue: '0', liqMargin: '0' };
  }
}

export function CurrentTotalProfit(tradeProfit: string, rolloverFee: string, fundingFee: string): string {
  let profit = BigNumber.from('0')
  try {
    profit = BigNumber.from(tradeProfit || 0).sub(rolloverFee || 0).sub(fundingFee || 0)
  } catch (error) {
    console.warn(`Unable to compute Total Profit:`, error)
  }
  return profit.toString()
}

export function CurrentTotalProfitP(totalProfit: string, collateral: string): string {
  let profitP = BigNumber.from('0')
  try {
    const totalProfitBN = BigNumber.from(totalProfit || 0)
    profitP = totalProfitBN.mul(PRECISION_6).mul(100).div(collateral || 1)

    profitP = profitP.lte(MIN_LOSS_P) ? MIN_LOSS_P : profitP
  } catch (error) {
    console.warn(`Unable to compute Total Profit P:`, error)
  }
  return profitP.toString()
}

export function CurrentLeverageRaw(
  openPrice: string,
  currentPrice: string,
  long: boolean,
  leverage: string,
  highestLeverage: string,
  collateral: string,
  rolloverFee: string,
  fundingFee: string,
): string {
  let currentL = BigNumber.from(0)
  try {
    const collateralBN = BigNumber.from(collateral)
    const totalProfit = CurrentTotalProfitRaw(
      openPrice,
      currentPrice,
      long,
      leverage,
      highestLeverage,
      collateral,
      rolloverFee,
      fundingFee,
    )

    currentL = collateralBN
      .mul(leverage)
      .div(PRECISION_2)
      .add(totalProfit)
      .mul(PRECISION_2)
      .div(collateralBN.add(totalProfit))
    currentL = currentL.lte(BigNumber.from(0)) ? BigNumber.from(0) : currentL
  } catch (error) {
    throw `Unable to compute Current Leverage: ${error}`
  }
  return currentL.toString()
}

export function CurrentLeverage(totalProfit: string, leverage: string, collateral: string): string {
  let currentL = BigNumber.from(0)
  try {
    const collateralBN = BigNumber.from(collateral)

    currentL = collateralBN
      .mul(leverage)
      .div(PRECISION_2)
      .add(totalProfit)
      .mul(PRECISION_2)
      .div(collateralBN.add(totalProfit))
    currentL = currentL.lte(BigNumber.from(0)) ? BigNumber.from(0) : currentL
  } catch (error) {
    throw `Unable to compute Current Leverage: ${error}`
  }
  return currentL.toString()
}

export function GetTradeRolloverFee(
  tradeRollover: string,
  currentRollover: string,
  collateral: string,
  leverage: string,
): string {
  let rolloverFee = BigNumber.from(0)
  try {
    const currentRolloverBN = BigNumber.from(currentRollover)

    rolloverFee = currentRolloverBN.sub(tradeRollover).mul(collateral).mul(leverage).div(PRECISION_18).div(PRECISION_2)
  } catch (error) {
    throw `Unable to compute Trade Rollover Fee: ${error}`
  }
  return rolloverFee.toString()
}

export function GetTradeFundingFee(
  tradeFunding: string,
  currentFunding: string,
  collateral: string,
  leverage: string,
): string {
  let fundingFee = BigNumber.from(0)
  try {
    const currentFundingBN = BigNumber.from(currentFunding)

    fundingFee = currentFundingBN.sub(tradeFunding).mul(collateral).mul(leverage).div(PRECISION_18).div(PRECISION_2)
  } catch (error) {
    throw `Unable to compute Trade Funding Fee: ${error}`
  }
  return fundingFee.toString()
}

export function GetTakeProfitPrice(openPrice: string, profitP: string, leverage: string, long: boolean): string {
  let tp = BigNumber.from(0)

  try {
    const openPriceBN = BigNumber.from(openPrice)
    const priceDiff = openPriceBN.mul(profitP).div(leverage).div(PRECISION_6).mul(PRECISION_2).div(100)

    tp = long ? openPriceBN.add(priceDiff) : openPriceBN.sub(priceDiff)
  } catch (error) {
    throw `Unable to compute Take profit price: ${error}`
  }

  return tp.gt(BigNumber.from(0)) ? tp.toString() : '0'
}

export function GetStopLossPrice(openPrice: string, lossP: string, leverage: string, long: boolean): string {
  let sl = BigNumber.from(0)

  try {
    const openPriceBN = BigNumber.from(openPrice)
    const priceDiff = openPriceBN.mul(lossP).div(leverage).div(PRECISION_6).mul(PRECISION_2).div(100)

    sl = long ? openPriceBN.sub(priceDiff) : openPriceBN.add(priceDiff)
  } catch (error) {
    throw `Unable to compute Stop loss price: ${error}`
  }

  return sl.gt(BigNumber.from(0)) ? sl.toString() : '0'
}

export function WithinExposureLimit(
  oi: string,
  maxOI: string,
  groupCollateral: string,
  maxCollateralP: string,
  vaultBalance: string,
  collateral: string,
  leverage: string,
): boolean {
  let oiwithinLimit,
    collateralwithinLimit = false
  try {
    const oiBN = BigNumber.from(oi)
    const gcBN = BigNumber.from(groupCollateral)
    const maxCollateral = BigNumber.from(vaultBalance).mul(maxCollateralP).div(100).div(PRECISION_2)

    oiwithinLimit = oiBN.add(BigNumber.from(collateral).mul(leverage).div(PRECISION_2)).lte(maxOI)

    collateralwithinLimit = gcBN.add(collateral).lte(maxCollateral)
  } catch (error) {
    throw `Unable to compute Exposure limit: ${error}`
  }

  return oiwithinLimit && collateralwithinLimit
}

export function GetOpeningFee(
  oiLong: string,
  oiShort: string,
  makerFeeP: string,
  takerFeeP: string,
  makerMaxLeverage: string,
  leveragedPositionSize: string,
  leverage: string,
): { baseFee: string; takerAmount: string; makerAmount: string } {
  const oiLongBN = BigNumber.from(oiLong)
  const oiShortBN = BigNumber.from(oiShort)
  const makerFeePBN = BigNumber.from(makerFeeP)
  const takerFeePBN = BigNumber.from(takerFeeP)
  const makerMaxLeverageBN = BigNumber.from(makerMaxLeverage)
  const leveragedPositionSizeBN = BigNumber.from(leveragedPositionSize)
  const leverageBN = BigNumber.from(leverage)

  const oiDelta = oiLongBN.sub(oiShortBN)

  const { baseFee, takerAmount, makerAmount } = _getBaseOpeningFee(
    makerMaxLeverageBN,
    leveragedPositionSizeBN,
    leverageBN,
    oiDelta,
    makerFeePBN,
    takerFeePBN,
  )

  return { baseFee: baseFee.toString(), takerAmount: takerAmount.toString(), makerAmount: makerAmount.toString() }
}

export function GetPriceImpact(
  medianPrice: string,
  bidPrice: string,
  askPrice: string,
  isOpen: boolean,
  isLong: boolean,
): { priceImpactP: string; priceAfterImpact: string } {
  const medianPriceBN = BigNumber.from(medianPrice)
  const bidPriceBN = BigNumber.from(bidPrice)
  const askPriceBN = BigNumber.from(askPrice)

  const aboveSpot: boolean = isOpen === isLong

  let priceImpactP = medianPriceBN
    .sub(aboveSpot ? askPriceBN : bidPriceBN)
    .abs()
    .mul(PRECISION_18)
    .div(medianPriceBN)
    .mul(100)

  priceImpactP = priceImpactP.gt(MAX_PRICE_IMPACT_P) ? priceImpactP : MAX_PRICE_IMPACT_P.mul(PRECISION_18)

  return { priceImpactP: priceImpactP.toString(), priceAfterImpact: aboveSpot ? askPrice : bidPrice }
}

export function getTargetFundingRate(
  normalizedOiDelta: string,
  hillInflectionPoint: string,
  maxFr: string,
  hillPosScale: string,
  hillNegScale: string,
): string {
  const a = BigNumber.from(184)
  const k = BigNumber.from(16)
  const normalizedOiDeltaBN = BigNumber.from(normalizedOiDelta)
  const hillInflectionPointBN = BigNumber.from(hillInflectionPoint)
  const hillPosScaleBN = BigNumber.from(hillPosScale)
  const hillNegScaleBN = BigNumber.from(hillNegScale)
  const maxFrBN = BigNumber.from(maxFr)
  const x = a.mul(normalizedOiDeltaBN).div(PRECISION_2)
  const x2 = x.mul(x).mul(PRECISION_6) // convert to PRECISION_18
  const hill = x2.mul(PRECISION_18).div(k.mul(PRECISION_16).add(x2))

  let targetFr = normalizedOiDeltaBN.gte(0)
    ? hillPosScaleBN.mul(hill).div(PRECISION_2).add(hillInflectionPointBN)
    : hillNegScaleBN.mul(-1).mul(hill).div(PRECISION_2).add(hillInflectionPointBN)

  if (targetFr.gt(PRECISION_18)) {
    targetFr = PRECISION_18
  } else if (targetFr.lt(PRECISION_18.mul(-1))) {
    targetFr = PRECISION_18.mul(-1)
  }

  return targetFr.mul(maxFrBN).div(PRECISION_18).toString()
}

function exponentialApproximation(x: string): string {
  const approxThreshold = BigNumber.from('793231258909201900')
  const xBN = BigNumber.from(x)

  if (xBN.abs().lt(approxThreshold)) {
    const threeWithPrecision = PRECISION_18.mul(3)
    let numerator = xBN.add(threeWithPrecision)
    numerator = numerator.mul(numerator).div(PRECISION_18).add(threeWithPrecision)
    let denominator = xBN.sub(threeWithPrecision)
    denominator = denominator.mul(denominator).div(PRECISION_18).add(threeWithPrecision)

    return numerator.mul(PRECISION_18).div(denominator).toString()
  } else {
    const k = [1648721, 1284025, 1133148, 1064494, 1031743, 1015748, 1007843, 1003915, 1001955, 1000977]
    const integerPart = xBN.abs().div(PRECISION_18)
    let decimalPart = xBN.abs().sub(integerPart.mul(PRECISION_18))

    let approx = PRECISION_6

    for (let i = 0; i < k.length; i++) {
      decimalPart = decimalPart.mul(2)
      if (decimalPart.gte(PRECISION_18)) {
        approx = approx.mul(k[i]).div(PRECISION_6)
        decimalPart = decimalPart.sub(PRECISION_18)
      }
      if (decimalPart.eq(0)) {
        break
      }
    }
    return BigNumber.from(PRECISION_18)
      .mul(PRECISION_18)
      .div(BigNumber.from(2).pow(integerPart).mul(approx.div(1e3).mul(1e15)))
      .div(1e15)
      .mul(1e15)
      .toString()
  }
}

export function GetFundingRate(
  accPerOiLong: string,
  accPerOiShort: string,
  lastFundingRate: string,
  maxFundingFeePerBlock: string,
  lastUpdateBlock: string,
  latestBlock: string,
  oiLong: string,
  oiShort: string,
  oiCap: string,
  hillInflectionPoint: string,
  hillPosScale: string,
  hillNegScale: string,
  springFactor: string,
  sFactorUpScaleP: string,
  sFactorDownScaleP: string,
): { accFundingLong: string; accFundingShort: string; latestFundingRate: string; targetFr: string } {
  let accPerOiLongBN = BigNumber.from(accPerOiLong || 0)
  let accPerOiShortBN = BigNumber.from(accPerOiShort || 0)

  const lastFundingRateBN = BigNumber.from(lastFundingRate || 0)
  const lastUpdateBlockBN = BigNumber.from(lastUpdateBlock || 0)
  const latestBlockBN = BigNumber.from(latestBlock || 0)
  const oiLongBN = BigNumber.from(oiLong || 0)
  const oiShortBN = BigNumber.from(oiShort || 0)
  const oiCapBN = BigNumber.from(oiCap || 1)
  const springFactorBN = BigNumber.from(springFactor || 0)
  const sFactorUpScalePBN = BigNumber.from(sFactorUpScaleP || 0)
  const sFactorDownScalePBN = BigNumber.from(sFactorDownScaleP || 0)

  const openInterestMax = oiLongBN.gt(oiShortBN) ? oiLongBN : oiShortBN
  const oiDeltaBN = oiLongBN
    .sub(oiShortBN)
    .mul(PRECISION_6)
    .div(oiCapBN.gt(openInterestMax) ? oiCapBN : openInterestMax)

  const targetFr = BigNumber.from(
    getTargetFundingRate(oiDeltaBN.toString(), hillInflectionPoint, maxFundingFeePerBlock, hillPosScale, hillNegScale),
  )

  let sFactor = BigNumber.from(0)
  if (lastFundingRateBN.mul(targetFr).gte(0)) {
    if (targetFr.abs().gt(lastFundingRateBN)) {
      sFactor = springFactorBN
    } else {
      sFactor = sFactorDownScalePBN.mul(springFactorBN).div(100e2)
    }
  } else {
    sFactor = sFactorUpScalePBN.mul(springFactorBN).div(100e2)
  }

  const numBlocksToCharge = latestBlockBN.sub(lastUpdateBlockBN)
  const exp = exponentialApproximation(sFactor.mul(numBlocksToCharge).mul(-1).toString())

  const accFundingRate = targetFr
    .mul(numBlocksToCharge)
    .add(PRECISION_18.sub(exp).mul(lastFundingRateBN.sub(targetFr)).div(sFactor))
  const fr = targetFr.add(lastFundingRateBN.sub(targetFr).mul(exp).div(PRECISION_18))

  if (accFundingRate.gt(0)) {
    if (oiLongBN.gt(0)) {
      accPerOiLongBN = accPerOiLongBN.add(accFundingRate)
      accPerOiShortBN = accPerOiShortBN.sub(
        oiShortBN.gt(0) ? accFundingRate.mul(oiLongBN).div(oiShortBN) : BigNumber.from(0),
      )
    }
  } else {
    if (oiShortBN.gt(0)) {
      accPerOiShortBN = accPerOiShortBN.sub(accFundingRate)
      accPerOiLongBN = accPerOiLongBN.add(
        oiLongBN.gt(0) ? accFundingRate.mul(oiShortBN).div(oiLongBN) : BigNumber.from(0),
      )
    }
  }

  return {
    accFundingLong: accPerOiLongBN.toString(),
    accFundingShort: accPerOiShortBN.toString(),
    latestFundingRate: fr.toString(),
    targetFr: targetFr.toString(),
  }
}

export function GetCurrentRolloverFee(
  accRollover: string,
  lastRolloverBlock: string,
  rolloverFeePerBlock: string,
  latestBlock: string,
): string {
  const accRolloverBN = BigNumber.from(accRollover)
  const lastRolloverBlockBN = BigNumber.from(lastRolloverBlock)
  const rolloverFeePerBlockBN = BigNumber.from(rolloverFeePerBlock)
  const latestBlockBN = BigNumber.from(latestBlock)

  return accRolloverBN.add(latestBlockBN.sub(lastRolloverBlockBN).mul(rolloverFeePerBlockBN)).toString()
}

export function TopUpWithCollateral(leverage: string, collateral: string, addedcollateral: string): string {
  let newLeverage = BigNumber.from(0)
  const leverageBN = BigNumber.from(leverage)
  const collateralBN = BigNumber.from(collateral)
  const addedcollateralBN = BigNumber.from(addedcollateral)

  newLeverage = collateralBN.mul(leverageBN).div(collateralBN.add(addedcollateralBN))

  return newLeverage.toString()
}

export function TopUpWithLeverage(leverage: string, desiredLeverage: string, collateral: string): string {
  let addedC = BigNumber.from(0)
  const leverageBN = BigNumber.from(leverage)
  const collateralBN = BigNumber.from(collateral)
  const desiredLeverageBN = BigNumber.from(desiredLeverage)

  addedC = collateralBN.mul(leverageBN).div(desiredLeverageBN).sub(collateralBN)

  return addedC.toString()
}

export function RemoveCollateralWithCollateral(
  leverage: string,
  collateral: string,
  removedcollateral: string,
): string {
  let newLeverage = BigNumber.from(0)
  const leverageBN = BigNumber.from(leverage)
  const collateralBN = BigNumber.from(collateral)
  const removedcollateralBN = BigNumber.from(removedcollateral)

  newLeverage = collateralBN.mul(leverageBN).div(collateralBN.sub(removedcollateralBN))

  return newLeverage.toString()
}

export function RemoveCollateralFromLeverage(leverage: string, desiredLeverage: string, collateral: string): string {
  let addedC = BigNumber.from(0)
  const leverageBN = BigNumber.from(leverage)
  const collateralBN = BigNumber.from(collateral)
  const desiredLeverageBN = BigNumber.from(desiredLeverage)

  addedC = collateralBN.sub(collateralBN.mul(leverageBN).div(desiredLeverageBN))

  return addedC.toString()
}

export function RemoveCollateralAmountForLiquidation(
  collateral: string,
  rolloverFee: string,
  fundingFee: string,
  profit: string,
  leverage: string,
  maxLeverage: string,
): string {
  const collateralBN = BigNumber.from(collateral)
  const rolloverFeeBN = BigNumber.from(rolloverFee)
  const fundingFeeBN = BigNumber.from(fundingFee)
  const profitBN = BigNumber.from(profit)

  const totalProfit = profitBN.sub(rolloverFeeBN).sub(fundingFeeBN)

  const liquidationMargin = GetTradeLiquidationMargin(collateral, leverage, maxLeverage)
  const collateralWithLoss = totalProfit.lt(0) ? collateralBN.add(totalProfit) : collateralBN

  return collateralWithLoss.gt(liquidationMargin) ? collateralWithLoss.sub(liquidationMargin).toString() : '0'
}

export function RemoveCollateralAmountForProfitProtection(
  openPrice: string,
  currentPrice: string,
  tradeSize: string,
  leverage: string,
  highestLeverage: string,
  isLong: boolean,
): string {
  const openPriceBN = BigNumber.from(openPrice)
  const currentPriceBN = BigNumber.from(currentPrice)
  const tradeSizeBN = BigNumber.from(tradeSize)
  const leverageBN = BigNumber.from(leverage)
  const highestLeverageBN = BigNumber.from(highestLeverage)

  const priceDelta = isLong ? currentPriceBN.sub(openPriceBN) : openPriceBN.sub(currentPriceBN)

  let newLeverage = priceDelta.eq(0)
    ? BigNumber.from(0)
    : MAX_PROFIT_P.div(PRECISION_6).mul(openPriceBN).div(priceDelta)
  newLeverage = newLeverage.gt(highestLeverageBN) ? newLeverage : highestLeverageBN

  const newCollateral = tradeSizeBN.div(newLeverage).mul(PRECISION_2)
  const oldCollateral = tradeSizeBN.div(leverageBN).mul(PRECISION_2)

  return newCollateral.lt(oldCollateral) ? oldCollateral.sub(newCollateral).toString() : oldCollateral.toString()
}

export function GetSimualtedAssets(
  assets: string,
  lockDuration: string,
  rewardsPerToken: string,
  accPnlPerTokenUsed: string,
  maxDiscountP: string,
  maxDiscountThresholdP: string,
  currentMaxSupply: string,
  totalSupply: string,
  sharePrice: string,
): string {
  const assetsBN = BigNumber.from(assets)

  const simulatedAssets = assetsBN
    .mul(
      PRECISION_2.mul(100).add(
        lockDiscountP(rewardsPerToken, accPnlPerTokenUsed, lockDuration, maxDiscountP, maxDiscountThresholdP),
      ),
    )
    .div(PRECISION_2.mul(100))

  if (simulatedAssets.gt(maxDeposit(accPnlPerTokenUsed, currentMaxSupply, totalSupply, sharePrice))) {
    throw new Error('AboveMaxDeposit')
  }

  return simulatedAssets.toString()
}

export function maxMint(accPnlPerTokenUsed: string, currentMaxSupply: string, totalSupply: string): string {
  const accPnlPerTokenUsedBN = BigNumber.from(accPnlPerTokenUsed)
  const currentMaxSupplyBN = BigNumber.from(currentMaxSupply)

  return accPnlPerTokenUsedBN.gt(0)
    ? currentMaxSupplyBN.sub(currentMaxSupplyBN.lt(totalSupply) ? currentMaxSupplyBN : totalSupply).toString()
    : MAX_UINT256.toString()
}

export function maxDeposit(
  accPnlPerTokenUsed: string,
  currentMaxSupply: string,
  totalSupply: string,
  sharePrice: string,
): string {
  return _convertToAssets(maxMint(accPnlPerTokenUsed, currentMaxSupply, totalSupply), sharePrice)
}

export function maxAccPnlPerToken(rewardsPerToken: string): string {
  return BigNumber.from(rewardsPerToken).add(PRECISION_18).toString()
}

export function lockDiscountP(
  rewardsPerToken: string,
  accPnlPerTokenUsed: string,
  lockDuration: string,
  maxDiscountP: string,
  maxDiscountThresholdP: string,
): string {
  const collateralizationPBN = BigNumber.from(collateralizationP(rewardsPerToken, accPnlPerTokenUsed))
  const maxDiscountThresholdPBN = BigNumber.from(maxDiscountThresholdP)
  const maxDiscountPBN = BigNumber.from(maxDiscountP)

  const discount = collateralizationPBN.lte(PRECISION_2.mul(100))
    ? maxDiscountPBN
    : collateralizationPBN.lte(maxDiscountThresholdPBN)
      ? maxDiscountPBN
          .mul(maxDiscountThresholdPBN.sub(collateralizationPBN))
          .div(maxDiscountThresholdPBN.sub(PRECISION_2.mul(100)))
      : BigNumber.from(0)

  return discount.mul(lockDuration).div(MAX_LOCK_DURATION).toString()
}

export function collateralizationP(rewardsPerToken: string, accPnlPerTokenUsed: string): string {
  const _maxAccPnlPerToken = BigNumber.from(maxAccPnlPerToken(rewardsPerToken))
  const accPnlPerTokenUsedBN = BigNumber.from(accPnlPerTokenUsed)

  const accPnlAdjusted = accPnlPerTokenUsedBN.gt(0)
    ? _maxAccPnlPerToken.sub(accPnlPerTokenUsedBN)
    : _maxAccPnlPerToken.add(accPnlPerTokenUsedBN.abs())

  return accPnlAdjusted.mul(100).mul(PRECISION_2).div(_maxAccPnlPerToken).toString()
}

export function previewDeposit(assets: string, sharePrice: string): string {
  return _convertToShares(assets, sharePrice)
}

function _convertToShares(assets: string, sharePrice: string): string {
  const assetsBN = BigNumber.from(assets)

  return assetsBN.mul(PRECISION_18).div(sharePrice).toString()
}

function _convertToAssets(shares: string, sharePrice: string): string {
  const sharesBN = BigNumber.from(shares)
  const sharePriceBN = BigNumber.from(sharePrice)

  if (sharesBN.eq(MAX_UINT256) && sharePriceBN.gte(PRECISION_18)) {
    return shares
  }

  return sharesBN.mul(sharePriceBN).div(PRECISION_18).toString()
}

function _getOpeningTakerAndMakerAmounts(
  makerMaxLeverage: BigNumber,
  tradeSize: BigNumber,
  leverage: BigNumber,
  oiDelta: BigNumber,
): { makerAmount: BigNumber; takerAmount: BigNumber } {
  let makerAmount = BigNumber.from(0)
  let takerAmount = BigNumber.from(0)

  if (oiDelta.mul(tradeSize).lt(0) && leverage.lte(makerMaxLeverage)) {
    if (oiDelta.mul(oiDelta.add(tradeSize)).gte(0)) {
      makerAmount = tradeSize.abs()
    } else {
      makerAmount = oiDelta.abs()
      takerAmount = oiDelta.add(tradeSize).abs()
    }
  } else {
    takerAmount = tradeSize.abs()
  }

  return { makerAmount, takerAmount }
}

function _getBaseOpeningFee(
  makerMaxLeverage: BigNumber,
  tradeSize: BigNumber,
  leverage: BigNumber,
  oiDelta: BigNumber,
  makerFeeP: BigNumber,
  takerFeeP: BigNumber,
): { baseFee: BigNumber; takerAmount: BigNumber; makerAmount: BigNumber } {
  const { makerAmount, takerAmount } = _getOpeningTakerAndMakerAmounts(makerMaxLeverage, tradeSize, leverage, oiDelta)
  const baseFee = makerFeeP.mul(makerAmount).add(takerFeeP.mul(takerAmount)).div(PRECISION_6).div(PRECISION_2)

  return { baseFee: baseFee, takerAmount: takerAmount, makerAmount: makerAmount }
}

export function IsDayTradeClosed(leverage: string, overnightMaxLeverage: string, isDayTradingClosed: boolean): boolean {
  const leverageBN = BigNumber.from(leverage)
  const overnightMaxLeverageBN = BigNumber.from(overnightMaxLeverage)

  if (isDayTradingClosed) {
    if (overnightMaxLeverageBN.gt(0) && leverageBN.gt(overnightMaxLeverageBN)) {
      return true
    }
  }
  return false
}

export function getPriceImpactParsed(
    marketPrice: { mid: number; bid: number; ask: number },
    isBuy: boolean,
    isOpen: boolean = false
) {
    if (!marketPrice.mid) {
        return 0
    }
    const priceAfterImpact = Number(GetPriceImpact(
        parseUnits(marketPrice.mid.toString(), 18).toString(),
        parseUnits(marketPrice.bid.toString(), 18).toString(),
        parseUnits(marketPrice.ask.toString(), 18).toString(),
        isOpen,
        isBuy
    ).priceAfterImpact) / 10 ** 18
    return priceAfterImpact;
}
