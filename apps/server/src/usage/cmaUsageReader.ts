import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
// @effect-diagnostics deterministicKeys:off globalDate:off globalJsonInEffect:off

import * as ProcessRunner from "../processRunner.ts";
import * as HostProcess from "@t3tools/shared/HostProcess";

export type CmaUsageWindowId = "primary" | "secondary";

export interface CmaUsageWindow {
  readonly id: CmaUsageWindowId;
  readonly label: string;
  readonly usedPercent: number;
  readonly windowMinutes?: number;
  readonly resetsAt?: string;
}

export interface CmaUsageSubscription {
  readonly planType?: string;
  readonly planDisplayName?: string;
  readonly subscriptionPlan?: string;
  readonly billingPeriod?: string;
  readonly active?: boolean;
  readonly expiresAt?: string;
  readonly renewsAt?: string;
  readonly willRenew?: boolean;
}

export interface CmaUsageAccount {
  readonly id: string;
  readonly email?: string;
  readonly plan?: string;
  readonly enabled: boolean;
  readonly current?: boolean;
  readonly subscription?: CmaUsageSubscription;
  readonly quota: {
    readonly checkedAt: string;
    readonly windows: ReadonlyArray<CmaUsageWindow>;
  };
}

export type CmaProbeFailureKind = "notInstalled" | "commandFailed" | "timedOut" | "invalidJson";

export class CmaProbeFailure extends Schema.TaggedError<CmaProbeFailure>()("CmaProbeFailure", {
  command: Schema.Literals(["status", "subscription"]),
  kind: Schema.Literals(["notInstalled", "commandFailed", "timedOut", "invalidJson"]),
}) {
  override get message(): string {
    switch (this.kind) {
      case "notInstalled":
        return "codex-multi-auth is not installed.";
      case "timedOut":
        return `codex-multi-auth ${this.command} timed out.`;
      case "invalidJson":
        return `codex-multi-auth ${this.command} returned invalid JSON.`;
      case "commandFailed":
        return `codex-multi-auth ${this.command} failed.`;
    }
  }
}

const isCmaProbeFailure = Schema.is(CmaProbeFailure);

export class CmaUsageReader extends Context.Service<
  CmaUsageReader,
  {
    readonly read: Effect.Effect<ReadonlyArray<CmaUsageAccount>, CmaProbeFailure>;
  }
>()("t3/usage/CmaUsageReader") {}

type JsonRecord = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const optionalString = (record: JsonRecord, key: string): string | undefined => {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
};

const optionalNumber = (record: JsonRecord, key: string): number | undefined => {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const optionalBoolean = (record: JsonRecord, key: string): boolean | undefined => {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
};

const isoFromMillis = (value: number | undefined): string | undefined => {
  if (value === undefined || value < 0) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
};

const isoFromString = (value: string | undefined): string | undefined => {
  if (value === undefined) return undefined;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? new Date(millis).toISOString() : undefined;
};

const labelAccountId = (record: JsonRecord): string | undefined => {
  const label = optionalString(record, "label") ?? optionalString(record, "accountLabel");
  return label?.match(/\bid:([^\]),\s]+)/i)?.[1];
};

const labelEmail = (record: JsonRecord): string | undefined => {
  const label = optionalString(record, "label") ?? optionalString(record, "accountLabel");
  const email = label?.match(/,\s*([^,\s()]+@[^,\s()]+),\s*id:/i)?.[1];
  return email && !email.includes("***") ? email : undefined;
};

const quotaWindowLabel = (key: "primary" | "secondary", windowMinutes: number | undefined) => {
  if (windowMinutes !== undefined && windowMinutes % 1_440 === 0) {
    return `${windowMinutes / 1_440}-day`;
  }
  if (windowMinutes !== undefined && windowMinutes % 60 === 0) {
    return `${windowMinutes / 60}-hour`;
  }
  return key === "primary" ? "5-hour" : "7-day";
};

const accountIdentity = (record: JsonRecord, index: number): string =>
  optionalString(record, "id") ??
  optionalString(record, "accountId") ??
  optionalString(record, "account_id") ??
  optionalString(record, "email") ??
  labelAccountId(record) ??
  `cma-${index}`;

const identityCandidates = (record: JsonRecord, index: number): ReadonlyArray<string> => [
  ...new Set(
    [
      accountIdentity(record, index),
      optionalString(record, "id"),
      optionalString(record, "accountId"),
      optionalString(record, "account_id"),
      optionalString(record, "email"),
      labelAccountId(record),
      optionalString(record, "label"),
      String(index),
      `cma-${index}`,
    ].filter((value): value is string => value !== undefined),
  ),
];

const accountList = (
  value: unknown,
  command: "status" | "subscription",
): ReadonlyArray<JsonRecord> => {
  const accounts = Array.isArray(value) ? value : isRecord(value) ? value.accounts : undefined;
  if (!Array.isArray(accounts)) {
    throw new CmaProbeFailure({ command, kind: "invalidJson" });
  }
  return accounts.map((account) => {
    if (!isRecord(account)) throw new CmaProbeFailure({ command, kind: "invalidJson" });
    return account;
  });
};

const subscriptionRecord = (record: JsonRecord): CmaUsageSubscription | undefined => {
  const planType = optionalString(record, "planType");
  const planDisplayName =
    optionalString(record, "planDisplayName") ?? optionalString(record, "planLabel");
  const subscriptionPlan = optionalString(record, "subscriptionPlan");
  const billingPeriod = optionalString(record, "billingPeriod");
  const active = optionalBoolean(record, "active");
  const expiresAt = isoFromString(optionalString(record, "expiresAt"));
  const renewsAt = isoFromString(optionalString(record, "renewsAt"));
  const willRenew = optionalBoolean(record, "willRenew");
  const subscription: CmaUsageSubscription = {
    ...(planType ? { planType } : {}),
    ...(planDisplayName ? { planDisplayName } : {}),
    ...(subscriptionPlan ? { subscriptionPlan } : {}),
    ...(billingPeriod ? { billingPeriod } : {}),
    ...(active !== undefined ? { active } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    ...(renewsAt ? { renewsAt } : {}),
    ...(willRenew !== undefined ? { willRenew } : {}),
  };
  return Object.keys(subscription).length === 0 ? undefined : subscription;
};

const quotaWindow = (
  record: JsonRecord,
  key: "primary" | "secondary",
): CmaUsageWindow | undefined => {
  const value = record[key];
  if (value === null || value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new CmaProbeFailure({ command: "status", kind: "invalidJson" });
  }
  const usedPercent = optionalNumber(value, "usedPercent");
  if (usedPercent === undefined) return undefined;
  if (usedPercent < 0 || usedPercent > 100) {
    throw new CmaProbeFailure({ command: "status", kind: "invalidJson" });
  }
  const windowMinutes = optionalNumber(value, "windowMinutes");
  if (
    ("windowMinutes" in value && windowMinutes === undefined) ||
    (windowMinutes !== undefined && windowMinutes < 0)
  ) {
    throw new CmaProbeFailure({ command: "status", kind: "invalidJson" });
  }
  const resetAtMs = optionalNumber(value, "resetAtMs");
  if (
    ("resetAtMs" in value && resetAtMs === undefined) ||
    (resetAtMs !== undefined && resetAtMs < 0)
  ) {
    throw new CmaProbeFailure({ command: "status", kind: "invalidJson" });
  }
  const resetsAt = isoFromMillis(resetAtMs);
  return {
    id: key,
    label: quotaWindowLabel(key, windowMinutes),
    usedPercent,
    ...(windowMinutes !== undefined ? { windowMinutes } : {}),
    ...(resetsAt ? { resetsAt } : {}),
  };
};

const normalizeAccounts = (
  status: ReadonlyArray<JsonRecord>,
  subscriptions: ReadonlyArray<JsonRecord>,
  observedAt: string,
): ReadonlyArray<CmaUsageAccount> => {
  const subscriptionByCandidate = new Map<string, JsonRecord>();
  subscriptions.forEach((record, index) => {
    for (const candidate of identityCandidates(record, index)) {
      if (!subscriptionByCandidate.has(candidate)) subscriptionByCandidate.set(candidate, record);
    }
  });

  return status.map((record, index) => {
    const nestedSubscription = isRecord(record.subscription) ? record.subscription : undefined;
    const subscription =
      subscriptionByCandidate.get(accountIdentity(record, index)) ??
      identityCandidates(record, index)
        .map((candidate) => subscriptionByCandidate.get(candidate))
        .find((candidate): candidate is JsonRecord => candidate !== undefined);
    const subscriptionData = subscriptionRecord({
      ...nestedSubscription,
      ...subscription,
    });
    const quota = isRecord(record.quota) ? record.quota : {};
    const checkedAt =
      isoFromMillis(optionalNumber(quota, "updatedAt")) ??
      isoFromMillis(optionalNumber(record, "observedAt")) ??
      observedAt;
    const primary = quotaWindow(quota, "primary");
    const secondary = quotaWindow(quota, "secondary");
    const plan =
      subscriptionData?.planDisplayName ??
      subscriptionData?.planType ??
      subscriptionData?.subscriptionPlan ??
      optionalString(record, "plan") ??
      optionalString(nestedSubscription ?? {}, "planLabel") ??
      optionalString(nestedSubscription ?? {}, "planType");

    const email = optionalString(record, "email") ?? labelEmail(record);
    const current = optionalBoolean(record, "current");
    return {
      id: accountIdentity(record, index),
      ...(email ? { email } : {}),
      ...(plan ? { plan } : {}),
      enabled: optionalBoolean(record, "enabled") ?? true,
      ...(current !== undefined ? { current } : {}),
      ...(subscriptionData ? { subscription: subscriptionData } : {}),
      quota: {
        checkedAt,
        windows: [primary, secondary].filter(
          (window): window is CmaUsageWindow => window !== undefined,
        ),
      },
    };
  });
};

export const normalizeCmaUsage = (
  status: unknown,
  subscriptions: unknown,
  observedAt: string,
): ReadonlyArray<CmaUsageAccount> =>
  normalizeAccounts(
    accountList(status, "status"),
    accountList(subscriptions, "subscription"),
    observedAt,
  );

const decodeJson = Effect.fn("CmaUsageReader.decodeJson")(function* (
  raw: string,
  command: "status" | "subscription",
) {
  return yield* Effect.try({
    try: () => {
      const trimmed = raw.trim();
      try {
        return JSON.parse(trimmed) as unknown;
      } catch {
        const start = [...trimmed].findIndex((character) => character === "{" || character === "[");
        if (start === -1) throw new Error("No JSON document");
        const opening = trimmed[start];
        const closing = opening === "{" ? "}" : "]";
        let depth = 0;
        let inString = false;
        let escaped = false;
        for (let index = start; index < trimmed.length; index += 1) {
          const character = trimmed[index];
          if (inString) {
            if (escaped) escaped = false;
            else if (character === "\\") escaped = true;
            else if (character === '"') inString = false;
            continue;
          }
          if (character === '"') {
            inString = true;
          } else if (character === opening) {
            depth += 1;
          } else if (character === closing) {
            depth -= 1;
            if (depth === 0) return JSON.parse(trimmed.slice(start, index + 1)) as unknown;
          }
        }
        throw new Error("Incomplete JSON document");
      }
    },
    catch: () => new CmaProbeFailure({ command, kind: "invalidJson" }),
  });
});

const failureKind = (error: ProcessRunner.ProcessRunError): CmaProbeFailureKind => {
  if (error._tag === "ProcessTimeoutError") return "timedOut";
  if (error._tag === "ProcessSpawnError") {
    const cause = error.cause as { readonly code?: unknown };
    if (cause?.code === "ENOENT") return "notInstalled";
  }
  return "commandFailed";
};

const make = Effect.gen(function* () {
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const platform = yield* HostProcess.Platform;
  const environment = yield* HostProcess.Environment;
  const cmaInvocation =
    platform === "win32"
      ? {
          command: environment.ComSpec ?? "cmd.exe",
          prefix: ["/d", "/s", "/c", "codex-multi-auth.cmd"],
        }
      : { command: "codex-multi-auth", prefix: [] as ReadonlyArray<string> };
  const runJson = Effect.fn("CmaUsageReader.runJson")(function* (
    command: "status" | "subscription",
  ) {
    const result = yield* processRunner
      .run({
        command: cmaInvocation.command,
        args: [...cmaInvocation.prefix, command, "--json"],
        timeout: "15 seconds",
      })
      .pipe(Effect.mapError((error) => new CmaProbeFailure({ command, kind: failureKind(error) })));
    if (result.timedOut) return yield* new CmaProbeFailure({ command, kind: "timedOut" });
    if (result.code !== 0) return yield* new CmaProbeFailure({ command, kind: "commandFailed" });
    return decodeJson(result.stdout, command);
  });

  const read = Effect.gen(function* () {
    const observedAt = DateTime.formatIso(yield* DateTime.now);
    const statusValue = yield* runJson("status");
    const status = yield* Effect.try({
      try: () => accountList(statusValue, "status"),
      catch: (error) =>
        isCmaProbeFailure(error)
          ? error
          : new CmaProbeFailure({ command: "status", kind: "invalidJson" }),
    });
    const subscriptionResult = yield* runJson("subscription").pipe(Effect.result);
    const subscriptions =
      subscriptionResult._tag === "Success"
        ? yield* Effect.try({
            try: () => accountList(subscriptionResult.success, "subscription"),
            catch: (error) =>
              isCmaProbeFailure(error)
                ? error
                : new CmaProbeFailure({ command: "subscription", kind: "invalidJson" }),
          }).pipe(Effect.orElseSucceed(() => [] as ReadonlyArray<JsonRecord>))
        : [];
    return normalizeAccounts(status, subscriptions, observedAt);
  });

  return { read } satisfies CmaUsageReader["Service"];
});

export const layer = Layer.effect(CmaUsageReader, make);
