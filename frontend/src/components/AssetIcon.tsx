import React, { useEffect } from 'react';
import { 
  TokenETH, 
  TokenBNB, 
  TokenADA, 
  TokenHYPE, 
  TokenLINK, 
  TokenSOL, 
  TokenTRX, 
  TokenXRP,
  TokenBTC
} from '@web3icons/react';

/**
 * Mapping des symboles vers les composants @web3icons/react
 */
const WEB3_TOKEN_ICONS: Record<string, any> = {
  'ETH': TokenETH,
  'BNB': TokenBNB,
  'ADA': TokenADA,
  'HYPE': TokenHYPE,
  'LINK': TokenLINK,
  'SOL': TokenSOL,
  'TRX': TokenTRX,
  'XRP': TokenXRP,
  'BTC': TokenBTC,
};

/**
 * Mapping des devises Forex vers les fichiers SVG locaux dans /public
 */
const FOREX_MAPPING: Record<string, string> = {
  'EUR': '/european_union.svg',
  'JPY': '/jp.svg',
  'GBP': '/uk.svg',
  'CHF': '/ch.svg',
  'CAD': '/ca.svg',
  'USD': '/us.svg',
  'MXN': '/mx.svg',
  'NZD': '/nz.svg',
  'AUD': '/au.svg',
  'KRW': '/kr.svg',
};

/**
 * Mapping des stocks vers les logos locaux dans /public
 */
const STOCK_ICONS: Record<string, string> = {
  'TSLA': '/tesla-pure.svg',
  'MSFT': '/microsoft-5.svg',
  'NVDA': '/nvidia-7.svg',
  'AMZN': '/amazon-simple.svg',
  'META': '/meta-3.svg',
  'AAPL': '/apple-13.svg',
  'COIN': '/COIN.svg',
  'PLTR': '/PLTR.svg',
  'AMD':  '/AMD.svg',
  'COST': '/COST.svg',
  'XOM':  '/XOM.svg',
  'ORCL': '/oracle-india.svg',
  'NFLX': '/netflix-logo-icon.svg',
  'CVX':  '/chevron-flat-version.svg',
  'SHEL': '/shell-4.svg',
  'RIVN': '/rivian.svg',
  'HOOD': '/robinhood-2.svg',
  'CRCL': '/CRCL.svg',
  'GOOG': '/google.svg',
  'MSTR': '/mstr.svg',
  'GEV':  '/GEV.svg',
  'SBET': '/sbet.jpeg',
  'GLXY': '/glxy.svg',
  // ── Nouveaux tickers (SVGs à placer dans /public) ───────────────────────────
  'AVGO': '/avgo.svg',
  'INTC': '/intc.svg',
  'ARM':  '/arm.svg',
  'SMCI': '/smci.svg',
  'CAT':  '/cat.svg',
  'TSM':  '/tsm.svg',
  'ASML': '/asml.svg',
};

// Logos qui doivent remplir toute la surface (pas de padding)
const STOCK_ICONS_FULL = new Set(['SBET', 'ORCL']);

/**
 * Config des indices boursiers : drapeau local + label optionnel affiché en overlay
 */
const INDEX_CONFIG: Record<string, { flag: string; label?: string }> = {
  'SPX':  { flag: '/us.svg',    label: 'US500' },
  'DJI':  { flag: '/us.svg',    label: 'US30'  },
  'NDX':  { flag: '/us.svg',    label: 'US100' },
  'FTSE': { flag: '/uk.svg' },
  'DAX':  { flag: '/de.svg' },
  'HSI':  { flag: '/cn-hk.svg' },
  'NIK':  { flag: '/jp.svg' },
};

/**
 * Config des métaux : icône unique metals.svg avec couleur de fond variable
 */
const METAL_CONFIG: Record<string, { bg: string }> = {
  'XAU': { bg: '#FFD700' }, // Gold
  'XAG': { bg: '#C0C0C0' }, // Silver
  'XPT': { bg: '#E5E4E2' }, // Platinum
  'XPD': { bg: '#444444' }, // Palladium
  'HG':  { bg: '#B87333' }, // Copper
};

/**
 * Config des pétroles : icône oil.svg avec styles spécifiques
 */
const OIL_CONFIG: Record<string, { bg: string; invert: boolean }> = {
  'BRENT': { bg: '#FFD700', invert: true },  // White on Gold
  'CL':    { bg: '#FFFFFF', invert: false }, // Black on White
};

export const ASSET_ICONS_BY_ID: Record<number, string> = {
  0: 'cryptocurrency:btc',
  1: 'cryptocurrency:eth',
  2: 'cryptocurrency:link',
  3: 'cryptocurrency:doge',
  5: 'cryptocurrency:avax',
  10: 'cryptocurrency:sol',
  14: 'cryptocurrency:xrp',
  15: 'cryptocurrency:trx',
  16: 'cryptocurrency:ada',
  90: 'simple-icons:sui',
  17: 'emojione:flag-for-european-union',
  18: 'emojione:flag-for-japan',
  19: 'emojione:flag-for-united-kingdom',
  20: 'emojione:flag-for-australia',
  21: 'emojione:flag-for-canada',
  22: 'mdi:swiss-cross-box',
  23: 'emojione:flag-for-new-zealand',
  24: 'streamline-plump:gold-remix',
  25: 'streamline-plump:gold-solid',
  26: 'mdi:barrel',
  6000: 'simple-icons:tesla',
  6001: 'simple-icons:microsoft',
  6002: 'simple-icons:nvidia',
  6003: 'simple-icons:google',
  6004: 'simple-icons:apple',
  6005: 'simple-icons:amazon',
  6006: 'simple-icons:meta',
  6009: 'simple-icons:intel',
  6010: 'simple-icons:coinbase',
  6011: 'arcticons:gamestop',
  6034: 'simple-icons:nike',
  6038: 'simple-icons:oracle',
  6059: 'simple-icons:cocacola',
  6066: 'simple-icons:ibm',
  6068: 'simple-icons:mcdonalds',
  6113: 'emojione:flag-for-united-states',
  6114: 'emojione:flag-for-united-states',
  6115: 'emojione:flag-for-united-states',
};

export const getIconString = (assetId: number | undefined | null): string | null => {
  if (assetId === undefined || assetId === null) return null;
  return ASSET_ICONS_BY_ID[assetId] || null;
};

interface AssetIconProps {
  assetId?: number | null;
  symbol?: string;
  size?: string;
  className?: string;
  style?: React.CSSProperties;
  borderRadius?: string;
  themeControlBg?: string;
  themeText?: string;
  themeBorder?: string;
}

/**
 * AssetIcon component displaying colored icons OR a placeholder square with the first letter
 */
export const AssetIcon: React.FC<AssetIconProps> = ({ 
  assetId, 
  symbol = "",
  size = "24px", 
  className = "",
  style = {},
  borderRadius = "6px",
  themeControlBg = "#2d3436",
  themeText = "#fff",
  themeBorder = "rgba(255,255,255,0.1)"
}) => {
  useEffect(() => {
    // Load Iconify script if not already present
    if (typeof document !== 'undefined' && !document.getElementById('iconify-script')) {
      const script = document.createElement('script');
      script.id = 'iconify-script';
      script.src = "https://code.iconify.design/3/3.1.1/iconify.min.js";
      script.async = true;
      document.body.appendChild(script);
    }
  }, []);

  // Nettoyage du symbole (enlever USD, etc.)
  // On retire tous les caractères non-alphanumériques (/, -, ., etc.) pour plus de robustesse
  let normalized = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
  let cleanSymbol = normalized.replace('USD', '');
  
  // Si le symbole est vide après nettoyage (cas de l'USD pur), on remet 'USD'
  if (!cleanSymbol && normalized.includes('USD')) {
    cleanSymbol = 'USD';
  }

  const Web3IconComponent = WEB3_TOKEN_ICONS[cleanSymbol];
  const forexIconPath = FOREX_MAPPING[cleanSymbol] || FOREX_MAPPING[normalized];

  // Détection des métaux (XAU, XAG, XPT, XPD, HG)
  const metalCfg = METAL_CONFIG[cleanSymbol] || METAL_CONFIG[normalized];

  // Détection des pétroles (BRENT, CL)
  const oilCfg = OIL_CONFIG[cleanSymbol] || OIL_CONFIG[normalized];

  // Détection des indices (SPX, DJI, NDX, FTSE, DAX, HSI, NIK...)
  const indexKey = Object.keys(INDEX_CONFIG).find(k => normalized.startsWith(k));
  const indexCfg = indexKey ? INDEX_CONFIG[indexKey] : null;

  const sizeValue = parseInt(size) || 24;

  // 0. Indices boursiers : drapeau + label
  if (indexCfg) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: borderRadius,
          overflow: 'hidden',
          flexShrink: 0,
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          ...style
        }}
        className={className}
      >
        <img
          src={indexCfg.flag}
          alt={indexKey}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
        {indexCfg.label && (
          <span style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            textAlign: 'center',
            fontSize: `calc(${size} * 0.28)`,
            fontWeight: 700,
            color: '#ffffff',
            backgroundColor: 'rgba(0,0,0,0.55)',
            lineHeight: '1.4',
            letterSpacing: '-0.3px',
          }}>
            {indexCfg.label}
          </span>
        )}
      </div>
    );
  }

  // 0.5 Métaux : metals.svg + background coloré
  if (metalCfg) {
    return (
      <div 
        style={{ 
          width: size, 
          height: size, 
          borderRadius: borderRadius,
          overflow: 'hidden',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: metalCfg.bg,
          padding: '4px',
          boxSizing: 'border-box',
          ...style
        }}
        className={className}
      >
        <img 
          src="/metals.svg" 
          alt={cleanSymbol}
          style={{ 
            width: '100%', 
            height: '100%', 
            objectFit: 'contain',
            filter: 'brightness(0) invert(1)' // Passe le stroke noir en blanc
          }}
        />
      </div>
    );
  }

  // 0.6 Pétroles : oil.svg + styling spécifique
  if (oilCfg) {
    return (
      <div 
        style={{ 
          width: size, 
          height: size, 
          borderRadius: borderRadius,
          overflow: 'hidden',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: oilCfg.bg,
          padding: '4px',
          boxSizing: 'border-box',
          ...style
        }}
        className={className}
      >
        <img 
          src="/oil.svg" 
          alt={cleanSymbol}
          style={{ 
            width: '100%', 
            height: '100%', 
            objectFit: 'contain',
            filter: oilCfg.invert ? 'brightness(0) invert(1)' : 'none'
          }}
        />
      </div>
    );
  }

  // 1. Priorité aux Web3Icons (ETH, SOL, etc.)
  if (Web3IconComponent) {
    return (
      <div 
        style={{ 
          width: size, 
          height: size, 
          borderRadius: borderRadius,
          overflow: 'hidden',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          ...style
        }}
        className={className}
      >
        <Web3IconComponent variant="background" size={sizeValue} />
      </div>
    );
  }

  // 2. Icônes Forex locales (SVG dans /public)
  if (forexIconPath) {
    return (
      <div 
        style={{ 
          width: size, 
          height: size, 
          borderRadius: borderRadius,
          overflow: 'hidden',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          ...style
        }}
        className={className}
      >
        <img 
          src={forexIconPath} 
          alt={cleanSymbol}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </div>
    );
  }

  // 3. Logos d'entreprises locaux (SVG dans /public) - fond blanc en dark mode
  const stockIconPath = STOCK_ICONS[cleanSymbol] || STOCK_ICONS[normalized];
  if (stockIconPath) {
    const isFull = STOCK_ICONS_FULL.has(cleanSymbol) || STOCK_ICONS_FULL.has(normalized);
    return (
      <div 
        style={{ 
          width: size, 
          height: size, 
          borderRadius: borderRadius,
          overflow: 'hidden',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#ffffff',
          padding: isFull ? '0' : '3px',
          boxSizing: 'border-box',
          ...style
        }}
        className={className}
      >
        <img 
          src={stockIconPath} 
          alt={cleanSymbol}
          style={{ width: '100%', height: '100%', objectFit: isFull ? 'cover' : 'contain' }}
        />
      </div>
    );
  }

  const iconStr = getIconString(assetId);

  // 3. Si pas d'icône Web3Icon/Forex ET qu'on a un symbole, on utilise la lettre comme fallback (demande utilisateur)
  // Sauf pour les drapeaux/stocks qui ont un ID spécifique et pas de symbole direct mappé via Web3Icons
  if (symbol && !iconStr) {
    return (
      <div 
        style={{ 
          width: size, 
          height: size, 
          borderRadius: borderRadius,
          backgroundColor: themeControlBg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: `1px solid ${themeBorder}`,
          fontSize: `calc(${size} * 0.45)`,
          fontWeight: 600,
          color: themeText,
          flexShrink: 0,
          ...style
        }}
        className={className}
      >
        {symbol === 'AAPL' ? '' : symbol.charAt(0)}
      </div>
    );
  }

  // 3. Cas particulier pour les icônes existantes via Iconify (BTC, Flags, etc.) si l'assetId est fourni
  if (iconStr) {
    return (
      <div 
        style={{ 
          width: size, 
          height: size, 
          borderRadius: borderRadius,
          overflow: 'hidden',
          flexShrink: 0,
          backgroundColor: 'transparent',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.3s ease',
          ...style
        }}
        className={className}
      >
        <span 
          className="iconify" 
          data-icon={iconStr} 
          style={{ 
            width: '100%', 
            height: '100%', 
            display: 'block'
          }} 
        />
      </div>
    );
  }

  // 4. Fallback ultime
  return (
    <div 
      style={{ 
        width: size, 
        height: size, 
        borderRadius: borderRadius,
        backgroundColor: themeControlBg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: `1px solid ${themeBorder}`,
        fontSize: `calc(${size} * 0.45)`,
        fontWeight: 600,
        color: themeText,
        flexShrink: 0,
        ...style
      }}
      className={className}
    >
      ?
    </div>
  );
};
