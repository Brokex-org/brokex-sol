import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Connection } from '@solana/web3.js';
import {
  getClusterFromEndpoint,
  getRpcEndpoint,
  SOLANA_PROGRAM_IDS,
  SOLANA_USDC_MINT,
  type SolanaCluster,
} from '../utils/solana/programConfig';

// ── Solana cluster identifiers ─────────────────────────────────────────────────
const CLUSTER_ENDPOINTS: Record<SolanaCluster, string> = {
  devnet: 'https://api.devnet.solana.com',
  testnet: 'https://api.testnet.solana.com',
  mainnet: 'https://api.mainnet-beta.solana.com',
};

interface NetworkContextValue {
  cluster: SolanaCluster;
  isTestnet: boolean;
  endpoint: string;
  chainId: number;
  coreProgramId: string;
  vaultProgramId: string;
  usdcMint: string;
}

const NetworkContext = createContext<NetworkContextValue>({
  cluster: 'devnet',
  isTestnet: true,
  endpoint: CLUSTER_ENDPOINTS.devnet,
  chainId: 103,
  coreProgramId: SOLANA_PROGRAM_IDS.core.toBase58(),
  vaultProgramId: SOLANA_PROGRAM_IDS.vault.toBase58(),
  usdcMint: SOLANA_USDC_MINT.toBase58(),
});

export const NetworkProvider = ({ children }: { children: ReactNode }) => {
  const [cluster, setCluster] = useState<SolanaCluster>('devnet');
  const [endpoint, setEndpoint] = useState<string>(getRpcEndpoint());

  useEffect(() => {
    const configuredEndpoint = getRpcEndpoint();
    setEndpoint(configuredEndpoint);
    setCluster(getClusterFromEndpoint(configuredEndpoint));
  }, []);

  useEffect(() => {
    const detect = async () => {
      try {
        const connection = new Connection(endpoint, 'confirmed');
        const genesisHash = await connection.getGenesisHash();

        // Identify cluster by genesis hash
        if (genesisHash === '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d') {
          setCluster('mainnet');
        } else if (genesisHash === 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG') {
          // Devnet genesis hash
          setCluster('devnet');
        } else if (genesisHash === '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY') {
          // Testnet genesis hash
          setCluster('testnet');
        } else {
          // Keep the endpoint-derived cluster for unknown/custom RPCs.
          setCluster(getClusterFromEndpoint(endpoint));
        }
      } catch {}
    };
    detect();
  }, [endpoint]);

  const isTestnet = cluster === 'devnet' || cluster === 'testnet';
  const chainId = cluster === 'mainnet' ? 101 : cluster === 'testnet' ? 102 : 103;

  return (
    <NetworkContext.Provider
      value={{
        cluster,
        isTestnet,
        endpoint,
        chainId,
        coreProgramId: SOLANA_PROGRAM_IDS.core.toBase58(),
        vaultProgramId: SOLANA_PROGRAM_IDS.vault.toBase58(),
        usdcMint: SOLANA_USDC_MINT.toBase58(),
      }}
    >
      {children}
    </NetworkContext.Provider>
  );
};

export const useNetwork = () => useContext(NetworkContext);