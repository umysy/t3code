# The fork follows official releases and ships from its own pipeline

The fork exists so its owner can always run the latest official T3 Code while keeping a few personal features. Each fork build is therefore an official release tag plus the fork features, never official `main` or a nightly, because releases are what the owner would otherwise install and they arrive about weekly instead of several times a day. Fork features live in fork-owned files and reach official code only through small fork hooks, since upstream changes its busiest files (`ws.ts`, `server.ts`) every few days and every line we keep there is a future conflict. Fork builds are published from a fork-only GitHub workflow, because the official release workflows only run on `pingdotgg/t3code` and on paid runners.

## Considered Options

- **Follow official `main`.** Rejected: about 550 upstream commits landed in four days, so the fork would be rebuilt constantly and would ship unreleased code.
- **Build installers on the owner's PC.** Rejected: it needs the PC on and a manual upload, and does not give the installed apps an update feed.
- **Run a local service that mimics the official hub API, so official code needs no change at all.** Rejected for now: it cannot carry CMA subscription details or the chart view, and the API fit was never verified.
- **Code-sign the Windows installer.** Rejected: Azure Trusted Signing costs money and identity verification, and unsigned installs still accept unsigned updates; the cost is a one-time "unknown publisher" warning.

## Consequences

- A fork feature that depends on official code newer than the latest release cannot ship until the next release includes it. CMA waited for the release after `v0.1.11` for this reason, because it builds on official hub routing (#30778).
- Only Windows x64 and Android are built.
- The fork's GitHub repository must stay public, because the desktop updater reads releases without a token.
