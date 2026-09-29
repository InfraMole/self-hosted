// SPDX-License-Identifier: AGPL-3.0-only
import { getAuth } from "@/server/auth";

// Better Auth handler (sign-in, sign-up, sign-out, session). Rate limited in production.
export async function GET(request: Request) {
  return getAuth().handler(request);
}

export async function POST(request: Request) {
  return getAuth().handler(request);
}
