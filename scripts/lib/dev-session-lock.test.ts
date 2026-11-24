// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { assert, describe, it } from "@effect/vitest";

import { acquireDevSessionLock, DevSessionAlreadyRunningError } from "./dev-session-lock.ts";

describe("dev session lock", () => {
  it("allows one owner and releases the lock", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-dev-lock-"));
    try {
      const first = acquireDevSessionLock(root, "dev:desktop");
      try {
        acquireDevSessionLock(root, "dev:desktop");
        assert.fail("expected a duplicate session to be rejected");
      } catch (error) {
        assert.isTrue(error instanceof DevSessionAlreadyRunningError);
      }
      try {
        acquireDevSessionLock(root, "dev:server");
        assert.fail("expected another mode in the same workspace to be rejected");
      } catch (error) {
        assert.isTrue(error instanceof DevSessionAlreadyRunningError);
      }
      first.release();
      const second = acquireDevSessionLock(root, "dev:desktop");
      second.release();
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });

  it("removes a lock whose owner no longer exists", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-dev-lock-"));
    try {
      const lockPath = NodePath.join(root, ".dev-runner", "session.lock");
      NodeFS.mkdirSync(NodePath.dirname(lockPath), { recursive: true });
      NodeFS.writeFileSync(lockPath, JSON.stringify({ pid: 4_000_000_000 }));
      const lock = acquireDevSessionLock(root, "dev");
      lock.release();
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });
});
