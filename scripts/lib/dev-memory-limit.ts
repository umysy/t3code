// @effect-diagnostics nodeBuiltinImport:off globalErrorInEffectCatch:off globalErrorInEffectFailure:off
/** Stops a dev server whose process tree outgrows a memory limit, so a leak cannot fill RAM and swap. */

import * as NodeOS from "node:os";
import * as NodeChildProcess from "node:child_process";
import * as NodeUtil from "node:util";

import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";

const GiB = 1024 ** 3;
const execFile = NodeUtil.promisify(NodeChildProcess.execFile);

/** Half of RAM, at most 16 GiB. A fresh bundled-dev server uses about 7 GiB. */
export const defaultDevMemoryLimitBytes = (totalBytes = NodeOS.totalmem()) =>
  Math.min(16 * GiB, Math.floor(totalBytes / 2));

export class DevRunnerMemoryLimitError extends Schema.TaggedError<DevRunnerMemoryLimitError>()(
  "DevRunnerMemoryLimitError",
  { usedBytes: Schema.Number, limitBytes: Schema.Number },
) {
  override get message(): string {
    const gib = (bytes: number) => (bytes / GiB).toFixed(1);
    return `The dev server used ${gib(this.usedBytes)} GiB of RAM and swap, over its ${gib(this.limitBytes)} GiB limit, so it was stopped. Start it again, or set --memory-limit-gb (T3CODE_DEV_MEMORY_LIMIT_GB; 0 turns the limit off).`;
  }
}

export interface ProcessSample {
  readonly pid: number;
  readonly ppid: number;
}

/** `comm` can hold spaces and parentheses, so fields are read after its last `)`. */
export function parseProcStatParentPid(stat: string): number | undefined {
  const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
  return Number.isInteger(ppid) ? ppid : undefined;
}

export function parseProcStatusBytes(status: string): number {
  const kib = (field: string) =>
    Number(new RegExp(`^${field}:\\s+(\\d+) kB`, "m").exec(status)?.[1] ?? 0);
  return (kib("VmRSS") + kib("VmSwap")) * 1024;
}

export function processTreePids(rootPid: number, processes: ReadonlyArray<ProcessSample>) {
  const tree = new Set([rootPid]);
  for (let grew = true; grew;) {
    grew = false;
    for (const { pid, ppid } of processes) {
      if (tree.has(ppid) && !tree.has(pid)) {
        tree.add(pid);
        grew = true;
      }
    }
  }
  return tree;
}

const readProcessTreeBytes = Effect.fn("DevRunner.readProcessTreeBytes")(function* (
  rootPid: number,
) {
  const fs = yield* FileSystem.FileSystem;
  // Processes exit between listing and reading, so each read may fail.
  const read = (path: string) => fs.readFileString(path).pipe(Effect.option);
  const entries = yield* fs.readDirectory("/proc").pipe(Effect.orElseSucceed(() => []));
  const pids = entries.filter((entry) => /^\d+$/.test(entry));
  const processes: ProcessSample[] = [];
  for (const pid of pids) {
    const stat = yield* read(`/proc/${pid}/stat`);
    const ppid = stat._tag === "Some" ? parseProcStatParentPid(stat.value) : undefined;
    if (ppid !== undefined) processes.push({ pid: Number(pid), ppid });
  }
  let bytes = 0;
  for (const pid of processTreePids(rootPid, processes)) {
    const status = yield* read(`/proc/${pid}/status`);
    if (status._tag === "Some") bytes += parseProcStatusBytes(status.value);
  }
  return bytes;
});

const readWindowsProcessTreeBytes = Effect.fn("DevRunner.readWindowsProcessTreeBytes")(function* (
  rootPid: number,
) {
  const script = `
    $ErrorActionPreference = 'Stop'
    $RootPid = ${rootPid}
    $parents = @{}
    Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId | ForEach-Object {
      $parent = [int]$_.ParentProcessId
      if (!$parents.ContainsKey($parent)) { $parents[$parent] = [System.Collections.Generic.List[int]]::new() }
      $parents[$parent].Add([int]$_.ProcessId)
    }
    $ids = New-Object 'System.Collections.Generic.HashSet[int]'
    $queue = New-Object 'System.Collections.Generic.Queue[int]'
    $ids.Add($RootPid) | Out-Null
    $queue.Enqueue($RootPid)
    $bytes = [int64]0
    while ($queue.Count -gt 0) {
      $pidInTree = $queue.Dequeue()
      try {
        $process = Get-Process -Id $pidInTree -ErrorAction Stop
        $bytes += [int64]$process.WorkingSet64 + [int64]$process.PagedMemorySize64
      } catch {}
      foreach ($child in $parents[$pidInTree]) {
        if ($ids.Add($child)) { $queue.Enqueue($child) }
      }
    }
    $bytes
  `;
  const result = yield* Effect.tryPromise({
    try: (signal) =>
      execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
        windowsHide: true,
        timeout: 5000,
        signal,
      }),
    catch: () => new Error("Windows process memory sampling failed."),
  });
  const bytes = Number(result.stdout.trim());
  return bytes;
});

/**
 * Samples this process and its descendants every 30 seconds and fails once
 * they hold more than `limitBytes` of RAM plus swap.
 */
export const enforceDevMemoryLimit = Effect.fn("DevRunner.enforceDevMemoryLimit")(function* (
  limitBytes: number,
) {
  const platform = yield* HostProcess.Platform;
  if ((platform !== "linux" && platform !== "win32") || limitBytes <= 0) return yield* Effect.never;
  while (true) {
    yield* Effect.sleep("30 seconds");
    const usedBytes =
      platform === "linux"
        ? yield* readProcessTreeBytes(process.pid)
        : yield* readWindowsProcessTreeBytes(process.pid).pipe(Effect.orElseSucceed(() => 0));
    if (usedBytes > limitBytes) {
      return yield* new DevRunnerMemoryLimitError({ usedBytes, limitBytes });
    }
  }
});
