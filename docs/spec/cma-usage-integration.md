# CMA Usage Integration Specification

Status: accepted for implementation

## Goal

Integrate `codex-multi-auth` (CMA) into the forked T3 Code Usage experience. The integration must show every CMA-managed account, its quota windows, subscription status, and subscription expiry while preserving T3's existing Usage behavior and keeping future upstream updates easy to merge.

The implementation targets the fork at `https://github.com/umysy/t3code`. The official repository is the upstream at `https://github.com/pingdotgg/t3code`.

## Scope

The first implementation includes:

- reading any number of CMA-managed accounts
- showing account identity, enabled or disabled state, and current account state when available
- showing the 7-hour quota window and reset time
- showing the 7-day quota window and reset time
- showing when each quota snapshot was observed
- showing the ChatGPT or Codex plan name
- showing subscription expiry, renewal time, and renewal status when CMA provides them
- keeping Usage ledger data separate from upstream quota data
- refreshing local Usage data after a completed conversation without probing every account
- preserving T3's existing cached and deduplicated refresh behavior
- exposing an explicit refresh path for an upstream quota probe
- keeping the CMA integration behind an isolated adapter boundary

The account list is data-driven. The UI must not assume that there are only two accounts.

## Data sources

### CMA account and quota data

The adapter reads CMA's structured JSON output. The quota source is equivalent to:

```text
codex-multi-auth status --json
```

The adapter uses stable account identity from CMA when available. It maps the primary quota window to the 7-hour display and the secondary quota window to the 7-day display. The adapter preserves the reported `usedPercent`, `windowMinutes`, and `resetAtMs` values.

### CMA subscription data

The adapter reads:

```text
codex-multi-auth subscription --json
```

The subscription record may contain:

- `planType`
- `planDisplayName`
- `subscriptionPlan`
- `billingPeriod`
- `active`
- `expiresAt`
- `renewsAt`
- `willRenew`
- `scheduledPlanChange`
- `trial`

The UI must distinguish subscription expiry from OAuth token expiry and quota-window reset times.

### Local Usage ledger

The local Usage ledger records usage received from completed provider requests. It is displayed and refreshed independently from quota snapshots. A ledger update must not trigger a quota probe for every account.

## Integration boundary

The CMA adapter is server-side. Browser and mobile clients receive normalized T3 contracts through the existing environment and Usage data flow. Tokens, refresh credentials, and raw CMA output never cross the client boundary.

The adapter should integrate with T3's existing Usage limit source service so the existing stream, cache, refresh, and account aggregation behavior can be reused. The adapter must not make the existing `UsageLimitSources` callers invoke CMA-specific commands.

The normalized account shape contains:

```ts
type CmaUsageAccount = {
  id: string;
  email?: string;
  plan?: string;
  enabled: boolean;
  current?: boolean;
  subscription?: {
    planType?: string;
    planDisplayName?: string;
    billingPeriod?: string;
    active?: boolean;
    expiresAt?: string;
    renewsAt?: string;
    willRenew?: boolean;
  };
  quota: {
    checkedAt: string;
    windows: Array<{
      id: "primary" | "secondary";
      label: "7-hour" | "7-day";
      usedPercent: number;
      windowMinutes?: number;
      resetsAt?: string;
    }>;
  };
};
```

The public T3 contract may use its existing `UsageLimitSourceAccount` and `ServerProviderUsageLimits` types. If the existing contract cannot represent subscription metadata or a CMA source kind, extend that contract once at the boundary and update all affected clients and tests together.

## Refresh behavior

### Conversation completion

When a provider response supplies Usage data, T3 updates the local ledger and the current account's local state. It does not run `subscription --json` or a quota probe for every CMA account.

### Normal Usage refresh

Normal refresh reads the local Usage ledger and the latest cached quota snapshot. It should not spend quota merely because the Usage page was rendered.

### Explicit upstream refresh

The existing refresh control may request a live quota refresh. The live refresh runs in the background, returns the current snapshot immediately, and publishes the new snapshot when available. Repeated refresh requests are coalesced.

The implementation keeps the existing T3 refresh deduplication behavior. The target behavior is a five-minute minimum age gate for repeated live quota probes, matching CMA's own limits refresh behavior.

### Subscription refresh

Subscription data is read when the CMA snapshot is refreshed or when its adapter cache is stale. It is not read after every assistant response.

## Account behavior

- Any number of accounts can be shown.
- Disabled accounts remain visible in a disabled state and do not participate in normal routing or refresh work.
- Account deletion is outside this first implementation because the available CMA command surface does not establish a stable account-delete operation.
- Account ordering must be independent from the UI's assumption about account count. If ordering is added, CMA routing order and T3 display order remain separate concepts.
- Reset-credit redemption is outside this first implementation. A count of available reset credits is not enough to expose a redemption action without a stable credit identifier and command contract.

## Failure behavior

- Missing CMA installation, command failure, timeout, or invalid JSON produces a typed probe failure.
- A failed refresh keeps the last successful account and quota readings when an identity can be matched safely.
- The UI shows that the data is stale or unavailable and shows the last successful observation time.
- Raw stderr and raw command output are not returned to clients because they may contain sensitive account data.
- Missing subscription fields are shown as unknown. Token expiry and quota reset times must never be substituted for subscription expiry.

## Upstream maintenance

Personal CMA code stays in isolated adapter files and small registration changes. Official T3 changes are synchronized from `upstream`, then personal commits are replayed or merged. Runtime build artifacts may help locate changed behavior, but they are not the source baseline.

The adapter must avoid direct edits to CMA's internal storage files. It uses CMA's stable JSON command surface so CMA updates remain localized to one boundary.

## Acceptance criteria

1. The Usage view renders every account returned by CMA, including more than two accounts.
2. Each account shows its 7-hour and 7-day quota when CMA reports them.
3. Each quota window shows its reset time when CMA reports it.
4. Each account shows its plan and subscription expiry when CMA reports them.
5. A missing subscription expiry is displayed as unknown rather than inferred.
6. A completed conversation updates local Usage data without probing all accounts.
7. Repeated live refresh requests are deduplicated and do not issue an upstream probe for every click.
8. A CMA failure leaves the last good snapshot visible with stale or unavailable status.
9. Existing Cliproxy Usage limit sources continue to work.
10. Server, web, desktop, and mobile contract tests pass for the changed Usage data shape.
