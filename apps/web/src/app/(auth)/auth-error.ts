// SPDX-License-Identifier: AGPL-3.0-only
/** Maps Better Auth client errors to user-facing copy (never leaks internals). */
export function authErrorMessage(
  error: { status?: number; message?: string } | null | undefined,
  fallback: string,
): string {
  if (!error) return fallback;
  if (error.status === 429) return "Too many attempts. Wait a minute and try again.";
  if (error.status === 401) return "Invalid email or password.";
  if (error.status === 403) return "Verify your email address first — we just sent you a new link.";
  return error.message || fallback;
}
