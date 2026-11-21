# 07: Verify CMA Usage across supported surfaces

**What to build:** Focused tests verify the complete CMA Usage behavior across server contracts, shared aggregation, Web, desktop reuse, and Mobile. Coverage includes more than two accounts, quota windows and reset times, missing subscription expiry, failed refresh retention, conversation completion without account-wide probing, refresh deduplication, and continued Cliproxy support.

**Blocked by:** 05: Show CMA account details in Web Usage; 06: Show CMA account details in Mobile Usage

**Status:** ready-for-agent

- [ ] Verify arbitrary account counts and all displayed quota and subscription fields.
- [ ] Verify missing expiry, stale snapshots, and failed refresh retention.
- [ ] Verify local Usage updates do not trigger account-wide probes.
- [ ] Verify repeated refreshes are deduplicated and Cliproxy sources remain compatible.
