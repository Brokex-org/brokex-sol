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


---

## **Core Requirements — Extended MVP Clarification (Brokex Solana)**

The current implementation must be adjusted to support a correct and scalable trading architecture. The priority is not advanced risk modeling, but ensuring that opening, closing, accounting, and settlement are strictly correct and consistent.

---

## **1. Multiple Positions and Trade Identification**

The current design does not allow multiple positions per trader per asset because positions are indexed using a PDA derived from `(trader, asset_id)`.

This must be changed.

The system must support:

* multiple simultaneous positions per user,
* multiple positions across multiple assets,
* independent lifecycle per position.

Each position must therefore have a unique identifier:

* introduce a global or per-user `position_id` counter,
* each new position increments the counter,
* positions are stored using `(position_id)` as a primary key.

This is mandatory for scalability and correct accounting.

---

## **2. Per-Asset Accounting (Long / Short Separation)**

For each asset, the Core must track independently:

* `oi_long` (total long position size),
* `oi_short` (total short position size),
* `sum_priced_oi_long` (sum of size × entry price for longs),
* `sum_priced_oi_short` (same for shorts),
* `lp_locked_long`,
* `lp_locked_short`.

The weighted average entry prices must be computable at all times:

* `avg_long_entry = sum_priced_oi_long / oi_long`
* `avg_short_entry = sum_priced_oi_short / oi_short`

These values are not immediately used for trading logic, but they are critical for future Vault accounting (LP token pricing and unrealized PnL tracking).

---

## **3. LP Locked Capital Logic (Per Asset)**

The system must strictly follow this rule:

The effective locked capital for an asset is NOT:

`lp_locked_long + lp_locked_short`

It is:

`max(lp_locked_long, lp_locked_short)`

This reflects the net exposure of the system.

---

## **4. Locked Capital Updates on Open / Close**

### On Position Open

When a position is opened:

* update the corresponding side (long or short),
* update OI, priced OI, and LP locked capital,
* compute:

`asset_locked_before = max(lp_locked_long, lp_locked_short)`

Then simulate the new values:

`asset_locked_after = max(new_lp_locked_long, new_lp_locked_short)`

Then:

`delta_locked = asset_locked_after - asset_locked_before`

This delta represents the **actual additional capital requirement**.

---

### On Position Close

When a position is closed:

* subtract the exact position values from:

  * OI,
  * priced OI,
  * LP locked capital (long or short side),
* recompute:

`asset_locked_before = previous max(...)`
`asset_locked_after = new max(...)`

Then:

`delta_unlocked = asset_locked_before - asset_locked_after`

Important constraint:

**Closing a position must NEVER increase locked capital.**

At worst, locked capital remains unchanged.
In most cases, it decreases.

This must be strictly enforced.

---

## **5. Global Locked Capital (Vault Responsibility)**

The Vault must track:

`total_locked_capital`

This value must represent the sum across all assets of:

`max(lp_locked_long, lp_locked_short)`

The Vault must also expose:

`free_capital = vault_balance - total_locked_capital`

This is the only capital available to back new positions.

---

## **6. Trade Acceptance Rule (Critical)**

Before opening a new position, the Core must:

* compute `delta_locked` (as defined above),
* fetch or verify Vault free capital,
* enforce:

If `free_capital >= delta_locked` → accept trade
Else → reject trade

This is a **hard constraint**. No trade should be opened without sufficient backing liquidity.

---

## **7. Settlement Logic (Strict MVP Behavior)**

The settlement must follow strictly:

If trader is profitable:

* trader receives:

  * full collateral (from Core),
  * profit (from Vault).

If trader is at a loss:

* loss is deducted from collateral,
* loss is transferred from Core collateral to Vault,
* remaining collateral is returned to trader.

If loss ≥ collateral:

* trader loses entire collateral,
* Vault receives full collateral.

The Vault must be called with:

* `settle(profit, 0)` OR
* `settle(0, loss)`

Never both at the same time.

---

## **8. Commission Logic**

Commission must:

* be charged **only at position opening**,
* be transferred immediately to the Vault,
* never be charged at closing.

No additional fee logic is required at this stage.

---

## **9. Emergency Mode**

A dedicated emergency function must be implemented.

When:

* protocol is paused, or
* emergency mode is activated,

users must be able to call:

**emergency_close**

This function must:

* allow closing even when paused,
* return **100% of collateral** to the trader,
* NOT compute PnL,
* NOT use oracle price,
* NOT apply any spread,
* NOT interact with Vault for profit,
* mark position as `EmergencyClosed`,
* fully remove position from all accounting (OI, priced OI, LP locked).

This ensures users are never stuck.

---

## **10. Asset Validation and Delisting**

Before opening a position:

* the asset must exist,
* the asset must be enabled.

If not → reject.

If an asset is disabled (delisted):

* users must still be able to **close existing positions**,
* users must NOT be able to **open new positions**.

---

## **11. Priority Scope (What NOT to Implement Yet)**

At this stage, DO NOT implement:

* spread,
* alpha / K risk models,
* funding rates,
* imbalance penalties,
* liquidation mechanisms,
* stop loss / take profit,
* keepers or automation.

The only goal is:

**correct accounting + correct settlement + correct capital management**

---

## **12. Future Use of Average Prices (Important Context)**

The weighted average entry prices (long and short) will later be used inside the Vault to:

* compute unrealized PnL across all traders,
* determine the net position of the protocol,
* calculate LP token price dynamically.

Developers must ensure these values are accurate and continuously updated, even if unused for now.

---

## **Final Summary**

The system must guarantee:

* multiple independent positions per user,
* exact per-asset long/short accounting,
* correct LP capital locking using `max(long, short)`,
* correct global locked capital tracking in the Vault,
* strict liquidity checks before opening trades,
* proper settlement between Core and Vault,
* one-time commission at opening,
* safe emergency exit mechanism.

No advanced trading logic is required at this stage. Only correctness and consistency matter.
