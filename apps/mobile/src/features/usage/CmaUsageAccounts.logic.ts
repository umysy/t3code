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

export function cmaSubscriptionExpiry(
  account: Pick<LimitAccount, "subscription">,
): string | undefined {
  return account.subscription?.expiresAt;
}
