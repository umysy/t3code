# 06: Show CMA account details in Mobile Usage

**What to build:** The Mobile Usage experience renders the same normalized CMA account data as Web. It supports arbitrary account counts, quota windows and reset times, subscription metadata, unknown subscription expiry, observation time, and stale or unavailable state. Its refresh action uses the shared server-side refresh behavior.

**Blocked by:** 04: Extend shared Usage aggregation for CMA accounts

**Status:** resolved

- [x] Render every CMA account returned by the server.
- [x] Display quota, subscription, observation, and account state fields.
- [x] Show stale or unavailable state and use the shared refresh path.
