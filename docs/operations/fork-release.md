# Fork releases

The fork workflows keep `umysy/t3code` aware of stable upstream releases and provide a Windows release path.

## Upstream checks

`fork-upstream-check.yml` runs hourly and can also be dispatched manually. It reads the latest stable release from `pingdotgg/t3code`. For a new tag, it opens one issue in the fork with the rebase, checks, build, and approval checklist. Prerelease and nightly tags are ignored.

## Cutting a release

1. Open **Fork release** under Actions and dispatch it with a version such as `0.1.12-fork.1`.
2. Wait for the Windows x64 job to build and upload its installer and update metadata.
3. Review the generated draft release and publish it when the owner approves.

The version must match `MAJOR.MINOR.PATCH-fork.N`. The `-fork.N` suffix keeps the build on electron-updater's `latest` channel while allowing normal SemVer ordering between fork releases and upstream versions.

The workflow checks out the dispatched ref, installs dependencies with the shared `setup-ci-deps` action, and builds an unsigned Windows NSIS installer. The release contains the installer, its blockmap, and `latest.yml`.

The desktop auto-update feed points at `umysy/t3code`. Windows SmartScreen can warn because fork installers are unsigned.

Android publishing will be added in a later step.
