import type { LimitAccount } from "@t3tools/shared/usageLimits";
import { remainingPercent } from "@t3tools/shared/usageLimits";
import { msg, T, useGT, useLocale, useMessages, Var } from "gt-react-native";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { ProviderIcon } from "../../components/ProviderIcon";
import { useEffect, useRef, useState } from "react";
import {
  cmaReadAt,
  cmaSourceReadAt,
  cmaSubscriptionExpiry,
  formatCmaTimestamp,
  shouldShowCmaRefreshHint,
} from "./CmaUsageAccounts.logic";

function valueOrUnknown(value: string | undefined, unknown: string): string {
  return value && value.length > 0 ? value : unknown;
}

function accountName(account: LimitAccount): string {
  return account.email ?? account.displayName ?? account.key;
}

function StateBadge({
  label,
  muted = false,
}: {
  readonly label: string;
  readonly muted?: boolean;
}) {
  return (
    <View className={`rounded-full px-2 py-0.5 ${muted ? "bg-subtle" : "bg-subtle-strong"}`}>
      <Text className="text-xs font-t3-medium text-foreground">{label}</Text>
    </View>
  );
}

function DetailRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View className="flex-row items-start justify-between gap-3">
      <Text className="text-sm text-foreground-muted">{label}</Text>
      <Text selectable className="min-w-0 flex-1 text-right text-sm tabular-nums text-foreground">
        {value}
      </Text>
    </View>
  );
}

function CmaAccountCard({ account }: { readonly account: LimitAccount }) {
  const locale = useLocale();
  const gt = useGT();
  const m = useMessages();
  const subscription = account.subscription;
  const unavailable = account.limits.unavailable !== undefined;
  const stale = !unavailable && account.sourceError !== undefined;
  const plan =
    account.plan ??
    subscription?.planDisplayName ??
    subscription?.planType ??
    subscription?.subscriptionPlan;
  const status = !account.enabled
    ? gt("Disabled")
    : account.current === true
      ? gt("Current")
      : account.current === false
        ? gt("Not current")
        : gt("Current state unknown");

  return (
    <View className="gap-4 rounded-[24px] border-continuous bg-grouped-card p-4">
      <View className="flex-row items-start gap-3">
        <ProviderIcon provider={account.driver} size={22} />
        <View className="min-w-0 flex-1 gap-1">
          <Text className="text-base font-t3-medium text-foreground" numberOfLines={1}>
            {accountName(account)}
          </Text>
          {account.email && account.displayName ? (
            <Text className="text-sm text-foreground-muted" numberOfLines={1}>
              {account.displayName}
            </Text>
          ) : null}
        </View>
        <StateBadge label={status} muted={!account.enabled || account.current === false} />
      </View>

      {unavailable || stale ? (
        <View className="rounded-xl border border-warning-border bg-warning px-3 py-2">
          <Text className="text-sm font-t3-medium text-warning-foreground">
            {unavailable ? gt("Unavailable") : gt("Stale")}
          </Text>
          <Text className="text-xs text-warning-foreground">
            {unavailable
              ? gt("Quota data is unavailable. The last observation is shown when available.")
              : gt("Showing the last known quota data.")}
          </Text>
        </View>
      ) : null}

      <View className="gap-3">
        {account.limits.windows.map((window, index) => (
          <View
            key={window.id}
            className={index === 0 ? "gap-1.5" : "gap-1.5 border-t border-border-subtle pt-3"}
          >
            <View className="flex-row items-baseline justify-between gap-3">
              <Text className="text-sm font-t3-medium text-foreground">{window.label}</Text>
              <Text className="text-sm font-t3-medium tabular-nums text-foreground">
                <T>
                  <Var>{remainingPercent(window)}</Var>% left
                </T>
              </Text>
            </View>
            {window.resetsAt ? (
              <DetailRow
                label={gt("Resets", { $context: "when the usage window resets" })}
                value={formatCmaTimestamp(window.resetsAt, locale) || m(msg("Unknown"))}
              />
            ) : (
              <DetailRow
                label={gt("Resets", { $context: "when the usage window resets" })}
                value={m(msg("Unknown"))}
              />
            )}
          </View>
        ))}
      </View>

      <View className="gap-1.5 border-t border-border-subtle pt-3">
        <DetailRow
          label={gt("Observed")}
          value={formatCmaTimestamp(account.limits.checkedAt, locale) || m(msg("Unknown"))}
        />
        <DetailRow
          label={gt("Plan", { $context: "subscription plan" })}
          value={valueOrUnknown(plan, m(msg("Unknown")))}
        />
        <DetailRow
          label={gt("Subscription", { $context: "subscription metadata" })}
          value={valueOrUnknown(
            subscription?.active === undefined
              ? undefined
              : subscription.active
                ? gt("Active")
                : gt("Inactive"),
            m(msg("Unknown")),
          )}
        />
        <DetailRow
          label={gt("Billing period", { $context: "subscription billing period" })}
          value={valueOrUnknown(subscription?.billingPeriod, m(msg("Unknown")))}
        />
        <DetailRow
          label={gt("Expires", { $context: "subscription expiry" })}
          value={formatCmaTimestamp(cmaSubscriptionExpiry(account), locale) || m(msg("Unknown"))}
        />
        <DetailRow
          label={gt("Renews", { $context: "subscription renewal time" })}
          value={formatCmaTimestamp(subscription?.renewsAt, locale) || m(msg("Unknown"))}
        />
        <DetailRow
          label={gt("Renewal", { $context: "subscription renewal status" })}
          value={valueOrUnknown(
            subscription?.willRenew === undefined
              ? undefined
              : subscription.willRenew
                ? gt("Will renew")
                : gt("Will not renew"),
            m(msg("Unknown")),
          )}
        />
      </View>
    </View>
  );
}

function CmaAccountsChart({ accounts }: { readonly accounts: readonly LimitAccount[] }) {
  const gt = useGT();
  const locale = useLocale();
  const m = useMessages();
  return (
    <View className="gap-3">
      {accounts.map((account) => {
        const unavailable = account.limits.unavailable !== undefined;
        const stale = !unavailable && account.sourceError !== undefined;
        const subscription = account.subscription;
        const plan =
          account.plan ??
          subscription?.planDisplayName ??
          subscription?.planType ??
          subscription?.subscriptionPlan;
        return (
          <View
            key={account.key}
            className="gap-4 rounded-[24px] border-continuous bg-grouped-card p-4"
          >
            <View className="flex-row items-start gap-3">
              <ProviderIcon provider={account.driver} size={22} />
              <View className="min-w-0 flex-1 gap-1">
                <Text className="text-base font-t3-medium text-foreground" numberOfLines={1}>
                  {accountName(account)}
                </Text>
                {account.email && account.displayName ? (
                  <Text className="text-sm text-foreground-muted" numberOfLines={1}>
                    {account.displayName}
                  </Text>
                ) : null}
              </View>
              <StateBadge
                label={
                  !account.enabled
                    ? gt("Disabled")
                    : account.current === true
                      ? gt("Current")
                      : account.current === false
                        ? gt("Not current")
                        : gt("Current state unknown")
                }
                muted={!account.enabled || account.current === false}
              />
            </View>
            {unavailable || stale ? (
              <View className="rounded-xl border border-warning-border bg-warning px-3 py-2">
                <Text className="text-sm font-t3-medium text-warning-foreground">
                  {unavailable ? gt("Unavailable") : gt("Stale")}
                </Text>
              </View>
            ) : null}
            <View className="flex-row flex-wrap gap-x-4 gap-y-1">
              <Text className="text-xs text-foreground-muted">
                {gt("Plan", { $context: "subscription plan" })}: {plan || m(msg("Unknown"))}
              </Text>
              <Text className="text-xs text-foreground-muted">
                {gt("Expires", { $context: "subscription expiry" })}:{" "}
                {formatCmaTimestamp(cmaSubscriptionExpiry(account), locale) || m(msg("Unknown"))}
              </Text>
            </View>
            <View className="gap-3">
              {account.limits.windows.length === 0 ? (
                <Text className="text-sm text-foreground-muted">{gt("No quota windows")}</Text>
              ) : (
                account.limits.windows.map((window) => {
                  const remaining = remainingPercent(window);
                  return (
                    <View key={window.id} className="gap-1.5">
                      <View className="flex-row items-baseline justify-between gap-3">
                        <Text className="text-sm text-foreground-muted">{window.label}</Text>
                        <Text className="text-sm font-t3-medium tabular-nums text-foreground">
                          <T>
                            <Var>{remaining}</Var>% left
                          </T>
                        </Text>
                      </View>
                      <View className="h-2 overflow-hidden rounded-full bg-subtle">
                        <View
                          className={
                            remaining <= 10
                              ? "h-full rounded-full bg-red-500"
                              : remaining <= 30
                                ? "h-full rounded-full bg-amber-500"
                                : "h-full rounded-full bg-foreground"
                          }
                          style={{ width: `${remaining}%` }}
                        />
                      </View>
                      <Text className="text-xs text-foreground-muted">
                        {gt("Resets {time}", {
                          time: window.resetsAt
                            ? formatCmaTimestamp(window.resetsAt, locale)
                            : m(msg("Unknown")),
                        })}
                      </Text>
                    </View>
                  );
                })
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

export function CmaUsageAccountsSection({
  accounts,
  manualRefreshPending = false,
}: {
  readonly accounts: readonly LimitAccount[];
  readonly manualRefreshPending?: boolean;
}) {
  const gt = useGT();
  const [view, setView] = useState<CmaUsageView>("text");
  const locale = useLocale();
  const m = useMessages();
  const readAt = cmaReadAt(accounts);
  const sourceReadAt = cmaSourceReadAt(accounts);
  const previousReadAt = useRef<string | undefined>(undefined);
  const hintReadAt = useRef<string | undefined>(undefined);
  const [showRefreshHint, setShowRefreshHint] = useState(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- records the completed manual refresh result while this section is mounted
  useEffect(() => {
    if (manualRefreshPending) {
      if (previousReadAt.current === undefined) previousReadAt.current = sourceReadAt;
      return;
    }
    if (previousReadAt.current !== undefined) {
      const show = shouldShowCmaRefreshHint(previousReadAt.current, sourceReadAt, true);
      setShowRefreshHint(show);
      hintReadAt.current = show ? sourceReadAt : undefined;
      previousReadAt.current = undefined;
    } else if (showRefreshHint && hintReadAt.current !== sourceReadAt) {
      setShowRefreshHint(false);
      hintReadAt.current = undefined;
    }
  }, [manualRefreshPending, sourceReadAt, showRefreshHint]);
  if (accounts.length === 0) return null;
  return (
    <View className="gap-3">
      <View className="flex-row items-center justify-between gap-3">
        <View>
          <Text className="px-1 text-base font-t3-medium text-foreground">
            {gt("Codex accounts", { $context: "CMA usage account list" })}
          </Text>
          {readAt ? (
            <Text className="px-1 text-xs text-foreground-muted">
              {m(
                msg("Updated {date}", {
                  date: formatCmaTimestamp(readAt, locale) || m(msg("Unknown")),
                }),
              )}
            </Text>
          ) : null}
        </View>
        <SegmentedControl
          options={[
            { value: "text" as const, label: gt("Text") },
            { value: "chart" as const, label: gt("Chart") },
          ]}
          selected={view}
          onSelect={setView}
          size="compact"
          role="tab"
        />
      </View>
      {showRefreshHint ? (
        <Text accessibilityRole="alert" className="px-1 text-sm text-foreground-muted">
          {m(msg("CMA can read account data at most once every 5 minutes"))}
        </Text>
      ) : null}
      {view === "chart" ? (
        <CmaAccountsChart accounts={accounts} />
      ) : (
        accounts.map((account) => <CmaAccountCard key={account.key} account={account} />)
      )}
    </View>
  );
}

export type CmaUsageView = "text" | "chart";
