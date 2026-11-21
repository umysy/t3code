# 04: Extend shared Usage aggregation for CMA accounts

**What to build:** Shared Usage aggregation carries every CMA account, its enabled state, quota observation time, quota windows, subscription metadata, and stale or unavailable status. The aggregation continues to handle native provider accounts and Cliproxy accounts correctly.

**Blocked by:** 03: Isolate local Usage updates from CMA refreshes

**Status:** ready-for-agent

- [ ] Preserve arbitrary account counts through shared Usage aggregation.
- [ ] Carry subscription and observation metadata to all clients.
- [ ] Keep existing provider and Cliproxy aggregation behavior intact.
