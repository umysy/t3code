import {
  DEFAULT_PROVIDER_HEALTH_REFRESH_INTERVAL,
  UsageLimitSourceError,
  type UsageLimitSourceConsumeResetCreditInput,
  type ProviderConsumeResetCreditResult,
  ProviderDriverKind,
  type ServerSettings,
  UsageLimitSourceConfig,
  UsageLimitSourceId,
  settingsSecretLiteral,
  type UsageLimitSourceAccount,
  type UsageLimitSourceSnapshot,
} from "@t3tools/contracts";
import { resolveServerBackgroundActivitySettings } from "@t3tools/shared/backgroundActivitySettings";
import { antigravityWindowLimitsModel, hubRoutes } from "@t3tools/shared/usageLimits";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as BackgroundPolicy from "../background/BackgroundPolicy.ts";
import * as SecretResolver from "@t3tools/secret-provider-core/server/SecretResolver";
import * as SecretResolverLayer from "../secrets/SecretResolver.ts";
import { resolveSettingsSecrets } from "../secrets/settingsSecretValue.ts";
import * as Settings from "../serverSettings.ts";
import { windowLimitsModel } from "../provider/claudeUsageLimits.ts";
import { makeCliproxyApi } from "./cliproxyApi.ts";
import * as CmaUsageReader from "./cmaUsageReader.ts";

export class UsageLimitSources extends Context.Service<
  UsageLimitSources,
  {
    readonly current: Effect.Effect<ReadonlyArray<UsageLimitSourceSnapshot>>;
    readonly streamChanges: Stream.Stream<ReadonlyArray<UsageLimitSourceSnapshot>>;
    readonly refresh: (options?: { readonly force?: boolean }) => Effect.Effect<void>;
    readonly consumeResetCredit: (
      input: UsageLimitSourceConsumeResetCreditInput,
    ) => Effect.Effect<ProviderConsumeResetCreditResult, UsageLimitSourceError>;
  }
>()("t3/usage/UsageLimitSources") {}

function sourceLabel(id: string, config: UsageLimitSourceConfig): string {
  if (config.label) return config.label;
  const fallback = id.trim() || "Usage limit source";
  try {
    return new URL(config.url).host || fallback;
  } catch {
    return fallback;
  }
}

/**
 * A refused read of one account keeps its last good reading, as provider probes keep their bars
 * (see ServerProviderUsageLimits); a reading with none to keep stays listed as unreadable.
 */
function keepLastGoodReadings(
  previous: ReadonlyArray<UsageLimitSourceSnapshot>,
  next: ReadonlyArray<UsageLimitSourceSnapshot>,
): ReadonlyArray<UsageLimitSourceSnapshot> {
  return next.map((source) => {
    // Auth file names can be reused, so only the same hub and login may lend a reading.
    const before = previous.find(
      (candidate) => candidate.id === source.id && candidate.endpoint === source.endpoint,
    );
    if (!before) return source;
    return {
      ...source,
      accounts: source.accounts.map((account) => {
        if (account.usageLimits.unavailable?.reason !== "probeFailed") return account;
        // Without a listed login, a reused auth file name cannot be told apart from the old one.
        if (account.email === undefined && account.workspaceId === undefined) return account;
        const last = before.accounts.find(
          (candidate) =>
            candidate.id === account.id &&
            candidate.driver === account.driver &&
            // Fingerprinted Antigravity readings omit the listed identity, so they are never lent.
            candidate.usageLimits.credentialFingerprint === undefined &&
            candidate.email === account.email &&
            candidate.workspaceId === account.workspaceId,
        );
        if (!last || last.usageLimits.unavailable) return account;
        // Only the reading is lent; an unread model list stays unknown.
        return { ...last, models: account.models };
      }),
    };
  });
}

const CMA_SOURCE_ID = UsageLimitSourceId.make("cma");
const CMA_REFRESH_MIN_AGE_MS = Duration.toMillis(Duration.minutes(5));

const cmaAccount = (account: CmaUsageReader.CmaUsageAccount): UsageLimitSourceAccount => ({
  id: account.id,
  driver: ProviderDriverKind.make("codex"),
  ...(account.email ? { email: account.email } : {}),
  ...(account.plan ? { plan: account.plan } : {}),
  enabled: account.enabled,
  ...(account.current === undefined ? {} : { current: account.current }),
  ...(account.subscription ? { subscription: account.subscription } : {}),
  usageLimits: {
    checkedAt: account.quota.checkedAt,
    windows: account.quota.windows.map((window) => ({
      id: window.id,
      kind: window.id === "primary" ? "session" : "weekly",
      label: window.label,
      usedPercent: window.usedPercent,
      ...(window.resetsAt ? { resetsAt: window.resetsAt } : {}),
      ...(window.windowMinutes === undefined ? {} : { windowDurationMins: window.windowMinutes }),
    })),
  },
});

const cmaSnapshot = (
  checkedAt: string,
  accounts: ReadonlyArray<CmaUsageReader.CmaUsageAccount>,
): UsageLimitSourceSnapshot => ({
  id: CMA_SOURCE_ID,
  kind: "cma",
  label: "CMA",
  checkedAt,
  accounts: accounts.map(cmaAccount),
});

function missingManagementKey(config: UsageLimitSourceConfig): string {
  return typeof config.managementKey === "string"
    ? "No management key configured."
    : "Could not read the management key from its secret provider.";
}

/** @public */
export const make = Effect.gen(function* () {
  const api = yield* makeCliproxyApi;
  const settingsService = yield* Settings.ServerSettingsService;
  const secrets = yield* SecretResolver.SecretResolver;
  const backgroundPolicy = yield* BackgroundPolicy.BackgroundPolicy;
  const readManagementKey = Effect.fn("UsageLimitSources.readManagementKey")(function* (
    config: UsageLimitSourceConfig,
  ) {
    const resolved = yield* resolveSettingsSecrets(secrets, UsageLimitSourceConfig, config);
    return settingsSecretLiteral(resolved.managementKey);
  });
  const stateRef = yield* Ref.make<ReadonlyArray<UsageLimitSourceSnapshot>>([]);
  const cmaLastAttemptAtMs = yield* Ref.make<number | undefined>(undefined);
  const changes = yield* Effect.acquireRelease(
    PubSub.unbounded<ReadonlyArray<UsageLimitSourceSnapshot>>(),
    PubSub.shutdown,
  );

  const readSource = Effect.fn("UsageLimitSources.readSource")(function* (
    id: UsageLimitSourceId,
    config: UsageLimitSourceConfig,
  ) {
    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    const url = URL.parse(config.url);
    const base = {
      id,
      kind: config.kind,
      label: sourceLabel(id, config),
      ...(url && /^https?:$/.test(url.protocol)
        ? {
            origin: url.origin,
            endpoint: `${url.origin}${url.pathname.replace(/(\/management\.html)?\/*$/i, "")}`,
          }
        : {}),
      checkedAt,
    } as const;
    const managementKey = yield* readManagementKey(config);
    if (managementKey.length === 0) {
      return { ...base, accounts: [], error: missingManagementKey(config) };
    }
    const accounts = yield* api
      .readAccounts({ url: config.url, managementKey })
      .pipe(Effect.result);
    if (accounts._tag === "Failure") {
      yield* Effect.logDebug("usage limit source read failed", { id, cause: accounts.failure });
      return { ...base, accounts: [], error: accounts.failure.detail };
    }
    return { ...base, accounts: accounts.success };
  });

  const readCmaSource = Effect.fn("UsageLimitSources.readCmaSource")(function* (
    previous: ReadonlyArray<UsageLimitSourceSnapshot>,
    force = false,
  ) {
    const cmaReader = yield* Effect.serviceOption(CmaUsageReader.CmaUsageReader);
    if (cmaReader._tag === "None") return undefined;
    const observedAt = yield* DateTime.now;
    const observedAtMs = DateTime.toEpochMillis(observedAt);
    const cached = previous.find((source) => source.id === CMA_SOURCE_ID);
    const lastAttemptAtMs = yield* Ref.get(cmaLastAttemptAtMs);
    if (
      !force &&
      cached !== undefined &&
      lastAttemptAtMs !== undefined &&
      observedAtMs - lastAttemptAtMs < CMA_REFRESH_MIN_AGE_MS
    ) {
      return cached;
    }
    const checkedAt = DateTime.formatIso(observedAt);
    const result = yield* cmaReader.value.read.pipe(Effect.result);
    yield* Ref.set(cmaLastAttemptAtMs, observedAtMs);
    if (result._tag === "Success") {
      return cmaSnapshot(checkedAt, result.success);
    }
    return {
      ...cmaSnapshot(checkedAt, []),
      accounts: cached?.accounts ?? [],
      error: result.failure.message,
    };
  });

  const publish = Effect.fn("UsageLimitSources.publish")(function* (
    next: ReadonlyArray<UsageLimitSourceSnapshot>,
  ) {
    const changed = yield* Ref.modify(stateRef, (previous) =>
      Equal.equals(previous, next) ? [false, previous] : [true, next],
    );
    if (changed) yield* PubSub.publish(changes, next);
  });

  // Serialize refreshes so slow old-settings reads cannot resurrect removed sources after newer refreshes.
  const refreshLock = yield* Semaphore.make(1);
  const runRefresh = Effect.fn("UsageLimitSources.runRefresh")(function* (force = false) {
    const settings = yield* settingsService.getSettings.pipe(
      Effect.orElseSucceed((): ServerSettings | null => null),
    );
    const entries = Object.entries(settings?.usageLimitSources ?? {}).filter(
      ([, config]) => config.enabled,
    );
    const snapshots = yield* Effect.forEach(
      entries,
      ([id, config]) => readSource(id as UsageLimitSourceId, config),
      { concurrency: 4 },
    );
    const previous = yield* Ref.get(stateRef);
    const cma = yield* readCmaSource(previous, force);
    yield* publish(
      keepLastGoodReadings(previous, [...snapshots, ...(cma === undefined ? [] : [cma])]),
    );
  });

  type RefreshCompletion = Deferred.Deferred<void>;
  const refreshInFlightRef = yield* Ref.make<Option.Option<RefreshCompletion>>(Option.none());
  const refresh = Effect.fn("UsageLimitSources.refresh")(function* (options?: {
    readonly force?: boolean;
  }) {
    const claimed = yield* Effect.uninterruptible(
      Ref.modify(
        refreshInFlightRef,
        (
          inFlight,
        ): readonly [
          { readonly owner: boolean; readonly completion: RefreshCompletion },
          Option.Option<RefreshCompletion>,
        ] => {
          if (Option.isSome(inFlight)) {
            return [{ owner: false, completion: inFlight.value }, inFlight];
          }
          const completion = Deferred.makeUnsafe<void>();
          return [{ owner: true, completion }, Option.some(completion)];
        },
      ),
    );
    if (claimed.owner) {
      yield* runRefresh(options?.force === true).pipe(
        refreshLock.withPermits(1),
        Effect.ignoreCause({ log: true }),
        Effect.onExit((exit) =>
          Ref.set(refreshInFlightRef, Option.none()).pipe(
            Effect.andThen(Deferred.done(claimed.completion, exit)),
          ),
        ),
        Effect.forkDetach,
      );
    }
    yield* Deferred.await(claimed.completion);
  });

  // Shares the refresh lock so a stale in-flight read cannot overwrite a redemption.
  const consumeResetCredit = Effect.fn("UsageLimitSources.consumeResetCredit")(function* (
    input: UsageLimitSourceConsumeResetCreditInput,
  ) {
    const settings = yield* settingsService.getSettings.pipe(
      Effect.mapError(() => new UsageLimitSourceError({ detail: "Could not read hub settings." })),
    );
    const config = settings.usageLimitSources[input.sourceId];
    if (!config?.enabled) {
      return yield* new UsageLimitSourceError({
        detail: "The usage limit source is missing or disabled.",
      });
    }
    const managementKey = yield* readManagementKey(config);
    if (managementKey.length === 0) {
      return yield* new UsageLimitSourceError({ detail: missingManagementKey(config) });
    }
    const result = yield* api.consume(
      { url: config.url, managementKey },
      input.accountId,
      input.creditId,
    );
    // A redemption changes the reading, so a refused re-read must not bring back the one before it.
    const snapshot = yield* readSource(input.sourceId, config);
    const previous = yield* Ref.get(stateRef);
    yield* publish(previous.map((source) => (source.id === input.sourceId ? snapshot : source)));
    return result;
  }, refreshLock.withPermits(1));

  yield* settingsService.streamChanges.pipe(
    Stream.map((settings) => settings.usageLimitSources),
    Stream.changes,
    Stream.runForEach(() => refresh()),
    Effect.forkScoped,
  );

  const interval = settingsService.getSettings.pipe(
    Effect.map(
      (settings) => resolveServerBackgroundActivitySettings(settings).providerHealthRefreshInterval,
    ),
    Effect.orElseSucceed(() => DEFAULT_PROVIDER_HEALTH_REFRESH_INTERVAL),
  );
  yield* Effect.forever(
    interval.pipe(
      Effect.flatMap((wait) => Effect.sleep(Duration.isPositive(wait) ? wait : "60 seconds")),
      Effect.andThen(interval),
      Effect.flatMap((current) =>
        Duration.isPositive(current)
          ? backgroundPolicy.shouldRunScopeWork({ type: "provider-status" })
          : Effect.succeed(false),
      ),
      Effect.flatMap((shouldRun) => (shouldRun ? refresh() : Effect.void)),
      Effect.ignoreCause({ log: true }),
    ),
  ).pipe(Effect.forkScoped);

  yield* refresh().pipe(Effect.forkScoped);

  return {
    current: Ref.get(stateRef),
    consumeResetCredit,
    refresh,
    get streamChanges() {
      return Stream.unwrap(
        Effect.gen(function* () {
          const subscription = yield* PubSub.subscribe(changes);
          const snapshot = yield* Ref.get(stateRef);
          return Stream.concat(Stream.make(snapshot), Stream.fromSubscription(subscription)).pipe(
            Stream.changes,
          );
        }),
      );
    },
  } satisfies UsageLimitSources["Service"];
});

export const layer = Layer.effect(UsageLimitSources, make).pipe(
  Layer.provide(SecretResolverLayer.layer),
);

/** A hub returns a usage limit only when every account it routes the model to is spent. */
export function hubPoolResetAt(
  sources: ReadonlyArray<UsageLimitSourceSnapshot>,
  driver: ProviderDriverKind,
  model: string | null,
  now: number,
): string | null {
  let earliest: number | null = null;
  const routes = hubRoutes(sources, driver, model);
  for (const account of sources.flatMap((source) => source.accounts).filter(routes)) {
    // An unread account may be the one still blocked, so its refill is unknown.
    if (account.usageLimits.unavailable) return null;
    const spent = account.usageLimits.windows.filter(
      (window) =>
        window.usedPercent >= 100 &&
        windowLimitsModel(window, model) &&
        (account.driver !== "antigravity" || antigravityWindowLimitsModel(window, model)),
    );
    if (spent.length === 0) return null;
    const resets = spent.map((window) => Date.parse(window.resetsAt ?? ""));
    if (resets.some((reset) => !Number.isFinite(reset))) return null;
    const recoversAt = Math.max(...resets);
    if (recoversAt <= now) return null;
    earliest = earliest === null ? recoversAt : Math.min(earliest, recoversAt);
  }
  return earliest === null ? null : DateTime.formatIso(DateTime.makeUnsafe(earliest));
}

export class UsageLimitResetFallback extends Context.Reference<{
  readonly resetAt: (
    driver: ProviderDriverKind,
    endpoint: string,
    model: string | null,
  ) => Effect.Effect<string | null>;
}>("t3/usage/UsageLimitResetFallback", {
  defaultValue: () => ({ resetAt: () => Effect.succeed(null) }),
}) {}

export const layerResetFallback = Layer.effect(
  UsageLimitResetFallback,
  Effect.gen(function* () {
    const sources = yield* UsageLimitSources;
    return {
      resetAt: Effect.fn("UsageLimitResetFallback.resetAt")(function* (driver, endpoint, model) {
        // Only the hub at the instance's endpoint serves its turns.
        const atEndpoint = Effect.map(sources.current, (current) =>
          current.filter((source) => source.origin === endpoint),
        );
        if ((yield* atEndpoint).length === 0) return null;
        // The pool usually ran out after the last poll, so the cached accounts still show room.
        yield* sources.refresh().pipe(Effect.timeout("5 seconds"), Effect.ignore);
        return hubPoolResetAt(
          yield* atEndpoint,
          driver,
          model,
          DateTime.toEpochMillis(yield* DateTime.now),
        );
      }),
    };
  }),
);
