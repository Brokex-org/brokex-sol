import { useState, useCallback } from 'react';
import { orderlyPrivateFetch } from './useOrderlyBalance';

export interface PendingOrder {
  order_id: number;
  symbol: string;
  order_type: string;
  side: 'BUY' | 'SELL';
  order_price: number | null;
  order_quantity: number;
  executed: number;
  status: string; // "NEW", "PARTIAL_FILLED"
}

export function useOrderlyPendingOrders(accountId: string | null) {
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // 1. Récupérer uniquement les ordres en attente d'exécution
  const fetchPendingOrders = useCallback(async () => {
    if (!accountId) return;
    setIsLoading(true);

    try {
      // Le paramètre status=INCOMPLETE filtre pour ne ramener que les ordres en attente
      const res = await orderlyPrivateFetch('/v1/orders?status=INCOMPLETE', 'GET', null, accountId);
      const data = await res.json();

      if (data.success && data.data) {
        setPendingOrders(data.data.rows || []);
      }
    } catch (err) {
      console.error("Erreur récupération des ordres en attente:", err);
    } finally {
      setIsLoading(false);
    }
  }, [accountId]);

  // 2. Annuler un ordre spécifique
  const cancelOrder = useCallback(async (orderId: number, symbol: string) => {
    if (!accountId) return;
    
    try {
      // D'après la doc, c't un DELETE avec l'ID et le symbole
      const res = await orderlyPrivateFetch(`/v1/order?order_id=${orderId}&symbol=${symbol}`, 'DELETE', null, accountId);
      const data = await res.json();
      
      if (data.success) {
        // On rafraîchit la liste pour faire disparaître l'ordre annulé
        fetchPendingOrders();
      }
    } catch (err) {
      console.error("Erreur annulation d'ordre:", err);
    }
  }, [accountId, fetchPendingOrders]);

  // 3. Annuler TOUS les ordres en attente (Le bouton d'urgence "Panic Button")
  const cancelAllOrders = useCallback(async () => {
    if (!accountId) return;
    
    try {
      const res = await orderlyPrivateFetch(`/v1/orders`, 'DELETE', null, accountId);
      const data = await res.json();
      
      if (data.success) {
        fetchPendingOrders();
      }
    } catch (err) {
      console.error("Erreur annulation de tous les ordres:", err);
    }
  }, [accountId, fetchPendingOrders]);

  return {
    pendingOrders,
    isLoading,
    fetchPendingOrders,
    cancelOrder,
    cancelAllOrders
  };
}