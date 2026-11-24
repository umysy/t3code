import { describe, expect, it } from "vite-plus/test";

import {
  cmaSubscriptionExpiry,
  cmaSourceReadAt,
  formatCmaTimestamp,
  formatCmaBillingPeriod,
  selectCmaUsageAccounts,
  shouldShowCmaRefreshHint,
} from "./CmaUsageAccounts.logic";

describe("CMA usage account presentation data", () => {
  it("capitalizes billing periods", () => {
    expect(formatCmaBillingPeriod("monthly")).toBe("Monthly");
  });
  it("keeps every CMA account in the source order", () => {
    const accounts = [
      { sourceKind: "cliproxy" as const, id: "cliproxy" },
      { sourceKind: "cma" as const, id: "account-a" },
      { sourceKind: "cma" as const, id: "account-b" },
      { sourceKind: "cma" as const, id: "account-c" },
    ];

    expect(selectCmaUsageAccounts(accounts).map((account) => account.id)).toEqual([
      "account-a",
      "account-b",
      "account-c",
    ]);
  });

  it("does not invent an expiry when subscription metadata omits it", () => {
    expect(cmaSubscriptionExpiry({ subscription: undefined })).toBeUndefined();
    expect(
      cmaSubscriptionExpiry({ subscription: { renewsAt: "2026-12-01T00:00:00.000Z" } }),
    ).toBeUndefined();
  });

  it("formats valid observations and leaves malformed timestamps unknown", () => {
    expect(formatCmaTimestamp("2026-01-02T03:04:05.000Z", "en-US")).toContain("Jan");
    expect(formatCmaTimestamp("not-a-date", "en-US")).toBe("");
  });

  it("shows the cache hint only when a completed refresh keeps the read time", () => {
    expect(
      shouldShowCmaRefreshHint("2026-10-25T16:00:00.000Z", "2026-10-25T16:00:00.000Z", true),
    ).toBe(true);
    expect(
      shouldShowCmaRefreshHint("2026-10-25T16:00:00.000Z", "2026-10-25T16:05:00.000Z", true),
    ).toBe(false);
  });

  it("uses the CMA source read time for cache hints", () => {
    expect(cmaSourceReadAt([{ sourceCheckedAt: "2026-10-25T16:00:00.000Z" }])).toBe(
      "2026-10-25T16:00:00.000Z",
    );
  });
});
