import { useState, useEffect, useMemo } from 'react';
import { useTheme } from '../ThemeContext';
import { usePriceContext } from '../contexts/PriceContext';
import { useDynamicContext } from '@dynamic-labs/sdk-react-core';
import { Connection, PublicKey } from '@solana/web3.js';
import { useOstiumSubgraph } from '../hooks/useOstiumSubgraph';
import { useToast } from '../contexts/ToastContext';
import { TpSlPanel } from './TpSlPanel';
import { formatPrice } from '../utils/ostium/utils';
import { AssetIcon } from './AssetIcon';
import { useNetwork } from '../contexts/NetworkContext';
import {
  buildCreateCoreCollateralAtaIxIfNeeded,
  buildOpenPositionIx,
} from '../utils/solana/trading';
import { getPythFeedId0x, getRpcEndpoint, SOLANA_USDC_MINT } from '../utils/solana/programConfig';
import { ix, sendHermesPythThenConsumeLegacy } from '../utils/solana/pythTradeTx';
import { validateAssetPythFeedAlignment } from '../utils/solana/assetPythAlignment';
import {
  CIRCLE_SOLANA_DEVNET_USDC_FAUCET_URL,
  getTraderUsdcAta,
  prepareCreateUsdcAtaTransaction,
} from '../utils/solana/devnetUsdcFunding';

// Couleur d'accentuation dorée demandée
const goldAccent = '#BC8961';
const goldAccentLight = 'rgba(188, 137, 97, 0.15)';

export const OrderForm = () => {
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [orderType, setOrderType] = useState<'market' | 'limit' | 'stop'>('market');
  const [isTpSlOpen, setIsTpSlOpen] = useState(false);
  const [leverage, setLeverage] = useState(10);
  const [collateralAmount, setCollateralAmount] = useState('100');
  const [isPending, setIsPending] = useState(false);
  const [usdcBalance, setUsdcBalance] = useState('0.00');
  const [isCreatingUsdcAta, setIsCreatingUsdcAta] = useState(false);
  const [tpAmount, setTpAmount] = useState('');
  const [slAmount, setSlAmount] = useState('');
  const [targetPrice, setTargetPrice] = useState('');

  const [sizeCurrency, setSizeCurrency] = useState<'USD' | 'ASSET'>('USD');

  const { setShowAuthFlow } = useDynamicContext();
  const { addToast } = useToast();
  const [solAddress, setSolAddress] = useState<string | null>(null);
  const isPhantomConnected = !!solAddress;

  useEffect(() => {
    const provider = (window as any).solana;
    if (!provider?.isPhantom) return;

    const syncAddress = () => {
      const next = provider.publicKey ? provider.publicKey.toBase58() : null;
      setSolAddress(next);
    };

    const onConnect = () => syncAddress();
    const onDisconnect = () => setSolAddress(null);
    const onAccountChanged = () => syncAddress();

    syncAddress();
    provider.on?.('connect', onConnect);
    provider.on?.('disconnect', onDisconnect);
    provider.on?.('accountChanged', onAccountChanged);

    return () => {
      provider.removeListener?.('connect', onConnect);
      provider.removeListener?.('disconnect', onDisconnect);
      provider.removeListener?.('accountChanged', onAccountChanged);
    };
  }, []);


  const { isTestnet, cluster } = useNetwork();
  const { getPairs } = useOstiumSubgraph();
  const [subgraphPairs, setSubgraphPairs] = useState<any[]>([]);

  const { themeBg, themeControlBg, themeBorder, themeText, themeTextMuted, buyColor, sellColor, buyColorBg, sellColorBg } = useTheme();
  const { currentPriceData, selectedAsset } = usePriceContext();

  const askPrice = currentPriceData?.ask != null ? formatPrice(currentPriceData.ask) : '---';
  const bidPrice = currentPriceData?.bid != null ? formatPrice(currentPriceData.bid) : '---';
  const isMarketOpen = currentPriceData ? (currentPriceData.isMarketOpen && !currentPriceData.isDayTradingClosed) : true;

  // -------------------------------------------------------------
  // GESTION ROBUSTE DU LEVIER
  // -------------------------------------------------------------
  const selectedPair = useMemo(() => {
    return subgraphPairs.find(p => p.from === selectedAsset) || null;
  }, [subgraphPairs, selectedAsset]);

  const parseLev = (val: any) => {
    const num = Number(val);
    if (isNaN(num) || num <= 0) return 0;
    return Math.floor(num / 100);
  };

  const pairMax = parseLev(selectedPair?.maxLeverage);
  const groupMax = parseLev(selectedPair?.group?.maxLeverage);
  const maxLeverageNum = pairMax > 0 ? pairMax : (groupMax > 0 ? groupMax : 100);

  const groupMin = parseLev(selectedPair?.group?.minLeverage);
  const minLeverageNum = Math.max(1, groupMin > 0 ? groupMin : 1);

  const pairOvernight = parseLev(selectedPair?.overnightMaxLeverage);
  const overnightMaxLeverageNum = pairOvernight > 0 ? pairOvernight : maxLeverageNum;

  useEffect(() => {
    setLeverage(prev => {
      if (prev > maxLeverageNum) return maxLeverageNum;
      if (prev < minLeverageNum) return minLeverageNum;
      return prev;
    });
  }, [maxLeverageNum, minLeverageNum]);

  const leverageStops = useMemo(() => {
    let midStops: number[] = [];
    if (maxLeverageNum <= 10) midStops = [2, 5, 8];
    else if (maxLeverageNum <= 25) midStops = [5, 10, 15, 20];
    else if (maxLeverageNum <= 50) midStops = [10, 20, 30, 40];
    else if (maxLeverageNum <= 100) midStops = [10, 25, 50, 75];
    else midStops = [10, 50, 100, 150];

    const validMidStops = midStops.filter(s => s > minLeverageNum && s < maxLeverageNum);
    return Array.from(new Set([minLeverageNum, ...validMidStops, maxLeverageNum])).sort((a, b) => a - b);
  }, [maxLeverageNum, minLeverageNum]);

  // Barre de levier avec finition dorée
  const percentage = maxLeverageNum > minLeverageNum
    ? ((leverage - minLeverageNum) / (maxLeverageNum - minLeverageNum)) * 100
    : 0;
  const sliderBackground = `linear-gradient(to right, ${goldAccent} ${percentage}%, ${themeBorder} ${percentage}%)`;

  useEffect(() => {
    getPairs().then(setSubgraphPairs).catch(console.error);
  }, [getPairs]);

  useEffect(() => {
    if (!solAddress) {
      setUsdcBalance('0.00');
      return;
    }

    const connection = new Connection(getRpcEndpoint(), 'confirmed');
    const owner = new PublicKey(solAddress);
    const traderUsdcAta = getTraderUsdcAta(owner);

    const fetchBalance = async () => {
      try {
        const bal = await connection.getTokenAccountBalance(traderUsdcAta, 'confirmed');
        setUsdcBalance(bal.value.uiAmountString ?? '0.00');
      } catch {
        setUsdcBalance('0.00');
      }
    };

    fetchBalance();
    const interval = setInterval(fetchBalance, 10000);
    return () => clearInterval(interval);
  }, [solAddress]);

  const handleExecute = async () => {
    if (!currentPriceData) return;

    const currentPriceStr = side === 'buy' ? askPrice : bidPrice;
    if (currentPriceStr === '---') return;

    const currentPriceNum = Number(currentPriceStr);

    if (orderType === 'limit') {
      const target = Number(targetPrice);
      if (!targetPrice || target <= 0) {
        addToast({ type: 'warning', title: 'Invalid Limit Price', message: 'Please set a target price for the Limit order.' });
        return;
      }
      if (side === 'buy' && target >= currentPriceNum) {
        addToast({ type: 'warning', title: 'Invalid Limit Long', message: 'Limit Long: target price must be strictly below the current market price.' });
        return;
      }
      if (side === 'sell' && target <= currentPriceNum) {
        addToast({ type: 'warning', title: 'Invalid Limit Short', message: 'Limit Short: target price must be strictly above the current market price.' });
        return;
      }
    } else if (orderType === 'stop') {
      const target = Number(targetPrice);
      if (!targetPrice || target <= 0) {
        addToast({ type: 'warning', title: 'Invalid Stop Price', message: 'Please set a target price for the Stop order.' });
        return;
      }
      if (side === 'buy' && target <= currentPriceNum) {
        addToast({ type: 'warning', title: 'Invalid Stop Long', message: 'Stop Long: target price must be strictly above the current market price.' });
        return;
      }
      if (side === 'sell' && target >= currentPriceNum) {
        addToast({ type: 'warning', title: 'Invalid Stop Short', message: 'Stop Short: target price must be strictly below the current market price.' });
        return;
      }
    }

    try {
      setIsPending(true);
      const provider = (window as any).solana;
      if (!provider?.isPhantom) {
        throw new Error('Phantom wallet not found');
      }
      if (!provider.publicKey) {
        await provider.connect();
      }
      const trader = new PublicKey(provider.publicKey.toBase58());
      const collateralBase = BigInt(Math.floor(Number(collateralAmount || '0') * 1_000_000));
      const targetPriceMicro =
        orderType === 'market' ? 0n : BigInt(Math.floor(Number(targetPrice || '0') * 1_000_000));
      const slPriceMicro =
        slAmount && Number(slAmount) > 0 ? BigInt(Math.floor(Number(slAmount) * 1_000_000)) : 0n;
      const tpPriceMicro =
        tpAmount && Number(tpAmount) > 0 ? BigInt(Math.floor(Number(tpAmount) * 1_000_000)) : 0n;

      const connection = new Connection(getRpcEndpoint(), 'confirmed');
      const align = await validateAssetPythFeedAlignment(connection, selectedAsset);
      if (!align.ok) {
        addToast({
          type: 'error',
          title: 'Oracle feed mismatch',
          message: align.detail.length > 420 ? `${align.detail.slice(0, 420)}…` : align.detail,
        });
        return;
      }

      const feedId = getPythFeedId0x(selectedAsset);
      const maybeCollateralAtaIx = await buildCreateCoreCollateralAtaIxIfNeeded(trader);

      const sigs = await sendHermesPythThenConsumeLegacy({
        connection,
        trader,
        phantom: provider,
        pythFeedId0x: feedId,
        buildConsumerInstructions: async (getPriceUpdateAccount) => {
          const pythPk = getPriceUpdateAccount(feedId);
          const { instruction } = await buildOpenPositionIx({
            trader,
            assetSymbol: selectedAsset,
            collateralUsdc: collateralBase,
            leverage: Math.max(1, Math.min(255, leverage)),
            side,
            orderType,
            targetPriceMicro,
            slPriceMicro,
            tpPriceMicro,
            pythPriceUpdate: pythPk,
          });
          const prep = maybeCollateralAtaIx ? [ix(maybeCollateralAtaIx)] : [];
          return [...prep, ix(instruction)];
        },
      });
      const hash = sigs[sigs.length - 1];

      addToast({
        type: 'success',
        title: orderType === 'market' ? 'Market Position Opened' : 'Conditional Order Placed',
        pair: selectedPair ? `${selectedPair.from}/${selectedPair.to}` : 'Unknown',
        side: side,
        leverage: Number(leverage),
        txHash: hash
      });


    } catch (err: unknown) {
      console.error('Error submitting trade:', err);
      let msg =
        err && typeof err === 'object' && 'message' in err && typeof (err as any).message === 'string'
          ? (err as any).message
          : err && typeof err === 'object' && 'shortMessage' in err
            ? String((err as any).shortMessage)
            : 'Unknown error';
      if (
        err &&
        typeof err === 'object' &&
        'getLogs' in err &&
        typeof (err as { getLogs: unknown }).getLogs === 'function'
      ) {
        try {
          const connection = new Connection(getRpcEndpoint(), 'confirmed');
          const logs = await (err as { getLogs: (c: Connection) => Promise<string[]> }).getLogs(connection);
          console.error('Simulation / send logs:', logs);
          if (logs?.length) {
            msg = `${msg}\n${logs.slice(-8).join('\n')}`;
          }
        } catch (logErr) {
          console.warn('Could not fetch transaction logs', logErr);
        }
      }
      addToast({
        type: 'error',
        title: 'Transaction Failed',
        message: msg.length > 400 ? `${msg.slice(0, 400)}…` : msg,
      });
    } finally {
      setIsPending(false);
    }
  };

  const handleDevnetFundUsdc = async () => {
    const provider = (window as any).solana;
    if (!provider?.isPhantom) {
      addToast({ type: 'warning', title: 'Wallet', message: 'Connect Phantom first.' });
      return;
    }
    try {
      if (!provider.publicKey) await provider.connect();
      setIsCreatingUsdcAta(true);
      const trader = new PublicKey(provider.publicKey.toBase58());
      const prep = await prepareCreateUsdcAtaTransaction(trader);
      if (prep.kind === 'exists') {
        addToast({
          type: 'success',
          title: 'USDC account ready',
          message: 'Token account exists. Use Circle faucet to receive devnet USDC.',
        });
        return;
      }
      const { connection, transaction, blockhash, lastValidBlockHeight } = prep;
      const signed = await provider.signTransaction(transaction);
      const sig = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
      addToast({
        type: 'success',
        title: 'USDC account created',
        message: 'Open Circle faucet and send to this wallet on Solana devnet.',
      });
    } catch (err: any) {
      console.error('Create USDC ATA:', err);
      const msg = err?.message || 'Failed to create token account';
      addToast({ type: 'error', title: 'USDC account', message: String(msg).slice(0, 120) });
    } finally {
      setIsCreatingUsdcAta(false);
    }
  };

  const ORACLE_FEE_USD = isTestnet ? 0.50 : 0.10;
  const collatNum = Number(collateralAmount || 0);

  // takerFeeP / makerFeeP sont stockés bruts (ex: 150000 = 0.15%)
  const rawFeeP = orderType === 'market'
    ? Number(selectedPair?.takerFeeP ?? 0)
    : Number(selectedPair?.makerFeeP ?? 0);
  
  // Total fee includes builder fee (1/3 of Ostium fee, capped at 0.5%)
  const builderFeeP = Math.min(Math.floor(rawFeeP / 3), 500000);
  const totalRawFeeP = rawFeeP + builderFeeP;
  
  const totalFeePct = totalRawFeeP / 1_000_000; // ex: 0.20 = 0.20%
  const feeRatio = totalFeePct / 100; // ex: 0.0020

  // ─── Net Size Calculation (Accounting for fees deducted from collateral) ───
  // Formula: Size = ((Collat - Oracle) * Lev) / (1 + Lev * FeeRatio)
  const netCollateralBase = Math.max(0, collatNum - ORACLE_FEE_USD);
  const estimatedSizeUSDNum = collatNum > 0 
    ? (netCollateralBase * leverage) / (1 + (leverage * feeRatio))
    : 0;

  const entryPriceCalc = orderType === 'market' ? Number(side === 'buy' ? askPrice : bidPrice) : Number(targetPrice || 0);
  const estimatedSizeAssetNum = entryPriceCalc > 0 ? estimatedSizeUSDNum / entryPriceCalc : 0;

  // Displayed fees should match the size shown
  const ostiumFeeUsd = estimatedSizeUSDNum * (rawFeeP / 1_000_000 / 100);
  const builderFeeUsd = estimatedSizeUSDNum * (builderFeeP / 1_000_000 / 100);
  const tradingFeeUsd = ostiumFeeUsd + builderFeeUsd;
  const totalFeesUsd = collatNum > 0 ? ORACLE_FEE_USD + tradingFeeUsd : 0;

  const displaySize = sizeCurrency === 'USD'
    ? estimatedSizeUSDNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 5 })
    : estimatedSizeAssetNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });

  let liqPriceDisplay = 'None';
  if (entryPriceCalc > 0 && leverage >= 1) {
    const liqPrice = side === 'buy'
      ? entryPriceCalc * (1 - 0.95 / leverage)
      : entryPriceCalc * (1 + 0.95 / leverage);
    liqPriceDisplay = liqPrice > 0 ? liqPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : 'None';
  }

  const isChainSupported = true;
  const isButtonDisabled = isPending || (orderType === 'market' && !isMarketOpen) || !isChainSupported;

  const buttonText = !isChainSupported
    ? '⚠ Contrat non disponible sur ce réseau'
    : !isMarketOpen && orderType === 'market'
      ? 'Market is Closed'
      : isPending
        ? 'Confirming...'
        : `Go ${side === 'buy' ? 'Long' : 'Short'}`;

  return (
    <div className="hide-scrollbar" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto', padding: '0.5rem', boxSizing: 'border-box', gap: '0.6rem', backgroundColor: themeBg, color: themeText, fontFamily: 'var(--sans)' }}>

      <style>{`
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        
        .no-spinners::-webkit-outer-spin-button,
        .no-spinners::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        .no-spinners {
          -moz-appearance: textfield;
        }

        .custom-leverage-slider {
          -webkit-appearance: none;
          appearance: none;
          width: 100%;
          height: 4px;
          border-radius: 2px;
          outline: none;
          cursor: pointer;
        }
        .custom-leverage-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #ffffff;
          cursor: pointer;
          border: 1px solid #333;
          box-shadow: 0 0 4px rgba(0,0,0,0.3);
        }
      `}</style>

      {/* Top Tabs (Long/Short) */}
      <div style={{ display: 'flex', flexShrink: 0, backgroundColor: themeControlBg, borderRadius: '4px', padding: '2px', border: `1px solid ${themeBorder}` }}>
        <div
          onClick={() => setSide('buy')}
          style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '0.25rem 0.6rem', cursor: 'pointer', borderRadius: '3px', backgroundColor: side === 'buy' ? buyColorBg : 'transparent', border: `1px solid ${side === 'buy' ? buyColor : 'transparent'}`, transition: 'all 0.15s' }}>
          <div style={{ color: side === 'buy' ? buyColor : themeTextMuted, fontWeight: side === 'buy' ? 600 : 400, fontSize: '0.75rem', lineHeight: '1.2' }}>Long</div>
          <div className="font-mono" style={{ color: side === 'buy' ? buyColor : themeTextMuted, fontSize: '0.7rem', lineHeight: '1.2' }}>{askPrice}</div>
        </div>
        <div
          onClick={() => setSide('sell')}
          style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '0.25rem 0.6rem', cursor: 'pointer', borderRadius: '3px', backgroundColor: side === 'sell' ? sellColorBg : 'transparent', border: `1px solid ${side === 'sell' ? sellColor : 'transparent'}`, transition: 'all 0.15s' }}>
          <div style={{ color: side === 'sell' ? sellColor : themeTextMuted, fontWeight: side === 'sell' ? 600 : 400, fontSize: '0.75rem', lineHeight: '1.2' }}>Short</div>
          <div className="font-mono" style={{ color: side === 'sell' ? sellColor : themeTextMuted, fontSize: '0.7rem', lineHeight: '1.2' }}>{bidPrice}</div>
        </div>
      </div>

      {/* Market / Limit / Stop - MODE ACTIF EN DORÉ */}
      <div style={{ display: 'flex', flexShrink: 0, backgroundColor: themeControlBg, borderRadius: '4px', padding: '2px', border: `1px solid ${themeBorder}` }}>
        {['market', 'limit', 'stop'].map(type => (
          <div
            key={type}
            onClick={() => setOrderType(type as any)}
            style={{
              flex: 1, textAlign: 'center', padding: '0.2rem', cursor: 'pointer', borderRadius: '3px',
              backgroundColor: orderType === type ? goldAccentLight : 'transparent',
              color: orderType === type ? goldAccent : themeTextMuted,
              border: `1px solid ${orderType === type ? goldAccent : 'transparent'}`,
              fontSize: '0.65rem', fontWeight: orderType === type ? 600 : 400, textTransform: 'capitalize', transition: 'all 0.15s'
            }}>
            {type}
          </div>
        ))}
      </div>

      {/* Available to Trade */}
      <div style={{ display: 'flex', flexShrink: 0, justifyContent: 'space-between', alignItems: 'center', fontSize: '0.65rem' }}>
        <span style={{ color: themeTextMuted, borderBottom: `1px dashed ${themeBorder}`, cursor: 'help' }}>Available to Trade</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <span className="font-mono" style={{ color: themeText }}>{Number(usdcBalance).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC</span>
          {cluster === 'devnet' ? (
            <button
              type="button"
              title="Devnet: fund USDC without Jupiter (Circle faucet)"
              onClick={() => window.open(CIRCLE_SOLANA_DEVNET_USDC_FAUCET_URL, '_blank', 'noopener,noreferrer')}
              style={{ backgroundColor: themeControlBg, border: `1px solid ${themeBorder}`, borderRadius: '4px', color: themeText, width: '18px', height: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '0.75rem' }}
            >
              +
            </button>
          ) : null}
        </div>
      </div>

      {cluster === 'devnet' && solAddress ? (
        <div
          style={{
            flexShrink: 0,
            fontSize: '0.55rem',
            color: themeTextMuted,
            lineHeight: 1.4,
            display: 'flex',
            flexDirection: 'column',
            gap: '0.35rem',
            padding: '0.4rem',
            border: `1px dashed ${themeBorder}`,
            borderRadius: '4px',
            backgroundColor: themeControlBg,
          }}
        >
          <span>
            Get devnet USDC without a swap: ensure a USDC token account exists, then use Circle&apos;s faucet (same mint as this app).
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
            <button
              type="button"
              disabled={isCreatingUsdcAta}
              onClick={handleDevnetFundUsdc}
              style={{
                fontSize: '0.55rem',
                padding: '0.25rem 0.45rem',
                borderRadius: '4px',
                border: `1px solid ${goldAccent}`,
                backgroundColor: goldAccentLight,
                color: goldAccent,
                cursor: isCreatingUsdcAta ? 'wait' : 'pointer',
                opacity: isCreatingUsdcAta ? 0.7 : 1,
              }}
            >
              {isCreatingUsdcAta ? 'Signing…' : 'Create USDC account'}
            </button>
            <button
              type="button"
              onClick={() => window.open(CIRCLE_SOLANA_DEVNET_USDC_FAUCET_URL, '_blank', 'noopener,noreferrer')}
              style={{
                fontSize: '0.55rem',
                padding: '0.25rem 0.45rem',
                borderRadius: '4px',
                border: `1px solid ${themeBorder}`,
                backgroundColor: themeBg,
                color: themeText,
                cursor: 'pointer',
              }}
            >
              Circle faucet
            </button>
            <button
              type="button"
              onClick={async () => {
                const mint = SOLANA_USDC_MINT.toBase58();
                try {
                  await navigator.clipboard.writeText(mint);
                  addToast({ type: 'success', title: 'Copied', message: 'USDC mint address copied.' });
                } catch {
                  addToast({ type: 'warning', title: 'USDC mint', message: mint });
                }
              }}
              style={{
                fontSize: '0.55rem',
                padding: '0.25rem 0.45rem',
                borderRadius: '4px',
                border: `1px solid ${themeBorder}`,
                backgroundColor: themeBg,
                color: themeText,
                cursor: 'pointer',
              }}
            >
              Copy USDC mint
            </button>
          </div>
        </div>
      ) : null}

      {/* Target Price (Limit/Stop only) */}
      {orderType !== 'market' && (
        <div style={{ flexShrink: 0, backgroundColor: themeControlBg, borderRadius: '4px', border: `1px solid ${themeBorder}`, padding: '0.3rem 0.6rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          <span style={{ fontSize: '0.65rem', color: themeTextMuted, textDecoration: 'underline dotted', width: 'max-content', cursor: 'help', textTransform: 'capitalize' }}>
            {orderType} price
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {/* Symbole ≤ ou ≥ en DORÉ */}
            <span style={{ fontSize: '1.1rem', fontWeight: 600, color: goldAccent, marginTop: '-2px' }}>
              {orderType === 'limit' ? (side === 'buy' ? '≤' : '≥') : (side === 'buy' ? '≥' : '≤')}
            </span>
            <input
              type="number"
              className="no-spinners font-mono"
              value={targetPrice}
              onChange={(e) => setTargetPrice(e.target.value)}
              placeholder="None"
              style={{ fontSize: '0.9rem', color: themeText, backgroundColor: 'transparent', border: 'none', outline: 'none', width: '100%', fontWeight: 600 }}
            />
          </div>
        </div>
      )}

      {/* Unified Main Input Block */}
      <div style={{ flexShrink: 0, backgroundColor: themeControlBg, borderRadius: '4px', border: `1px solid ${themeBorder}`, display: 'flex', flexDirection: 'column' }}>

        {/* Collateral */}
        <div style={{ padding: '0.3rem 0.6rem', borderBottom: `1px solid ${themeBorder}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.15rem' }}>
            <span style={{ fontSize: '0.6rem', color: themeTextMuted }}>Collateral</span>
            <span style={{ fontSize: '0.6rem', color: themeTextMuted, cursor: 'pointer' }} onClick={() => setCollateralAmount(usdcBalance)}>Max</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <input
              type="number"
              className="no-spinners font-mono"
              value={collateralAmount}
              onChange={(e) => setCollateralAmount(e.target.value)}
              style={{ fontSize: '0.9rem', color: themeText, backgroundColor: 'transparent', border: 'none', outline: 'none', padding: 0, width: '150px', fontFamily: 'inherit' }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: themeText, fontWeight: 500, fontSize: '0.75rem' }}>
              <div style={{ width: '12px', height: '12px', backgroundColor: '#2563eb', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '8px', color: '#fff' }}>$</div>
              USDC
            </div>
          </div>
        </div>

        {/* Estimated Size */}
        <div style={{ padding: '0.3rem 0.6rem', borderBottom: `1px solid ${themeBorder}` }}>
          <div style={{ fontSize: '0.6rem', color: themeTextMuted, marginBottom: '0.15rem' }}>Estimated Size</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="font-mono" style={{ fontSize: '0.9rem', color: themeText }}>
              {displaySize}
            </span>
            {/* Toggle USD / ASSET EN DORÉ */}
            <div
              onClick={() => setSizeCurrency(prev => prev === 'USD' ? 'ASSET' : 'USD')}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', color: goldAccent, fontWeight: 600, fontSize: '0.65rem', backgroundColor: goldAccentLight, border: `1px solid ${goldAccent}`, padding: '2px 8px', borderRadius: '4px', cursor: 'pointer', userSelect: 'none', transition: 'all 0.2s', height: '20px' }}
            >
              {sizeCurrency === 'USD' ? (
                <div style={{ width: '12px', height: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <img src="/usdc.svg" alt="USD" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                </div>
              ) : (
                <AssetIcon symbol={selectedAsset} size="14px" />
              )}
              <span>{sizeCurrency === 'USD' ? (selectedPair?.to ?? 'USD') : selectedAsset}</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.8 }}>
                <path d="M7 15l5 5 5-5" />
                <path d="M7 9l5-5 5 5" />
              </svg>
            </div>
          </div>
        </div>

        {/* Leverage */}
        <div style={{ padding: '0.3rem 0.6rem', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
            <span style={{ fontSize: '0.6rem', color: themeTextMuted }}>Leverage</span>
            <span className="font-mono" style={{ color: themeText, fontWeight: 600, fontSize: '0.8rem' }}>{leverage}x</span>
          </div>
          {/* Slider avec fill doré */}
          <input
            type="range"
            min={minLeverageNum}
            max={maxLeverageNum}
            step="1"
            value={leverage}
            onChange={(e) => setLeverage(Number(e.target.value))}
            className="custom-leverage-slider"
            style={{ background: sliderBackground }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.4rem', gap: '4px' }}>
            {leverageStops.map(lev => (
              <button
                key={lev}
                onClick={() => setLeverage(lev)}
                style={{
                  flex: 1, padding: '0.15rem 0', fontSize: '0.6rem',
                  border: `1px solid ${leverage === lev ? goldAccent : themeBorder}`,
                  borderRadius: '4px',
                  backgroundColor: leverage === lev ? goldAccentLight : themeBg,
                  color: leverage === lev ? goldAccent : themeTextMuted,
                  cursor: 'pointer', transition: 'all 0.1s'
                }}
              >
                {lev}x
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* OVERNIGHT LEVERAGE WARNING - ULTRA COMPACT */}
      {leverage > overnightMaxLeverageNum && (
        <div style={{ 
          flexShrink: 0, 
          backgroundColor: 'rgba(188, 137, 97, 0.06)', 
          border: `1px solid rgba(188, 137, 97, 0.2)`, 
          borderRadius: '4px', 
          padding: '0.4rem 0.6rem', 
          color: goldAccent, 
          fontSize: '0.62rem', 
          lineHeight: '1.35',
          display: 'flex',
          flexDirection: 'column',
          gap: '1px'
        }}>
          <div style={{ fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.58rem', opacity: 0.9 }}>
            Overnight Exposure Risk
          </div>
          <div style={{ opacity: 0.8 }}>
            Leverage ({leverage}x) exceeds thresholds. Position auto-closes at market close.
          </div>
        </div>
      )}

      {/* Composant déporté TP / SL Panel */}
      <TpSlPanel
        isTpSlOpen={isTpSlOpen}
        setIsTpSlOpen={setIsTpSlOpen}
        tpAmount={tpAmount}
        setTpAmount={setTpAmount}
        slAmount={slAmount}
        setSlAmount={setSlAmount}
        side={side}
        entryPrice={entryPriceCalc}
        leverage={leverage}
        collateralNum={collatNum}
      />

      {/* Action Button */}
      <div style={{ flexShrink: 0, display: 'flex', marginTop: '0.2rem' }}>
        {!isPhantomConnected ? (
          <button
            onClick={async () => {
              const provider = (window as any).solana;
              if (provider?.isPhantom) {
                const res = await provider.connect({ onlyIfTrusted: false });
                setSolAddress(res.publicKey.toBase58());
              } else {
                setShowAuthFlow(true);
              }
            }}
            style={{ flex: 1, backgroundColor: goldAccent, color: '#fff', border: 'none', borderRadius: '4px', padding: '0.7rem', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', transition: 'opacity 0.2s' }}>
            Connect Phantom
          </button>
        ) : (
          <button
            onClick={handleExecute}
            disabled={isButtonDisabled}
            style={{
              flex: 1,
              backgroundColor: isButtonDisabled ? themeControlBg : goldAccent,
              color: isButtonDisabled ? themeTextMuted : '#fff',
              border: isButtonDisabled ? `1px solid ${themeBorder}` : 'none',
              borderRadius: '4px',
              padding: '0.7rem',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: isButtonDisabled ? 'not-allowed' : 'pointer',
              opacity: isButtonDisabled ? 0.6 : 1,
              transition: 'all 0.2s'
            }}>
            {buttonText}
          </button>
        )}
      </div>

      {/* Metrics List */}
      <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '0.01rem', fontSize: '0.65rem', marginTop: '0.1rem' }}>

        {orderType === 'market' && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: themeTextMuted, borderBottom: `1px dashed ${themeBorder}` }}>Slippage Tolerance</span>
            <span className="font-mono" style={{ color: themeText, backgroundColor: themeControlBg, border: `1px solid ${themeBorder}`, padding: '2px 6px', borderRadius: '4px' }}>
              1%
            </span>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: themeTextMuted, borderBottom: `1px dashed ${themeBorder}` }}>Amount</span>
          <span className="font-mono" style={{ color: themeText }}>{estimatedSizeAssetNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })} {selectedAsset}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: themeTextMuted, borderBottom: `1px dashed ${themeBorder}` }}>Exposure</span>
          <span className="font-mono" style={{ color: themeText }}>${estimatedSizeUSDNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: themeTextMuted, borderBottom: `1px dashed ${themeBorder}` }}>Collateral at Open</span>
          <span className="font-mono" style={{ color: themeText }}>{collatNum.toFixed(2)} USDC</span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: themeTextMuted, borderBottom: `1px dashed ${themeBorder}` }}>Liquidation Price</span>
          <span className="font-mono" style={{ color: themeText }}>{liqPriceDisplay}</span>
        </div>

        <div style={{ height: '1px', backgroundColor: themeBorder, margin: '0.05rem 0' }}></div>

        {/* Fees breakdown */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: themeTextMuted, borderBottom: `1px dashed ${themeBorder}` }}>Oracle Fee</span>
          <span className="font-mono" style={{ color: themeText }}>{collatNum > 0 ? `$${ORACLE_FEE_USD.toFixed(2)}` : '—'}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: themeTextMuted, borderBottom: `1px dashed ${themeBorder}` }}>
            Open Fee
            {totalFeePct > 0 && (
              <span style={{ color: goldAccent, marginLeft: '4px' }}>
                ({(Math.ceil(totalFeePct * 100) / 100).toFixed(2)}%)
              </span>
            )}
          </span>
          <span className="font-mono" style={{ color: themeText }}>
            {collatNum > 0 ? `$${tradingFeeUsd.toFixed(4)}` : '—'}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: themeTextMuted, borderBottom: `1px dashed ${themeBorder}` }}>
            Closing Fee
          </span>
          <span className="font-mono" style={{ color: themeText }}>
            {collatNum > 0 ? `$0.00` : '—'}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '1.5px', borderTop: `1px solid ${themeBorder}` }}>
          <span style={{ color: themeText, fontWeight: 600 }}>Total Fees</span>
          <span className="font-mono" style={{ color: goldAccent, fontWeight: 600 }}>
            {collatNum > 0 ? `~$${totalFeesUsd.toFixed(4)}` : '—'}
          </span>
        </div>
      </div>

    </div>
  );
};