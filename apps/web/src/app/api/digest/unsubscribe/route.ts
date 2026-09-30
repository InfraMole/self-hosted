// SPDX-License-Identifier: AGPL-3.0-only
import { NextResponse } from "next/server";
import { unsubscribeDigest } from "@/server/modules/digest/digest";

export const dynamic = "force-dynamic";

/**
 * One-click unsubscribe (RFC 8058 List-Unsubscribe-Post) and the target of
 * the confirmation page's button. Only POST changes anything: link scanners
 * that GET the URL never unsubscribe anyone.
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const m = url.searchParams.get("m") ?? "";
  const t = url.searchParams.get("t") ?? "";
  const workspace = await unsubscribeDigest(m, t);
  const accepts = request.headers.get("accept") ?? "";
  if (accepts.includes("text/html")) {
    const back = new URL("/digest/unsubscribe", url.origin);
    back.searchParams.set("done", workspace ? "1" : "0");
    return NextResponse.redirect(back, 303);
  }
  return new NextResponse(null, { status: workspace ? 200 : 400 });
}

/** A GET (a person clicking the link in the email) shows the confirmation page. */
export function GET(request: Request) {
  const url = new URL(request.url);
  const page = new URL("/digest/unsubscribe", url.origin);
  page.search = url.search;
  return NextResponse.redirect(page, 303);
}
