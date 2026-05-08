import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import { getRpcEndpoint, SOLANA_USDC_MINT } from './programConfig';

/** Circle sends devnet USDC for mint `SOLANA_USDC_MINT` — no DEX / Jupiter swap. */
export const CIRCLE_SOLANA_DEVNET_USDC_FAUCET_URL = 'https://faucet.circle.com/';

export function getTraderUsdcAta(owner: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(
    SOLANA_USDC_MINT,
    owner,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
}

export type PrepareUsdcAtaResult =
  | { kind: 'exists'; ata: PublicKey }
  | {
      kind: 'create';
      connection: Connection;
      transaction: Transaction;
      blockhash: string;
      lastValidBlockHeight: number;
    };

export async function prepareCreateUsdcAtaTransaction(owner: PublicKey): Promise<PrepareUsdcAtaResult> {
  const connection = new Connection(getRpcEndpoint(), 'confirmed');
  const ata = getTraderUsdcAta(owner);
  const info = await connection.getAccountInfo(ata, 'confirmed');
  if (info) {
    return { kind: 'exists', ata };
  }

  const ix = createAssociatedTokenAccountInstruction(
    owner,
    ata,
    owner,
    SOLANA_USDC_MINT,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const transaction = new Transaction({ feePayer: owner, blockhash, lastValidBlockHeight }).add(ix);
  return { kind: 'create', connection, transaction, blockhash, lastValidBlockHeight };
}
