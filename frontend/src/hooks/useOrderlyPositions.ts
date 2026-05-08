import { useState, useCallback } from 'react';
import { orderlyPrivateFetch } from './useOrderlyBalance'; // On réutilise toujours notre outil magique

// On définit la structure d'une position selon ta documentation
export interface Position {
  symbol: string;
  position_qty: number;      // Positif = Long, Négatif = Short
  average_open_price: number;
  mark_price: number;        // Le prix actuel
  unsettled_pnl: number;     // Les gains/pertes latents
  leverage: number;
  margin_mode: 'CROSS' | 'ISOLATED';
  est_liq_price: number;     // Prix de liquidation
}

export function useOrderlyPositions(accountId: string | null) {
  const [positions, setPositions] = useState<Position[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  
  // Les données globales du compte (Marge dispo, PnL total, etc.)
  const [accountData, setAccountData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);

  // 1. Récupérer toutes les positions actives
  const fetchPositions = useCallback(async () => {
    if (!accountId) return;
    setIsLoading(true);

    try {
      const res = await orderlyPrivateFetch('/v1/positions', 'GET', null, accountId);
      const data = await res.json();

      if (data.success && data.data) {
        setPositions(data.data.rows || []); // Le tableau des positions
        setAccountData(data.data);          // Le résumé global du compte
      }
    } catch (err) {
      console.error("Erreur récupération des positions:", err);
    } finally {
      setIsLoading(false);
    }
  }, [accountId]);

  // 2. Récupérer l'historique des trades terminés
  const fetchHistory = useCallback(async (limit: number = 20) => {
    if (!accountId) return;
    setIsLoading(true);

    try {
      const res = await orderlyPrivateFetch(`/v1/position_history?limit=${limit}`, 'GET', null, accountId);
      const data = await res.json();

      if (data.success && data.data) {
        setHistory(data.data.rows || []);
      }
    } catch (err) {
      console.error("Erreur récupération historique:", err);
    } finally {
      setIsLoading(false);
    }
  }, [accountId]);

  // 3. Récupérer une seule position (Optionnel, utile pour vérifier un trade précis)
  const fetchOnePosition = useCallback(async (symbol: string) => {
    if (!accountId) return null;
    try {
      const res = await orderlyPrivateFetch(`/v1/position/${symbol}`, 'GET', null, accountId);
      const data = await res.json();
      return data.success ? data.data : null;
    } catch (err) {
      return null;
    }
  }, [accountId]);

  return { 
    positions, 
    history, 
    accountData, 
    isLoading, 
    fetchPositions, 
    fetchHistory, 
    fetchOnePosition 
  };
}