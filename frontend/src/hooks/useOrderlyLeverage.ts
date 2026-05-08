import { useState, useCallback } from 'react';
import { orderlyPrivateFetch } from './useOrderlyBalance'; // On réutilise l'outil de signature !

const ORDERLY_API_URL = 'https://testnet-api.orderly.org'; // On reste sur le Testnet

export function useOrderlyLeverage(accountId: string | null) {
  // États pour stocker les données
  const [availableLeverages, setAvailableLeverages] = useState<number[]>([]);
  const [maxLeverage, setMaxLeverage] = useState<number>(1);
  const [currentLeverage, setCurrentLeverage] = useState<number>(1);
  const [marginMode, setMarginMode] = useState<'CROSS' | 'ISOLATED'>('CROSS');
  const [isLoading, setIsLoading] = useState(false);
  const [logs, setLogs] = useState<string>('');

  // 1. [PUBLIC] Récupérer la configuration globale (ex: quels leviers sont possibles ?)
  const fetchLeverageConfig = useCallback(async () => {
    try {
      // Récupère les choix possibles (ex: "1,2,3,4,5,10...")
      const configRes = await fetch(`${ORDERLY_API_URL}/v1/public/config`);
      const configData = await configRes.json();
      
      if (configData.success) {
        // On transforme la chaîne de texte en tableau de nombres
        const leveragesArray = configData.data.available_futures_leverage
          .split(',')
          .map((n: string) => parseInt(n));
        setAvailableLeverages(leveragesArray);
      }

      // Récupère le levier maximum global
      const maxRes = await fetch(`${ORDERLY_API_URL}/v1/public/leverage`);
      const maxData = await maxRes.json();
      if (maxData.success) {
        setMaxLeverage(parseInt(maxData.data.max_futures_leverage));
      }
    } catch (error) {
      console.error("Erreur config levier:", error);
    }
  }, []);

  // 2. [PRIVÉ] Voir TON levier actuel sur une crypto spécifique (ex: PERP_ETH_USDC)
  const fetchMyLeverage = useCallback(async (symbol: string) => {
    if (!accountId) return;
    setIsLoading(true);

    try {
      const res = await orderlyPrivateFetch(`/v1/client/leverage?symbol=${symbol}`, 'GET', null, accountId);
      const data = await res.json();

      if (data.success) {
        setCurrentLeverage(data.data.leverage);
        setMarginMode(data.data.margin_mode);
      }
    } catch (error) {
      console.error("Erreur lecture de ton levier:", error);
    } finally {
      setIsLoading(false);
    }
  }, [accountId]);

  // 3. [PRIVÉ] Modifier TON levier (La route POST)
  const setMyLeverage = useCallback(async (symbol: string, leverage: number, mode: 'CROSS' | 'ISOLATED' = 'CROSS') => {
    if (!accountId) return;
    setIsLoading(true);
    setLogs(`Passage au levier x${leverage} en cours...`);

    try {
      const body = {
        symbol: symbol,
        leverage: leverage,
        margin_mode: mode
      };

      // Appel de la méthode POST pour mettre à jour la base de données d'Orderly
      const res = await orderlyPrivateFetch('/v1/client/leverage', 'POST', body, accountId);
      const data = await res.json();

      if (data.success) {
        setLogs(`✅ Levier mis à jour : x${leverage} (${mode})`);
        setCurrentLeverage(leverage);
        setMarginMode(mode);
      } else {
        throw new Error(data.message);
      }
    } catch (error: any) {
      setLogs(`❌ Erreur: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [accountId]);

  return {
    // Variables
    availableLeverages,
    maxLeverage,
    currentLeverage,
    marginMode,
    isLoading,
    logs,
    
    // Fonctions
    fetchLeverageConfig,
    fetchMyLeverage,
    setMyLeverage
  };
}