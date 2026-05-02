# Brokex Solana

On-chain CFD trading protocol built on Solana using Rust and Anchor. This is the Solana port of the Brokex EVM protocol — enabling decentralized trading of real-world assets (stocks, forex, indices, commodities) with oracle-based pricing and a vault-backed liquidity model.

---

## Overview

Brokex operates on a **Book B model** — the protocol vault acts as the direct counterparty for all trades. Prices are sourced from the **Pyth Oracle** (no AMMs, no order books), ensuring execution at real market prices with zero artificial slippage.

Key mechanics:
- Traders speculate on price movements using leverage; each listed asset defines its own minimum and maximum leverage (there is no single protocol-wide maximum)
- USDC is the sole settlement currency
- The vault holds all liquidity and dynamically locks capital based on open interest imbalance
- Spread and funding mechanisms incentivize traders to rebalance the system

---

## Prerequisites

Ensure the following are installed before setting up the project:

- [Rust](https://rustup.rs/) (stable)
- [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools)
- [Anchor CLI](https://www.anchor-lang.com/docs/installation) via AVM
- Node.js >= 18
- Yarn

---

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/Brokex-org/brokex-sol.git
cd brokex-sol
```

### 2. Install dependencies

```bash
yarn install
```

### 3. Configure environment

```bash
cp .env.example .env
```

Fill in the required values in `.env` (see [Environment Variables](#environment-variables)).

### 4. Configure Solana CLI

```bash
solana config set --url devnet
solana-keygen new --outfile ~/.config/solana/id.json
solana airdrop 2
```

### 5. Build the program

```bash
anchor build
```

### 6. Get your Program ID

```bash
solana address -k target/deploy/brokex-keypair.json
```

Update `declare_id!()` in `programs/brokex/src/lib.rs` and `[programs.devnet]` in `Anchor.toml` with this value.

### 7. Deploy to devnet

```bash
anchor deploy --provider.cluster devnet
```

---

## Environment Variables

```env
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
ANCHOR_WALLET=~/.config/solana/id.json
PROGRAM_ID=

# Pyth devnet price feed addresses
PYTH_SOL_USD=H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG
PYTH_BTC_USD=GVXRSBjFk6e909Wjy64QnbB1W3ToS4RCgbkqXEbBKVGA
PYTH_ETH_USD=EdVCmQ9FSPcVe5YySXDPCRmc8aDQLKJ9xvYBMZPie1Vw
```

> **Never commit your `.env` or wallet keypair file.**

---

## Running Tests

### Local validator (recommended for development)

```bash
# Terminal 1
solana-test-validator

# Terminal 2
anchor test --provider.cluster localnet
```

### Against devnet

```bash
anchor test --provider.cluster devnet
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Smart contracts | Rust + Anchor |
| Oracle | Pyth Network |
| Settlement token | USDC (SPL) |
| Off-chain keeper | TypeScript + @solana/web3.js |
| Testing | solana-program-test + Anchor TS client |
| Network | Solana (Devnet → Mainnet) |

---

## Protocol Architecture

### Vault
The vault holds all USDC liquidity and is the counterparty for every trade. LPs deposit USDC and receive LP shares (SPL tokens). LP token price reflects real-time trader PnL exposure: `vault value = USDC balance − unrealized trader PnL`.

### Oracle
All trade execution uses Pyth price feeds directly — no AMM formula. Price confidence intervals and staleness are validated on every instruction.

### Imbalance & Alpha
The protocol tracks long and short open interest per asset. Imbalance is measured as:

```
imbalance = |longOI - shortOI| / (longOI + shortOI)
```

The alpha coefficient dynamically controls how much vault capital is locked:

```
alpha = alphaMin + (alphaMax - alphaMin) * (imbalance ^ K)
needLock = max(longSideRisk, shortSideRisk) * alpha
```

Trades are rejected if the resulting `needLock` exceeds available vault capital.

### Spread & Funding
- **Spread**: Traders opening on the dominant side receive worse pricing; the weaker side gets better pricing.
- **Funding**: Paid to the protocol (not peer-to-peer). Higher imbalance contribution = higher funding rate.

### Emergency Mode
A circuit breaker that halts trading, disables new orders, and allows traders to recover margins. No PnL is calculated in emergency mode.

---


## License

Private — Brokex Protocol. All rights reserved.