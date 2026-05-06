# Brokex Solana

On-chain CFD trading protocol built on Solana using Rust and Anchor. This is the Solana port of the Brokex EVM protocol — enabling decentralized trading of real-world assets (stocks, forex, indices, commodities) with oracle-based pricing and a vault-backed liquidity model.

---

## Overview

Brokex operates on a **Book B model** — the protocol vault acts as the direct counterparty for all trades. Prices are sourced from the **Pyth Oracle** (no AMMs, no order books), ensuring execution at real market prices with zero artificial slippage.

Key mechanics:

- Traders speculate on price movements using leverage
- USDC is the sole settlement currency
- The vault holds liquidity and locks capital based on open interest
- Core and Vault are separate on-chain programs — trading logic is fully isolated from liquidity management

---

## Folder Structure

```text
brokex-solana/
├── programs/
│   ├── brokex-core/
│   │   ├── src/
│   │   │   ├── lib.rs                    # Program entry + instructions (initialize, assets, positions)
│   │   │   ├── constants.rs
│   │   │   ├── error.rs
│   │   │   ├── state.rs                  # Protocol config, assets, positions
│   │   │   ├── logic.rs                  # PnL / risk helpers
│   │   │   ├── oracle.rs                 # Oracle integration (Pyth)
│   │   │   ├── instructions.rs
│   │   │   └── instructions/
│   │   │       ├── initialize_protocol.rs
│   │   │       ├── add_asset.rs
│   │   │       ├── toggle_asset_status.rs
│   │   │       ├── toggle_protocol_status.rs
│   │   │       ├── update_admin.rs       # propose / accept admin
│   │   │       ├── open_position.rs
│   │   │       ├── close_position.rs
│   │   │       └── emergency_close.rs
│   │   └── tests/                        # Rust integration tests (LiteSVM / program-test)
│   └── brokex-vault/
│       ├── src/
│       │   ├── lib.rs
│       │   ├── contexts.rs               # #[derive(Accounts)] for Anchor clients
│       │   ├── constants.rs
│       │   ├── error.rs
│       │   ├── state/
│       │   │   └── vault.rs
│       │   └── instructions/
│       │       ├── initialize.rs
│       │       ├── deposit.rs
│       │       ├── withdraw.rs
│       │       ├── settle.rs             # CPI target — pay/receive from Core
│       │       └── admin_set_paused.rs
│       └── tests/
│           └── vault_flow.rs
├── deploy/                               # Program keypairs (used by prep:program-keys → target/deploy)
├── tests/                                # Anchor TS tests (mocha)
├── MVP_SPEC.md                           # MVP technical specification
├── .env.example
├── Anchor.toml                           # Anchor 1.0.1; program IDs & provider wallet
├── Cargo.toml
├── CONTRIBUTION.md
└── package.json
```

---

## Prerequisites

Ensure the following are installed before setting up the project:

- [Rust](https://rustup.rs/) (stable)
- [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools)
- [Anchor CLI](https://www.anchor-lang.com/docs/installation) **1.0.1** (match `anchor_version` in `Anchor.toml`; install via [AVM](https://www.anchor-lang.com/docs/installation))
- Node.js >= 18
- Yarn (classic / v1 — see `package.json` `packageManager`)

---

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/Brokex-org/brokex-sol.git
cd brokex-sol
```

Use your checkout directory name in later commands if it differs (for example if you renamed the folder).

### 2. Install dependencies

```bash
yarn install
```

### 3. Configure environment

```bash
cp .env.example .env
```

Fill in the required values in `.env` (see [Environment Variables](#environment-variables)). For deployed devnet programs you can copy IDs from `Anchor.toml` under `[programs.devnet]`.

### 4. Configure Solana CLI

```bash
solana config set --url devnet
solana-keygen new --outfile ~/.config/solana/id.json
solana airdrop 2
```

For `anchor test` on **localnet**, `Anchor.toml` points the provider wallet at `keys/localnet-authority.json`. Create that keypair (or adjust `Anchor.toml`) before running tests locally.

### 5. Build both programs

```bash
anchor build
```

### 6. Deploy to devnet

```bash
anchor deploy --provider.cluster devnet
```

Both programs will be deployed. Confirm with:

```bash
solana program show --programs
```

---

## Environment Variables

```env
# Solana Network
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
ANCHOR_WALLET=~/.config/solana/id.json

# Program IDs (match Anchor.toml [programs.devnet] after deploy, or build artifacts)
CORE_PROGRAM_ID=
VAULT_PROGRAM_ID=

# Pyth Devnet Price Feeds
PYTH_SOL_USD=H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG
PYTH_BTC_USD=GVXRSBjFk6e909Wjy64QnbB1W3ToS4RCgbkqXEbBKVGA
PYTH_ETH_USD=EdVCmQ9FSPcVe5YySXDPCRmc8aDQLKJ9xvYBMZPie1Vw
PYTH_EUR_USD=42amVS4KgzR9rA28tkVYqVXjq9Qa8dcZQMbH5EYFX6XC
PYTH_XAU_USD=AtRCZhwikbMsDAEYgwHFuBzGQuRQUMAfYomMaKnkEGRS

# USDC Mint (Devnet)
USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU

```

> **Never commit your `.env` or wallet keypair file.**

---

## Running Tests

### Anchor TypeScript tests (default workflow)

The repo pins Anchor **1.0.1**. Default `anchor test` uses Surfpool; if simulations fail with a message like program cannot execute instructions, use the **legacy** validator or the wrapper script:

```bash
yarn test:anchor
```

That runs `prep:program-keys`, `anchor build`, then `anchor test --skip-build --validator legacy`.

### Local validator (manual)

```bash
# Terminal 1
solana-test-validator

# Terminal 2
anchor test --provider.cluster localnet
```

### Rust tests

```bash
yarn test:rust
```

LiteSVM-backed integration tests (after build + key prep):

```bash
yarn test:rust:litesvm
```

### Against devnet

```bash
anchor test --provider.cluster devnet
```

### Useful checks

```bash
yarn check:rust    # cargo check both programs
yarn lint          # Prettier on JS/TS
```

---

## Tech Stack

| Layer              | Technology                             |
| ------------------ | -------------------------------------- |
| Smart contracts    | Rust + Anchor 1.0.1                    |
| Oracle             | Pyth Network                           |
| Settlement token   | USDC (SPL)                             |
| Testing            | Anchor TS + Rust (`cargo test`, LiteSVM integration where enabled) |
| Network            | Solana (Localnet / Devnet → Mainnet)   |

---

## Protocol Architecture

### Two-Program Design

The protocol is split into two independently deployable programs:

`brokex-core` handles all trading logic — protocol initialization, asset registry, oracle price reads, position lifecycle (open and close), and PnL computation. It temporarily holds trader collateral during an open position.

`brokex-vault` manages all USDC liquidity. It pays traders when they profit and collects funds when traders lose. In the current phase, liquidity is provided by the admin only. Core settles trades by calling Vault via CPI (Cross-Program Invocation).

### Oracle

All trade execution uses Pyth price feeds directly — no AMM formula. Price confidence intervals and staleness are validated on every instruction.

### Locked Capital

The Core tracks long and short open interest per asset and computes effective locked capital as:

```
max(lp_locked_long, lp_locked_short)
```

Trades are rejected if the resulting additional locked capital exceeds available vault free capital.

### Emergency Mode

A circuit breaker that halts trading, disables new orders, and allows traders to recover margins. No PnL is calculated in emergency mode.

---

## Position Lifecycle

- Admin initializes protocol (Core + Vault)
- Admin deposits USDC liquidity → Vault
- User opens position → Core (collateral transferred, entry price recorded)
- User closes position → Core reads exit price → PnL computed → Vault settles

## PnL & Settlement

- Long: profit if price rises, loss if price falls
- Short: profit if price falls, loss if price rises
- Profitable: trader receives collateral + profit paid from Vault
- Loss: loss deducted from collateral, sent to Vault, remainder returned
- Full loss: entire collateral transferred to Vault

---

## Contributing

Development happens on **`next-release`** — open PRs against that branch, not `main`. Use branches like `feat/*`, `fix/*`, and `chore/*`, keep one feature per branch, and run `anchor build` before submitting.

**[Full guidelines → `CONTRIBUTION.md`](CONTRIBUTION.md)** (setup, branch table, PR workflow, review rules, and ground rules).

---

## License

Private — Brokex Protocol. All rights reserved.
