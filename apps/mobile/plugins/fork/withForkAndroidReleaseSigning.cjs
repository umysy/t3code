const { withAppBuildGradle } = require("expo/config-plugins");

const MARKER = "// fork: release signing";

// Appended after the template's android block so it overrides the release build's debug signing.
// Credentials come from the environment at Gradle time; without them local builds keep debug signing.
const FORK_SIGNING = `
${MARKER}
if (System.getenv("FORK_ANDROID_KEYSTORE_PATH")) {
    android {
        signingConfigs {
            forkRelease {
                storeFile file(System.getenv("FORK_ANDROID_KEYSTORE_PATH"))
                storePassword System.getenv("FORK_ANDROID_KEYSTORE_PASSWORD")
                keyAlias System.getenv("FORK_ANDROID_KEY_ALIAS")
                keyPassword System.getenv("FORK_ANDROID_KEY_PASSWORD")
            }
        }
        buildTypes {
            release {
                signingConfig signingConfigs.forkRelease
            }
        }
    }
}
`;

module.exports = function withForkAndroidReleaseSigning(config) {
  return withAppBuildGradle(config, (nextConfig) => {
    if (!nextConfig.modResults.contents.includes(MARKER)) {
      nextConfig.modResults.contents += FORK_SIGNING;
    }
    return nextConfig;
  });
};
