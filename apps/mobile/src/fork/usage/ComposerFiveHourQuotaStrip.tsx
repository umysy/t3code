import { useAtomValue } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
import type { EnvironmentId, ProviderDriverKind } from "@t3tools/contracts";
import {
  type QuotaSeverity,
  selectComposerFiveHourQuota,
} from "@t3tools/shared/fork/usageAccountMatrix";
import { collectLimitAccounts } from "@t3tools/shared/usageLimits";
import { formatDuration } from "@t3tools/shared/usageLimitsCopy";
import { useGT, useMessages } from "gt-react-native";
import { Keyboard, Pressable, View } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { openSettings } from "../../features/settings/settings-navigation";
import { useNowMinuteMs } from "../../lib/clock";
import { environmentPresentations } from "../../state/presentation";

function stripToneClasses(severity: QuotaSeverity): {
  readonly container: string;
  readonly text: string;
  readonly dot: string;
} {
  if (severity === "danger") {
    return {
      container: "bg-danger/15 border border-danger/30",
      text: "text-danger-foreground",
      dot: "bg-danger",
    };
  }
  if (severity === "warning") {
    return {
      container: "bg-warning/15 border border-warning/30",
      text: "text-warning-foreground",
      dot: "bg-warning",
    };
  }
  return {
    container: "bg-subtle",
    text: "text-foreground-muted",
    dot: "bg-foreground-muted",
  };
}

/** Fork: compact 5-hour quota strip above the mobile composer; taps open Usage → Limits. */
export function ComposerFiveHourQuotaStrip({
  driver,
  environmentId,
}: {
  readonly driver: ProviderDriverKind;
  readonly environmentId: EnvironmentId;
}) {
  const gt = useGT();
  const m = useMessages();
  const navigation = useNavigation();
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const now = useNowMinuteMs();
  const quota = selectComposerFiveHourQuota(
    collectLimitAccounts(presentations),
    driver,
    environmentId,
    now,
  );
  if (!quota) return null;

  const resetMs = quota.resetsAt ? Date.parse(quota.resetsAt) - now : Number.NaN;
  const resetDuration = Number.isFinite(resetMs) && resetMs > 0 ? formatDuration(resetMs, m) : null;
  const idlest =
    quota.idlestAccount && quota.idlestAccount.accountKey !== quota.accountKey
      ? quota.idlestAccount
      : undefined;
  const tone = stripToneClasses(quota.severity);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={gt("5-hour quota: {remaining}% left. Open usage limits", {
        remaining: quota.remainingPercent,
      })}
      onPress={() => {
        Keyboard.dismiss();
        openSettings(navigation, "SettingsUsage");
      }}
      className={`mb-1.5 flex-row items-center justify-between gap-2 rounded-full px-3 py-1 active:opacity-70 ${tone.container}`}
    >
      <View className="min-w-0 flex-1 flex-row items-center gap-1.5">
        <View className={`size-1.5 shrink-0 rounded-full ${tone.dot}`} />
        <Text numberOfLines={1} className={`text-xs font-t3-medium tabular-nums ${tone.text}`}>
          {resetDuration
            ? gt("5h {remaining}% · resets {duration}", {
                remaining: quota.remainingPercent,
                duration: resetDuration,
              })
            : gt("5h {remaining}%", {
                remaining: quota.remainingPercent,
                $context: "five-hour usage window remaining, mobile composer strip",
              })}
        </Text>
      </View>
      <View className="shrink-0 flex-row items-center gap-1">
        {idlest ? (
          <Text numberOfLines={1} className="text-xs text-foreground-muted tabular-nums">
            {gt("Best {remaining}%", { remaining: idlest.remainingPercent })}
          </Text>
        ) : null}
        <SymbolView
          name="chevron.right"
          size={10}
          tintColorClassName="accent-foreground-muted"
          type="monochrome"
        />
      </View>
    </Pressable>
  );
}
