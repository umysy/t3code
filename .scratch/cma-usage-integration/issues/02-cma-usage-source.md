# 02: Add CMA to the T3 Usage source flow

**What to build:** CMA snapshots are available through the existing server-side Usage source flow. The boundary contract represents the CMA source kind, account enabled state, and subscription metadata. Disabled accounts remain visible while excluded from normal routing and refresh work. Existing Cliproxy Usage sources continue to work, and a failed CMA refresh preserves safely matched last-good readings.

**Blocked by:** 01: Establish the CMA structured reader

**Status:** ready-for-agent

- [ ] Publish normalized CMA snapshots through the existing environment Usage data flow.
- [ ] Keep disabled accounts visible and inactive for routing and refresh.
- [ ] Preserve existing Cliproxy source behavior and safe last-good readings.
