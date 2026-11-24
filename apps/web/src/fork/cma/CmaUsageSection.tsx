import type { LimitAccount } from "@t3tools/shared/usageLimits";
import { remainingPercent } from "@t3tools/shared/usageLimits";
import { selectCmaUsageAccounts } from "@t3tools/shared/forkCmaUsage";
import { useGT, useMessages } from "gt-react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { usePrimarySettings } from "../../hooks/useSettings";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import { RedactedSensitiveText } from "../../components/settings/RedactedSensitiveText";
import { ProviderInstanceIcon } from "../../components/chat/ProviderInstanceIcon";
import { Badge } from "../../components/ui/badge";
import { Toggle, ToggleGroup } from "../../components/ui/toggle-group";
import {
  cmaReadAt,
  cmaSourceReadAt,
  formatCmaBillingPeriod,
  formatCmaDate,
  shouldShowCmaRefreshHint,
} from "./CmaUsage.logic";

function CmaValue({ value }: { readonly value: string | boolean | undefined }) {
  const gt = useGT();
  if (value === undefined) return <span className="text-muted-foreground">{gt("Unknown")}</span>;
  if (typeof value === "boolean") return value ? gt("Yes") : gt("No");
  return value;
}

function CmaRow({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 text-foreground tabular-nums">{children}</span>
    </div>
  );
}

function CmaAccountHeader({ account }: { readonly account: LimitAccount }) {
  const gt = useGT();
  const subscription = account.subscription;
  const plan =
    account.plan ??
    subscription?.planDisplayName ??
    subscription?.planType ??
    subscription?.subscriptionPlan;
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <ProviderInstanceIcon
          driverKind="codex"
          displayName="Codex"
          indicatorBackground="var(--background)"
          className="size-5"
          iconClassName="size-4 text-foreground/80"
        />
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {account.email ? (
              <RedactedSensitiveText
                value={account.email}
                ariaLabel={gt("Toggle account email visibility")}
                revealTooltip={gt("Click to reveal email")}
                hideTooltip={gt("Click to hide email")}
              />
            ) : (
              <h3 className="truncate text-sm font-medium text-foreground">
                {account.key.split(":").at(-1) ?? account.key}
              </h3>
            )}
            {plan ? <span className="text-xs text-muted-foreground">{plan}</span> : null}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
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
      </div>
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
  return (
    <article className="flex flex-col gap-3 rounded-lg border border-border/60 p-4">
      <CmaAccountHeader account={account} />
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

      {subscription &&
      (subscription.active !== undefined ||
        subscription.expiresAt ||
        subscription.renewsAt ||
        subscription.willRenew !== undefined ||
        subscription.billingPeriod) ? (
        <div className="grid gap-x-6 gap-y-1 border-t border-border/60 pt-3 text-xs md:grid-cols-2">
          {subscription.active !== undefined ? (
            <CmaRow label={gt("Subscription status")}>
              {subscription?.active === undefined ? (
                <CmaValue value={undefined} />
              ) : subscription.active ? (
                gt("Active")
              ) : (
                gt("Inactive")
              )}
            </CmaRow>
          ) : null}
          {subscription.expiresAt ? (
            <CmaRow label={gt("Subscription expiry")}>
              <CmaValue value={formatCmaDate(subscription?.expiresAt, timestampFormat)} />
            </CmaRow>
          ) : null}
          {subscription.renewsAt ? (
            <CmaRow label={gt("Renewal time")}>
              <CmaValue value={formatCmaDate(subscription?.renewsAt, timestampFormat)} />
            </CmaRow>
          ) : null}
          {subscription.willRenew !== undefined ? (
            <CmaRow label={gt("Renewal status")}>
              {subscription?.willRenew === undefined ? (
                <CmaValue value={undefined} />
              ) : subscription.willRenew ? (
                gt("Renews")
              ) : (
                gt("Does not renew")
              )}
            </CmaRow>
          ) : null}
          {subscription.billingPeriod ? (
            <CmaRow label={gt("Billing period")}>
              <CmaValue value={formatCmaBillingPeriod(subscription.billingPeriod)} />
            </CmaRow>
          ) : null}
        </div>
      ) : null}
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
      {accounts.map((account) => (
        <article
          key={account.key}
          className="flex flex-col gap-3 rounded-lg border border-border/60 p-4"
        >
          <CmaAccountHeader account={account} />
          {account.sourceError ? (
            <p role="status" className="text-xs text-warning-foreground">
              {account.sourceError}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-2xs text-muted-foreground">
            <span>
              {gt("Observed")}:{" "}
              {formatUpcomingTimestamp(
                account.limits.checkedAt,
                timestampFormat,
                now,
                undefined,
                m,
              )}
            </span>
            {account.subscription?.expiresAt ? (
              <span>
                {gt("Expires", { $context: "subscription expiry" })}:{" "}
                {formatCmaDate(account.subscription.expiresAt, timestampFormat)}
              </span>
            ) : null}
          </div>
          <div className="grid gap-3">
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
                    <div className="h-5 overflow-hidden rounded-md bg-muted">
                      <div
                        className="h-full rounded-md opacity-35"
                        style={{ width: `${remaining}%`, backgroundColor: "var(--color-codex)" }}
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
      ))}
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
  const sourceReadAt = cmaSourceReadAt(cmaAccounts);
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
  }, [manualRefreshPending, previousReadAt, sourceReadAt, showRefreshHint, hintReadAt]);
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  if (cmaAccounts.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ProviderInstanceIcon
            driverKind="codex"
            displayName="Codex"
            indicatorBackground="var(--background)"
            className="size-5"
            iconClassName="size-4 text-foreground/80"
          />
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-medium text-foreground">{gt("CMA accounts")}</h2>
            {readAt ? (
              <p className="text-2xs text-muted-foreground">
                {gt("Updated {date}", {
                  date: formatCmaDate(readAt, timestampFormat) ?? gt("Unknown"),
                })}
              </p>
            ) : null}
          </div>
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
