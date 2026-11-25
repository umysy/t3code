import type { ExpoConfig } from "expo/config";

const FORK_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)-fork\.(\d+)$/;

export function forkVersionCode(version: string): number | undefined {
  const match = FORK_VERSION_PATTERN.exec(version);
  if (!match) {
    if (version.includes("-fork.")) {
      throw new Error(`Invalid fork version "${version}". Expected MAJOR.MINOR.PATCH-fork.N.`);
    }
    return undefined;
  }
  const [, majorText, minorText, patchText, forkText] = match;
  const major = Number(majorText);
  const minor = Number(minorText);
  const patch = Number(patchText);
  const fork = Number(forkText);
  const code = major * 10_000_000 + minor * 100_000 + patch * 100 + fork;
  if (major > 999 || minor > 99 || patch > 99 || fork > 99 || code > 2_147_483_647) {
    throw new Error(
      `Invalid fork version "${version}". Each version component must fit its Android version code range.`,
    );
  }
  return code;
}

export function applyForkAppConfig(config: ExpoConfig): ExpoConfig {
  if (config.extra?.appVariant !== "production") return config;

  const versionCode = forkVersionCode(config.version ?? "");
  const intentFilters = config.android?.intentFilters?.filter((filter) => {
    const data = Array.isArray(filter.data) ? filter.data : [filter.data];
    return !(filter.autoVerify && data.some((item) => item?.host === "app.t3.codes"));
  });
  return {
    ...config,
    name: "T3 Code Fork",
    scheme: "t3code-fork",
    icon: "./assets/fork/ios-icon.png",
    updates: { ...config.updates, enabled: false },
    android: {
      ...config.android,
      package: "com.umysy.t3codefork",
      icon: "./assets/fork/ios-icon.png",
      versionCode,
      intentFilters,
      adaptiveIcon: {
        ...config.android?.adaptiveIcon,
        foregroundImage: "./assets/fork/android-adaptive-foreground.png",
      },
    },
    extra: { ...config.extra, fork: { updateRepository: "umysy/t3code" } },
    plugins: [...(config.plugins ?? []), "./plugins/fork/withForkAndroidReleaseSigning.cjs"],
  };
}
