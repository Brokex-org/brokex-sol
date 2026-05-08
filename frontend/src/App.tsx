// React is used implicitly via JSX transform
import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { OrderlyConfigProvider } from '@orderly.network/hooks';
import { DynamicContextProvider } from '@dynamic-labs/sdk-react-core';
import { EthereumWalletConnectors } from '@dynamic-labs/ethereum';
import { Layout } from './components/Layout';
import { MobileLayout } from './components/MobileLayout';
import { Trade } from './pages/Trade';
import { Market } from './pages/Market';
import { Portfolio } from './pages/Portfolio';
import { MobileTrade } from './pages/mobile/MobileTrade';
import { MobileMarket } from './pages/mobile/MobileMarket';
import { MobilePortfolio } from './pages/mobile/MobilePortfolio';
import { ThemeProvider } from './ThemeContext';
import { PriceProvider } from './contexts/PriceContext';
import { ToastProvider } from './contexts/ToastContext';
import { NetworkProvider } from './contexts/NetworkContext';

// ── Hook: detect mobile viewport ──────────────────────────────────────────────
export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isMobile;
}

// ── Responsive Layout wrapper ─────────────────────────────────────────────────
function ResponsiveRoot() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileLayout /> : <Layout />;
}

// ── Responsive page wrappers ─────────────────────────────────────────────────
function ResponsiveTrade() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileTrade /> : <Trade />;
}
function ResponsiveMarket() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileMarket /> : <Market />;
}
function ResponsivePortfolio() {
  const isMobile = useIsMobile();
  return isMobile ? <MobilePortfolio /> : <Portfolio />;
}

export default function App() {
  return (
    <ThemeProvider>
      <DynamicContextProvider
        settings={{
          environmentId: '8ba6b515-935b-4508-94e0-c0f7fb7f91b5',
          walletConnectors: [EthereumWalletConnectors],
          overrides: {
            evmNetworks: [
              {
                blockExplorerUrls: ['https://arbiscan.io'],
                chainId: 42161,
                name: 'Arbitrum One',
                iconUrls: ['https://app.dynamic.xyz/assets/networks/arbitrum.svg'],
                nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
                networkId: 42161,
                rpcUrls: ['https://arb1.arbitrum.io/rpc'],
                vanityName: 'Arbitrum',
              },
              {
                blockExplorerUrls: ['https://sepolia.arbiscan.io'],
                chainId: 421614,
                name: 'Arbitrum Sepolia',
                iconUrls: ['https://app.dynamic.xyz/assets/networks/arbitrum.svg'],
                nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
                networkId: 421614,
                rpcUrls: ['https://sepolia-rollup.arbitrum.io/rpc'],
                vanityName: 'Arbitrum Sepolia',
              },
              {
                blockExplorerUrls: ['https://pharosscan.xyz'],
                chainId: 1672,
                name: 'Pharos Mainnet',
                iconUrls: [],
                nativeCurrency: { decimals: 18, name: 'Pharos', symbol: 'PHRS' },
                networkId: 1672,
                rpcUrls: ['https://rpc.pharos.xyz'],
                vanityName: 'Pharos Mainnet',
              },
              {
                blockExplorerUrls: ['https://atlantic.pharosscan.xyz'],
                chainId: 688689,
                name: 'Pharos Testnet',
                iconUrls: [],
                nativeCurrency: { decimals: 18, name: 'Pharos', symbol: 'PHRS' },
                networkId: 688689,
                rpcUrls: ['https://atlantic.dplabs-internal.com'],
                vanityName: 'Pharos Testnet',
              },
            ],
          },
        }}
        theme="dark"
      >
        <OrderlyConfigProvider brokerId="woofi_pro" networkId="mainnet">
          <NetworkProvider>
            <PriceProvider>
              <ToastProvider>
              <BrowserRouter>
                <Routes>
                  {/* ── Redirect old /m/* paths ──────────────── */}
                  <Route path="/m" element={<Navigate to="/" replace />} />
                  <Route path="/m/*" element={<Navigate to="/" replace />} />

                  {/* ── Single responsive route tree ─────────── */}
                  <Route path="/" element={<ResponsiveRoot />}>
                    <Route index element={<ResponsiveTrade />} />
                    <Route path=":symbol" element={<ResponsiveTrade />} />
                    <Route path="market" element={<ResponsiveMarket />} />
                    <Route path="portfolio" element={<ResponsivePortfolio />} />
                  </Route>
                </Routes>
              </BrowserRouter>
              </ToastProvider>
            </PriceProvider>
          </NetworkProvider>
        </OrderlyConfigProvider>
      </DynamicContextProvider>
    </ThemeProvider>
  );
}