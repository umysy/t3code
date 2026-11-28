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
import {
  type LimitAccount,
  paceOf,
  paceRemainingPercent,
  remainingPercent,
} from "@t3tools/shared/usageLimits";
import { formatResetsIn } from "@t3tools/shared/usageLimitsCopy";
import * as Schema from "effect/Schema";
import { useGT, useMessages } from "gt-react";
import { AlertTriangleIcon, ChevronDownIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { usePrimarySettings } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import { ProviderInstanceIcon } from "../../components/chat/ProviderInstanceIcon";
import { providerClients } from "../../components/settings/providerDriverMeta";
import {
  RedactedSensitiveText,
  redactedPlaceholder,
} from "../../components/settings/RedactedSensitiveText";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { PaceIcon, ResetCredits, barColor } from "../../components/usage/UsageLimits";
import {
  cmaSourceReadAt,
  formatCmaBillingPeriod,
  formatCmaDate,
  shouldShowCmaRefreshHint,
} from "../cma/CmaUsage.logic";

const SORT_STORAGE_KEY = "t3code:fork:usage-account-sort:v1";
const SORT_MODES = ["idlest", "soonestReset", "soonestExpiry", "fixed"] as const;
const SortPreferencesSchema = Schema.Record(Schema.String, Schema.Literals(SORT_MODES));
const NO_SORT_PREFERENCES: Readonly<Record<string, AccountSortMode>> = {};

function isSortMode(value: unknown): value is AccountSortMode {
  return SORT_MODES.some((mode) => mode === value);
}

function accountInitials(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local[0] ?? ""}${domain[0] ?? ""}`.toUpperCase() || "?";
}

function accountHue(email: string): number {
  let hash = 0;
  for (let index = 0; index < email.length; index += 1) {
    hash = (hash * 31 + email.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) % 360;
}

function providerLabel(account: Pick<LimitAccount, "driver">): string {
  return providerClients.get(account.driver)?.label ?? String(account.driver);
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

function accountSource(account: LimitAccount): string | null {
  return account.environments.length > 0
    ? account.environments.map((environment) => environment.label).join(", ")
    : account.sourceLabel;
}

/** Same hashed hue as the pooled view's chip, so an account keeps its color everywhere. */
function AccountAvatar({ account }: { readonly account: LimitAccount }) {
  const gt = useGT();
  if (!account.email) {
    return (
      <ProviderInstanceIcon
        driverKind={account.driver}
        displayName={account.displayName ?? providerLabel(account)}
        accentColor={account.accentColor}
        indicatorBackground="var(--background)"
        className="size-5 shrink-0"
        iconClassName="size-4 text-foreground/80"
      />
    );
  }
  const hue = accountHue(account.email);
  return (
    <span
      role="img"
      aria-label={gt("Account {initials}", { initials: accountInitials(account.email) })}
      className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-3xs leading-none font-semibold"
      style={{ backgroundColor: `oklch(0.85 0.08 ${hue})`, color: `oklch(0.35 0.1 ${hue})` }}
    >
      {accountInitials(account.email)}
    </span>
  );
}

function AccountName({
  account,
  className,
}: {
  readonly account: LimitAccount;
  readonly className?: string;
}) {
  const gt = useGT();
  if (account.email) {
    return (
      <RedactedSensitiveText
        value={account.email}
        ariaLabel={gt("Toggle account email visibility")}
        revealTooltip={gt("Click to reveal email")}
        hideTooltip={gt("Click to hide email")}
        className={cn("truncate text-sm font-medium text-foreground", className)}
      />
    );
  }
  return (
    <span className={cn("truncate text-sm font-medium text-foreground", className)}>
      {account.displayName ?? account.sourceLabel ?? providerLabel(account)}
    </span>
  );
}

/** Rows are one toggle button, so the email stays redacted there instead of nesting a button. */
function RowAccountName({ account }: { readonly account: LimitAccount }) {
  return account.email ? (
    <span className="truncate font-mono text-xs text-muted-foreground blur-xs select-none">
      {redactedPlaceholder(account.email)}
    </span>
  ) : (
    <span className="truncate text-xs font-medium text-foreground">
      {account.displayName ?? account.sourceLabel ?? providerLabel(account)}
    </span>
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
  return (
    <Badge size="sm" variant={warning.isExpired ? "error" : renews ? "info" : "warning"}>
      {label}
    </Badge>
  );
}

function severityFillClass(severity: QuotaSeverity): string | undefined {
  if (severity === "danger") return "bg-destructive";
  if (severity === "warning") return "bg-warning";
  return undefined;
}

function severityTextClass(severity: QuotaSeverity): string {
  if (severity === "danger") return "text-destructive-foreground";
  if (severity === "warning") return "text-warning-foreground";
  return "text-foreground";
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
  const severity = getQuotaSeverity(remaining);
  const fill = severityFillClass(severity);
  return (
    <div
      aria-hidden
      className={cn(
        "relative w-full overflow-hidden rounded-full bg-muted",
        size === "wide" ? "h-2.5" : "h-1.5",
      )}
    >
      {remaining > 0 ? (
        <div
          className={cn("absolute inset-y-0 left-0 rounded-full", fill)}
          style={{ width: `${remaining}%`, ...(fill ? {} : { backgroundColor: color }) }}
        />
      ) : null}
    </div>
  );
}

function PaceLine({
  window,
  now,
}: {
  readonly window: ServerProviderUsageWindow;
  readonly now: number;
}) {
  const gt = useGT();
  const m = useMessages();
  const pace = paceOf(window, now);
  const timeLeft = paceRemainingPercent(window, now);
  const resetsIn = formatResetsIn(window, now, m);
  const paceLabel =
    pace === "ahead"
      ? gt("Ahead of pace")
      : pace === "under"
        ? gt("Under pace")
        : pace === "on"
          ? gt("On pace")
          : null;
  const parts = [
    paceLabel,
    timeLeft === null ? null : gt("even pace {timeLeft}% left by now", { timeLeft }),
    resetsIn,
  ].filter((part): part is string => Boolean(part));
  if (parts.length === 0) return null;
  return (
    <p className="flex items-center gap-1.5 text-2xs text-muted-foreground tabular-nums">
      {pace ? <PaceIcon pace={pace} /> : null}
      <span>{parts.join(" · ")}</span>
    </p>
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
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-warning/8 px-3 py-2 text-xs text-warning-foreground dark:bg-warning/16"
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <AlertTriangleIcon className="size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 break-words">
          {accountErrorMessage(account) ?? gt("Quota data is unavailable.")}
        </span>
      </span>
      {onRetry ? (
        <Button size="xs" variant="outline" disabled={refreshing} onClick={onRetry}>
          {refreshing ? gt("Retrying…") : gt("Retry")}
        </Button>
      ) : null}
    </div>
  );
}

/** Everything one account reports: identity, every window with pace, credits and subscription. */
function AccountAuditCard({
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
  const m = useMessages();
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const color = barColor(account.driver);
  const plan = accountPlan(account);
  const errored = isAccountInErrorState(account);
  const subscription = account.subscription;
  const source = accountSource(account);
  const expiresAt = formatCmaDate(subscription?.expiresAt, timestampFormat);
  const renewsAt = formatCmaDate(subscription?.renewsAt, timestampFormat);
  const billingPeriod = formatCmaBillingPeriod(subscription?.billingPeriod);
  const subscriptionParts = [
    subscription?.active === false ? gt("Inactive") : null,
    expiresAt ? gt("Expires {date}", { date: expiresAt }) : null,
    renewsAt
      ? subscription?.willRenew === false
        ? gt("Ends {date}", { date: renewsAt })
        : gt("Renews {date}", { date: renewsAt })
      : null,
    billingPeriod ?? null,
  ].filter((part): part is string => Boolean(part));
  return (
    <article
      className={cn(
        "flex flex-col gap-3 rounded-lg p-4",
        embedded ? "bg-muted/40" : "border border-border/60",
      )}
    >
      <header className="flex flex-wrap items-center gap-2">
        <AccountAvatar account={account} />
        <AccountName account={account} className="min-w-0" />
        {plan ? (
          <Badge size="sm" variant="secondary">
            {plan}
          </Badge>
        ) : null}
        {account.current === true ? (
          <Badge size="sm" variant="success">
            {gt("Current")}
          </Badge>
        ) : null}
        {account.enabled === false ? (
          <Badge size="sm" variant="secondary">
            {gt("Disabled")}
          </Badge>
        ) : null}
        <ExpiryPill account={account} now={now} />
      </header>

      {errored ? (
        <ErrorNotice account={account} onRetry={onRetry} refreshing={refreshing} />
      ) : account.sourceError ? (
        <p role="status" className="text-xs text-warning-foreground">
          {gt("Showing the last known quota data: {error}", { error: account.sourceError })}
        </p>
      ) : null}

      {account.limits.windows.length > 0 ? (
        <div className="grid gap-3">
          {account.limits.windows.map((window) => {
            const remaining = remainingPercent(window);
            return (
              <div key={`${window.kind}:${window.id}`} className="grid gap-1.5">
                <div className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="text-muted-foreground">{window.label}</span>
                  <span
                    className={cn(
                      "font-medium tabular-nums",
                      severityTextClass(getQuotaSeverity(remaining)),
                    )}
                  >
                    {gt("{remaining}% left", { remaining })}
                  </span>
                </div>
                <RemainingBar remaining={remaining} color={color} size="wide" />
                <PaceLine window={window} now={now} />
              </div>
            );
          })}
        </div>
      ) : errored ? null : (
        <p className="text-xs text-muted-foreground">{gt("No quota windows")}</p>
      )}

      {account.redeem && account.limits.resetCredits ? (
        <ResetCredits
          environmentId={account.redeem.environmentId}
          input={account.redeem.input}
          credits={account.limits.resetCredits}
          now={now}
        />
      ) : null}

      <footer className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border/60 pt-3 text-2xs text-muted-foreground">
        {subscriptionParts.length > 0 ? <span>{subscriptionParts.join(" · ")}</span> : null}
        {source ? <span>{gt("Via {source}", { source })}</span> : null}
        {account.limits.checkedAt ? (
          <span>
            {gt("Updated {time}", {
              time: formatUpcomingTimestamp(
                account.limits.checkedAt,
                timestampFormat,
                now,
                undefined,
                m,
              ),
            })}
          </span>
        ) : null}
      </footer>
    </article>
  );
}

function MiniWindow({
  window,
  color,
}: {
  readonly window: ServerProviderUsageWindow | undefined;
  readonly color: string;
}) {
  if (!window) {
    return <span className="text-2xs text-muted-foreground">-</span>;
  }
  const remaining = remainingPercent(window);
  return (
    <span className="flex min-w-0 flex-col gap-1">
      <span
        className={cn(
          "text-2xs font-medium tabular-nums",
          severityTextClass(getQuotaSeverity(remaining)),
        )}
      >
        {remaining}%
      </span>
      <RemainingBar remaining={remaining} color={color} size="mini" />
    </span>
  );
}

const MATRIX_COLUMNS =
  "grid-cols-[minmax(0,1fr)_4rem_4rem_1rem] sm:grid-cols-[minmax(0,1fr)_6.5rem_6.5rem_7rem_1rem]";

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
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const color = barColor(account.driver);
  const plan = accountPlan(account);
  const errored = isAccountInErrorState(account);
  const session = getSessionWindow(account);
  const weekly = getWeeklyWindow(account);
  const nextResetMs = getSoonestResetMs(account, now);
  const nextReset =
    nextResetMs === undefined
      ? null
      : formatUpcomingTimestamp(
          new Date(nextResetMs).toISOString(),
          timestampFormat,
          now,
          undefined,
          m,
        );
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md pe-1",
        idlest && !expanded && "bg-success/6",
        expanded && "bg-muted/60",
      )}
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className={cn(
          "grid min-w-0 flex-1 cursor-pointer items-center gap-x-3 rounded-md px-2 py-2 text-start outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          MATRIX_COLUMNS,
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <AccountAvatar account={account} />
          <RowAccountName account={account} />
          {plan ? (
            <Badge size="sm" variant="secondary" className="hidden md:inline-flex">
              {plan}
            </Badge>
          ) : null}
          <ExpiryPill account={account} now={now} />
        </span>
        {errored ? (
          <span className="col-span-2 flex min-w-0 items-center gap-1.5 text-2xs text-warning-foreground sm:col-span-3">
            <AlertTriangleIcon className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">
              {accountErrorMessage(account) ?? gt("Quota data is unavailable.")}
            </span>
          </span>
        ) : (
          <>
            <MiniWindow window={session} color={color} />
            <MiniWindow window={weekly} color={color} />
            <span className="hidden truncate text-2xs text-muted-foreground tabular-nums sm:block">
              {nextReset ?? "-"}
            </span>
          </>
        )}
        <ChevronDownIcon
          aria-hidden
          className={cn(
            "size-4 text-muted-foreground transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>
      {errored && onRetry ? (
        <Button size="xs" variant="outline" disabled={refreshing} onClick={onRetry}>
          {refreshing ? gt("Retrying…") : gt("Retry")}
        </Button>
      ) : null}
    </div>
  );
}

function SortSelect({
  value,
  onChange,
}: {
  readonly value: AccountSortMode;
  readonly onChange: (mode: AccountSortMode) => void;
}) {
  const gt = useGT();
  const labels: Record<AccountSortMode, string> = {
    idlest: gt("Most available"),
    soonestReset: gt("Soonest reset"),
    soonestExpiry: gt("Soonest expiry"),
    fixed: gt("Fixed order"),
  };
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (isSortMode(next)) onChange(next);
      }}
    >
      <SelectTrigger aria-label={gt("Sort accounts")} size="xs" className="w-36 min-w-0">
        <SelectValue>{labels[value]}</SelectValue>
      </SelectTrigger>
      <SelectPopup>
        {SORT_MODES.map((mode) => (
          <SelectItem key={mode} value={mode}>
            {labels[mode]}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

function IdlestSummary({ account }: { readonly account: LimitAccount }) {
  const gt = useGT();
  const session = getSessionWindow(account);
  const weekly = getWeeklyWindow(account);
  const window = session ?? weekly;
  return (
    <Badge size="sm" variant="success" className="max-w-full">
      <span>{gt("Most available:")}</span>
      <AccountName account={account} className="min-w-0 text-xs text-success-foreground" />
      {window ? (
        <span className="tabular-nums">
          {session
            ? gt("(5h {remaining}%)", { remaining: remainingPercent(window) })
            : gt("(7d {remaining}%)", { remaining: remainingPercent(window) })}
        </span>
      ) : null}
    </Badge>
  );
}

function GroupHeading({ group }: { readonly group: ProviderAccountGroup }) {
  const label = providerLabel(group);
  return (
    <span className="flex items-center gap-2 text-sm font-medium text-foreground">
      <ProviderInstanceIcon
        driverKind={group.driver}
        displayName={label}
        indicatorBackground="var(--background)"
        className="size-5"
        iconClassName="size-4 text-foreground/80"
      />
      {label}
    </span>
  );
}

function MatrixGroup({
  group,
  now,
  sortMode,
  onSortModeChange,
  initialExpandedAccountKey,
  onRetry,
  refreshing,
}: {
  readonly group: ProviderAccountGroup;
  readonly now: number;
  readonly sortMode: AccountSortMode;
  readonly onSortModeChange: (mode: AccountSortMode) => void;
  readonly initialExpandedAccountKey: string | undefined;
  readonly onRetry: (() => void) | undefined;
  readonly refreshing: boolean;
}) {
  const gt = useGT();
  const matchedDeepLinkKey = group.accounts.some(
    (account) => account.key === initialExpandedAccountKey,
  )
    ? (initialExpandedAccountKey ?? null)
    : null;
  const [expandedKey, setExpandedKey] = useState<string | null>(() => matchedDeepLinkKey);
  const [prevDeepLinkKey, setPrevDeepLinkKey] = useState<string | null>(() => matchedDeepLinkKey);
  if (matchedDeepLinkKey !== prevDeepLinkKey) {
    setPrevDeepLinkKey(matchedDeepLinkKey);
    if (matchedDeepLinkKey !== null) {
      setExpandedKey(matchedDeepLinkKey);
    }
  }
  const deepLinkedRef = useRef<HTMLDivElement | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- scrolls the account a composer link opened into view when deep-linked
  useEffect(() => {
    if (matchedDeepLinkKey !== null) {
      deepLinkedRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [matchedDeepLinkKey]);
  const accounts = sortProviderAccounts(group.accounts, sortMode, now);
  const columnHeaders = (
    <div
      aria-hidden
      className={cn(
        "grid gap-x-3 px-2 text-3xs font-medium tracking-wide text-muted-foreground uppercase",
        MATRIX_COLUMNS,
        "me-1",
      )}
    >
      <span>{gt("Account")}</span>
      <span>{gt("5h", { $context: "five-hour usage window, column header" })}</span>
      <span>{gt("7d", { $context: "seven-day usage window, column header" })}</span>
      <span className="hidden sm:block">{gt("Next reset")}</span>
      <span />
    </div>
  );
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <GroupHeading group={group} />
          <Badge size="sm" variant="secondary">
            {gt("{count, plural, one {{count} account} other {{count} accounts}}", {
              count: group.accounts.length,
            })}
          </Badge>
          {group.idlestAccount ? <IdlestSummary account={group.idlestAccount} /> : null}
        </div>
        <SortSelect value={sortMode} onChange={onSortModeChange} />
      </div>
      <div className="flex flex-col gap-0.5 rounded-lg border border-border/60 p-1.5">
        {columnHeaders}
        {accounts.map((account) => {
          const expanded = expandedKey === account.key;
          return (
            <div
              key={account.key}
              ref={account.key === initialExpandedAccountKey ? deepLinkedRef : undefined}
              className="flex flex-col gap-1"
            >
              <MatrixRow
                account={account}
                now={now}
                expanded={expanded}
                idlest={group.idlestAccount?.key === account.key}
                onToggle={() => setExpandedKey(expanded ? null : account.key)}
                onRetry={onRetry}
                refreshing={refreshing}
              />
              {expanded ? (
                <AccountAuditCard
                  account={account}
                  now={now}
                  onRetry={onRetry}
                  refreshing={refreshing}
                  embedded
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SingleAccountGroup({
  group,
  now,
  onRetry,
  refreshing,
}: {
  readonly group: ProviderAccountGroup;
  readonly now: number;
  readonly onRetry: (() => void) | undefined;
  readonly refreshing: boolean;
}) {
  const [account] = group.accounts;
  if (!account) return null;
  return (
    <section className="flex flex-col gap-3">
      <GroupHeading group={group} />
      <AccountAuditCard account={account} now={now} onRetry={onRetry} refreshing={refreshing} />
    </section>
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

export function UsageAccountMatrixSection({
  accounts,
  now,
  initialExpandedAccountKey,
  onRetry,
  refreshing = false,
}: {
  readonly accounts: readonly LimitAccount[];
  readonly now: number;
  readonly initialExpandedAccountKey?: string | undefined;
  readonly onRetry?: (() => void) | undefined;
  readonly refreshing?: boolean;
}) {
  const gt = useGT();
  const [sortPreferences, setSortPreferences] = useLocalStorage(
    SORT_STORAGE_KEY,
    NO_SORT_PREFERENCES,
    SortPreferencesSchema,
  );
  const showCmaHint = useCmaRefreshHint(accounts, refreshing);
  const groups = groupAccountsByProvider(accounts, now);
  if (groups.length === 0) return null;
  return (
    <div className="flex flex-col gap-8">
      {showCmaHint ? (
        <p role="status" className="text-xs text-muted-foreground">
          {gt("CMA can read account data at most once every 5 minutes")}
        </p>
      ) : null}
      {groups.map((group) =>
        group.mode === "single" ? (
          <SingleAccountGroup
            key={group.driver}
            group={group}
            now={now}
            onRetry={onRetry}
            refreshing={refreshing}
          />
        ) : (
          <MatrixGroup
            key={group.driver}
            group={group}
            now={now}
            sortMode={sortPreferences[group.driver] ?? "idlest"}
            onSortModeChange={(mode) =>
              setSortPreferences((previous) => ({ ...previous, [group.driver]: mode }))
            }
            initialExpandedAccountKey={initialExpandedAccountKey}
            onRetry={onRetry}
            refreshing={refreshing}
          />
        ),
      )}
    </div>
  );
}
