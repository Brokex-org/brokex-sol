import { PublicKey } from '@solana/web3.js';
import { SOLANA_PROGRAM_IDS } from './programConfig';

const CONFIG_SEED = Buffer.from('config');
const ASSET_SEED = Buffer.from('asset');
const POSITION_SEED = Buffer.from('position');
const SETTLEMENT_SEED = Buffer.from('settlement');
const VAULT_SEED = Buffer.from('vault');

export function deriveConfigPda(programId = SOLANA_PROGRAM_IDS.core): PublicKey {
  return PublicKey.findProgramAddressSync([CONFIG_SEED], programId)[0];
}

export function deriveAssetPda(assetId: string, programId = SOLANA_PROGRAM_IDS.core): PublicKey {
  return PublicKey.findProgramAddressSync([ASSET_SEED, Buffer.from(assetId)], programId)[0];
}

export function deriveSettlementAuthorityPda(programId = SOLANA_PROGRAM_IDS.core): PublicKey {
  return PublicKey.findProgramAddressSync([SETTLEMENT_SEED], programId)[0];
}

export function derivePositionPda(
  trader: PublicKey,
  assetId: string,
  tradeId: bigint,
  programId = SOLANA_PROGRAM_IDS.core
): PublicKey {
  const tradeIdBuffer = Buffer.alloc(8);
  tradeIdBuffer.writeBigUInt64LE(tradeId);
  return PublicKey.findProgramAddressSync(
    [POSITION_SEED, trader.toBuffer(), Buffer.from(assetId), tradeIdBuffer],
    programId
  )[0];
}

export function deriveVaultStatePda(programId = SOLANA_PROGRAM_IDS.vault): PublicKey {
  return PublicKey.findProgramAddressSync([VAULT_SEED], programId)[0];
}
