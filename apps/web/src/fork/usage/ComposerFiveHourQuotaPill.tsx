import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import type { EnvironmentId, ProviderDriverKind } from "@t3tools/contracts";
import {
  type QuotaSeverity,
  selectComposerFiveHourQuota,
} from "@t3tools/shared/fork/usageAccountMatrix";
import { collectLimitAccounts } from "@t3tools/shared/usageLimits";
import { useGT, useMessages } from "gt-react";
import { memo } from "react";

import { ComposerControl } from "../../components/chat/ComposerControl";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../components/ui/tooltip";
import { usePrimarySettings } from "../../hooks/useSettings";
import { environmentPresentations } from "../../state/presentation";
import { formatUpcomingTimestamp } from "../../timestampFormat";

/** The composer is often on screen while streaming, so never show a full email here. */
function maskEmail(label: string): string {
  const at = label.indexOf("@");
  return at > 0 ? `${label[0]}•••${label.slice(at)}` : label;
}

function severityClass(severity: QuotaSeverity): string | undefined {
  if (severity === "danger") return "text-destructive-foreground";
  if (severity === "warning") return "text-warning-foreground";
  return undefined;
}

/** Fork: the active account's 5-hour quota beside the model picker; opens it on Usage → Limits. */
export const ComposerFiveHourQuotaPill = memo(function ComposerFiveHourQuotaPill({
  driver,
  environmentId,
}: {
  readonly driver: ProviderDriverKind;
  readonly environmentId: EnvironmentId;
}) {
  const gt = useGT();
  const m = useMessages();
  const navigate = useNavigate();
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const now = Date.now();
  const quota = selectComposerFiveHourQuota(
    collectLimitAccounts(presentations),
    driver,
    environmentId,
    now,
  );
  if (!quota) return null;
  const resetsAt = quota.resetsAt
    ? formatUpcomingTimestamp(quota.resetsAt, timestampFormat, now, undefined, m)
    : null;
  const idlest =
    quota.idlestAccount && quota.idlestAccount.accountKey !== quota.accountKey
      ? quota.idlestAccount
      : undefined;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ComposerControl
            data-composer-fork-leading
            size="xs"
            className={severityClass(quota.severity)}
            aria-label={gt("5-hour quota: {remaining}% left. Open usage limits", {
              remaining: quota.remainingPercent,
            })}
            onClick={() => void navigate({ to: "/usage", search: { account: quota.accountKey } })}
          />
        }
      >
        <span data-composer-control-label className="tabular-nums">
          {gt("5h {remaining}%", {
            remaining: quota.remainingPercent,
            $context: "five-hour usage window remaining, composer chip",
          })}
        </span>
      </TooltipTrigger>
      <TooltipPopup side="top">
        <div className="flex flex-col gap-0.5 text-xs">
          <span className="font-medium">{maskEmail(quota.accountLabel)}</span>
          <span className="tabular-nums">
            {resetsAt
              ? gt("{remaining}% left · resets {time}", {
                  remaining: quota.remainingPercent,
                  time: resetsAt,
                })
              : gt("{remaining}% left", { remaining: quota.remainingPercent })}
          </span>
          {idlest ? (
            <span className="text-muted-foreground tabular-nums">
              {gt("Most available: {account} (5h {remaining}%)", {
                account: maskEmail(idlest.label),
                remaining: idlest.remainingPercent,
              })}
            </span>
          ) : null}
        </div>
      </TooltipPopup>
    </Tooltip>
  );
});
