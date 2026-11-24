import type { LimitAccount } from "@t3tools/shared/usageLimits";
import { remainingPercent } from "@t3tools/shared/usageLimits";
import { selectCmaUsageAccounts } from "@t3tools/shared/forkCmaUsage";
import { useGT, useMessages } from "gt-react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { usePrimarySettings } from "../../hooks/useSettings";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import { RedactedSensitiveText } from "../../components/settings/RedactedSensitiveText";
import { Toggle, ToggleGroup } from "../../components/ui/toggle-group";
import { cmaReadAt, formatCmaDate, shouldShowCmaRefreshHint } from "./CmaUsage.logic";

function CmaValue({ value }: { readonly value: string | boolean | undefined }) {
  const gt = useGT();
  if (value === undefined) return <span className="text-muted-foreground">{gt("Unknown")}</span>;
  if (typeof value === "boolean") return value ? gt("Yes") : gt("No");
  return value;
}

function CmaRow({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 text-foreground tabular-nums">{children}</span>
    </div>
  );
}

function CmaAccountCard({
  account,
  now,
}: {
  readonly account: LimitAccount;
  readonly now: number;
}) {
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const gt = useGT();
  const m = useMessages();
  const subscription = account.subscription;
  const plan =
    account.plan ??
    subscription?.planDisplayName ??
    subscription?.planType ??
    subscription?.subscriptionPlan;
  const status = account.sourceError
    ? gt("Stale")
    : account.limits.unavailable
      ? gt("Unavailable")
      : null;
  return (
    <article className="flex flex-col gap-3 rounded-xl border border-border/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium text-foreground">
            {account.displayName ?? account.key.split(":").at(-1) ?? account.key}
          </h3>
          {account.email ? (
            <RedactedSensitiveText
              value={account.email}
              ariaLabel={gt("Toggle account email visibility")}
              revealTooltip={gt("Click to reveal email")}
              hideTooltip={gt("Click to hide email")}
              className="mt-0.5"
            />
          ) : null}
          <p className="mt-0.5 text-2xs text-muted-foreground">{account.key}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-2xs">
          <span className="rounded-full border px-2 py-0.5">
            {account.enabled ? gt("Enabled") : gt("Disabled")}
          </span>
          {account.current !== undefined ? (
            <span className="rounded-full border px-2 py-0.5">
              {account.current ? gt("Current") : gt("Not current")}
            </span>
          ) : null}
          {status ? (
            <span className="rounded-full border border-warning/50 px-2 py-0.5 text-warning">
              {status}
            </span>
          ) : null}
        </div>
      </div>
      {account.sourceError ? (
        <p role="status" className="text-xs text-warning-foreground">
          {account.sourceError}
        </p>
      ) : null}

      <div className="grid gap-x-6 gap-y-1 text-xs md:grid-cols-2">
        <CmaRow label={gt("Plan", { $context: "subscription plan" })}>
          <CmaValue value={plan} />
        </CmaRow>
        <CmaRow label={gt("Observed")}>
          {formatUpcomingTimestamp(account.limits.checkedAt, timestampFormat, now, undefined, m)}
        </CmaRow>
        {account.limits.windows.map((window) => (
          <CmaRow key={window.id} label={window.label}>
            <span>{gt("{remaining}% left", { remaining: remainingPercent(window) })}</span>
            {window.resetsAt ? (
              <span className="text-muted-foreground">
                {gt(" · resets {time}", {
                  time: formatUpcomingTimestamp(
                    window.resetsAt,
                    timestampFormat,
                    now,
                    undefined,
                    m,
                  ),
                })}
              </span>
            ) : null}
          </CmaRow>
        ))}
      </div>

      <div className="grid gap-x-6 gap-y-1 border-t border-border/60 pt-3 text-xs md:grid-cols-2">
        <CmaRow label={gt("Subscription status")}>
          {subscription?.active === undefined ? (
            <CmaValue value={undefined} />
          ) : subscription.active ? (
            gt("Active")
          ) : (
            gt("Inactive")
          )}
        </CmaRow>
        <CmaRow label={gt("Subscription expiry")}>
          <CmaValue value={formatCmaDate(subscription?.expiresAt, timestampFormat)} />
        </CmaRow>
        <CmaRow label={gt("Renewal time")}>
          <CmaValue value={formatCmaDate(subscription?.renewsAt, timestampFormat)} />
        </CmaRow>
        <CmaRow label={gt("Renewal status")}>
          {subscription?.willRenew === undefined ? (
            <CmaValue value={undefined} />
          ) : subscription.willRenew ? (
            gt("Renews")
          ) : (
            gt("Does not renew")
          )}
        </CmaRow>
        <CmaRow label={gt("Billing period")}>
          <CmaValue value={subscription?.billingPeriod} />
        </CmaRow>
      </div>
    </article>
  );
}

function CmaAccountsChart({
  accounts,
  now,
}: {
  readonly accounts: readonly LimitAccount[];
  readonly now: number;
}) {
  const gt = useGT();
  const m = useMessages();
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  return (
    <div className="grid gap-3" aria-label={gt("CMA quota chart")}>
      {accounts.map((account) => {
        const subscription = account.subscription;
        const plan =
          account.plan ??
          subscription?.planDisplayName ??
          subscription?.planType ??
          subscription?.subscriptionPlan;
        const status = account.sourceError
          ? gt("Stale")
          : account.limits.unavailable
            ? gt("Unavailable")
            : null;
        return (
          <article key={account.key} className="rounded-xl border border-border/60 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-medium text-foreground">
                  {account.displayName ?? account.key.split(":").at(-1) ?? account.key}
                </h3>
                <p className="mt-0.5 text-2xs text-muted-foreground">{account.key}</p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-2xs">
                <span className="rounded-full border px-2 py-0.5">
                  {account.enabled ? gt("Enabled") : gt("Disabled")}
                </span>
                {account.current !== undefined ? (
                  <span className="rounded-full border px-2 py-0.5">
                    {account.current ? gt("Current") : gt("Not current")}
                  </span>
                ) : null}
                {status ? (
                  <span className="rounded-full border border-warning/50 px-2 py-0.5 text-warning">
                    {status}
                  </span>
                ) : null}
              </div>
            </div>
            {account.sourceError ? (
              <p role="status" className="mt-2 text-xs text-warning-foreground">
                {account.sourceError}
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-2xs text-muted-foreground">
              <span>
                {gt("Plan", { $context: "subscription plan" })}: {plan ?? gt("Unknown")}
              </span>
              <span>
                {gt("Expires", { $context: "subscription expiry" })}:{" "}
                {formatCmaDate(subscription?.expiresAt, timestampFormat) ?? gt("Unknown")}
              </span>
            </div>
            <div className="mt-4 grid gap-3">
              {account.limits.windows.length === 0 ? (
                <p className="text-xs text-muted-foreground">{gt("No quota windows")}</p>
              ) : (
                account.limits.windows.map((window) => {
                  const remaining = remainingPercent(window);
                  return (
                    <div key={window.id} className="grid gap-1.5">
                      <div className="flex items-baseline justify-between gap-3 text-xs">
                        <span className="text-muted-foreground">{window.label}</span>
                        <span className="font-medium tabular-nums text-foreground">
                          {gt("{remaining}% left", { remaining })}
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className={
                            remaining <= 10
                              ? "h-full rounded-full bg-error"
                              : remaining <= 30
                                ? "h-full rounded-full bg-warning"
                                : "h-full rounded-full bg-foreground"
                          }
                          style={{ width: `${remaining}%` }}
                        />
                      </div>
                      {window.resetsAt ? (
                        <span className="text-2xs text-muted-foreground">
                          {gt("Resets {time}", {
                            time: formatUpcomingTimestamp(
                              window.resetsAt,
                              timestampFormat,
                              now,
                              undefined,
                              m,
                            ),
                          })}
                        </span>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

export type CmaUsageView = "text" | "chart";

export function CmaAccountsSection({
  accounts,
  now,
  manualRefreshPending = false,
}: {
  readonly accounts: readonly LimitAccount[];
  readonly now: number;
  readonly manualRefreshPending?: boolean;
}) {
  const gt = useGT();
  const [view, setView] = useState<CmaUsageView>("text");
  const cmaAccounts = selectCmaUsageAccounts(accounts);
  const readAt = cmaReadAt(cmaAccounts);
  const previousReadAt = useRef<string | undefined>(undefined);
  const hintReadAt = useRef<string | undefined>(undefined);
  const [showRefreshHint, setShowRefreshHint] = useState(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- records the completed manual refresh result while this section is mounted
  useEffect(() => {
    if (manualRefreshPending) {
      if (previousReadAt.current === undefined) previousReadAt.current = readAt;
      return;
    }
    if (previousReadAt.current !== undefined) {
      const show = shouldShowCmaRefreshHint(previousReadAt.current, readAt, true);
      setShowRefreshHint(show);
      hintReadAt.current = show ? readAt : undefined;
      previousReadAt.current = undefined;
    } else if (showRefreshHint && hintReadAt.current !== readAt) {
      setShowRefreshHint(false);
      hintReadAt.current = undefined;
    }
  }, [manualRefreshPending, previousReadAt, readAt, showRefreshHint, hintReadAt]);
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  if (cmaAccounts.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-foreground">{gt("CMA accounts")}</h2>
          {readAt ? (
            <p className="text-2xs text-muted-foreground">
              {gt("Updated {date}", {
                date: formatCmaDate(readAt, timestampFormat) ?? gt("Unknown"),
              })}
            </p>
          ) : null}
        </div>
        <ToggleGroup
          aria-label={gt("Limits view")}
          variant="segmented"
          value={[view]}
          onValueChange={(next) => {
            const value = next[0];
            if (value === "text" || value === "chart") setView(value);
          }}
        >
          <Toggle value="text">{gt("Text")}</Toggle>
          <Toggle value="chart">{gt("Chart")}</Toggle>
        </ToggleGroup>
      </div>
      {showRefreshHint ? (
        <p role="status" className="text-xs text-muted-foreground">
          {gt("CMA can read account data at most once every 5 minutes")}
        </p>
      ) : null}
      {view === "chart" ? (
        <CmaAccountsChart accounts={cmaAccounts} now={now} />
      ) : (
        <div className="grid gap-3">
          {cmaAccounts.map((account) => (
            <CmaAccountCard key={account.key} account={account} now={now} />
          ))}
        </div>
      )}
    </section>
  );
}
