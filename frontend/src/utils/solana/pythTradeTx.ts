import type { Wallet } from '@coral-xyz/anchor';
import { PythSolanaReceiver } from '@pythnetwork/pyth-solana-receiver';
import type { InstructionWithEphemeralSigners } from '@pythnetwork/solana-utils';
import {
  Connection,
  type PublicKey,
  type Transaction,
  type TransactionInstruction,
  VersionedTransaction,
} from '@solana/web3.js';
import type { Signer } from '@solana/web3.js';
import { fetchHermesLatestPriceUpdatesBase64 } from './pythHermes';

export function phantomToAnchorWallet(
  phantom: {
    signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
    signAllTransactions?<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]>;
  },
  publicKey: PublicKey,
): Wallet {
  return {
    publicKey,
    signTransaction: <T extends Transaction | VersionedTransaction>(tx: T) => phantom.signTransaction(tx),
    signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]) => {
      if (phantom.signAllTransactions) {
        return phantom.signAllTransactions(txs);
      }
      const out: (Transaction | VersionedTransaction)[] = [];
      for (const tx of txs) {
        out.push(await phantom.signTransaction(tx));
      }
      return out as typeof txs;
    },
  } as unknown as Wallet;
}

/**
 * Post latest Hermes prices then run consumer instructions (e.g. open/close position).
 * May produce multiple legacy transactions if the Pyth post path exceeds packet size.
 */
export async function sendHermesPythThenConsumeLegacy(params: {
  connection: Connection;
  trader: PublicKey;
  phantom: {
    signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
    signAllTransactions?<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]>;
  };
  pythFeedId0x: string;
  buildConsumerInstructions: (getPriceUpdateAccount: (feedId: string) => PublicKey) => Promise<
    InstructionWithEphemeralSigners[]
  >;
  computeUnitPriceMicroLamports?: number;
}): Promise<string[]> {
  const wallet = phantomToAnchorWallet(params.phantom, params.trader);
  const receiver = new PythSolanaReceiver({
    connection: params.connection,
    wallet,
  });
  const blobs = await fetchHermesLatestPriceUpdatesBase64([params.pythFeedId0x]);
  const tb = receiver.newTransactionBuilder({ closeUpdateAccounts: false });
  await tb.addPostPriceUpdates(blobs);
  await tb.addPriceConsumerInstructions(params.buildConsumerInstructions);

  const built = tb.buildLegacyTransactions({
    computeUnitPriceMicroLamports: params.computeUnitPriceMicroLamports ?? 50_000,
    tightComputeBudget: true,
  });

  const { blockhash, lastValidBlockHeight } = await params.connection.getLatestBlockhash('confirmed');
  const signatures: string[] = [];

  for (const { tx, signers } of built) {
    tx.feePayer = params.trader;
    tx.recentBlockhash = blockhash;
    for (const s of signers) {
      tx.partialSign(s);
    }
    const signed = await params.phantom.signTransaction(tx);
    const sig = await params.connection.sendRawTransaction(signed.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });
    await params.connection.confirmTransaction(
      { signature: sig, blockhash, lastValidBlockHeight },
      'confirmed',
    );
    signatures.push(sig);
  }

  return signatures;
}

/**
 * Wrap a plain instruction for the Pyth transaction builder.
 * Pass a non-zero `computeUnits` (default 400k): with `tightComputeBudget`, a sum of 0 becomes SetComputeUnitLimit(0) and fails (e.g. ATA program).
 */
export function ix(
  instruction: TransactionInstruction,
  signers: Signer[] = [],
  computeUnits = 400_000,
): InstructionWithEphemeralSigners {
  return { instruction, signers, computeUnits };
}
