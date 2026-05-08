import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useDynamicContext } from '@dynamic-labs/sdk-react-core';
import { useTheme } from '../ThemeContext';

const NETWORKS = [
  { name: 'Arbitrum', chainId: 42161 },
  { name: 'Arbitrum Sepolia', chainId: 421614, testnet: true },
  { name: 'Pharos Mainnet', chainId: 1672 },
  { name: 'Pharos Testnet', chainId: 688689, testnet: true },
];

export const NetworkSelector = () => {
  const { themeBorder, themeText, themeTextMuted, themeControlBg, themeBg } = useTheme();
  const { primaryWallet } = useDynamicContext();
  
  const [isNetworkMenuOpen, setIsNetworkMenuOpen] = useState(false);
  const [currentChainId, setCurrentChainId] = useState<number>(42161);
  const networkMenuRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, right: 0 });

  useEffect(() => {
    const detectChain = async () => {
      try {
        const eth = (window as any).ethereum;
        if (!eth) return;
        const chainHex: string = await eth.request({ method: 'eth_chainId' });
        setCurrentChainId(parseInt(chainHex, 16));
      } catch {}
    };
    detectChain();

    const eth = (window as any).ethereum;
    if (eth) {
      const handleChainChanged = (chainHex: string) => setCurrentChainId(parseInt(chainHex, 16));
      eth.on('chainChanged', handleChainChanged);
      return () => eth.removeListener?.('chainChanged', handleChainChanged);
    }
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (networkMenuRef.current && !networkMenuRef.current.contains(event.target as Node)) {
        setIsNetworkMenuOpen(false);
      }
    };
    if (isNetworkMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isNetworkMenuOpen]);

  const handleToggleNetworkMenu = useCallback(() => {
    if (!isNetworkMenuOpen && networkMenuRef.current) {
      const rect = networkMenuRef.current.getBoundingClientRect();
      setDropdownPos({
        top: rect.bottom + window.scrollY + 4,
        right: window.innerWidth - rect.right,
      });
    }
    setIsNetworkMenuOpen(prev => !prev);
  }, [isNetworkMenuOpen]);

  const handleNetworkSwitch = useCallback(async (network: { name: string; chainId: number }) => {
    setIsNetworkMenuOpen(false);
    try {
      if (primaryWallet) {
        const provider = await (primaryWallet as any).connector?.getWalletClient?.() ||
          (primaryWallet as any).connector?.ethers?.provider?.provider ||
          (window as any).ethereum;
        const target = provider || (window as any).ethereum;
        if (target) {
          try {
            await target.request({
              method: 'wallet_switchEthereumChain',
              params: [{ chainId: `0x${network.chainId.toString(16)}` }],
            });
          } catch (switchError: any) {
            if (switchError.code === 4902) {
              const pharosConfig = {
                chainId: `0x${network.chainId.toString(16)}`,
                chainName: 'Pharos Mainnet',
                nativeCurrency: { name: 'Pharos', symbol: 'PHRS', decimals: 18 },
                rpcUrls: ['https://rpc.pharos.sh'],
                blockExplorerUrls: ['https://explorer.pharos.sh'],
              };
              await target.request({ method: 'wallet_addEthereumChain', params: [pharosConfig] });
            } else {
              throw switchError;
            }
          }
        }
      } else {
         setCurrentChainId(network.chainId);
      }
    } catch (err) {
      console.error('Switch chain failed:', err);
    }
  }, [primaryWallet]);

  const selectedNetworkObj = NETWORKS.find(n => n.chainId === currentChainId);
  const selectedNetwork = selectedNetworkObj ? selectedNetworkObj.name : 'Unknown Network';

  return (
    <div ref={networkMenuRef} style={{ position: 'relative' }}>
      <div 
        onClick={handleToggleNetworkMenu}
        style={{ 
          display: 'flex', alignItems: 'center', gap: '6px', 
          padding: '4px 8px', borderRadius: '6px', 
          backgroundColor: themeControlBg, border: `1px solid ${themeBorder}`,
          cursor: 'pointer',
          transition: 'background-color 0.2s'
        }}>
        {selectedNetwork === 'Arbitrum' ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M11.9999 19.3496L3.9248 14.5126V4.83838L11.9999 0V19.3496Z" fill="#28A0F0"/>
            <path d="M12.0001 19.3496L20.0752 14.5126V4.83838L12.0001 0V19.3496Z" fill="#28A0F0" fillOpacity="0.8"/>
            <path d="M11.9999 19.3496L3.9248 14.5126L11.9999 24V19.3496Z" fill="#28A0F0" fillOpacity="0.6"/>
            <path d="M12.0001 19.3496L20.0752 14.5126L12.0001 24V19.3496Z" fill="#28A0F0" fillOpacity="0.4"/>
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="10" fill="#FACC15"/>
            <path d="M12 6v12M6 12h12" stroke="#1F2937" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        )}
        <span style={{ fontSize: '0.65rem', color: themeText, fontWeight: 500 }}>{selectedNetwork}</span>
        <span style={{ fontSize: '0.5rem', color: themeTextMuted }}>▼</span>
      </div>

      {isNetworkMenuOpen && (
        <div style={{
          position: 'fixed',
          top: `${dropdownPos.top}px`,
          right: `${dropdownPos.right}px`,
          width: '160px',
          backgroundColor: themeBg,
          border: `1px solid ${themeBorder}`,
          borderRadius: '8px',
          padding: '4px',
          zIndex: 9999,
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)'
        }}>
          {NETWORKS.map((network) => (
            <div
              key={network.name}
              onClick={() => handleNetworkSwitch(network)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px',
                borderRadius: '4px',
                cursor: 'pointer',
                backgroundColor: selectedNetwork === network.name ? themeControlBg : 'transparent'
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = themeControlBg}
              onMouseLeave={(e) => {
                if (selectedNetwork !== network.name) e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              {network.name === 'Arbitrum' ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M11.9999 19.3496L3.9248 14.5126V4.83838L11.9999 0V19.3496Z" fill="#28A0F0"/>
                  <path d="M12.0001 19.3496L20.0752 14.5126V4.83838L12.0001 0V19.3496Z" fill="#28A0F0" fillOpacity="0.8"/>
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="12" cy="12" r="10" fill="#FACC15"/>
                </svg>
              )}
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: '0.65rem', color: themeText, fontWeight: 500 }}>{network.name}</span>
                <span style={{ fontSize: '0.5rem', color: themeTextMuted }}>Chain {network.chainId}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};