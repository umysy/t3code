import { describe, expect, it } from "vite-plus/test";

import {
  cmaSubscriptionExpiry,
  formatCmaTimestamp,
  selectCmaUsageAccounts,
} from "./CmaUsageAccounts.logic";

describe("CMA usage account presentation data", () => {
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
});
