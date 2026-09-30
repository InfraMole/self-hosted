// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useState, useTransition } from "react";

export interface DigestRow {
  workspaceSlug: string;
  workspaceName: string;
  weeklyDigest: boolean;
}

/**
 * Weekly email summary (M21): one switch per workspace. Sent on Mondays with
 * what changed during the week — counts and resource names, never details.
 */
export function DigestSection({
  rows,
  mailConfigured,
  disabled,
  setDigest,
}: {
  rows: DigestRow[];
  mailConfigured: boolean;
  disabled: boolean;
  setDigest: (slug: string, enabled: boolean) => Promise<{ error?: string }>;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!mailConfigured) {
    return (
      <p className="text-muted text-sm">
        This server does not send email yet (an administrator can set <code>SMTP_URL</code>), so the
        weekly summary is not available.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-muted text-sm">
        Every Monday, an email with what changed in the last week: how many resources were
        discovered, changed or stopped reporting, the most active ones, and what waits for review.
        Not an alert — and never IP addresses or change details.
      </p>
      <ul className="divide-border divide-y">
        {rows.map((r) => (
          <li key={r.workspaceSlug} className="flex items-center justify-between py-2 text-sm">
            <span>{r.workspaceName}</span>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                defaultChecked={r.weeklyDigest}
                disabled={pending || disabled}
                aria-label={`Weekly summary for ${r.workspaceName}`}
                onChange={(e) => {
                  const enabled = e.target.checked;
                  startTransition(async () => {
                    setError(null);
                    const result = await setDigest(r.workspaceSlug, enabled);
                    if (result.error) setError(result.error);
                  });
                }}
                className="accent-[var(--accent)]"
              />
              <span className="text-muted text-xs">Weekly summary</span>
            </label>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
