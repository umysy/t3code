export type ForkVersion = readonly [major: number, minor: number, patch: number, fork: number];

export type ForkRelease = { readonly version: string; readonly apkUrl: string };

export function parseForkVersion(value: string): ForkVersion | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)-fork\.(\d+)$/.exec(value);
  return match
    ? [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])]
    : undefined;
}

export function compareForkVersions(left: string, right: string): number {
  const a = parseForkVersion(left);
  const b = parseForkVersion(right);
  if (!a || !b) return 0;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index]! > b[index]! ? 1 : -1;
  }
  return 0;
}

export function releaseFromGithub(value: unknown): ForkRelease | undefined {
  if (!value || typeof value !== "object") return undefined;
  const release = value as { tag_name?: unknown; assets?: unknown };
  const version =
    typeof release.tag_name === "string" ? release.tag_name.replace(/^v/, "") : undefined;
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const apk = assets.find((asset) => {
    if (!asset || typeof asset !== "object") return false;
    const item = asset as { name?: unknown; browser_download_url?: unknown };
    return (
      typeof item.name === "string" &&
      item.name.endsWith(".apk") &&
      typeof item.browser_download_url === "string"
    );
  }) as { browser_download_url: string } | undefined;
  return version && parseForkVersion(version) && apk
    ? { version, apkUrl: apk.browser_download_url }
    : undefined;
}

export function isForkUpdateAvailable(current: string, latest: ForkRelease | undefined): boolean {
  return latest !== undefined && compareForkVersions(latest.version, current) > 0;
}

export async function fetchForkRelease(repository: string): Promise<ForkRelease | undefined> {
  try {
    const response = await fetch(`https://api.github.com/repos/${repository}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) return undefined;
    return releaseFromGithub(await response.json());
  } catch {
    return undefined;
  }
}
