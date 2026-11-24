import type { LimitAccount } from "@t3tools/shared/usageLimits";

export function selectCmaUsageAccounts<T extends Pick<LimitAccount, "sourceKind">>(
  accounts: readonly T[],
): readonly T[] {
  return accounts.filter((account) => account.sourceKind === "cma");
}

export function formatCmaTimestamp(value: string | undefined, locale: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}

export function formatCmaBillingPeriod(value: string | undefined): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1).toLowerCase() : "";
}

export function cmaReadAt(accounts: readonly Pick<LimitAccount, "limits">[]): string | undefined {
  return accounts
    .map((account) => account.limits.checkedAt)
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
}

export function cmaSourceReadAt(
  accounts: readonly Pick<LimitAccount, "sourceCheckedAt">[],
): string | undefined {
  return accounts
    .map((account) => account.sourceCheckedAt)
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
}

export function shouldShowCmaRefreshHint(
  before: string | undefined,
  after: string | undefined,
  refreshCompleted: boolean,
): boolean {
  return refreshCompleted && before !== undefined && after !== undefined && before === after;
}

export function cmaSubscriptionExpiry(
  account: Pick<LimitAccount, "subscription">,
): string | undefined {
  return account.subscription?.expiresAt;
}
