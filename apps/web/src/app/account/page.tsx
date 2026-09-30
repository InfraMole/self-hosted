// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { DeleteAccount } from "@/components/account/delete-account";
import { DigestSection } from "@/components/account/digest-section";
import { PasskeysSection } from "@/components/account/passkeys-section";
import { SignInMethods } from "@/components/account/sign-in-methods";
import { TwoFactorSection } from "@/components/account/two-factor-section";
import { Logo } from "@/components/logo";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AUDIT_ACTIONS } from "@/lib/audit-actions";
import { formatDateTime, formatRelative } from "@/lib/format";
import { enabledSsoProviders } from "@/server/auth";
import { getAccountSecurity } from "@/server/modules/account/account";
import { listAccountEvents } from "@/server/modules/audit/audit";
import { requireUser } from "@/server/tenancy";
import { listDigestPreferences } from "@/server/modules/digest/digest";
import { mailerConfigured } from "@/server/mail";
import {
  passkeyAddedAction,
  removePasskeyAction,
  setWeeklyDigestAction,
  twoFactorChangedAction,
} from "./actions";
import { isDemoUser } from "@/server/modules/demo/demo";

export const metadata: Metadata = { title: "Account & security" };

/** Short, non-identifying summary of a user agent ("Chrome on Windows"). */
function describeAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Mac OS X/.test(ua)
      ? "macOS"
      : /Android/.test(ua)
        ? "Android"
        : /iPhone|iPad/.test(ua)
          ? "iOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return os ? `${browser} on ${os}` : browser;
}

export default async function AccountPage({ searchParams }: PageProps<"/account">) {
  const user = await requireUser();
  const required = (await searchParams).required;
  const [security, events, digests] = await Promise.all([
    getAccountSecurity(user.id),
    listAccountEvents(user.id),
    listDigestPreferences(user.id),
  ]);

  return (
    <main className="flex flex-1 flex-col items-center px-4 py-12">
      <div className="w-full max-w-2xl space-y-6">
        <div className="flex items-center justify-between">
          <Logo className="text-base" />
          <Link href="/" className="text-muted hover:text-foreground text-xs">
            ← Back to InfraMole
          </Link>
        </div>
        <div>
          <h1 className="text-lg font-medium tracking-tight">Account & security</h1>
          <p className="text-muted text-sm">
            {user.name} · <span className="font-mono text-xs">{user.email}</span>
          </p>
        </div>

        {isDemoUser(user) && (
          <p
            role="status"
            className="border-accent/30 bg-accent/10 rounded-md border px-3 py-2 text-sm"
          >
            This is the shared demo account: its settings cannot be changed.
          </p>
        )}

        {typeof required === "string" && !security.twoFactorEnabled && (
          <div
            role="alert"
            className="border-warning/50 text-warning flex gap-2 rounded-md border px-3 py-2.5 text-sm"
          >
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            <p>
              <span className="font-medium">{required.slice(0, 64)}</span> requires two-factor
              authentication. Turn it on below to continue.
            </p>
          </div>
        )}

        {digests.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Weekly summary</CardTitle>
            </CardHeader>
            <CardContent>
              <DigestSection
                rows={digests}
                mailConfigured={mailerConfigured()}
                disabled={isDemoUser(user)}
                setDigest={setWeeklyDigestAction}
              />
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Two-factor authentication</CardTitle>
          </CardHeader>
          <CardContent>
            <TwoFactorSection
              enabled={security.twoFactorEnabled}
              onChanged={twoFactorChangedAction}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Passkeys</CardTitle>
          </CardHeader>
          <CardContent>
            <PasskeysSection
              passkeys={security.passkeys}
              onAdded={passkeyAddedAction}
              onRemove={removePasskeyAction}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sign-in methods</CardTitle>
          </CardHeader>
          <CardContent>
            <SignInMethods methods={security.signInMethods} available={enabledSsoProviders()} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent security activity</CardTitle>
            <p className="text-muted mt-0.5 text-xs">
              Sign-ins and changes to your account. Something you don&apos;t recognise? Reset your
              password and turn on two-factor authentication.
            </p>
          </CardHeader>
          {events.length === 0 ? (
            <CardContent className="text-subtle text-sm">Nothing yet.</CardContent>
          ) : (
            <ul className="divide-border divide-y">
              {events.map((e) => (
                <li key={e.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                  <span className="flex-1">
                    {AUDIT_ACTIONS[e.action as keyof typeof AUDIT_ACTIONS]?.label ?? e.action}
                    <span className="text-subtle text-xs"> · {describeAgent(e.userAgent)}</span>
                  </span>
                  <span className="text-subtle font-mono text-xs">{e.ip ?? "—"}</span>
                  <span
                    className="text-muted w-28 text-right text-xs"
                    title={formatDateTime(e.createdAt)}
                  >
                    {formatRelative(e.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Delete account</CardTitle>
          </CardHeader>
          <CardContent>
            <DeleteAccount
              hasPassword={security.signInMethods.some((m) => m.providerId === "credential")}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
