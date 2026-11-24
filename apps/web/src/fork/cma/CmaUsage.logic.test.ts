import { describe, expect, it } from "vite-plus/test";

import { formatCmaDate } from "./CmaUsage.logic";

describe("CMA usage formatting", () => {
  it("keeps the calendar date when an expiry is on the current day", () => {
    expect(formatCmaDate("2026-10-25T16:30:00.000Z", "locale")).toMatch(/2026/);
  });
});
