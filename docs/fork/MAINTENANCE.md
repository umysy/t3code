# Fork Maintenance

How to maintain `umysy/t3code` and update it to each new [official release](GLOSSARY.md#where-the-fork-comes-from). See [ADR-0001](adr/0001-fork-follows-official-releases.md) and [ADR-0002](adr/0002-android-fork-is-a-separate-app.md) for the underlying decisions.

## 1. What the fork carries

- **CMA usage**: reads and displays CMA account usage and subscription info on the Usage page (server, web, mobile).
- **Environment role safety**: development and test servers refuse to start against `~/.t3/userdata`.
- **Windows `pgrep` skip**: skips the POSIX `pgrep` busy check in Codex on `win32`.
- **Windows payload limit**: raises `WINDOWS_PACKAGED_PAYLOAD_FILE_LIMIT` from `80` to `100`.
- **Dev tooling** (optional; drop if it conflicts): dev session lock, Windows dev memory limit, and Windows symlink test skip.
- **Android fork app**: builds as "T3 Code Fork" (`com.umysy.t3codefork`) with self-hosted GitHub update checks.
- **Fork release workflows**: automated [upstream check](../../.github/workflows/fork-upstream-check.yml) and [Windows/Android release](../../.github/workflows/fork-release.yml) pipelines.

## 2. Where fork code lives

- [apps/server/src/fork/](../../apps/server/src/fork/) (registered via [layer.ts](../../apps/server/src/fork/layer.ts))
- [apps/web/src/fork/](../../apps/web/src/fork/)
- [apps/mobile/src/fork/](../../apps/mobile/src/fork/)
- [apps/mobile/fork/appConfig.ts](../../apps/mobile/fork/appConfig.ts)
- [apps/mobile/plugins/fork/](../../apps/mobile/plugins/fork/)
- [apps/mobile/assets/fork/](../../apps/mobile/assets/fork/)
- [apps/mobile/scripts/fork-icons.ts](../../apps/mobile/scripts/fork-icons.ts)
- [packages/shared/src/forkCmaUsage.ts](../../packages/shared/src/forkCmaUsage.ts)
- [scripts/lib/dev-session-lock.ts](../../scripts/lib/dev-session-lock.ts)
- [.github/workflows/fork-\*.yml](../../.github/workflows/)
- [docs/fork/](.)

## 3. Hooks in official files

The fork keeps features in fork-owned directories and connects them through small [fork hooks](GLOSSARY.md#what-the-fork-carries):

| File                                                                                                                                   | What the fork adds                                                    | Why                                 |
| -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------- |
| [apps/server/src/server.ts](../../apps/server/src/server.ts)                                                                           | Provides `ForkLayer.layer` to `UsageLimitSources.layer`               | Wire CMA usage source               |
| [apps/server/src/usage/UsageLimitSources.ts](../../apps/server/src/usage/UsageLimitSources.ts)                                         | `UsageLimitSourceExtension` service hook                              | Append CMA snapshots on refresh     |
| [apps/server/src/environment/ServerEnvironment.ts](../../apps/server/src/environment/ServerEnvironment.ts)                             | `resolveSafeEnvironmentRole` and `environmentRole`                    | Block dev/test from live data       |
| [apps/server/src/environment/ServerEnvironment.test.ts](../../apps/server/src/environment/ServerEnvironment.test.ts)                   | `skipIf` `win32` on symlink install-ownership test                    | Windows lacks unprivileged symlinks |
| [apps/server/src/provider/CodexProvider.ts](../../apps/server/src/provider/CodexProvider.ts)                                           | Early `return false` on `win32` in `codexProcessGroupIsBusy`          | `pgrep` does not exist on Windows   |
| [packages/contracts/src/environment.ts](../../packages/contracts/src/environment.ts)                                                   | `EnvironmentRole` on `ExecutionEnvironmentDescriptor`                 | Expose environment role over RPC    |
| [packages/contracts/src/providerUsageLimits.ts](../../packages/contracts/src/providerUsageLimits.ts)                                   | `"cma"` source kind, `enabled`, `current`, `subscription`             | Contract schemas for CMA accounts   |
| [packages/shared/src/usageLimits.ts](../../packages/shared/src/usageLimits.ts)                                                         | `enabled` filtering, `isCmaSource`, CMA metadata passthrough          | Aggregate CMA accounts with pools   |
| [packages/shared/src/usageLimits.test.ts](../../packages/shared/src/usageLimits.test.ts)                                               | New CMA and `enabled` fields in pool fixtures                         | Match updated usage account shape   |
| [packages/shared/package.json](../../packages/shared/package.json)                                                                     | `"./forkCmaUsage"` subpath export                                     | Expose shared CMA helpers           |
| [apps/web/src/components/usage/UsagePage.tsx](../../apps/web/src/components/usage/UsagePage.tsx)                                       | Passes `manualRefreshPending={isRefreshing}`                          | Show CMA refresh state in web UI    |
| [apps/web/src/components/usage/UsageLimits.tsx](../../apps/web/src/components/usage/UsageLimits.tsx)                                   | Forwards `manualRefreshPending` to pooled view                        | Thread refresh state to CMA         |
| [apps/web/src/components/usage/UsageLimitsPooled.tsx](../../apps/web/src/components/usage/UsageLimitsPooled.tsx)                       | Renders `CmaAccountsSection` and checks CMA in empty state            | Display CMA accounts on web         |
| [apps/mobile/app.config.ts](../../apps/mobile/app.config.ts)                                                                           | Wraps exported config in `applyForkAppConfig`                         | Set fork Android ID, name, icons    |
| [apps/mobile/src/App.tsx](../../apps/mobile/src/App.tsx)                                                                               | Mounts `<ForkUpdateLaunchCheck />`                                    | Check fork releases on launch       |
| [apps/mobile/src/features/settings/SettingsAboutRouteScreen.tsx](../../apps/mobile/src/features/settings/SettingsAboutRouteScreen.tsx) | Renders `<ForkUpdateRow />` when `extra.fork` is set                  | Manual fork update check in About   |
| [apps/mobile/src/features/usage/UsageRouteScreen.tsx](../../apps/mobile/src/features/usage/UsageRouteScreen.tsx)                       | Passes `manualRefreshPending={limits.refreshing}`                     | Show CMA refresh state on mobile    |
| [apps/mobile/src/features/usage/UsageLimitsPooled.tsx](../../apps/mobile/src/features/usage/UsageLimitsPooled.tsx)                     | Renders `CmaAccountsSection` and checks CMA in empty state            | Display CMA accounts on mobile      |
| [scripts/build-desktop-artifact.ts](../../scripts/build-desktop-artifact.ts)                                                           | Sets `WINDOWS_PACKAGED_PAYLOAD_FILE_LIMIT = 100`                      | Allow local Windows build size      |
| [scripts/dev-runner.ts](../../scripts/dev-runner.ts)                                                                                   | `T3CODE_ENVIRONMENT_ROLE`, `acquireDevSessionLock`, Windows help text | Dev role, session lock, memory cap  |
| [scripts/lib/dev-memory-limit.ts](../../scripts/lib/dev-memory-limit.ts)                                                               | `readWindowsProcessTreeBytes` via PowerShell                          | Enforce dev memory cap on Windows   |
| [scripts/scenarios/start-app.ts](../../scripts/scenarios/start-app.ts)                                                                 | Sets `T3CODE_ENVIRONMENT_ROLE: "test"`                                | Mark scenario servers as test       |
| [knip.jsonc](../../knip.jsonc)                                                                                                         | Ignores `plugins/fork/*.cjs` and `scripts/fork-icons.ts`              | Keep fork entry points unflagged    |
| [AGENTS.md](../../AGENTS.md)                                                                                                           | `## Agent skills` section                                             | Point agents to fork docs           |
| [docs/operations/release.md](../../docs/operations/release.md)                                                                         | Updates documented Windows file limit from 80 to 100                  | Match `build-desktop-artifact.ts`   |

The i18n translation catalogs (`apps/{web,mobile}/src/i18n/translations/*.json`) also carry fork-specific keys.

## 4. Syncing an official release

The hourly [fork-upstream-check.yml](../../.github/workflows/fork-upstream-check.yml) workflow opens an issue titled `Upstream stable release vX.Y.Z` when `pingdotgg/t3code` publishes a new stable tag. Only official **stable** tags are used—never nightly tags or `upstream/main`. The fork's default branch is `fork/main`; always sync into `fork/main`, never into `main`.

1. Fetch upstream tags: `git fetch upstream --tags`.
2. Find the old official base commit (the last official commit below the first fork commit in `git log --first-parent`), then rebase `fork/main` in a dev worktree: `git rebase --onto vX.Y.Z <old-official-base> fork/main`.
3. Resolve any conflicts at the fork hook points listed in Section 3. Drop any superseded change or conflicting dev tooling rather than carrying dead weight.
4. Re-check `WINDOWS_PACKAGED_PAYLOAD_FILE_LIMIT` (see [custom-fork-promotion.md](../operations/custom-fork-promotion.md#core-exceptions)).
5. Regenerate i18n keys with `vp run i18n:generate` and translate any new keys in every locale under `apps/web/src/i18n/translations` and `apps/mobile/src/i18n/translations`.
6. Run `vp run check:changed` and the fork unit tests.
7. Verify the build in a separate **test environment**, never in the development or live environment.
8. Push `fork/main` only with the owner's approval.
9. Dispatch [fork-release.yml](../../.github/workflows/fork-release.yml) with version `X.Y.Z-fork.1`.
10. Inspect the generated draft GitHub release and its Windows/Android artifacts.
11. Publish the release only when the owner says "发布".
12. Close the `Upstream stable release vX.Y.Z` issue.

## 5. Versions

Fork releases use `X.Y.Z-fork.N`. Reset `N` to `1` for each new official version `X.Y.Z`, and bump `N` for fork-only releases on the same official base. See [fork-release.md](../operations/fork-release.md) for build and update-feed details.

## 6. Secrets and things that must not be lost

- Four GitHub Actions secrets are required for Android signing: `FORK_ANDROID_KEYSTORE_BASE64`, `FORK_ANDROID_KEYSTORE_PASSWORD`, `FORK_ANDROID_KEY_ALIAS`, and `FORK_ANDROID_KEY_PASSWORD`.
- Back up the Android release keystore outside GitHub. Losing it means Android users must uninstall "T3 Code Fork" before installing future updates.
