import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  UsageLimitSourceId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  collectLimitAccounts,
  collectLimitPools,
  collectProviderUsageLimits,
} from "./usageLimits.ts";

const checkedAt = "2026-09-03T11:00:00.000Z";
const now = Date.parse("2026-09-03T12:00:00.000Z");
const window = {
  id: "five_hour",
  kind: "session",
  label: "Session",
  usedPercent: 40,
  resetsAt: "2026-09-03T14:00:00.000Z",
} as const;
const provider = (overrides: Partial<ServerProvider>): ServerProvider => ({
  instanceId: ProviderInstanceId.make("codex"),
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt,
  models: [],
  slashCommands: [],
  skills: [],
  ...overrides,
});
const selected = provider({});
const laptop = { entry: { target: { label: "Laptop" } } };
const source = {
  id: UsageLimitSourceId.make("hub"),
  kind: "cliproxy" as const,
  label: "hub",
  checkedAt,
};

describe("fork CMA usage aggregation", () => {
  it("preserves CMA account state and subscription metadata in shared accounts", () => {
    const cma = {
      ...source,
      kind: "cma" as const,
      id: UsageLimitSourceId.make("cma"),
      label: "CMA",
      error: "codex-multi-auth status failed",
      accounts: [
        {
          id: "cma-account",
          driver: ProviderDriverKind.make("codex"),
          email: "cma@example.com",
          plan: "ChatGPT Plus",
          enabled: false,
          current: true,
          subscription: {
            planDisplayName: "ChatGPT Plus",
            expiresAt: "2027-01-02T03:04:05.000Z",
            renewsAt: "2027-01-02T03:04:05.000Z",
            willRenew: true,
          },
          usageLimits: {
            checkedAt,
            windows: [{ ...window, usedPercent: 12 }],
            unavailable: { reason: "probeFailed" as const },
          },
        },
        {
          id: "cma-account-2",
          driver: ProviderDriverKind.make("codex"),
          email: "cma@example.com",
          enabled: true,
          usageLimits: { checkedAt, windows: [{ ...window, usedPercent: 24 }] },
        },
      ],
    };
    const accounts = collectLimitAccounts(
      new Map([
        [
          EnvironmentId.make("env-a"),
          { ...laptop, serverConfig: { providers: [], usageLimitSources: [cma] } },
        ],
      ]),
    );
    expect(accounts).toHaveLength(2);
    const [account] = accounts;
    expect(account).toMatchObject({
      sourceKind: "cma",
      sourceError: "codex-multi-auth status failed",
      enabled: false,
      current: true,
      subscription: {
        planDisplayName: "ChatGPT Plus",
        expiresAt: "2027-01-02T03:04:05.000Z",
      },
      limits: {
        checkedAt,
        unavailable: { reason: "probeFailed" },
      },
    });
  });

  it("clears a stale CMA source error after a newer healthy snapshot", () => {
    const account = (checkedAt: string) => ({
      id: "cma-account",
      driver: ProviderDriverKind.make("codex"),
      email: "cma@example.com",
      usageLimits: { checkedAt, windows: [{ ...window, usedPercent: 12 }] },
    });
    const source = (checkedAt: string, error: string | undefined) => ({
      id: UsageLimitSourceId.make("cma"),
      kind: "cma" as const,
      label: "CMA",
      checkedAt,
      endpoint: "https://cma.example",
      ...(error === undefined ? {} : { error }),
      accounts: [account(checkedAt)],
    });
    const presentations = (snapshots: readonly ReturnType<typeof source>[]) =>
      new Map(
        snapshots.map((snapshot, index) => [
          EnvironmentId.make(`env-${index}`),
          { ...laptop, serverConfig: { providers: [], usageLimitSources: [snapshot] } },
        ]),
      );

    const accounts = collectLimitAccounts(
      presentations([
        source("2026-09-03T11:00:00.000Z", "codex-multi-auth status failed"),
        source("2026-09-03T12:00:00.000Z", undefined),
      ]),
    );
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.sourceError).toBeUndefined();
  });

  it("keeps disabled CMA accounts visible but excludes them from quota pools", () => {
    const cma = {
      ...source,
      kind: "cma" as const,
      id: UsageLimitSourceId.make("cma"),
      accounts: [
        {
          id: "disabled",
          driver: ProviderDriverKind.make("codex"),
          enabled: false,
          usageLimits: { checkedAt, windows: [{ ...window, usedPercent: 10 }] },
        },
        {
          id: "enabled",
          driver: ProviderDriverKind.make("codex"),
          enabled: true,
          usageLimits: { checkedAt, windows: [{ ...window, usedPercent: 20 }] },
        },
      ],
    };
    const accounts = collectLimitAccounts(
      new Map([
        [
          EnvironmentId.make("env-a"),
          { ...laptop, serverConfig: { providers: [], usageLimitSources: [cma] } },
        ],
      ]),
    );
    expect(accounts.map((account) => account.key)).toEqual([
      "env-a:cma:disabled",
      "env-a:cma:enabled",
    ]);
    const [pool] = collectLimitPools(accounts, now);
    expect(pool?.accounts.map((account) => account.key)).toEqual(["env-a:cma:enabled"]);
    expect(pool?.windows[0]?.members.map((member) => member.account.key)).toEqual([
      "env-a:cma:enabled",
    ]);
  });

  it("carries CMA account metadata and disabled accounts into the usage report", () => {
    const cma = {
      id: UsageLimitSourceId.make("cma"),
      kind: "cma" as const,
      label: "CMA",
      checkedAt,
      error: "codex-multi-auth status failed",
      accounts: [
        {
          id: "cma-account",
          driver: selected.driver,
          email: "cma@example.com",
          plan: "ChatGPT Plus",
          enabled: false,
          current: true,
          subscription: {
            planDisplayName: "ChatGPT Plus",
            expiresAt: "2027-01-02T03:04:05.000Z",
          },
          usageLimits: { checkedAt, windows: [{ ...window, usedPercent: 12 }] },
        },
      ],
    };
    const report = collectProviderUsageLimits(selected.instanceId, [selected], [cma], now);
    const cmaAccount = report?.accounts.find((account) => account.sourceKind === "cma");
    expect(cmaAccount).toMatchObject({
      id: "cma:cma-account",
      sourceKind: "cma",
      sourceError: "codex-multi-auth status failed",
      enabled: false,
      current: true,
      subscription: {
        planDisplayName: "ChatGPT Plus",
        expiresAt: "2027-01-02T03:04:05.000Z",
      },
      limits: { checkedAt, windows: [{ usedPercent: 12 }] },
    });
  });
});
