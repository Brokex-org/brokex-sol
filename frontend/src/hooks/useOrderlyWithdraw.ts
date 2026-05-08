import { useState, useCallback } from 'react';
import { useAccount, useSignTypedData } from 'wagmi';
import { parseUnits } from 'viem';
import { orderlyPrivateFetch } from './useOrderlyBalance'; // On réutilise notre helper magique

// ⚠️ Assure-toi d'utiliser le même Broker ID que pour ton dépôt
const BROKER_ID = 'woofi_pro'; // ou 'kodiak' si Orderly l'a whitelisté !
const VERIFYING_CONTRACT = '0x1826B75e2ef249173FC735149AE4B8e9ea10abff' as const; // Ledger Contract Orderly

export function useOrderlyWithdraw(accountId: string | null) {
  const { address, chainId } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [logs, setLogs] = useState<string>('');

  const withdraw = useCallback(async (amountStr: string) => {
    if (!address || !chainId || !accountId) {
      setLogs("❌ Wallet ou Account ID manquant.");
      return;
    }

    try {
      setIsWithdrawing(true);
      const amountParsed = parseUnits(amountStr, 6).toString(); // USDC en décimales (ex: 1000000 pour 1 USDC)

      // --- ETAPE 1 : RÉCUPÉRER LE NONCE ---
      setLogs("1/3 Récupération du jeton de retrait (Nonce)...");
      const nonceRes = await orderlyPrivateFetch('/v1/withdraw_nonce', 'GET', null, accountId);
      const nonceData = await nonceRes.json();
      
      if (!nonceData.success) throw new Error("Impossible de récupérer le Nonce");
      const nonce = nonceData.data.withdraw_nonce;

      // --- ETAPE 2 : SIGNER LE RETRAIT AVEC METAMASK (EIP-712) ---
      setLogs("2/3 Autorisation du retrait dans MetaMask...");
      const timestamp = Date.now();
      
      const domain = {
        name: 'Orderly',
        version: '1',
        chainId,
        verifyingContract: VERIFYING_CONTRACT,
      };

      const types = {
        Withdraw: [
          { name: 'brokerId', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'receiver', type: 'address' },
          { name: 'token', type: 'string' },
          { name: 'amount', type: 'uint256' },
          { name: 'withdrawNonce', type: 'uint64' },
          { name: 'timestamp', type: 'uint64' },
        ],
      };

      const message = {
        brokerId: BROKER_ID,
        chainId,
        receiver: address,
        token: 'USDC',
        amount: BigInt(amountParsed),
        withdrawNonce: BigInt(nonce),
        timestamp: BigInt(timestamp),
      };

      const signature = await signTypedDataAsync({ domain, types, primaryType: 'Withdraw', message });

      // --- ETAPE 3 : ENVOYER LA REQUÊTE À L'API ORDERLY ---
      setLogs("3/3 Envoi de la requête au réseau Orderly...");
      
      const requestBody = {
        signature,
        userAddress: address,
        verifyingContract: VERIFYING_CONTRACT,
        message: {
          brokerId: BROKER_ID,
          chainId,
          chainType: 'EVM',
          receiver: address,
          token: 'USDC',
          amount: amountParsed,
          withdrawNonce: nonce.toString(),
          timestamp: timestamp.toString(),
          allowCrossChainWithdraw: true
        }
      };

      const withdrawRes = await orderlyPrivateFetch('/v1/withdraw_request', 'POST', requestBody, accountId);
      const withdrawData = await withdrawRes.json();

      if (withdrawData.success) {
        setLogs(`✅ Retrait initié ! (ID: ${withdrawData.data.withdraw_id}) Les fonds arrivent.`);
      } else {
        throw new Error(withdrawData.message);
      }

    } catch (err: any) {
      console.error(err);
      setLogs(`❌ Erreur: ${err.message}`);
    } finally {
      setIsWithdrawing(false);
    }
  }, [address, chainId, accountId, signTypedDataAsync]);

  return { withdraw, isWithdrawing, logs };
}