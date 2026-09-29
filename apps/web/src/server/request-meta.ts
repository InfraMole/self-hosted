// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import { headers } from "next/headers";
import { ipFromHeaders } from "./http";

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

/** Client IP + user agent of the current request; nulls outside a request (jobs, tests). */
export async function requestMeta(): Promise<RequestMeta> {
  try {
    const h = await headers();
    const ip = ipFromHeaders(h);
    return {
      ip: ip === "unknown" ? null : ip,
      userAgent: h.get("user-agent")?.slice(0, 256) ?? null,
    };
  } catch {
    return { ip: null, userAgent: null };
  }
}
