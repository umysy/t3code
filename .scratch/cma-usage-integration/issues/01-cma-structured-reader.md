# 01: Establish the CMA structured reader

**What to build:** The server reads `codex-multi-auth status --json` and `codex-multi-auth subscription --json`, then produces normalized records for every CMA account. Records include stable identity, enabled state, current state when available, 7-hour and 7-day quota windows, reset times, observation time, plan, and subscription metadata. Missing installation, command failures, timeouts, and invalid JSON become typed probe failures without exposing raw command output.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Read any number of accounts from structured CMA output.
- [ ] Map quota windows and subscription fields without inferring subscription expiry.
- [ ] Normalize probe failures without returning sensitive raw output.
