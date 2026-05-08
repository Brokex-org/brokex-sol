import { useState, useCallback, useEffect } from 'react';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';
import { parseUnits, formatUnits, keccak256, stringToHex, encodeAbiParameters } from 'viem';

// --- CONFIGURATION ARBITRUM SEPOLIA ---
const USDC_ADDRESS = '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d' as const;
const VAULT_ADDRESS = '0x0EaC556c0C2321BA25b9DC01e4e3c95aD5CDCd2f' as const;
const BROKER_ID = 'woofi_pro';

// --- ABIs MINIMALES ---
const ERC20_ABI = [
  { inputs: [{ name: "account", type: "address" }], name: "balanceOf", outputs: [{ name: "", type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], name: "allowance", outputs: [{ name: "", type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], name: "approve", outputs: [{ name: "", type: "bool" }], stateMutability: "nonpayable", type: "function" }
] as const;

// J'ai renommé les paramètres de l'ABI pour correspondre exactement à ce que tu as vu sur l'explorateur !
const VAULT_ABI = [
  {
    inputs: [
      { name: "receiver", type: "address" },
      {
        components: [
          { name: "accountId", type: "bytes32" },
          { name: "brokerHash", type: "bytes32" },
          { name: "tokenHash", type: "bytes32" },
          { name: "tokenAmount", type: "uint128" }
        ],
        name: "data",
        type: "tuple"
      }
    ],
    name: "getDepositFee",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        components: [
          { name: "accountId", type: "bytes32" },
          { name: "brokerHash", type: "bytes32" },
          { name: "tokenHash", type: "bytes32" },
          { name: "tokenAmount", type: "uint128" }
        ],
        name: "data",
        type: "tuple"
      }
    ],
    name: "deposit",
    outputs: [],
    stateMutability: "payable",
    type: "function"
  }
] as const;

export function useOrderlyDeposit() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const [usdcBalance, setUsdcBalance] = useState<string>('0');
  const [isProcessing, setIsProcessing] = useState(false);
  const [logs, setLogs] = useState<string>('');

  // 1. LIRE LE SOLDE USDC
  const fetchBalance = useCallback(async () => {
    if (!address || !publicClient) return;
    try {
      const balance = await publicClient.readContract({
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [address],
      });
      setUsdcBalance(formatUnits(balance, 6));
    } catch (err) {
      console.error("Erreur lecture solde:", err);
    }
  }, [address, publicClient]);

  useEffect(() => {
    fetchBalance();
    const interval = setInterval(fetchBalance, 10000);
    return () => clearInterval(interval);
  }, [fetchBalance]);

  // 2. LA FONCTION DE DÉPÔT
  const deposit = useCallback(async (amountStr: string) => {
    if (!address || !publicClient || !walletClient) {
      setLogs("❌ Wallet manquant.");
      return;
    }

    try {
      setIsProcessing(true);
      const amountParsed = parseUnits(amountStr, 6); // USDC = 6 décimales

      // --- ETAPE 1 : VÉRIFIER L'ALLOWANCE ---
      setLogs("1/4 Vérification de l'autorisation (Allowance)...");
      const currentAllowance = await publicClient.readContract({
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [address, VAULT_ADDRESS],
      });

      if (currentAllowance < amountParsed) {
        setLogs("2/4 Approbation des USDC requise dans MetaMask...");
        const hash = await walletClient.writeContract({
          address: USDC_ADDRESS,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [VAULT_ADDRESS, amountParsed],
        });
        setLogs("Attente de la validation de la transaction d'approbation...");
        await publicClient.waitForTransactionReceipt({ hash });
      } else {
        setLogs("2/4 Allowance suffisante, pas besoin d'approuver.");
      }

      // --- ETAPE 2 : PRÉPARATION CRYPTOGRAPHIQUE (Anti-Revert !) ---
      setLogs("3/4 Calcul des frais de dépôt cross-chain...");
      
      // On utilise stringToHex qui est la méthode la plus propre pour Viem
      const brokerHash = keccak256(stringToHex(BROKER_ID));
      const tokenHash = keccak256(stringToHex('USDC'));
      
      // LA MAGIE EST ICI : On calcule l'Account ID exactement comme le fait le Smart Contract
      // abi.encode(["address", "bytes32"], [userAddress, brokerHash])
      const onChainAccountId = keccak256(
        encodeAbiParameters(
          [{ type: 'address' }, { type: 'bytes32' }],
          [address, brokerHash]
        )
      );

      const depositInput = {
        accountId: onChainAccountId,
        brokerHash,
        tokenHash,
        tokenAmount: amountParsed,
      };

      // --- ETAPE 3 : RÉCUPÉRER LES FRAIS (Deposit Fee) ---
      const depositFeeWei = await publicClient.readContract({
        address: VAULT_ADDRESS,
        abi: VAULT_ABI,
        functionName: 'getDepositFee',
        args: [address, depositInput],
        // Sécurité supplémentaire : On précise qui fait l'appel pour éviter les reverts liés à msg.sender
        account: address 
      });

      // --- ETAPE 4 : EXÉCUTER LE DÉPÔT ---
      setLogs("4/4 Signature du dépôt dans MetaMask...");
      const txHash = await walletClient.writeContract({
        address: VAULT_ADDRESS,
        abi: VAULT_ABI,
        functionName: 'deposit',
        args: [depositInput],
        value: depositFeeWei, // On envoie les frais en ETH natif
      });

      setLogs(`✅ Transaction envoyée ! Hash: ${txHash.slice(0,10)}...`);
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      
      setLogs("🎉 Dépôt réussi ! Les fonds apparaîtront bientôt sur Orderly.");
      fetchBalance(); 

    } catch (err: any) {
      console.error(err);
      setLogs(`❌ Erreur: ${err.shortMessage || err.message}`);
    } finally {
      setIsProcessing(false);
    }
  }, [address, publicClient, walletClient, fetchBalance]);

  return {
    usdcBalance,
    isProcessing,
    logs,
    deposit
  };
}