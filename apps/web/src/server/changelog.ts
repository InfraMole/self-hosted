// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { marked } from "marked";
import { cache } from "react";
import { mergeReleases, parseChangelog, type Release } from "@/lib/changelog";

/**
 * Release notes from the repository (M36): CHANGELOG.md and
 * agent/CHANGELOG.md at the repository root, read at build time only (the
 * pages and the feed are static). Repository content, so no sanitiser. A
 * checkout without the agent's changelog shows the server's only.
 */
async function read(file: Promise<string>): Promise<string> {
  try {
    return await file;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

export const loadReleases = cache(async (): Promise<Release[]> => {
  // Literal paths: a computed one makes the build trace the whole repository.
  const [server, agent] = await Promise.all([
    read(readFile(path.join(process.cwd(), "../../CHANGELOG.md"), "utf8")),
    read(readFile(path.join(process.cwd(), "../../agent/CHANGELOG.md"), "utf8")),
  ]);
  const releases = mergeReleases(parseChangelog(server, "server"), parseChangelog(agent, "agent"));
  if (!releases.length) throw new Error("CHANGELOG.md not found or has no releases");
  return releases;
});

export function releaseHtml(body: string): string {
  return marked.parse(body, { gfm: true, async: false });
}
