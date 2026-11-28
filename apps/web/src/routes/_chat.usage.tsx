import { createFileRoute } from "@tanstack/react-router";

import { UsagePage } from "../components/usage/UsagePage";

export const Route = createFileRoute("/_chat/usage")({
  // Fork: the composer quota pill deep-links an account on the Limits tab.
  validateSearch: (raw: Record<string, unknown>): { readonly account?: string } =>
    typeof raw.account === "string" && raw.account.length > 0 ? { account: raw.account } : {},
  component: UsagePage,
});
