import { EnvironmentId, ProviderDriverKind } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { LimitAccount } from "../usageLimits.ts";
import {
  getComposerQuotaSeverity,
  getExpiryWarning,
  getQuotaSeverity,
  groupAccountsByProvider,
  selectComposerFiveHourQuota,
  sortProviderAccounts,
} from "./usageAccountMatrix.ts";

const NOW = Date.parse("2026-11-28T12:00:00.000Z");
const CODEX = ProviderDriverKind.make("codex");
const CLAUDE = ProviderDriverKind.make("claudeAgent");
const ANTIGRAVITY = ProviderDriverKind.make("antigravity");

function makeAccount(
  overrides: Partial<LimitAccount> & { readonly key: string; readonly driver?: ProviderDriverKind },
): LimitAccount {
  return {
    driver: overrides.driver ?? CODEX,
    displayName: null,
    accentColor: undefined,
    redeem: null,
    email: `${overrides.key}@example.com`,
    plan: "Plus",
    enabled: true,
    current: undefined,
    subscription: undefined,
    sourceKind: "cma",
    sourceLabel: "CMA",
    sourceError: undefined,
    environments: [],
    limits: {
      checkedAt: "2026-11-28T11:55:00.000Z",
      windows: [
        {
          id: "primary",
          kind: "session",
          label: "5-hour",
          usedPercent: 30,
          windowDurationMins: 300,
          resetsAt: "2026-11-28T15:00:00.000Z",
        },
        {
          id: "secondary",
          kind: "weekly",
          label: "7-day",
          usedPercent: 40,
          windowDurationMins: 10080,
          resetsAt: "2026-12-03T12:00:00.000Z",
        },
      ],
    },
    ...overrides,
  };
}

describe("usageAccountMatrix", () => {
  it("groups single-account providers as single and multi-account providers as matrix", () => {
    const accounts = [
      makeAccount({ key: "codex-a", driver: CODEX }),
      makeAccount({ key: "codex-b", driver: CODEX }),
      makeAccount({ key: "claude-a", driver: CLAUDE }),
      makeAccount({
        key: "ag-unsupported",
        driver: ANTIGRAVITY,
        limits: {
          checkedAt: "2026-11-28T11:55:00.000Z",
          windows: [],
          unavailable: { reason: "unsupported" },
        },
      }),
    ];

    const groups = groupAccountsByProvider(accounts, NOW);
    expect(groups.map((g) => [g.driver, g.mode, g.accounts.length])).toEqual([
      [CODEX, "matrix", 2],
      [CLAUDE, "single", 1],
    ]);
  });

  it("sorts healthy accounts by all 4 modes and always keeps errored accounts last", () => {
    const busy = makeAccount({
      key: "busy",
      subscription: { expiresAt: "2026-12-01T00:00:00.000Z" },
      limits: {
        checkedAt: "2026-11-28T11:55:00.000Z",
        windows: [
          {
            id: "primary",
            kind: "session",
            label: "5-hour",
            usedPercent: 85,
            windowDurationMins: 300,
            resetsAt: "2026-11-28T13:00:00.000Z",
          },
        ],
      },
    });
    const idle = makeAccount({
      key: "idle",
      subscription: { expiresAt: "2026-12-20T00:00:00.000Z" },
      limits: {
        checkedAt: "2026-11-28T11:55:00.000Z",
        windows: [
          {
            id: "primary",
            kind: "session",
            label: "5-hour",
            usedPercent: 10,
            windowDurationMins: 300,
            resetsAt: "2026-11-28T16:00:00.000Z",
          },
        ],
      },
    });
    const errored = makeAccount({
      key: "errored",
      limits: {
        checkedAt: "2026-11-28T11:55:00.000Z",
        windows: [],
        unavailable: { reason: "probeFailed", message: "HTTP 401" },
      },
    });

    const input = [errored, busy, idle];

    expect(sortProviderAccounts(input, "idlest", NOW).map((a) => a.key)).toEqual([
      "idle",
      "busy",
      "errored",
    ]);
    expect(sortProviderAccounts(input, "soonestReset", NOW).map((a) => a.key)).toEqual([
      "busy",
      "idle",
      "errored",
    ]);
    expect(sortProviderAccounts(input, "soonestExpiry", NOW).map((a) => a.key)).toEqual([
      "busy",
      "idle",
      "errored",
    ]);
    expect(sortProviderAccounts(input, "fixed", NOW).map((a) => a.key)).toEqual([
      "busy",
      "idle",
      "errored",
    ]);
  });

  it("computes expiry warnings only when 7 days or fewer remain", () => {
    expect(getExpiryWarning({ expiresAt: "2026-12-03T12:00:00.000Z" }, NOW)).toMatchObject({
      daysRemaining: 5,
      isSoon: true,
      isExpired: false,
    });

    expect(getExpiryWarning({ expiresAt: "2026-12-20T12:00:00.000Z" }, NOW)).toMatchObject({
      daysRemaining: 22,
      isSoon: false,
      isExpired: false,
    });

    expect(getExpiryWarning({ expiresAt: "2026-11-27T12:00:00.000Z" }, NOW)).toMatchObject({
      isSoon: false,
      isExpired: true,
    });
  });

  it("computes severity thresholds for Limits bars and Composer pill", () => {
    expect(getQuotaSeverity(50)).toBe("normal");
    expect(getQuotaSeverity(25)).toBe("warning");
    expect(getQuotaSeverity(9)).toBe("danger");

    expect(getComposerQuotaSeverity(25)).toBe("normal");
    expect(getComposerQuotaSeverity(19)).toBe("warning");
    expect(getComposerQuotaSeverity(4)).toBe("danger");
  });

  it("selects active account 5h quota for composer and returns null for providers without limits", () => {
    const envA = EnvironmentId.make("env-a");
    const current = makeAccount({
      key: "current",
      current: true,
      environments: [{ environmentId: envA, label: "Local" }],
      limits: {
        checkedAt: "2026-11-28T11:55:00.000Z",
        windows: [
          {
            id: "primary",
            kind: "session",
            label: "5-hour",
            usedPercent: 85,
            windowDurationMins: 300,
            resetsAt: "2026-11-28T14:00:00.000Z",
          },
        ],
      },
    });
    const backup = makeAccount({
      key: "backup",
      current: false,
      environments: [{ environmentId: envA, label: "Local" }],
      limits: {
        checkedAt: "2026-11-28T11:55:00.000Z",
        windows: [
          {
            id: "primary",
            kind: "session",
            label: "5-hour",
            usedPercent: 10,
            windowDurationMins: 300,
            resetsAt: "2026-11-28T16:00:00.000Z",
          },
        ],
      },
    });

    const selected = selectComposerFiveHourQuota([backup, current], CODEX, envA, NOW);
    expect(selected).toEqual({
      driver: CODEX,
      accountKey: "current",
      accountLabel: "current@example.com",
      remainingPercent: 15,
      resetsAt: "2026-11-28T14:00:00.000Z",
      severity: "warning",
      idlestAccount: {
        accountKey: "backup",
        label: "backup@example.com",
        remainingPercent: 90,
      },
    });

    expect(selectComposerFiveHourQuota([backup, current], ANTIGRAVITY, envA, NOW)).toBeNull();
  });
});
