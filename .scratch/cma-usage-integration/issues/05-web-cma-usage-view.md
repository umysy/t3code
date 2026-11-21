# 05: Show CMA account details in Web Usage

**What to build:** The Web Usage page renders every CMA account returned by the server. Each account shows identity, enabled or disabled state, current state when available, 7-hour and 7-day quotas, reset times, observation time, plan, subscription expiry, renewal time, and renewal status. Unknown subscription fields display as unknown. Failed refreshes retain the last good data and expose stale or unavailable status. The existing refresh control starts an explicit refresh.

**Blocked by:** 04: Extend shared Usage aggregation for CMA accounts

**Status:** ready-for-agent

- [ ] Render more than two CMA accounts from data-driven account lists.
- [ ] Display quota, subscription, observation, and account state fields.
- [ ] Show stale or unavailable state after a failed refresh.
