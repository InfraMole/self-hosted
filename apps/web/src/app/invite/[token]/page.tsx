// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { previewInvitation } from "@/server/modules/members/members";
import { getSession } from "@/server/tenancy";
import { AcceptButton } from "./accept-button";
import { acceptInvitationAction } from "./actions";

// The token is in the URL: never leak it through the Referer header.
export const metadata: Metadata = { title: "Invitation", referrer: "no-referrer" };

const STATE_MESSAGE = {
  accepted: "This invitation has already been used.",
  revoked: "This invitation was revoked. Ask the person who invited you for a new one.",
  expired: "This invitation has expired. Ask the person who invited you for a new one.",
} as const;

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const [session, invitation] = await Promise.all([getSession(), previewInvitation(token)]);
  const next = encodeURIComponent(`/invite/${token}`);

  let body: React.ReactNode;
  if (!invitation) {
    body = <p className="text-muted text-sm">This invitation link is not valid.</p>;
  } else if (invitation.state !== "pending") {
    body = <p className="text-muted text-sm">{STATE_MESSAGE[invitation.state]}</p>;
  } else {
    body = (
      <>
        <p className="text-sm">
          <span className="font-medium">{invitation.invitedByName}</span> invited you to{" "}
          <span className="font-medium">{invitation.workspaceName}</span> as{" "}
          <span className="font-medium">{invitation.role.toLowerCase()}</span>.
        </p>
        <p className="text-muted mt-1 mb-6 text-xs">
          For {invitation.emailHint} — sign in with that email address to accept.
        </p>
        {session ? (
          <>
            <AcceptButton action={acceptInvitationAction.bind(null, token)} />
            <p className="text-subtle mt-4 text-xs">Signed in as {session.user.email}</p>
          </>
        ) : (
          <div className="flex flex-col gap-2">
            <Button asChild>
              <Link href={`/sign-up?next=${next}`}>Create an account</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href={`/sign-in?next=${next}`}>I already have an account</Link>
            </Button>
          </div>
        )}
      </>
    );
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-16">
      <div className="w-full max-w-[380px]">
        <Logo className="mb-8 text-base" />
        <h1 className="mb-3 text-lg font-medium tracking-tight">Workspace invitation</h1>
        {body}
      </div>
    </main>
  );
}
