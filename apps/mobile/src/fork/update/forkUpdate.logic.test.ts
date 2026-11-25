import { expect, it } from "vite-plus/test";

import { compareForkVersions, isForkUpdateAvailable, releaseFromGithub } from "./forkUpdate.logic";

it("orders fork releases numerically", () => {
  expect(compareForkVersions("0.1.12-fork.2", "0.1.12-fork.10")).toBe(-1);
  expect(compareForkVersions("0.1.12-fork.10", "0.1.13-fork.1")).toBe(-1);
});

it("selects an APK release asset", () => {
  const release = releaseFromGithub({
    tag_name: "v0.1.12-fork.2",
    assets: [{ name: "T3.apk", browser_download_url: "https://example.test/T3.apk" }],
  });
  expect(release).toEqual({ version: "0.1.12-fork.2", apkUrl: "https://example.test/T3.apk" });
  expect(isForkUpdateAvailable("0.1.12-fork.1", release)).toBe(true);
});
