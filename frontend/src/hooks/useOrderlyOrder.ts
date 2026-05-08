import { useState, useCallback } from 'react';
import { orderlyPrivateFetch } from './useOrderlyBalance';

// On définit les paramètres de l'ordre selon la doc
export interface OrderParams {
  symbol: string;         // ex: 'PERP_ETH_USDC'
  order_type: 'LIMIT' | 'MARKET' | 'IOC' | 'FOK' | 'POST_ONLY' | 'ASK' | 'BID';
  side: 'BUY' | 'SELL';
  order_quantity?: number; // La quantité d'ETH (ex: 0.01)
  order_price?: number;    // Le prix (obligatoire pour LIMIT)
  reduce_only?: boolean;   // Si on veut juste fermer une position existante
}

export function useOrderlyOrder(accountId: string | null) {
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const [orderLogs, setOrderLogs] = useState<string>('');

  const createOrder = useCallback(async (params: OrderParams) => {
    if (!accountId) {
      setOrderLogs("❌ Account ID manquant.");
      return null;
    }

    try {
      setIsPlacingOrder(true);
      setOrderLogs("Envoi de l'ordre en cours...");

      // Appel de l'API avec notre helper qui gère la signature Ed25519
      const res = await orderlyPrivateFetch('/v1/order', 'POST', params, accountId);
      const data = await res.json();

      if (data.success) {
        setOrderLogs(`✅ Ordre placé avec succès ! (ID: ${data.data.order_id})`);
        return data.data; // Retourne les infos de l'ordre créé
      } else {
        throw new Error(data.message || 'Erreur inconnue lors du passage de l\'ordre');
      }
    } catch (err: any) {
      console.error(err);
      setOrderLogs(`❌ Erreur: ${err.message}`);
      return null;
    } finally {
      setIsPlacingOrder(false);
    }
  }, [accountId]);

  return { createOrder, isPlacingOrder, orderLogs };
}