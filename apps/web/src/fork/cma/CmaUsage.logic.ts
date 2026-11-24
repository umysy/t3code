import type { TimestampFormat } from "@t3tools/contracts/settings";

import { formatFullTimestamp, parseTimestampDate } from "../../timestampFormat";

export function formatCmaDate(
  isoDate: string | undefined,
  timestampFormat: TimestampFormat,
): string | undefined {
  return isoDate && parseTimestampDate(isoDate)
    ? formatFullTimestamp(isoDate, timestampFormat)
    : undefined;
}
