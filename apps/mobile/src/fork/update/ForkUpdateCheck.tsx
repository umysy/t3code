import * as Application from "expo-application";
import Constants from "expo-constants";
import { useGT } from "gt-react-native";
import { useEffect, useRef, useState } from "react";

import * as Dialog from "../../components/ui/Dialog";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import { SettingsRow } from "../../features/settings/components/SettingsRow";
import { fetchForkRelease, isForkUpdateAvailable, type ForkRelease } from "./forkUpdate.logic";

const repository = Constants.expoConfig?.extra?.fork?.updateRepository;
// The installed APK's versionName; the bundled JS config can carry a different version.
const currentVersion = () => Application.nativeApplicationVersion ?? "0.0.0";

function showForkUpdate(gt: ReturnType<typeof useGT>, release: ForkRelease): void {
  Dialog.confirm({
    title: gt("T3 Code Fork {version} is available", { version: release.version }),
    message: gt("Download the latest fork release?"),
    confirmText: gt("Download"),
    cancelText: gt("Later"),
    onConfirm: () => void tryOpenExternalUrl(release.apkUrl),
  });
}

export function ForkUpdateRow() {
  const gt = useGT();
  const [status, setStatus] = useState<"idle" | "checking" | "current" | "failed">("idle");
  return (
    <SettingsRow
      icon="arrow.down.circle"
      label={gt("Check for updates")}
      value={
        status === "checking"
          ? gt("Checking…")
          : status === "current"
            ? gt("Up to date")
            : status === "failed"
              ? gt("Could not check for updates")
              : undefined
      }
      valuePosition="below"
      disabled={status === "checking"}
      onPress={() => {
        if (!repository) return;
        setStatus("checking");
        void fetchForkRelease(repository).then((release) => {
          if (!release) return setStatus("failed");
          if (isForkUpdateAvailable(currentVersion(), release)) {
            setStatus("idle");
            showForkUpdate(gt, release);
          } else {
            setStatus("current");
          }
        });
      }}
    />
  );
}

export function ForkUpdateLaunchCheck() {
  const gt = useGT();
  const checked = useRef(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- checks the external GitHub release once when the app mounts
  useEffect(() => {
    // gt changes with the language; check only once per launch.
    if (!repository || checked.current) return;
    checked.current = true;
    void fetchForkRelease(repository).then((release) => {
      if (release && isForkUpdateAvailable(currentVersion(), release)) showForkUpdate(gt, release);
    });
  }, [gt]);
  return null;
}
