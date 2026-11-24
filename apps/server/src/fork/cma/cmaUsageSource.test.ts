import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import { ProviderDriverKind } from "@t3tools/contracts";
import * as SecretResolver from "@t3tools/secret-provider-core/server/SecretResolver";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient } from "effect/http";

import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as UsageLimitSources from "../../usage/UsageLimitSources.ts";
import * as CmaUsageReader from "./cmaUsageReader.ts";
import * as CmaUsageSource from "./cmaUsageSource.ts";

const account = {
  id: "account-a",
  enabled: true,
  quota: {
    checkedAt: "2026-11-21T00:00:00.000Z",
    windows: [{ id: "primary" as const, label: "5-hour", usedPercent: 12 }],
  },
};

const readerLayer = (read: CmaUsageReader.CmaUsageReader["Service"]["read"]) =>
  Layer.succeed(CmaUsageReader.CmaUsageReader, { read });

it.effect("shares a CMA CLI read across concurrent extension calls", () => {
  let reads = 0;
  return Effect.gen(function* () {
    const extension = yield* UsageLimitSources.UsageLimitSourceExtension;
    const [first, second] = yield* Effect.all([extension.read([]), extension.read([])], {
      concurrency: 2,
    });
    expect(reads).toBe(1);
    expect(first[0]?.id).toBe("cma");
    expect(second[0]?.id).toBe("cma");
  }).pipe(
    Effect.provide(
      CmaUsageSource.layer.pipe(
        Layer.provide(
          readerLayer(
            Effect.sync(() => {
              reads += 1;
              return [account];
            }),
          ),
        ),
      ),
    ),
  );
});

it.effect("feeds a CMA snapshot through the official usage source hook", () =>
  Effect.gen(function* () {
    const sources = yield* UsageLimitSources.make;
    yield* sources.refresh;
    const snapshot = (yield* sources.current).find((source) => source.kind === "cma");
    expect(snapshot).toMatchObject({
      id: "cma",
      accounts: [{ id: "account-a", driver: ProviderDriverKind.make("codex") }],
    });
  }).pipe(
    Effect.provide([
      ServerSettings.layerTest({ usageLimitSources: {} }),
      Layer.mock(BackgroundPolicy.BackgroundPolicy)({
        shouldRunScopeWork: () => Effect.succeed(false),
      }),
      Layer.succeed(SecretResolver.SecretResolver, {
        label: (provider) => Effect.succeed(provider),
        read: (references) => Effect.succeed(references.map(() => undefined)),
        invalidate: () => Effect.void,
      }),
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make(() => Effect.die("Unexpected network request")),
      ),
      NodeCrypto.layer,
      CmaUsageSource.layer.pipe(Layer.provide(readerLayer(Effect.succeed([account])))),
    ]),
  ),
);
