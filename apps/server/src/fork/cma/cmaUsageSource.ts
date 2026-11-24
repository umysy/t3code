import {
  ProviderDriverKind,
  UsageLimitSourceId,
  type UsageLimitSourceAccount,
  type UsageLimitSourceSnapshot,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import * as UsageLimitSources from "../../usage/UsageLimitSources.ts";
import * as CmaUsageReader from "./cmaUsageReader.ts";

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

type RefreshCompletion = Deferred.Deferred<UsageLimitSourceSnapshot>;

const make = Effect.gen(function* () {
  const reader = yield* CmaUsageReader.CmaUsageReader;
  const lastAttemptAtMs = yield* Ref.make<number | undefined>(undefined);
  const inFlightRef = yield* Ref.make<Option.Option<RefreshCompletion>>(Option.none());

  const read = Effect.fn("CmaUsageSource.read")(function* (
    previous: ReadonlyArray<UsageLimitSourceSnapshot>,
  ) {
    const observedAt = yield* DateTime.now;
    const observedAtMs = DateTime.toEpochMillis(observedAt);
    const cached = previous.find((source) => source.id === CMA_SOURCE_ID);
    const lastAttempt = yield* Ref.get(lastAttemptAtMs);
    if (
      cached !== undefined &&
      lastAttempt !== undefined &&
      observedAtMs - lastAttempt < CMA_REFRESH_MIN_AGE_MS
    ) {
      return [cached] as const;
    }

    const claimed = yield* Effect.uninterruptible(
      Ref.modify(
        inFlightRef,
        (
          inFlight,
        ): readonly [
          { readonly owner: boolean; readonly completion: RefreshCompletion },
          Option.Option<RefreshCompletion>,
        ] => {
          if (Option.isSome(inFlight)) {
            return [{ owner: false, completion: inFlight.value }, inFlight];
          }
          const completion = Deferred.makeUnsafe<UsageLimitSourceSnapshot>();
          return [{ owner: true, completion }, Option.some(completion)];
        },
      ),
    );
    if (claimed.owner) {
      const run = Effect.gen(function* () {
        yield* Ref.set(lastAttemptAtMs, observedAtMs);
        const checkedAt = DateTime.formatIso(observedAt);
        const result = yield* reader.read.pipe(Effect.result);
        return result._tag === "Success"
          ? cmaSnapshot(checkedAt, result.success)
          : {
              ...cmaSnapshot(checkedAt, []),
              accounts: cached?.accounts ?? [],
              error: result.failure.message,
            };
      });
      yield* run.pipe(
        Effect.onExit((exit) =>
          Ref.set(inFlightRef, Option.none()).pipe(
            Effect.andThen(Deferred.done(claimed.completion, exit)),
          ),
        ),
        Effect.forkDetach,
      );
    }
    return [yield* Deferred.await(claimed.completion)] as const;
  });

  return { read } satisfies UsageLimitSources.UsageLimitSourceExtension["Service"];
});

export const layer = Layer.effect(UsageLimitSources.UsageLimitSourceExtension, make);
