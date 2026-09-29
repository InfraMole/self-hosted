// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

/**
 * Signs in with the public, read-only demo account through the normal auth
 * endpoint (rate limits apply) and opens the map.
 */
export function DemoSignIn({
  email,
  password,
  slug,
  labels,
}: {
  email: string;
  password: string;
  slug: string;
  labels: { open: string; opening: string; busy: string; unavailable: string };
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        size="lg"
        className="h-10 px-5"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          const { error } = await authClient.signIn.email({ email, password });
          if (error) {
            setPending(false);
            setError(error.status === 429 ? labels.busy : labels.unavailable);
            return;
          }
          router.push(`/w/${slug}/map`);
          router.refresh();
        }}
      >
        {pending ? labels.opening : labels.open}
      </Button>
      {error && (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
