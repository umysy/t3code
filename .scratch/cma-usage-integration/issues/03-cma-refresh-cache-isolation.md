# 03: Isolate local Usage updates from CMA refreshes

**What to build:** A completed conversation updates the local Usage ledger and the current account state without probing every CMA account. Normal Usage reads cached CMA snapshots. Explicit live refreshes use T3's existing request coalescing and apply an approximately five-minute minimum age gate. Subscription data is refreshed with the CMA snapshot or when its cache is stale.

**Blocked by:** 02: Add CMA to the T3 Usage source flow

**Status:** ready-for-agent

- [ ] Keep conversation completion independent from account-wide CMA probes.
- [ ] Coalesce repeated live refresh requests and enforce the refresh age gate.
- [ ] Refresh subscription data only with a CMA snapshot or stale adapter cache.
