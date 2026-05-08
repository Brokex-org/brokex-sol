import { arbitrum, arbitrumSepolia, type Chain } from 'viem/chains';

// ─── Pharos chains (not in viem) ─────────────────────────────────────────────
export const pharosMainnet: Chain = {
  id: 1672,
  name: 'Pharos Mainnet',
  nativeCurrency: { name: 'Pharos', symbol: 'PHRS', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.pharos.xyz'] } },
  blockExplorers: { default: { name: 'PharosScan', url: 'https://pharosscan.xyz' } },
};

export const pharosTestnet: Chain = {
  id: 688689,
  name: 'Pharos Testnet',
  nativeCurrency: { name: 'Pharos', symbol: 'PHRS', decimals: 18 },
  rpcUrls: { default: { http: ['https://atlantic.dplabs-internal.com'] } },
  blockExplorers: { default: { name: 'PharosScan Atlantic', url: 'https://atlantic.pharosscan.xyz' } },
};

// ─── Per-chain contract configuration ────────────────────────────────────────
interface ChainConfig {
  chain: Chain;
  tradingAddress: `0x${string}` | null;
  tradingStorageAddress: `0x${string}` | null;
  usdcAddress: `0x${string}` | null;
}

export const CHAIN_CONFIGS: Record<number, ChainConfig> = {
  // Arbitrum Sepolia (testnet — contrats Ostium de test)
  421614: {
    chain: arbitrumSepolia,
    tradingAddress: '0x2A9B9c988393f46a2537B0ff11E98c2C15a95afe',
    tradingStorageAddress: '0x0b9F5243B29938668c9Cfbd7557A389EC7Ef88b8',
    usdcAddress: '0xe73B11Fb1e3eeEe8AF2a23079A4410Fe1B370548',
  },
  // Arbitrum One (mainnet)
  42161: {
    chain: arbitrum,
    tradingAddress: '0x6D0bA1f9996DBD8885827e1b2e8f6593e7702411',
    tradingStorageAddress: '0xcCd5891083A8acD2074690F65d3024E7D13d66E7',
    usdcAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  },
  // Pharos Mainnet
  1672: {
    chain: pharosMainnet,
    tradingAddress: '0x6D0bA1f9996DBD8885827e1b2e8f6593e7702411',
    tradingStorageAddress: '0xcCd5891083A8acD2074690F65d3024E7D13d66E7',
    usdcAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  },
  // Pharos Testnet
  688689: {
    chain: pharosTestnet,
    tradingAddress: '0x2A9B9c988393f46a2537B0ff11E98c2C15a95afe',
    tradingStorageAddress: '0x0b9F5243B29938668c9Cfbd7557A389EC7Ef88b8',
    usdcAddress: '0xe73B11Fb1e3eeEe8AF2a23079A4410Fe1B370548',
  },
};

export const getChainConfig = (chainId: number): ChainConfig | null =>
  CHAIN_CONFIGS[chainId] ?? null;

// ─── Legacy (Sepolia) — gardés pour compatibilité ─────────────────────────────
export const OSTIUM_TRADING_ADDRESS = CHAIN_CONFIGS[421614].tradingAddress!;
export const TRADING_STORAGE_ADDRESS = CHAIN_CONFIGS[421614].tradingStorageAddress!;
export const USDC_ADDRESS = CHAIN_CONFIGS[421614].usdcAddress!;
export const BUILDER_ADDRESS = '0x22249D0e6c013aa6d7E183b56e9f31835c763Ce6';


export const ERC20_ABI = [
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    name: 'allowance',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'approve',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

export const OSTIUM_ABI = [
  {
    inputs: [
      {
        components: [
          { name: 'collateral', type: 'uint256' },
          { name: 'openPrice', type: 'uint192' },
          { name: 'tp', type: 'uint192' },
          { name: 'sl', type: 'uint192' },
          { name: 'trader', type: 'address' },
          { name: 'leverage', type: 'uint32' },
          { name: 'pairIndex', type: 'uint16' },
          { name: 'index', type: 'uint8' },
          { name: 'buy', type: 'bool' }
        ],
        name: 'trade',
        type: 'tuple'
      },
      {
        components: [
          { name: 'builder', type: 'address' },
          { name: 'builderFee', type: 'uint32' }
        ],
        name: 'builderFee',
        type: 'tuple'
      },
      { name: 'orderType', type: 'uint8' },
      { name: 'slippage', type: 'uint256' }
    ],
    name: 'openTrade',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [
      { name: 'pairIndex', type: 'uint16' },
      { name: 'index', type: 'uint8' },
      { name: 'closePercentage', type: 'uint16' },
      { name: 'marketPrice', type: 'uint192' },
      { name: 'slippageP', type: 'uint32' }
    ],
    name: 'closeTradeMarket',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [
      { name: 'pairIndex', type: 'uint16' },
      { name: 'index', type: 'uint8' },
      { name: 'topUpAmount', type: 'uint256' }
    ],
    name: 'topUpCollateral',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [
      { name: 'pairIndex', type: 'uint16' },
      { name: 'index', type: 'uint8' },
      { name: 'removeAmount', type: 'uint256' }
    ],
    name: 'removeCollateral',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [
      { name: 'pairIndex', type: 'uint16' },
      { name: 'index', type: 'uint8' },
      { name: 'newTp', type: 'uint192' }
    ],
    name: 'updateTp',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [
      { name: 'pairIndex', type: 'uint16' },
      { name: 'index', type: 'uint8' },
      { name: 'newSl', type: 'uint192' }
    ],
    name: 'updateSl',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [
      { name: 'pairIndex', type: 'uint16' },
      { name: 'index', type: 'uint8' }
    ],
    name: 'cancelOpenLimitOrder',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [
      { name: 'pairIndex', type: 'uint16' },
      { name: 'index', type: 'uint8' },
      { name: 'price', type: 'uint192' },
      { name: 'tp', type: 'uint192' },
      { name: 'sl', type: 'uint192' }
    ],
    name: 'updateOpenLimitOrder',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  }
] as const;
