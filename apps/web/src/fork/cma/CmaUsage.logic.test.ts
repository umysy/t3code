import { describe, expect, it } from "vite-plus/test";

import { formatCmaDate, shouldShowCmaRefreshHint } from "./CmaUsage.logic";

describe("CMA usage formatting", () => {
  it("keeps the calendar date when an expiry is on the current day", () => {
    expect(formatCmaDate("2026-10-25T16:30:00.000Z", "locale")).toMatch(/2026/);
  });

  it("shows the cache hint only when a completed refresh keeps the read time", () => {
    expect(
      shouldShowCmaRefreshHint("2026-10-25T16:00:00.000Z", "2026-10-25T16:00:00.000Z", true),
    ).toBe(true);
    expect(
      shouldShowCmaRefreshHint("2026-10-25T16:00:00.000Z", "2026-10-25T16:05:00.000Z", true),
    ).toBe(false);
    expect(
      shouldShowCmaRefreshHint("2026-10-25T16:00:00.000Z", "2026-10-25T16:00:00.000Z", false),
    ).toBe(false);
  });
});
