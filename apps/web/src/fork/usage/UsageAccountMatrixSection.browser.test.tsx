import { EnvironmentId, ProviderDriverKind, UsageLimitSourceId } from "@t3tools/contracts";
import { collectLimitAccounts } from "@t3tools/shared/usageLimits";
import { describe, expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import { UsageAccountMatrixSection } from "./UsageAccountMatrixSection";

const checkedAt = "2026-10-25T16:00:00.000Z";
const codex = ProviderDriverKind.make("codex");

function cmaAccounts() {
  return collectLimitAccounts(
    new Map([
      [
        EnvironmentId.make("desk"),
        {
          entry: { target: { label: "Desk" } },
          serverConfig: {
            providers: [],
            usageLimitSources: [
              {
                id: UsageLimitSourceId.make("cma"),
                kind: "cma" as const,
                label: "CMA",
                checkedAt,
                accounts: [
                  {
                    id: "work-account",
                    driver: codex,
                    email: "work@example.com",
                    enabled: true,
                    current: true,
                    subscription: { expiresAt: "2026-10-25T16:30:00.000Z" },
                    usageLimits: {
                      checkedAt,
                      windows: [
                        {
                          id: "primary",
                          kind: "session" as const,
                          label: "5-hour",
                          usedPercent: 25,
                          resetsAt: "2026-10-25T20:00:00.000Z",
                        },
                      ],
                    },
                  },
                  {
                    id: "broken-account",
                    driver: codex,
                    email: "broken@example.com",
                    enabled: true,
                    usageLimits: {
                      checkedAt,
                      windows: [],
                      unavailable: { reason: "probeFailed" as const, message: "Token expired" },
                    },
                  },
                ],
              },
            ],
          },
        },
      ],
    ]),
  );
}

describe("UsageAccountMatrixSection", () => {
  it("expands the deep-linked account and retries failed accounts", async () => {
    const accounts = cmaAccounts();
    const work = accounts.find((account) => account.email === "work@example.com");
    const onRetry = vi.fn();
    await using screen = await render(
      <UsageAccountMatrixSection
        accounts={accounts}
        now={Date.parse(checkedAt)}
        initialExpandedAccountKey={work?.key}
        onRetry={onRetry}
      />,
    );

    await expect.element(screen.getByText("2 accounts")).toBeVisible();
    // An expiry on the same day as `now` must still show its date, not just a time.
    await expect.element(screen.getByText(/Expires .*2026/)).toBeVisible();
    await expect.element(screen.getByText("Token expired")).toBeVisible();
    await screen.getByRole("button", { name: "Retry" }).click();
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
