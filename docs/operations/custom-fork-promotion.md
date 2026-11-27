# Custom fork promotion

Use three isolated T3 homes for the custom fork. The development home is for active code changes, the test home is for seeded fixtures and surface verification, and the production home is the installed user environment.

## Development

Run the fork from its worktree so the runner selects a private `.t3` home and labels the server as development.

```powershell
vp run dev --home-dir .t3
```

Do not point development or test servers at `~/.t3/userdata`. The server rejects that combination through its environment role policy.

## Test

Run the scenario stack with a separate home. Scenario startup sets `T3CODE_ENVIRONMENT_ROLE=test` and recreates the home before each run.

```powershell
vp run scenarios:prove
```

The CMA Usage test data must cover three accounts, a disabled account, both quota windows, subscription expiry, and retention after a failed refresh. Verify the Usage page in every available client before promotion.

## Promotion

Promote a change only after the focused tests, the affected package typecheck, and the client verification pass. Keep the test home available until the result is recorded. Start the production app separately with its normal production home after the test server has stopped.

## Upstream updates

Follow [docs/fork/MAINTENANCE.md](../fork/MAINTENANCE.md#4-syncing-an-official-release) when syncing the fork with a new official release.

## Core exceptions

- `WINDOWS_PACKAGED_PAYLOAD_FILE_LIMIT` is 120 here, not the official 80. The fork release build on `windows-latest` counted 96 files in `win-unpacked` on v0.1.11 (server compile cache 29, server unpacked files 26, Electron 16, `@cursor/sdk` 11, other 14) and 106 on v0.1.12, so the official limit rejects it. Re-check this value after each upstream update and remove the exception if the official build stays within 80.
- Product analytics, relay tracing, and mobile diagnostics default to off in this fork (`isTelemetryEnabledByDefault()` in `packages/shared/src/fork/telemetryDefault.ts`), rather than `!isCiEnvironment(...)` / opt-out. Explicit `T3CODE_TELEMETRY_ENABLED=true` still enables server and desktop telemetry unless `DO_NOT_TRACK=1` or a managed policy denies it.
