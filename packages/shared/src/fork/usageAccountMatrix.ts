import type {
  EnvironmentId,
  ProviderDriverKind,
  ServerProviderUsageWindow,
  UsageLimitSourceSubscription,
} from "@t3tools/contracts";

import { remainingPercent, type LimitAccount } from "../usageLimits.ts";

export type AccountSortMode = "idlest" | "soonestReset" | "soonestExpiry" | "fixed";

export type QuotaSeverity = "normal" | "warning" | "danger";

export interface ExpiryWarning {
  readonly expiresAt: string;
  readonly daysRemaining: number;
  readonly isSoon: boolean;
  readonly isExpired: boolean;
}

export interface ProviderAccountGroup {
  readonly driver: ProviderDriverKind;
  readonly mode: "single" | "matrix";
  readonly accounts: readonly LimitAccount[];
  readonly idlestAccount: LimitAccount | undefined;
}

export interface ComposerFiveHourQuota {
  readonly driver: ProviderDriverKind;
  readonly accountKey: string;
  readonly accountLabel: string;
  readonly remainingPercent: number;
  readonly resetsAt: string | undefined;
  readonly severity: QuotaSeverity;
  readonly idlestAccount:
    | {
        readonly accountKey: string;
        readonly label: string;
        readonly remainingPercent: number;
      }
    | undefined;
}

/**
 * Drivers whose accounts the Limits page shows as the account matrix. Cursor reports monthly
 * spend windows with their own labels and explanations, so it keeps the pooled window view.
 */
export function usesAccountMatrix(driver: ProviderDriverKind): boolean {
  return driver !== "cursor";
}

const MS_PER_DAY = 86_400_000;
const EXPIRY_WARNING_DAYS = 7;

export function getQuotaSeverity(remainingPct: number): QuotaSeverity {
  if (remainingPct < 10) return "danger";
  if (remainingPct < 30) return "warning";
  return "normal";
}

export function getComposerQuotaSeverity(remainingPct: number): QuotaSeverity {
  if (remainingPct < 5) return "danger";
  if (remainingPct < 20) return "warning";
  return "normal";
}

export function isAccountInErrorState(account: LimitAccount): boolean {
  if (account.limits.unavailable !== undefined) return true;
  return account.limits.windows.length === 0 && Boolean(account.sourceError);
}

export function accountErrorMessage(account: LimitAccount): string | undefined {
  if (account.limits.unavailable?.message) return account.limits.unavailable.message;
  if (account.sourceError) return account.sourceError;
  if (account.limits.unavailable) return account.limits.unavailable.reason;
  return undefined;
}

export function getSessionWindow(account: LimitAccount): ServerProviderUsageWindow | undefined {
  const windows = account.limits.windows;
  return (
    windows.find((w) => w.kind === "session") ?? windows.find((w) => w.windowDurationMins === 300)
  );
}

export function getWeeklyWindow(account: LimitAccount): ServerProviderUsageWindow | undefined {
  const windows = account.limits.windows;
  const session = getSessionWindow(account);
  return (
    windows.find((w) => w.kind === "weekly" && w.id !== session?.id) ??
    windows.find(
      (w) =>
        w.id !== session?.id && w.windowDurationMins !== undefined && w.windowDurationMins >= 1440,
    ) ??
    windows.find((w) => w.id !== session?.id)
  );
}

export function getSoonestResetMs(account: LimitAccount, nowMs: number): number | undefined {
  let soonest: number | undefined;
  for (const w of account.limits.windows) {
    if (!w.resetsAt) continue;
    const ms = Date.parse(w.resetsAt);
    if (!Number.isFinite(ms) || ms <= nowMs) continue;
    if (soonest === undefined || ms < soonest) soonest = ms;
  }
  return soonest;
}

export function getExpiryWarning(
  subscription: UsageLimitSourceSubscription | undefined,
  nowMs: number,
): ExpiryWarning | undefined {
  const target = subscription?.expiresAt ?? subscription?.renewsAt;
  if (!target) return undefined;
  const targetMs = Date.parse(target);
  if (!Number.isFinite(targetMs)) return undefined;
  const diffMs = targetMs - nowMs;
  const daysRemaining = Math.ceil(diffMs / MS_PER_DAY);
  return {
    expiresAt: target,
    daysRemaining,
    isSoon: daysRemaining >= 0 && daysRemaining <= EXPIRY_WARNING_DAYS,
    isExpired: diffMs < 0,
  };
}

function accountPrimaryRemaining(account: LimitAccount): number {
  const session = getSessionWindow(account);
  if (session) return remainingPercent(session);
  const weekly = getWeeklyWindow(account);
  if (weekly) return remainingPercent(weekly);
  return -1;
}

function accountSecondaryRemaining(account: LimitAccount): number {
  const weekly = getWeeklyWindow(account);
  return weekly ? remainingPercent(weekly) : -1;
}

function accountExpiryMs(account: LimitAccount): number | undefined {
  const target = account.subscription?.expiresAt ?? account.subscription?.renewsAt;
  if (!target) return undefined;
  const ms = Date.parse(target);
  return Number.isFinite(ms) ? ms : undefined;
}

function compareIdlest(left: LimitAccount, right: LimitAccount, nowMs: number): number {
  const primaryDiff = accountPrimaryRemaining(right) - accountPrimaryRemaining(left);
  if (primaryDiff !== 0) return primaryDiff;
  const secondaryDiff = accountSecondaryRemaining(right) - accountSecondaryRemaining(left);
  if (secondaryDiff !== 0) return secondaryDiff;
  const leftReset = getSoonestResetMs(left, nowMs) ?? Number.POSITIVE_INFINITY;
  const rightReset = getSoonestResetMs(right, nowMs) ?? Number.POSITIVE_INFINITY;
  return leftReset - rightReset;
}

export function sortProviderAccounts(
  accounts: readonly LimitAccount[],
  mode: AccountSortMode,
  nowMs: number,
): readonly LimitAccount[] {
  const healthy: LimitAccount[] = [];
  const errored: LimitAccount[] = [];
  for (const account of accounts) {
    if (isAccountInErrorState(account)) {
      errored.push(account);
    } else {
      healthy.push(account);
    }
  }

  if (mode === "fixed") {
    return [...healthy, ...errored];
  }

  const sortedHealthy = [...healthy].sort((left, right) => {
    if (mode === "idlest") {
      return compareIdlest(left, right, nowMs);
    }
    if (mode === "soonestReset") {
      const leftMs = getSoonestResetMs(left, nowMs) ?? Number.POSITIVE_INFINITY;
      const rightMs = getSoonestResetMs(right, nowMs) ?? Number.POSITIVE_INFINITY;
      if (leftMs !== rightMs) return leftMs - rightMs;
      return compareIdlest(left, right, nowMs);
    }
    // soonestExpiry
    const leftMs = accountExpiryMs(left) ?? Number.POSITIVE_INFINITY;
    const rightMs = accountExpiryMs(right) ?? Number.POSITIVE_INFINITY;
    if (leftMs !== rightMs) return leftMs - rightMs;
    return compareIdlest(left, right, nowMs);
  });

  return [...sortedHealthy, ...errored];
}

export function groupAccountsByProvider(
  accounts: readonly LimitAccount[],
  nowMs: number,
): readonly ProviderAccountGroup[] {
  const byDriver = new Map<ProviderDriverKind, LimitAccount[]>();
  for (const account of accounts) {
    // Skip accounts that are purely unsupported and have no windows or errors to show.
    if (
      account.limits.unavailable?.reason === "unsupported" &&
      account.limits.windows.length === 0
    ) {
      continue;
    }
    const bucket = byDriver.get(account.driver);
    if (bucket) {
      bucket.push(account);
    } else {
      byDriver.set(account.driver, [account]);
    }
  }

  const groups: ProviderAccountGroup[] = [];
  for (const [driver, driverAccounts] of byDriver) {
    if (driverAccounts.length === 0) continue;
    const healthy = driverAccounts.filter((a) => !isAccountInErrorState(a));
    const idlestAccount =
      healthy.length > 0
        ? [...healthy].sort((left, right) => compareIdlest(left, right, nowMs))[0]
        : undefined;
    groups.push({
      driver,
      mode: driverAccounts.length === 1 ? "single" : "matrix",
      accounts: driverAccounts,
      idlestAccount,
    });
  }
  return groups;
}

function accountDisplayLabel(account: LimitAccount): string {
  return account.email ?? account.displayName ?? account.sourceLabel ?? String(account.driver);
}

export function selectComposerFiveHourQuota(
  accounts: readonly LimitAccount[],
  activeDriver: ProviderDriverKind | undefined,
  activeEnvironmentId: EnvironmentId | undefined,
  nowMs: number,
): ComposerFiveHourQuota | null {
  if (!activeDriver) return null;

  const matchingDriver = accounts.filter(
    (account) => account.driver === activeDriver && !isAccountInErrorState(account),
  );
  if (matchingDriver.length === 0) return null;

  const envScoped = activeEnvironmentId
    ? matchingDriver.filter(
        (account) =>
          account.environments.length === 0 ||
          account.environments.some((env) => env.environmentId === activeEnvironmentId),
      )
    : matchingDriver;
  const candidates = envScoped.length > 0 ? envScoped : matchingDriver;

  const withSession = candidates
    .map((account) => ({ account, session: getSessionWindow(account) }))
    .filter(
      (
        entry,
      ): entry is {
        readonly account: LimitAccount;
        readonly session: ServerProviderUsageWindow;
      } => entry.session !== undefined,
    );
  if (withSession.length === 0) return null;

  const activeEntry =
    withSession.find((entry) => entry.account.current === true) ?? withSession[0]!;
  const activeRemaining = remainingPercent(activeEntry.session);

  let idlestSummary: ComposerFiveHourQuota["idlestAccount"];
  if (withSession.length > 1) {
    const idlestEntry = [...withSession].sort((left, right) =>
      compareIdlest(left.account, right.account, nowMs),
    )[0]!;
    idlestSummary = {
      accountKey: idlestEntry.account.key,
      label: accountDisplayLabel(idlestEntry.account),
      remainingPercent: remainingPercent(idlestEntry.session),
    };
  }

  return {
    driver: activeDriver,
    accountKey: activeEntry.account.key,
    accountLabel: accountDisplayLabel(activeEntry.account),
    remainingPercent: activeRemaining,
    resetsAt: activeEntry.session.resetsAt,
    severity: getComposerQuotaSeverity(activeRemaining),
    idlestAccount: idlestSummary,
  };
}
