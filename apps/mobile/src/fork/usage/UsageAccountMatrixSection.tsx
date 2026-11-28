import { useAtomValue } from "@effect/atom-react";
import { providerClients } from "@t3tools/client-runtime/provider-clients";
import { normalizeProviderAccentColor } from "@t3tools/client-runtime/state/provider-instance-display";
import type { ServerProviderUsageWindow } from "@t3tools/contracts";
import { selectCmaUsageAccounts } from "@t3tools/shared/forkCmaUsage";
import {
  type AccountSortMode,
  accountErrorMessage,
  getExpiryWarning,
  getQuotaSeverity,
  getSessionWindow,
  getSoonestResetMs,
  getWeeklyWindow,
  groupAccountsByProvider,
  isAccountInErrorState,
  type ProviderAccountGroup,
  type QuotaSeverity,
  sortProviderAccounts,
} from "@t3tools/shared/fork/usageAccountMatrix";
import { type LimitAccount, paceOf, remainingPercent } from "@t3tools/shared/usageLimits";
import { formatDuration } from "@t3tools/shared/usageLimitsCopy";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { msg, useGT, useLocale, useMessages } from "gt-react-native";
import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { ProviderIcon } from "../../components/ProviderIcon";
import { resetLabels, ResetCredits } from "../../features/usage/UsageLimitsSection";
import { usageProviderKind, useProviderColors } from "../../features/usage/usageProviders";
import { mobilePreferencesAtom, saveMobilePreferences } from "../../state/preferences";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  cmaSourceReadAt,
  formatCmaBillingPeriod,
  formatCmaTimestamp,
  shouldShowCmaRefreshHint,
} from "../cma/CmaUsageAccounts.logic";

const SORT_MODES = ["idlest", "soonestReset", "soonestExpiry", "fixed"] as const;
const SORT_LABELS = {
  idlest: msg("Most available"),
  soonestReset: msg("Soonest reset"),
  soonestExpiry: msg("Soonest expiry"),
  fixed: msg("Fixed order"),
} as const;
const PACE_LABEL = {
  ahead: msg("Ahead of pace"),
  on: msg("On pace"),
  under: msg("Under pace"),
} as const;

function isSortMode(value: unknown): value is AccountSortMode {
  return SORT_MODES.some((mode) => mode === value);
}

function providerLabel(account: Pick<LimitAccount, "driver">): string {
  return providerClients.get(account.driver)?.label ?? String(account.driver);
}

function accountLabel(account: LimitAccount): string {
  return account.email ?? account.displayName ?? account.sourceLabel ?? providerLabel(account);
}

function accountPlan(account: LimitAccount): string | undefined {
  const subscription = account.subscription;
  return (
    account.plan ??
    subscription?.planDisplayName ??
    subscription?.planType ??
    subscription?.subscriptionPlan
  );
}

function severityFillClass(severity: QuotaSeverity): string | undefined {
  if (severity === "danger") return "bg-danger-foreground";
  if (severity === "warning") return "bg-warning-foreground";
  return undefined;
}

function severityTextClass(severity: QuotaSeverity): string {
  if (severity === "danger") return "text-danger-foreground";
  if (severity === "warning") return "text-warning-foreground";
  return "text-foreground";
}

function useAccountColor(account: LimitAccount): string {
  const colors = useProviderColors();
  return (
    normalizeProviderAccentColor(account.accentColor) ??
    colors[usageProviderKind(account.driver) ?? "codex"]
  );
}

function Pill({
  label,
  tone = "neutral",
}: {
  readonly label: string;
  readonly tone?: "neutral" | "muted" | "warning";
}) {
  return (
    <View
      className={
        tone === "warning"
          ? "rounded-full border border-warning-border bg-warning px-2 py-0.5"
          : `rounded-full px-2 py-0.5 ${tone === "muted" ? "bg-subtle" : "bg-subtle-strong"}`
      }
    >
      <Text
        className={`text-xs font-t3-medium ${tone === "warning" ? "text-warning-foreground" : "text-foreground"}`}
      >
        {label}
      </Text>
    </View>
  );
}

function ExpiryPill({ account, now }: { readonly account: LimitAccount; readonly now: number }) {
  const gt = useGT();
  const warning = getExpiryWarning(account.subscription, now);
  if (!warning || (!warning.isSoon && !warning.isExpired)) return null;
  const count = warning.daysRemaining;
  // Without an expiry the warning comes from the renewal date, which is not a lapse.
  const renews = !account.subscription?.expiresAt;
  if (warning.isExpired && renews) return null;
  const label = warning.isExpired
    ? gt("Expired")
    : renews
      ? count === 0
        ? gt("Renews today")
        : gt("{count, plural, one {Renews in {count} day} other {Renews in {count} days}}", {
            count,
          })
      : count === 0
        ? gt("Expires today")
        : gt("{count, plural, one {Expires in {count} day} other {Expires in {count} days}}", {
            count,
          });
  return <Pill label={label} tone={renews ? "neutral" : "warning"} />;
}

function RemainingBar({
  remaining,
  color,
  size,
}: {
  readonly remaining: number;
  readonly color: string;
  readonly size: "wide" | "mini";
}) {
  const fill = severityFillClass(getQuotaSeverity(remaining));
  return (
    <View
      className={`w-full overflow-hidden rounded-full bg-subtle ${size === "wide" ? "h-2.5" : "h-1.5"}`}
    >
      {remaining > 0 ? (
        <View
          className={`h-full rounded-full ${fill ?? ""}`}
          style={{ width: `${remaining}%`, ...(fill ? {} : { backgroundColor: color }) }}
        />
      ) : null}
    </View>
  );
}

function RetryButton({
  onRetry,
  refreshing,
}: {
  readonly onRetry: () => void;
  readonly refreshing: boolean;
}) {
  const gt = useGT();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: refreshing }}
      disabled={refreshing}
      onPress={onRetry}
      className="min-h-9 justify-center rounded-full border border-warning-border px-3 active:opacity-60"
    >
      <Text className="text-xs font-t3-medium text-warning-foreground">
        {refreshing ? gt("Retrying…") : gt("Retry")}
      </Text>
    </Pressable>
  );
}

function ErrorNotice({
  account,
  onRetry,
  refreshing,
}: {
  readonly account: LimitAccount;
  readonly onRetry: (() => void) | undefined;
  readonly refreshing: boolean;
}) {
  const gt = useGT();
  return (
    <View
      accessibilityRole="alert"
      className="flex-row items-center gap-2 rounded-xl border border-warning-border bg-warning px-3 py-2"
    >
      <SymbolView
        name="exclamationmark.triangle"
        size={14}
        tintColorClassName="accent-warning-foreground"
      />
      <Text className="min-w-0 flex-1 text-xs text-warning-foreground">
        {accountErrorMessage(account) ?? gt("Quota data is unavailable.")}
      </Text>
      {onRetry ? <RetryButton onRetry={onRetry} refreshing={refreshing} /> : null}
    </View>
  );
}

function WindowDetail({
  window,
  color,
  now,
}: {
  readonly window: ServerProviderUsageWindow;
  readonly color: string;
  readonly now: number;
}) {
  const gt = useGT();
  const m = useMessages();
  const remaining = remainingPercent(window);
  const pace = paceOf(window, now);
  const reset = resetLabels(window, now, m);
  return (
    <View className="gap-1.5">
      <View className="flex-row items-baseline justify-between gap-3">
        <Text className="shrink text-sm text-foreground-muted">{window.label}</Text>
        <Text
          className={`text-sm font-t3-medium tabular-nums ${severityTextClass(getQuotaSeverity(remaining))}`}
        >
          {gt("{remaining}% left", { remaining })}
        </Text>
      </View>
      <RemainingBar remaining={remaining} color={color} size="wide" />
      {pace || reset ? (
        <View className="flex-row justify-between gap-3">
          <Text className="text-xs text-foreground-tertiary">
            {pace ? m(PACE_LABEL[pace]) : ""}
          </Text>
          <Text className="text-xs tabular-nums text-foreground-tertiary">{reset?.full ?? ""}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** Everything one account reports: identity, every window with pace, credits and subscription. */
function AccountCard({
  account,
  now,
  onRetry,
  refreshing,
  embedded = false,
}: {
  readonly account: LimitAccount;
  readonly now: number;
  readonly onRetry: (() => void) | undefined;
  readonly refreshing: boolean;
  readonly embedded?: boolean;
}) {
  const gt = useGT();
  const locale = useLocale();
  const color = useAccountColor(account);
  const plan = accountPlan(account);
  const errored = isAccountInErrorState(account);
  const subscription = account.subscription;
  const source =
    account.environments.length > 0
      ? account.environments.map((environment) => environment.label).join(", ")
      : account.sourceLabel;
  const expiresAt = formatCmaTimestamp(subscription?.expiresAt, locale);
  const renewsAt = formatCmaTimestamp(subscription?.renewsAt, locale);
  const billingPeriod = formatCmaBillingPeriod(subscription?.billingPeriod);
  const checkedAt = formatCmaTimestamp(account.limits.checkedAt, locale);
  const footer = [
    subscription?.active === false ? gt("Inactive") : null,
    expiresAt ? gt("Expires {date}", { date: expiresAt }) : null,
    renewsAt
      ? subscription?.willRenew === false
        ? gt("Ends {date}", { date: renewsAt })
        : gt("Renews {date}", { date: renewsAt })
      : null,
    billingPeriod || null,
    source ? gt("Via {source}", { source }) : null,
    checkedAt ? gt("Updated {time}", { time: checkedAt }) : null,
  ].filter((part): part is string => Boolean(part));
  return (
    <View
      className={
        embedded
          ? "gap-3 rounded-2xl bg-subtle p-3"
          : "gap-4 rounded-[24px] border-continuous bg-grouped-card p-4"
      }
    >
      <View className="gap-1.5">
        <Text selectable className="text-base font-t3-medium text-foreground" numberOfLines={1}>
          {accountLabel(account)}
        </Text>
        <View className="flex-row flex-wrap gap-1.5">
          {plan ? <Pill label={plan} /> : null}
          {account.current === true ? <Pill label={gt("Current")} /> : null}
          {account.enabled === false ? <Pill label={gt("Disabled")} tone="muted" /> : null}
          <ExpiryPill account={account} now={now} />
        </View>
      </View>

      {errored ? (
        <ErrorNotice account={account} onRetry={onRetry} refreshing={refreshing} />
      ) : account.sourceError ? (
        <Text className="text-xs text-warning-foreground">
          {gt("Showing the last known quota data: {error}", { error: account.sourceError })}
        </Text>
      ) : null}

      {account.limits.windows.length > 0 ? (
        <View className="gap-3">
          {account.limits.windows.map((window) => (
            <WindowDetail
              key={`${window.kind}:${window.id}`}
              window={window}
              color={color}
              now={now}
            />
          ))}
        </View>
      ) : errored ? null : (
        <Text className="text-sm text-foreground-muted">{gt("No quota windows")}</Text>
      )}

      {account.redeem && account.limits.resetCredits ? (
        <ResetCredits
          environmentId={account.redeem.environmentId}
          input={account.redeem.input}
          credits={account.limits.resetCredits}
          now={now}
          dense
        />
      ) : null}

      {footer.length > 0 ? (
        <Text className="border-t border-border-subtle pt-3 text-xs text-foreground-muted">
          {footer.join(" · ")}
        </Text>
      ) : null}
    </View>
  );
}

function MiniWindow({
  label,
  window,
  color,
}: {
  readonly label: string;
  readonly window: ServerProviderUsageWindow | undefined;
  readonly color: string;
}) {
  const remaining = window ? remainingPercent(window) : null;
  return (
    <View className="w-16 gap-1">
      <Text
        className={`text-xs font-t3-medium tabular-nums ${remaining === null ? "text-foreground-muted" : severityTextClass(getQuotaSeverity(remaining))}`}
      >
        {remaining === null ? `${label} -` : `${label} ${remaining}%`}
      </Text>
      {remaining === null ? null : <RemainingBar remaining={remaining} color={color} size="mini" />}
    </View>
  );
}

function MatrixRow({
  account,
  now,
  expanded,
  idlest,
  onToggle,
  onRetry,
  refreshing,
}: {
  readonly account: LimitAccount;
  readonly now: number;
  readonly expanded: boolean;
  readonly idlest: boolean;
  readonly onToggle: () => void;
  readonly onRetry: (() => void) | undefined;
  readonly refreshing: boolean;
}) {
  const gt = useGT();
  const m = useMessages();
  const color = useAccountColor(account);
  const errored = isAccountInErrorState(account);
  const nextResetMs = getSoonestResetMs(account, now);
  const nextReset =
    nextResetMs !== undefined && nextResetMs > now ? formatDuration(nextResetMs - now, m) : null;
  return (
    <View className="gap-2">
      <View
        className={`flex-row items-center gap-2 rounded-xl ${idlest && !expanded ? "bg-subtle" : ""}`}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityHint={gt("Show account details")}
          onPress={onToggle}
          className="min-h-[52px] min-w-0 flex-1 flex-row items-center gap-3 px-2 py-2 active:opacity-60"
        >
          <View className="min-w-0 flex-1 gap-1">
            <Text className="text-sm font-t3-medium text-foreground" numberOfLines={1}>
              {accountLabel(account)}
            </Text>
            <View className="flex-row flex-wrap items-center gap-1.5">
              <ExpiryPill account={account} now={now} />
              {!errored && nextReset ? (
                <Text className="text-xs tabular-nums text-foreground-tertiary">
                  {gt("Next reset in {duration}", { duration: nextReset })}
                </Text>
              ) : null}
            </View>
          </View>
          {errored ? (
            <Text className="max-w-[45%] text-xs text-warning-foreground" numberOfLines={2}>
              {accountErrorMessage(account) ?? gt("Quota data is unavailable.")}
            </Text>
          ) : (
            <>
              <MiniWindow
                label={gt("5h", { $context: "five-hour usage window, short label" })}
                window={getSessionWindow(account)}
                color={color}
              />
              <MiniWindow
                label={gt("7d", { $context: "seven-day usage window, short label" })}
                window={getWeeklyWindow(account)}
                color={color}
              />
            </>
          )}
          <SymbolView
            name={expanded ? "chevron.up" : "chevron.down"}
            size={12}
            tintColorClassName="accent-foreground-muted"
          />
        </Pressable>
        {errored && onRetry ? <RetryButton onRetry={onRetry} refreshing={refreshing} /> : null}
      </View>
      {expanded ? (
        <AccountCard
          account={account}
          now={now}
          onRetry={onRetry}
          refreshing={refreshing}
          embedded
        />
      ) : null}
    </View>
  );
}

function GroupHeading({ group }: { readonly group: ProviderAccountGroup }) {
  return (
    <View className="flex-row items-center gap-2 px-1">
      <ProviderIcon provider={group.driver} size={18} />
      <Text className="text-base font-t3-medium text-foreground">{providerLabel(group)}</Text>
    </View>
  );
}

function MatrixGroup({
  group,
  now,
  sortMode,
  onSortModeChange,
  onRetry,
  refreshing,
}: {
  readonly group: ProviderAccountGroup;
  readonly now: number;
  readonly sortMode: AccountSortMode;
  readonly onSortModeChange: (mode: AccountSortMode) => void;
  readonly onRetry: (() => void) | undefined;
  readonly refreshing: boolean;
}) {
  const gt = useGT();
  const m = useMessages();
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const accounts = sortProviderAccounts(group.accounts, sortMode, now);
  const idlest = group.idlestAccount;
  const idlestSession = idlest ? getSessionWindow(idlest) : undefined;
  const idlestWindow = idlestSession ?? (idlest ? getWeeklyWindow(idlest) : undefined);
  const nextSortMode = SORT_MODES[(SORT_MODES.indexOf(sortMode) + 1) % SORT_MODES.length]!;
  return (
    <View className="gap-3">
      <View className="flex-row items-center justify-between gap-3">
        <View className="min-w-0 flex-1 flex-row items-center gap-2">
          <GroupHeading group={group} />
          <Pill
            label={gt("{count, plural, one {{count} account} other {{count} accounts}}", {
              count: group.accounts.length,
            })}
            tone="muted"
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={gt("Sort accounts: {mode}", { mode: m(SORT_LABELS[sortMode]) })}
          onPress={() => onSortModeChange(nextSortMode)}
          className="min-h-9 flex-row items-center gap-1 rounded-full bg-subtle px-3 active:opacity-60"
        >
          <SymbolView
            name="line.3.horizontal.decrease"
            size={11}
            tintColorClassName="accent-foreground-muted"
          />
          <Text className="text-xs font-t3-medium text-foreground">{m(SORT_LABELS[sortMode])}</Text>
        </Pressable>
      </View>
      {idlest && idlestWindow ? (
        <Text className="px-1 text-sm text-foreground-muted" numberOfLines={1}>
          {idlestSession
            ? gt("Most available: {account} (5h {remaining}%)", {
                account: accountLabel(idlest),
                remaining: remainingPercent(idlestWindow),
              })
            : gt("Most available: {account} (7d {remaining}%)", {
                account: accountLabel(idlest),
                remaining: remainingPercent(idlestWindow),
              })}
        </Text>
      ) : null}
      <View className="gap-1 rounded-[24px] border-continuous bg-grouped-card p-2">
        {accounts.map((account) => {
          const expanded = expandedKey === account.key;
          return (
            <MatrixRow
              key={account.key}
              account={account}
              now={now}
              expanded={expanded}
              idlest={idlest?.key === account.key}
              onToggle={() => setExpandedKey(expanded ? null : account.key)}
              onRetry={onRetry}
              refreshing={refreshing}
            />
          );
        })}
      </View>
    </View>
  );
}

/** CMA serves cached reads, so say so when a manual refresh came back unchanged. */
function useCmaRefreshHint(accounts: readonly LimitAccount[], refreshing: boolean): boolean {
  const sourceReadAt = cmaSourceReadAt(selectCmaUsageAccounts(accounts));
  const previousReadAt = useRef<string | undefined>(undefined);
  const hintReadAt = useRef<string | undefined>(undefined);
  const [showHint, setShowHint] = useState(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- records the completed manual refresh result while this section is mounted
  useEffect(() => {
    if (refreshing) {
      if (previousReadAt.current === undefined) previousReadAt.current = sourceReadAt;
      return;
    }
    if (previousReadAt.current !== undefined) {
      const show = shouldShowCmaRefreshHint(previousReadAt.current, sourceReadAt, true);
      setShowHint(show);
      hintReadAt.current = show ? sourceReadAt : undefined;
      previousReadAt.current = undefined;
    } else if (showHint && hintReadAt.current !== sourceReadAt) {
      setShowHint(false);
      hintReadAt.current = undefined;
    }
  }, [refreshing, sourceReadAt, showHint]);
  return showHint;
}

/** Fork: single accounts as one detail card, several as a sortable matrix with inline details. */
export function UsageAccountMatrixSection({
  accounts,
  now,
  onRetry,
  refreshing = false,
}: {
  readonly accounts: readonly LimitAccount[];
  readonly now: number;
  readonly onRetry?: (() => void) | undefined;
  readonly refreshing?: boolean;
}) {
  const gt = useGT();
  const preferences = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomCommand(saveMobilePreferences);
  const showCmaHint = useCmaRefreshHint(accounts, refreshing);
  const sortPreferences = AsyncResult.isSuccess(preferences)
    ? (preferences.value.forkUsageAccountSort ?? {})
    : {};
  const groups = groupAccountsByProvider(accounts, now);
  if (groups.length === 0) return null;
  return (
    <View className="gap-6">
      {showCmaHint ? (
        <Text accessibilityRole="alert" className="px-1 text-sm text-foreground-muted">
          {gt("CMA can read account data at most once every 5 minutes")}
        </Text>
      ) : null}
      {groups.map((group) => {
        if (group.mode === "single") {
          const [account] = group.accounts;
          return account ? (
            <View key={group.driver} className="gap-3">
              <GroupHeading group={group} />
              <AccountCard account={account} now={now} onRetry={onRetry} refreshing={refreshing} />
            </View>
          ) : null;
        }
        const stored = sortPreferences[group.driver];
        return (
          <MatrixGroup
            key={group.driver}
            group={group}
            now={now}
            sortMode={isSortMode(stored) ? stored : "idlest"}
            onSortModeChange={(mode) =>
              void savePreferences({
                forkUsageAccountSort: { ...sortPreferences, [group.driver]: mode },
              })
            }
            onRetry={onRetry}
            refreshing={refreshing}
          />
        );
      })}
    </View>
  );
}
