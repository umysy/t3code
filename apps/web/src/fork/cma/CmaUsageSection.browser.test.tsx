import { EnvironmentId, ProviderDriverKind, UsageLimitSourceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { render } from "../../../test/render";
import { UsageLimitsPooled } from "../../components/usage/UsageLimitsPooled";

const checkedAt = "2026-10-25T16:00:00.000Z";

describe("CMA usage section", () => {
  it("renders every CMA account with quota and subscription details", async () => {
    const presentations = new Map([
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
                error: "CMA refresh failed",
                accounts: [
                  {
                    id: "work-account",
                    driver: ProviderDriverKind.make("codex"),
                    email: "work@example.com",
                    plan: "ChatGPT Pro",
                    enabled: true,
                    current: true,
                    subscription: {
                      planDisplayName: "ChatGPT Pro",
                      expiresAt: "2026-10-25T16:30:00.000Z",
                      renewsAt: "2027-01-01T00:00:00.000Z",
                      willRenew: true,
                    },
                    usageLimits: {
                      checkedAt,
                      windows: [
                        {
                          id: "primary",
                          kind: "session" as const,
                          label: "7-hour",
                          usedPercent: 25,
                          resetsAt: "2026-10-25T20:00:00.000Z",
                        },
                        {
                          id: "secondary",
                          kind: "weekly" as const,
                          label: "7-day",
                          usedPercent: 50,
                          resetsAt: "2026-10-30T16:00:00.000Z",
                        },
                      ],
                    },
                  },
                  {
                    id: "personal-account",
                    driver: ProviderDriverKind.make("codex"),
                    email: "personal@example.com",
                    enabled: false,
                    subscription: { planType: "Free" },
                    usageLimits: { checkedAt, windows: [] },
                  },
                  {
                    id: "third-account",
                    driver: ProviderDriverKind.make("codex"),
                    email: "third@example.com",
                    enabled: true,
                    usageLimits: { checkedAt, windows: [] },
                  },
                ],
              },
            ],
          },
        },
      ],
    ]);

    await using screen = await render(
      <UsageLimitsPooled presentations={presentations} now={Date.parse(checkedAt)} />,
    );

    await expect.element(screen.getByText("work-account")).toBeVisible();
    await expect.element(screen.getByText("personal-account")).toBeVisible();
    await expect.element(screen.getByText("third-account")).toBeVisible();
    await expect.element(screen.getByText("7-hour").first()).toBeVisible();
    await expect.element(screen.getByText("7-day").first()).toBeVisible();
    await expect.element(screen.getByText("ChatGPT Pro").first()).toBeVisible();
    await expect.element(screen.getByText("Stale").first()).toBeVisible();
    await expect.element(screen.getByText("Disabled")).toBeVisible();
    await expect.element(screen.getByText("Unknown").first()).toBeVisible();
    expect(screen.container.textContent).not.toContain(
      "No provider on the selected environments reports subscription limits.",
    );
    // An expiry on the same day as `now` must still show its date, not just a time.
    expect(screen.container.textContent).toMatch(/Subscription expiry[^A-Za-z]*2026/);
  });

  it("renders CMA quota chart view for multiple windows", async () => {
    const presentations = new Map([
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
                    driver: ProviderDriverKind.make("codex"),
                    email: "work@example.com",
                    enabled: true,
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
                        {
                          id: "secondary",
                          kind: "weekly" as const,
                          label: "7-day",
                          usedPercent: 50,
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        },
      ],
    ]);

    await using screen = await render(
      <UsageLimitsPooled presentations={presentations} now={Date.parse(checkedAt)} />,
    );

    await screen.getByRole("button", { name: "Chart" }).click();
    await expect.element(screen.getByLabelText("CMA quota chart")).toBeVisible();
    await expect.element(screen.getByText("75% left")).toBeVisible();
    await expect.element(screen.getByText("50% left")).toBeVisible();
    await expect.element(screen.getByText(/Resets 4:00 AM/)).toBeVisible();
  });
});
