import { useState, useCallback, useEffect } from 'react';
import * as ed25519 from '@noble/ed25519';
import bs58 from 'bs58';
import { useAccount } from 'wagmi';

const ORDERLY_API_URL = 'https://testnet-api.orderly.org';

// Helper pour encoder en Base64 dans le navigateur
function uint8ArrayToBase64(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

// Fonction utilitaire pour appeler les API privées d'Orderly
export async function orderlyPrivateFetch(path: string, method: string = 'GET', body?: any, accountId?: string) {
  const privateKeyBs58 = localStorage.getItem('orderly_private_key');
  if (!privateKeyBs58 || !accountId) throw new Error("Clé privée ou Account ID manquant.");

  const privateKey = bs58.decode(privateKeyBs58);
  const publicKey = await ed25519.getPublicKeyAsync(privateKey);
  const orderlyKey = `ed25519:${bs58.encode(publicKey)}`;

  const timestamp = Date.now().toString();
  const bodyStr = body ? JSON.stringify(body) : '';
  
  // Message à signer pour Orderly (règle stricte : timestamp + method + path + body)
  const message = `${timestamp}${method}${path}${bodyStr}`;
  const messageBytes = new TextEncoder().encode(message);
  
  // Signature Ed25519
  const signatureBytes = await ed25519.signAsync(messageBytes, privateKey);
  const signatureBase64 = uint8ArrayToBase64(signatureBytes);

  return fetch(`${ORDERLY_API_URL}${path}`, {
    method,
    headers: {
      'Content-Type': body ? 'application/json' : 'application/x-www-form-urlencoded',
      'orderly-timestamp': timestamp,
      'orderly-account-id': accountId,
      'orderly-key': orderlyKey,
      'orderly-signature': signatureBase64,
    },
    body: body ? bodyStr : undefined,
  });
}

// LE HOOK PRINCIPAL
export function useOrderlyBalance(accountId: string | null) {
  const { isConnected } = useAccount();
  const [usdcBalance, setUsdcBalance] = useState<string>('0.00');
  const [isLoading, setIsLoading] = useState(false);

  const fetchBalance = useCallback(async () => {
    if (!accountId || !isConnected) return;
    setIsLoading(true);
    
    try {
      // API d'Orderly pour voir les avoirs
      const res = await orderlyPrivateFetch('/v1/client/holding', 'GET', null, accountId);
      const data = await res.json();
      
      if (data.success && data.data.holding) {
        // On cherche le solde de l'USDC
        const usdcHolding = data.data.holding.find((h: any) => h.token === 'USDC');
        if (usdcHolding) {
          setUsdcBalance(usdcHolding.holding.toFixed(2));
        } else {
          setUsdcBalance('0.00');
        }
      }
    } catch (error) {
      console.error("Erreur récupération solde:", error);
    } finally {
      setIsLoading(false);
    }
  }, [accountId, isConnected]);

  useEffect(() => {
    fetchBalance();
  }, [fetchBalance]);

  return { usdcBalance, fetchBalance, isLoading };
}