# The Android fork is a separate app that updates itself from GitHub

The Android fork build uses its own application id and the name "T3 Code Fork", so it installs next to the official Play Store app instead of replacing it, and the owner can always fall back to the official app. It turns off the official Expo over-the-air updates, because those would replace the fork's JavaScript with official code, and it checks the fork's GitHub releases itself instead of relying on a third-party updater.

## Consequences

- T3 Connect sign-in and push notifications do not work in the fork app, because the official Clerk and Firebase projects only know the official application id. The owner connects over Tailscale, so this was accepted.
- The fork app has its own data, so it must be paired with each environment once.
