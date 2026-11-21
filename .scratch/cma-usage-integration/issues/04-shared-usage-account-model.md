# 04: Extend shared Usage aggregation for CMA accounts

**What to build:** Shared Usage aggregation carries every CMA account, its enabled state, quota observation time, quota windows, subscription metadata, and stale or unavailable status. The aggregation continues to handle native provider accounts and Cliproxy accounts correctly.

**Blocked by:** 03: Isolate local Usage updates from CMA refreshes

**Status:** resolved

- [x] Preserve arbitrary account counts through shared Usage aggregation.
- [x] Carry subscription and observation metadata to all clients.
- [x] Keep existing provider and Cliproxy aggregation behavior intact.
