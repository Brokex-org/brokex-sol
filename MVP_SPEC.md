# Brokex MVP — Technical Specification (Solana)

## Objective

Build a minimal trading protocol on Solana that allows users to:

* open a position at the current market price,
* close the position at the current market price,
* compute profit or loss based on oracle prices,
* settle gains or losses using a dedicated liquidity pool.

No additional features are required at this stage.

---

## Architecture

The system is composed of two on-chain programs:

### 1. Core Program

The Core program is responsible for all trading logic:

* managing user positions,
* storing position data,
* fetching prices from the oracle,
* computing profit and loss,
* triggering settlement with the Vault.

It temporarily holds trader collateral.

---

### 2. Vault Program

The Vault program is responsible for liquidity management:

* holds USDC liquidity,
* pays traders when they make a profit,
* receives funds when traders incur losses.

In this MVP, liquidity is provided only by the admin.

---

## Token

* All operations are done in **USDC (SPL token)**.
* Transfers follow standard SPL token mechanics.
* The Vault uses a token account controlled by a PDA.

---

## Oracle

The system uses **Pyth Oracle** for pricing.

Requirements:

* read the latest price from the Pyth price account,
* ensure the price is valid and recent,
* normalize the price to a consistent precision (e.g. 1e6).

No price transformation is applied.

---

## Assets

* Each tradable asset is associated with a Pyth price feed.
* Assets must be configurable by the admin.
* Only listed and enabled assets can be traded.

---

## Position Model

Each position must store:

* trader public key,
* asset identifier,
* direction (long or short),
* collateral (in USDC),
* leverage,
* position size (collateral × leverage),
* entry price (oracle price at opening),
* current state (open or closed).

---

## Opening a Position

When a user opens a position:

* the program reads the current price from Pyth,
* the user transfers USDC as collateral,
* the position size is calculated using leverage,
* the position is stored with its entry price.

No additional adjustments are applied.

---

## Closing a Position

When a user closes a position:

* the program reads the current price from Pyth,
* the price difference between entry and exit is computed,
* the profit or loss is derived from that difference.

---

## PnL Calculation

PnL depends on direction:

* **Long position**

  * profit if price increases,
  * loss if price decreases.

* **Short position**

  * profit if price decreases,
  * loss if price increases.

The PnL is proportional to:

* the position size,
* the relative price change.

---

## Settlement Logic

After PnL calculation:

### If the trader is profitable:

* the trader receives:

  * their initial collateral,
  * plus the profit paid from the Vault.

### If the trader incurs a loss:

* the loss is deducted from collateral,
* the loss amount is transferred to the Vault,
* any remaining collateral is returned to the trader.

### If losses exceed collateral:

* the trader loses the entire collateral,
* no funds are returned.

---

## Vault Behavior

The Vault must:

* store USDC liquidity,
* allow the admin to deposit and withdraw funds,
* pay trader profits,
* collect trader losses.

It acts as the counterparty to all trades.

---

## Constraints

The program must enforce:

* only the position owner can close their position,
* the position must be in an open state,
* oracle data must be valid and not stale,
* the protocol can be paused by the admin.

---

## Out of Scope (Not Included)

The following features are explicitly excluded from this MVP:

* limit or stop orders,
* liquidation mechanisms,
* stop loss / take profit,
* spreads,
* funding rates,
* global open interest tracking,
* imbalance protection,
* public LP deposits,
* withdrawal queues,
* automated execution (keepers).

---

## Final Behavior

The system must support the following lifecycle:

* admin initializes the protocol and provides USDC liquidity,
* a user opens a position using USDC collateral,
* the system records the entry price from Pyth,
* the user closes the position,
* the system computes profit or loss based on price difference,
* the Vault settles the result accordingly.

---

## Summary

This MVP is intentionally minimal:

* one price at entry,
* one price at exit,
* one calculation,
* one settlement.

Nothing more.
