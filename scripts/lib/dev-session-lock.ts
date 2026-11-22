// @effect-diagnostics nodeBuiltinImport:off extendsNativeError:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

export class DevSessionAlreadyRunningError extends Error {
  readonly lockPath: string;
  readonly pid: number;

  constructor(lockPath: string, pid: number) {
    super(`A T3 dev session is already running for this workspace (pid ${String(pid)}).`);
    this.name = "DevSessionAlreadyRunningError";
    this.lockPath = lockPath;
    this.pid = pid;
  }
}

interface LockRecord {
  readonly pid: number;
  readonly mode?: string;
}

const readPid = (lockPath: string): number | undefined => {
  try {
    const value = JSON.parse(NodeFS.readFileSync(lockPath, "utf8")) as Partial<LockRecord>;
    return typeof value.pid === "number" && Number.isInteger(value.pid) && value.pid > 0
      ? value.pid
      : undefined;
  } catch {
    return undefined;
  }
};

const processExists = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "EPERM";
  }
};

const removeStaleLock = (lockPath: string): boolean => {
  const pid = readPid(lockPath);
  if (pid !== undefined && processExists(pid)) return false;
  try {
    NodeFS.unlinkSync(lockPath);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }
};

export interface DevSessionLock {
  readonly path: string;
  readonly release: () => void;
}

export const acquireDevSessionLock = (baseDir: string, mode: string): DevSessionLock => {
  const directory = NodePath.join(baseDir, ".dev-runner");
  const lockPath = NodePath.join(directory, "session.lock");
  NodeFS.mkdirSync(directory, { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const descriptor = NodeFS.openSync(lockPath, "wx");
      try {
        NodeFS.writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, mode })}\n`, "utf8");
      } finally {
        NodeFS.closeSync(descriptor);
      }
      let released = false;
      return {
        path: lockPath,
        release: () => {
          if (released) return;
          released = true;
          try {
            NodeFS.unlinkSync(lockPath);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || !removeStaleLock(lockPath)) {
        const pid = readPid(lockPath);
        throw new DevSessionAlreadyRunningError(lockPath, pid ?? 0);
      }
    }
  }

  throw new DevSessionAlreadyRunningError(lockPath, readPid(lockPath) ?? 0);
};
