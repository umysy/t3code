import type { TimestampFormat } from "@t3tools/contracts/settings";

import { formatFullTimestamp, parseTimestampDate } from "../../timestampFormat";
import type { LimitAccount } from "@t3tools/shared/usageLimits";

export function formatCmaDate(
  isoDate: string | undefined,
  timestampFormat: TimestampFormat,
): string | undefined {
  return isoDate && parseTimestampDate(isoDate)
    ? formatFullTimestamp(isoDate, timestampFormat)
    : undefined;
}

export function formatCmaBillingPeriod(value: string | undefined): string | undefined {
  return value ? value.charAt(0).toUpperCase() + value.slice(1).toLowerCase() : undefined;
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
