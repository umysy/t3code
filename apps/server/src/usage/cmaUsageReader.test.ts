import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as ProcessRunner from "../processRunner.ts";
import * as CmaUsageReader from "./cmaUsageReader.ts";

const output = (stdout: string, code = 0, stderr = "") =>
  ({
    stdout,
    stderr,
    code: ChildProcessSpawner.ExitCode(code),
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
        run: (() => {
          let call = 0;
          return (_input: ProcessRunner.ProcessRunInput) =>
            Effect.succeed(output(call++ === 0 ? status : subscription));
        })(),
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
      quota: { windows: [{ id: "primary", usedPercent: 99, label: "5-hour" }] },
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

  it.effect("falls back to JSON written to stderr", () =>
    Effect.gen(function* () {
      const reader = yield* CmaUsageReader.CmaUsageReader;
      const accounts = yield* reader.read;
      expect(accounts[0]?.id).toBe("acct-a");
    }).pipe(
      Effect.provide(
        CmaUsageReader.layer.pipe(
          Layer.provide(
            Layer.succeed(ProcessRunner.ProcessRunner, {
              run: (() => {
                let call = 0;
                return (_input: ProcessRunner.ProcessRunInput) =>
                  Effect.succeed(
                    call++ === 0
                      ? output("not-json", 0, JSON.stringify({ accounts: [{ id: "acct-a" }] }))
                      : output(JSON.stringify({ accounts: [] })),
                  );
              })(),
            }),
          ),
        ),
      ),
    ),
  );

  it("extracts the first JSON document from CLI output", () => {
    expect(
      CmaUsageReader.decodeCmaJson('{"accounts":[{"id":"acct-a"}]}\nwarning: {not-json}\n'),
    ).toEqual({ accounts: [{ id: "acct-a" }] });
  });

  it("strips terminal control bytes around the JSON document", () => {
    expect(
      CmaUsageReader.decodeCmaJson(
        '\u001b[?25l\u0000{"accounts":[{"id":"acct-a"}]}\u0000\u001b[?25h',
      ),
    ).toEqual({ accounts: [{ id: "acct-a" }] });
  });

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
      ).toThrowError(
        expect.objectContaining({
          _tag: "CmaProbeFailure",
          command: "status",
          kind: "invalidJson",
        }),
      );
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

  it("uses CMA's reported window duration for the quota label", () => {
    const accounts = CmaUsageReader.normalizeCmaUsage(
      { accounts: [{ id: "acct-a", quota: { primary: { usedPercent: 12, windowMinutes: 300 } } }] },
      { accounts: [] },
      "2026-11-21T00:00:00.000Z",
    );

    expect(accounts[0]?.quota.windows[0]?.label).toBe("5-hour");
  });

  it("accepts CMA status rows with an empty quota window and derives identity from labels", () => {
    const accounts = CmaUsageReader.normalizeCmaUsage(
      {
        accounts: [
          {
            label: "Account 1 (Token account [id:89bbe3], person@example.com, id:89bbe3)",
            enabled: true,
            current: true,
            subscription: { planType: "plus", planLabel: "Plus" },
            quota: {
              updatedAt: 1_700_000_000_000,
              primary: {},
              secondary: { usedPercent: 35, windowMinutes: 10_080, resetAtMs: 1_700_604_800_000 },
            },
          },
        ],
      },
      {
        accounts: [
          {
            index: 0,
            label: "Account 1 (Token account [id:89bbe3], pe***@***.com, id:89bbe3)",
            planType: "plus",
            planDisplayName: "Plus",
            expiresAt: "2026-12-19T20:36:56+00:00",
          },
        ],
      },
      "2023-11-14T22:13:20.000Z",
    );

    expect(accounts[0]).toMatchObject({
      id: "89bbe3",
      email: "person@example.com",
      plan: "Plus",
      subscription: {
        planDisplayName: "Plus",
        expiresAt: "2026-12-19T20:36:56.000Z",
      },
      quota: {
        windows: [
          {
            id: "secondary",
            usedPercent: 35,
            windowMinutes: 10_080,
          },
        ],
      },
    });
  });
});
