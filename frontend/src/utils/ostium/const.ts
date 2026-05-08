import { BigNumber } from "@ethersproject/bignumber"

export const SUBGRAPH_URL = 'https://subgraph.satsuma-prod.com/391a61815d32/ostium/ost-prod/api'

export const PRECISION_2 = BigNumber.from('100')
export const PRECISION_6 = BigNumber.from('1000000')
export const PRECISION_12 = BigNumber.from('1000000000000')
export const PRECISION_16 = BigNumber.from('10000000000000000')
export const PRECISION_18 = BigNumber.from('1000000000000000000')
export const MAX_UINT256 = BigNumber.from('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')

export const LIQ_MARGIN_P = BigNumber.from(25) // 25% (of collateral)
export const MAX_PROFIT_P = BigNumber.from(900).mul(PRECISION_6) //900% PnL (10x)
export const MIN_LOSS_P = BigNumber.from(-100).mul(PRECISION_6) //-100% PnL (10x)
export const MAX_PRICE_IMPACT_P = BigNumber.from('100')
export const MAX_LOCK_DURATION = BigNumber.from('31536000') // 365 * 24 * 60 * 60 (365 days)
