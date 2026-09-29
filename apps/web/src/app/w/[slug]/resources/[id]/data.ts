// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { getResource } from "@/server/modules/resources/resources";
import { requireWorkspace } from "@/server/tenancy";

/** Workspace context + resource for resource pages (deduplicated per request). */
export const loadResource = cache(async (slug: string, id: string) => {
  const ctx = await requireWorkspace(slug);
  const resource = await getResource(ctx, id);
  if (!resource) notFound();
  return { ctx, resource };
});
