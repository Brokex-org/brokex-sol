import { useState, useCallback, useEffect } from 'react';
import { useAccount, useSignTypedData } from 'wagmi';
import * as ed25519 from '@noble/ed25519';
import bs58 from 'bs58';

export const ORDERLY_API_URL = 'https://testnet-api.orderly.org';
export const BROKER_ID = 'woofi_pro'; 

// ⚠️ ON FORCE LE CHAIN ID D'ARBITRUM SEPOLIA POUR LE TEST
const ORDERLY_CHAIN_ID = 421614; 

export type AuthStatus = 'disconnected' | 'checking' | 'unregistered' | 'registered' | 'key_ready' | 'error';

export function useOrderlyAuth() {
  // Plus besoin du chainId dynamique de Wagmi, on va utiliser la constante !
  const { address, isConnected } = useAccount(); 
  const { signTypedDataAsync } = useSignTypedData();

  const [status, setStatus] = useState<AuthStatus>('disconnected');
  const [logs, setLogs] = useState<string>('En attente de connexion au wallet...');
  const [isLoading, setIsLoading] = useState(false);
  const [accountId, setAccountId] = useState<string | null>(null);

  // 1. VÉRIFIER LE COMPTE
  const checkAccount = useCallback(async () => {
    if (!address) return;
    
    setStatus('checking');
    setLogs('Recherche de ton compte Orderly...');
    setIsLoading(true);

    try {
      const res = await fetch(`${ORDERLY_API_URL}/v1/get_account?address=${address}&broker_id=${BROKER_ID}`);
      const data = await res.json();

      if (data.success && data.data.account_id) {
        setAccountId(data.data.account_id);
        const localKey = localStorage.getItem('orderly_private_key');
        
        if (localKey) {
          setStatus('key_ready');
          setLogs(`✅ Compte et Clé prêts ! (ID: ${data.data.account_id})`);
        } else {
          setStatus('registered');
          setLogs(`✅ Compte trouvé, mais la clé locale est manquante.`);
        }
      } else {
        setStatus('unregistered');
        setLogs('❌ Aucun compte trouvé. Création requise.');
      }
    } catch (error) {
      setStatus('error');
      setLogs('Erreur réseau lors de la vérification.');
    } finally {
      setIsLoading(false);
    }
  }, [address]);

  useEffect(() => {
    if (isConnected && address) {
      checkAccount();
    } else {
      setStatus('disconnected');
      setLogs('En attente de connexion au wallet...');
      setAccountId(null);
    }
  }, [isConnected, address, checkAccount]);

  // 2. CRÉER LE COMPTE (EIP-712 Forcé sur Arbitrum)
  const registerAccount = useCallback(async () => {
    if (!address) return;
    setIsLoading(true);
    setLogs('Demande de signature MetaMask (Attention à l\'alerte rouge !)...');

    try {
      const nonceRes = await fetch(`${ORDERLY_API_URL}/v1/registration_nonce`);
      const nonceData = await nonceRes.json();
      const nonce = nonceData.data.registration_nonce;

      const timestamp = Date.now();
      
      const domain = {
        name: 'Orderly',
        version: '1',
        chainId: ORDERLY_CHAIN_ID, // ⚠️ FORCÉ ICI
        verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC' as const,
      };

      const types = {
        Registration: [
          { name: 'brokerId', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'timestamp', type: 'uint64' },
          { name: 'registrationNonce', type: 'uint256' },
        ],
      };

      const message = { 
        brokerId: BROKER_ID, 
        chainId: ORDERLY_CHAIN_ID, // ⚠️ ET FORCÉ ICI
        timestamp, 
        registrationNonce: nonce 
      };

      // 🚨 C'EST LORS DE CET APPEL QUE METAMASK VA AFFICHER LE BANDEAU ROUGE
      const signature = await signTypedDataAsync({ domain, types, primaryType: 'Registration', message });

      const registerRes = await fetch(`${ORDERLY_API_URL}/v1/register_account`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, signature, userAddress: address }),
      });

      const registerData = await registerRes.json();
      
      if (registerData.success) {
        setAccountId(registerData.data.account_id);
        setStatus('registered');
        setLogs(`✅ Compte créé sur Arbitrum ! Étape suivante : La clé de trading.`);
      } else {
        throw new Error(registerData.message);
      }
    } catch (error: any) {
      setLogs(`❌ Erreur: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [address, signTypedDataAsync]);

  // 3. CRÉER LA CLÉ ED25519 (EIP-712 Forcé sur Arbitrum)
  const createKey = useCallback(async () => {
    if (!address) return;
    setIsLoading(true);
    setLogs('Génération de la clé cryptographique...');

    try {
      const privateKey = ed25519.utils.randomPrivateKey();
      const publicKey = await ed25519.getPublicKeyAsync(privateKey);
      const orderlyKey = `ed25519:${bs58.encode(publicKey)}`;

      setLogs('Demande de signature MetaMask pour lier la clé...');

      const timestamp = Date.now();
      const expiration = timestamp + 1_000 * 60 * 60 * 24 * 365;

      const domain = {
        name: 'Orderly',
        version: '1',
        chainId: ORDERLY_CHAIN_ID, // ⚠️ FORCÉ ICI
        verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC' as const,
      };

      const types = {
        AddOrderlyKey: [
          { name: 'brokerId', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'orderlyKey', type: 'string' },
          { name: 'scope', type: 'string' },
          { name: 'timestamp', type: 'uint64' },
          { name: 'expiration', type: 'uint64' },
        ],
      };

      const message = { 
        brokerId: BROKER_ID, 
        chainId: ORDERLY_CHAIN_ID, // ⚠️ ET FORCÉ ICI
        orderlyKey, 
        scope: 'read,trading', 
        timestamp, 
        expiration 
      };

      // 🚨 DEUXIÈME BANDEAU ROUGE
      const signature = await signTypedDataAsync({ domain, types, primaryType: 'AddOrderlyKey', message });

      const keyRes = await fetch(`${ORDERLY_API_URL}/v1/orderly_key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, signature, userAddress: address }),
      });

      const keyData = await keyRes.json();

      if (keyData.success) {
        localStorage.setItem('orderly_private_key', bs58.encode(privateKey));
        setStatus('key_ready');
        setLogs(`✅ Trading activé ! Clé enregistrée avec succès.`);
      } else {
        throw new Error(keyData.message);
      }
    } catch (error: any) {
      setLogs(`❌ Erreur: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [address, signTypedDataAsync]);

  return {
    status,
    logs,
    isLoading,
    accountId,
    setStatus,
    setLogs,
    setIsLoading,
    setAccountId,
    checkAccount,
    registerAccount,
    createKey
  };
}