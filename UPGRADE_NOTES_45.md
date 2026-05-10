# Upgrade Notes: Issue #45 (MVP §§14–16)

This change adds `liquidation_threshold_bps` to `Asset`, which changes serialized account layout (`Asset::INIT_SPACE`).

## High-risk upgrade caveat

Existing on-chain `Asset` accounts created before this change are not layout-compatible with the new struct.

## Required migration plan before mainnet/testnet upgrade

1. Deploy this program only alongside a migration flow.
2. Recreate or migrate all existing `Asset` PDAs to the new layout.
3. Set `liquidation_threshold_bps` explicitly for each asset (expected range: `9000..=10000`).
4. Verify open/close flows against migrated assets before enabling trading.

If migration is not possible in-place, treat this as a fresh-deploy state version and bootstrap assets from scratch.
