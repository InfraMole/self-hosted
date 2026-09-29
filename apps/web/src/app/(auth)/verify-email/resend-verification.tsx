// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "../auth-error";

export function ResendVerification({ email, callbackURL }: { email: string; callbackURL: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <div className="flex flex-col items-center gap-2">
      <Button
        variant="secondary"
        size="sm"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          const { error } = await authClient.sendVerificationEmail({ email, callbackURL });
          setPending(false);
          setMessage(error ? authErrorMessage(error, "Could not send the email.") : "Sent again.");
        }}
      >
        {pending ? "Sending…" : "Resend the link"}
      </Button>
      {message && (
        <p role="status" className="text-muted text-xs">
          {message}
        </p>
      )}
    </div>
  );
}
