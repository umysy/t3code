import { expect, it } from "vite-plus/test";

import { forkVersionCode } from "./appConfig";

it("encodes fork versions as Android version codes", () => {
  expect(forkVersionCode("0.1.12-fork.3")).toBe(101203);
  expect(forkVersionCode("12.34.56-fork.78")).toBe(123456078);
});

it("rejects components outside the version code range", () => {
  expect(() => forkVersionCode("1000.1.1-fork.1")).toThrow("Invalid fork version");
  expect(() => forkVersionCode("0.1.1-fork.bad")).toThrow("Expected MAJOR.MINOR.PATCH-fork.N");
});
