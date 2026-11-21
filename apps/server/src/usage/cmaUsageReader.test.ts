import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ProcessRunner from "../processRunner.ts";
import * as CmaUsageReader from "./cmaUsageReader.ts";

const output = (stdout: string, code = 0) =>
  ({
    stdout,
    stderr: "",
    code,
    timedOut: false,
    stdoutTruncated: false,
    stderrTruncated: false,
    stdoutInvalidUtf8: false,
    stderrInvalidUtf8: false,
  }) satisfies ProcessRunner.ProcessRunOutput;

const readerWith = (status: string, subscription = JSON.stringify({ accounts: [] })) =>
  CmaUsageReader.layer.pipe(
    Layer.provide(
      Layer.succeed(ProcessRunner.ProcessRunner, {
        run: (input) => Effect.succeed(output(input.args[0] === "status" ? status : subscription)),
      }),
    ),
  );

describe("CMA usage reader", () => {
  it("normalizes every account and both quota windows", () => {
    const status = {
      accounts: [
        {
          id: "acct-a",
          email: "a@example.test",
          enabled: true,
          current: true,
          quota: {
            updatedAt: 1_700_000_000_000,
            primary: { usedPercent: 12, windowMinutes: 420, resetAtMs: 1_700_025_200_000 },
            secondary: { usedPercent: 34, windowMinutes: 10_080, resetAtMs: 1_700_604_800_000 },
          },
        },
        { id: "acct-b", enabled: false, quota: { updatedAt: 1_700_000_001_000, primary: null } },
        { id: "acct-c", enabled: true, quota: { primary: { usedPercent: 99 } } },
      ],
    };
    const subscription = {
      accounts: [
        {
          id: "acct-a",
          planType: "plus",
          planDisplayName: "ChatGPT Plus",
          billingPeriod: "monthly",
          active: true,
          expiresAt: "2026-01-02T03:04:05.000Z",
          renewsAt: "2026-01-02T03:04:05.000Z",
          willRenew: true,
        },
      ],
    };
    const accounts = CmaUsageReader.normalizeCmaUsage(
      status,
      subscription,
      "2023-11-14T22:13:20.000Z",
    );
    expect(accounts).toHaveLength(3);
    expect(accounts[0]).toMatchObject({
      id: "acct-a",
      email: "a@example.test",
      enabled: true,
      current: true,
      plan: "ChatGPT Plus",
      subscription: {
        planType: "plus",
        planDisplayName: "ChatGPT Plus",
        billingPeriod: "monthly",
        active: true,
        expiresAt: "2026-01-02T03:04:05.000Z",
        renewsAt: "2026-01-02T03:04:05.000Z",
        willRenew: true,
      },
      quota: {
        checkedAt: "2023-11-14T22:13:20.000Z",
        windows: [
          {
            id: "primary",
            label: "7-hour",
            usedPercent: 12,
            windowMinutes: 420,
            resetsAt: "2023-11-15T05:13:20.000Z",
          },
          {
            id: "secondary",
            label: "7-day",
            usedPercent: 34,
            windowMinutes: 10080,
            resetsAt: "2023-11-21T22:13:20.000Z",
          },
        ],
      },
    });
    expect(accounts[1]).toMatchObject({ id: "acct-b", enabled: false, quota: { windows: [] } });
    expect(accounts[2]).toMatchObject({
      id: "acct-c",
      quota: { windows: [{ id: "primary", usedPercent: 99, label: "7-hour" }] },
    });
  });

  it.effect("reports a typed failure without command output", () =>
    Effect.gen(function* () {
      const reader = yield* CmaUsageReader.CmaUsageReader;
      const error = yield* reader.read.pipe(Effect.flip);
      expect(error._tag).toBe("CmaProbeFailure");
      expect(error.kind).toBe("invalidJson");
      expect(error.message).not.toContain("secret");
    }).pipe(Effect.provide(readerWith('{"accounts": [} secret-token'))),
  );

  it.effect("attributes an invalid subscription payload to the subscription probe", () =>
    Effect.gen(function* () {
      const reader = yield* CmaUsageReader.CmaUsageReader;
      const error = yield* reader.read.pipe(Effect.flip);
      expect(error.command).toBe("subscription");
      expect(error.kind).toBe("invalidJson");
    }).pipe(Effect.provide(readerWith(JSON.stringify({ accounts: [] }), "{}"))),
  );

  it("reports malformed quota windows as typed status probe failures", () => {
    for (const quota of [
      { primary: "not-an-object" },
      { primary: { usedPercent: 101 } },
      { primary: { usedPercent: 10, windowMinutes: -1 } },
    ]) {
      expect(() =>
        CmaUsageReader.normalizeCmaUsage(
          { accounts: [{ id: "acct-a", quota }] },
          { accounts: [] },
          "2026-11-21T00:00:00.000Z",
        ),
      ).toThrowErrorMatchingObject({ _tag: "CmaProbeFailure", command: "status", kind: "invalidJson" });
    }
  });

  it("leaves subscription expiry unknown when CMA omits it", () => {
    const accounts = CmaUsageReader.normalizeCmaUsage(
      {
        accounts: [
          {
            id: "acct-a",
            quota: {
              primary: { usedPercent: 12, resetAtMs: 1_800_000_000_000 },
            },
          },
        ],
      },
      { accounts: [{ id: "acct-a", planDisplayName: "ChatGPT Plus", renewsAt: "2026-12-01" }] },
      "2026-11-21T00:00:00.000Z",
    );

    expect(accounts[0]?.subscription).toEqual({
      planDisplayName: "ChatGPT Plus",
      renewsAt: "2026-12-01T00:00:00.000Z",
    });
    expect(accounts[0]?.subscription?.expiresAt).toBeUndefined();
    expect(accounts[0]?.quota.windows[0]?.resetsAt).toBe("2027-01-15T08:00:00.000Z");
  });
});
