import type { UsageLimitSourceSnapshot } from "@t3tools/contracts";

export interface CmaLimitAccountMetadata {
  readonly enabled: boolean;
  readonly current: boolean | undefined;
  readonly subscription: UsageLimitSourceSnapshot["accounts"][number]["subscription"];
  readonly sourceKind: UsageLimitSourceSnapshot["kind"] | undefined;
  readonly sourceCheckedAt?: UsageLimitSourceSnapshot["checkedAt"];
  readonly sourceError: string | undefined;
}

export type CmaLimitAccount = CmaLimitAccountMetadata;

export function mergeCmaAccountMetadata(
  previous: CmaLimitAccountMetadata,
  next: CmaLimitAccountMetadata,
  winner: CmaLimitAccountMetadata,
): CmaLimitAccountMetadata {
  return {
    enabled: winner.enabled,
    current: winner.current ?? previous.current ?? next.current,
    subscription: winner.subscription ?? previous.subscription ?? next.subscription,
    sourceKind: winner.sourceKind ?? previous.sourceKind ?? next.sourceKind,
    ...((winner.sourceCheckedAt ?? previous.sourceCheckedAt ?? next.sourceCheckedAt)
      ? {
          sourceCheckedAt:
            winner.sourceCheckedAt ?? previous.sourceCheckedAt ?? next.sourceCheckedAt,
        }
      : {}),
    sourceError:
      winner.sourceError ??
      (winner.sourceKind === "cma" ? undefined : (previous.sourceError ?? next.sourceError)),
  };
}

export function isCmaSource(source: UsageLimitSourceSnapshot): boolean {
  return source.kind === "cma";
}

function isCmaAccount(account: Pick<CmaLimitAccountMetadata, "sourceKind">): boolean {
  return account.sourceKind === "cma";
}

export function selectCmaUsageAccounts<T extends Pick<CmaLimitAccountMetadata, "sourceKind">>(
  accounts: readonly T[],
): readonly T[] {
  return accounts.filter(isCmaAccount);
}
