import {
  AccountMeta,
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { SOLANA_PROGRAM_IDS, SOLANA_USDC_MINT, getRpcEndpoint } from './programConfig';
import {
  deriveAssetPda,
  deriveConfigPda,
  derivePositionPda,
  deriveSettlementAuthorityPda,
  deriveVaultStatePda,
} from './pdas';

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

function encodeU64(value: bigint): Buffer {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(value);
  return out;
}

function encodeString(value: string): Buffer {
  const str = Buffer.from(value, 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(str.length, 0);
  return Buffer.concat([len, str]);
}

function getAtaAddress(mint: PublicKey, owner: PublicKey): PublicKey {
  const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
    'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
  );
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
}

function readNextPositionId(configAccountData: Buffer): bigint {
  // 8 discriminator + 32 admin + 1 paused + 1 emergency_mode
  const offset = 42;
  return configAccountData.readBigUInt64LE(offset);
}

/** Exported for Solana position discovery (see `solanaPositions.ts`). */
export function readNextPositionIdFromConfig(configAccountData: Buffer): bigint {
  return readNextPositionId(configAccountData);
}

export async function buildCreateCoreCollateralAtaIxIfNeeded(
  payer: PublicKey,
): Promise<TransactionInstruction | null> {
  const connection = new Connection(getRpcEndpoint(), 'confirmed');
  const settlementAuthority = deriveSettlementAuthorityPda();
  const ata = getAssociatedTokenAddressSync(SOLANA_USDC_MINT, settlementAuthority, true);
  const info = await connection.getAccountInfo(ata, 'confirmed');
  if (info) return null;
  return createAssociatedTokenAccountInstruction(
    payer,
    ata,
    settlementAuthority,
    SOLANA_USDC_MINT,
  );
}

export async function buildOpenPositionIx(params: {
  trader: PublicKey;
  assetSymbol: string;
  collateralUsdc: bigint;
  leverage: number;
  side: 'buy' | 'sell';
  orderType: 'market' | 'limit' | 'stop';
  targetPriceMicro: bigint;
  slPriceMicro: bigint;
  tpPriceMicro: bigint;
  pythPriceUpdate: PublicKey;
}) {
  const connection = new Connection(getRpcEndpoint(), 'confirmed');
  const configPda = deriveConfigPda();
  const configAccount = await connection.getAccountInfo(configPda);
  if (!configAccount) {
    const rpc = getRpcEndpoint();
    throw new Error(
      `Protocol is not initialized on this cluster (no config account at ${configPda.toBase58()}). ` +
        `Use an RPC where brokex has been bootstrapped: run vault initialize, initialize_protocol, add_asset per market, and vault deposit. ` +
        `RPC: ${rpc}`
    );
  }

  const nextPositionId = readNextPositionId(configAccount.data);
  const assetId = `${params.assetSymbol}/USD`;
  const positionPda = derivePositionPda(params.trader, assetId, nextPositionId);
  const assetPda = deriveAssetPda(assetId);
  const vaultStatePda = deriveVaultStatePda();
  const settlementAuthority = deriveSettlementAuthorityPda();
  const traderTokenAccount = getAtaAddress(SOLANA_USDC_MINT, params.trader);
  const vaultTokenAccount = getAtaAddress(SOLANA_USDC_MINT, vaultStatePda);
  const coreCollateralToken = getAtaAddress(SOLANA_USDC_MINT, settlementAuthority);
  const pythPriceUpdate = params.pythPriceUpdate;

  const direction = params.side === 'buy' ? 0 : 1; // Long, Short
  const orderType = params.orderType === 'limit' ? 1 : params.orderType === 'stop' ? 2 : 0; // Market, Limit, Stop

  const data = Buffer.concat([
    Buffer.from([135, 128, 47, 77, 15, 152, 240, 49]), // open_position discriminator
    encodeString(assetId),
    encodeU64(params.collateralUsdc),
    Buffer.from([params.leverage]),
    Buffer.from([direction]),
    Buffer.from([orderType]),
    encodeU64(params.targetPriceMicro),
    encodeU64(params.slPriceMicro),
    encodeU64(params.tpPriceMicro),
  ]);

  const keys: AccountMeta[] = [
    { pubkey: params.trader, isSigner: true, isWritable: true },
    { pubkey: configPda, isSigner: false, isWritable: true },
    { pubkey: assetPda, isSigner: false, isWritable: true },
    { pubkey: pythPriceUpdate, isSigner: false, isWritable: false },
    { pubkey: positionPda, isSigner: false, isWritable: true },
    { pubkey: traderTokenAccount, isSigner: false, isWritable: true },
    { pubkey: vaultTokenAccount, isSigner: false, isWritable: true },
    { pubkey: coreCollateralToken, isSigner: false, isWritable: true },
    { pubkey: vaultStatePda, isSigner: false, isWritable: true },
    { pubkey: settlementAuthority, isSigner: false, isWritable: false },
    { pubkey: SOLANA_PROGRAM_IDS.vault, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  return {
    connection,
    instruction: new TransactionInstruction({
      programId: SOLANA_PROGRAM_IDS.core,
      keys,
      data,
    }),
  };
}

export async function buildClosePositionIx(params: {
  trader: PublicKey;
  assetSymbol: string;
  tradeId: bigint;
  pythPriceUpdate: PublicKey;
}) {
  const connection = new Connection(getRpcEndpoint(), 'confirmed');
  const assetId = `${params.assetSymbol}/USD`;
  const configPda = deriveConfigPda();
  const positionPda = derivePositionPda(params.trader, assetId, params.tradeId);
  const assetPda = deriveAssetPda(assetId);
  const vaultStatePda = deriveVaultStatePda();
  const settlementAuthority = deriveSettlementAuthorityPda();
  const traderTokenAccount = getAtaAddress(SOLANA_USDC_MINT, params.trader);
  const vaultTokenAccount = getAtaAddress(SOLANA_USDC_MINT, vaultStatePda);
  const coreCollateralToken = getAtaAddress(SOLANA_USDC_MINT, settlementAuthority);
  const pythPriceUpdate = params.pythPriceUpdate;

  const data = Buffer.concat([
    Buffer.from([123, 134, 81, 0, 49, 68, 98, 98]), // close_position
    encodeString(assetId),
    encodeU64(params.tradeId),
  ]);

  const keys: AccountMeta[] = [
    { pubkey: params.trader, isSigner: true, isWritable: true },
    { pubkey: configPda, isSigner: false, isWritable: false },
    { pubkey: assetPda, isSigner: false, isWritable: true },
    { pubkey: positionPda, isSigner: false, isWritable: true },
    { pubkey: pythPriceUpdate, isSigner: false, isWritable: false },
    { pubkey: vaultTokenAccount, isSigner: false, isWritable: true },
    { pubkey: traderTokenAccount, isSigner: false, isWritable: true },
    { pubkey: coreCollateralToken, isSigner: false, isWritable: true },
    { pubkey: settlementAuthority, isSigner: false, isWritable: false },
    { pubkey: SOLANA_PROGRAM_IDS.vault, isSigner: false, isWritable: false },
    { pubkey: vaultStatePda, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  return {
    connection,
    instruction: new TransactionInstruction({
      programId: SOLANA_PROGRAM_IDS.core,
      keys,
      data,
    }),
  };
}

export async function buildUpdateSlTpIx(params: {
  trader: PublicKey;
  assetSymbol: string;
  tradeId: bigint;
  slPriceMicro: bigint;
  tpPriceMicro: bigint;
}) {
  const connection = new Connection(getRpcEndpoint(), 'confirmed');
  const assetId = `${params.assetSymbol}/USD`;
  const positionPda = derivePositionPda(params.trader, assetId, params.tradeId);

  const data = Buffer.concat([
    Buffer.from([109, 142, 29, 74, 54, 26, 143, 169]), // update_sl_tp
    encodeString(assetId),
    encodeU64(params.tradeId),
    encodeU64(params.slPriceMicro),
    encodeU64(params.tpPriceMicro),
  ]);

  const keys: AccountMeta[] = [
    { pubkey: params.trader, isSigner: true, isWritable: true },
    { pubkey: positionPda, isSigner: false, isWritable: true },
  ];

  return {
    connection,
    instruction: new TransactionInstruction({
      programId: SOLANA_PROGRAM_IDS.core,
      keys,
      data,
    }),
  };
}

export async function buildCancelOrderIx(params: {
  trader: PublicKey;
  assetSymbol: string;
  tradeId: bigint;
}) {
  const connection = new Connection(getRpcEndpoint(), 'confirmed');
  const assetId = `${params.assetSymbol}/USD`;
  const configPda = deriveConfigPda();
  const positionPda = derivePositionPda(params.trader, assetId, params.tradeId);
  const settlementAuthority = deriveSettlementAuthorityPda();
  const traderTokenAccount = getAtaAddress(SOLANA_USDC_MINT, params.trader);
  const coreCollateralToken = getAtaAddress(SOLANA_USDC_MINT, settlementAuthority);

  const data = Buffer.concat([
    Buffer.from([95, 129, 237, 240, 8, 49, 223, 132]), // cancel_order
    encodeString(assetId),
    encodeU64(params.tradeId),
  ]);

  const keys: AccountMeta[] = [
    { pubkey: params.trader, isSigner: true, isWritable: true },
    { pubkey: configPda, isSigner: false, isWritable: false },
    { pubkey: positionPda, isSigner: false, isWritable: true },
    { pubkey: traderTokenAccount, isSigner: false, isWritable: true },
    { pubkey: coreCollateralToken, isSigner: false, isWritable: true },
    { pubkey: settlementAuthority, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  return {
    connection,
    instruction: new TransactionInstruction({
      programId: SOLANA_PROGRAM_IDS.core,
      keys,
      data,
    }),
  };
}
