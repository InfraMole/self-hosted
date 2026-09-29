// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import QRCode from "qrcode";
import { CopyBlock } from "@/components/agents/create-token-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

type Step =
  | { kind: "idle" }
  | { kind: "password"; purpose: "enable" | "disable" | "codes" }
  | { kind: "scan"; qr: string; secret: string; backupCodes: string[] }
  | { kind: "codes"; backupCodes: string[] };

/** otpauth://totp/InfraMole:alice?secret=XYZ&issuer=InfraMole → XYZ (for manual entry). */
function secretOf(uri: string): string {
  try {
    return new URL(uri).searchParams.get("secret") ?? "";
  } catch {
    return "";
  }
}

export function TwoFactorSection({
  enabled,
  onChanged,
}: {
  enabled: boolean;
  onChanged: () => Promise<void>;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const fail = (message: string) => {
    setError(message);
    setPending(false);
  };

  async function submitPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step.kind !== "password") return;
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    setPending(true);
    setError(null);
    if (step.purpose === "enable") {
      const { data, error } = await authClient.twoFactor.enable({ password });
      if (error || !data)
        return fail(error?.status === 400 ? "Wrong password." : "Could not start 2FA setup.");
      if (!("totpURI" in data)) return fail("Could not start 2FA setup.");
      const qr = await QRCode.toDataURL(data.totpURI, { margin: 1, width: 192 });
      setStep({ kind: "scan", qr, secret: secretOf(data.totpURI), backupCodes: data.backupCodes });
    } else if (step.purpose === "disable") {
      const { error } = await authClient.twoFactor.disable({ password });
      if (error) return fail(error.status === 400 ? "Wrong password." : "Could not disable 2FA.");
      await onChanged();
      setStep({ kind: "idle" });
      router.refresh();
    } else {
      const { data, error } = await authClient.twoFactor.generateBackupCodes({ password });
      if (error || !data)
        return fail(error?.status === 400 ? "Wrong password." : "Could not create codes.");
      setStep({ kind: "codes", backupCodes: data.backupCodes });
    }
    setPending(false);
  }

  async function verify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code") ?? "").replace(/\s+/g, "");
    setPending(true);
    setError(null);
    const { error } = await authClient.twoFactor.verifyTotp({ code });
    if (error) return fail("That code is not valid. Check the time on your phone and try again.");
    await onChanged();
    setPending(false);
    setStep({ kind: "idle" });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm">
            Authenticator app{" "}
            <span className={enabled ? "text-success text-xs" : "text-subtle text-xs"}>
              {enabled ? "· on" : "· off"}
            </span>
          </p>
          <p className="text-muted text-xs">
            A 6-digit code from an app like 1Password, Bitwarden, Google Authenticator or Authy is
            asked after your password.
          </p>
        </div>
        {step.kind === "idle" &&
          (enabled ? (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setStep({ kind: "password", purpose: "codes" })}
              >
                New backup codes
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setStep({ kind: "password", purpose: "disable" })}
              >
                Turn off
              </Button>
            </div>
          ) : (
            <Button size="sm" onClick={() => setStep({ kind: "password", purpose: "enable" })}>
              Turn on
            </Button>
          ))}
      </div>

      {step.kind === "password" && (
        <form onSubmit={submitPassword} className="flex items-end gap-2">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="tf-password">Confirm your password</Label>
            <Input
              id="tf-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              autoFocus
            />
          </div>
          <Button type="submit" disabled={pending}>
            Continue
          </Button>
          <Button type="button" variant="ghost" onClick={() => setStep({ kind: "idle" })}>
            Cancel
          </Button>
        </form>
      )}

      {step.kind === "scan" && (
        <div className="border-border space-y-4 rounded-md border p-4">
          <div className="flex gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- data URL generated locally */}
            <img
              src={step.qr}
              alt="QR code for your authenticator app"
              width={160}
              height={160}
              className="rounded bg-white p-1"
            />
            <div className="space-y-2 text-xs">
              <p>1. Scan the QR code with your authenticator app.</p>
              <p className="text-muted">
                Can&apos;t scan? Enter this key manually:{" "}
                <span className="text-foreground font-mono break-all">{step.secret}</span>
              </p>
              <p>
                2. Save your backup codes somewhere safe — each works once if you lose the phone.
              </p>
            </div>
          </div>
          <CopyBlock label="Backup codes" value={step.backupCodes.join("\n")} />
          <form onSubmit={verify} className="flex items-end gap-2">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="tf-code">3. Enter the 6-digit code to finish</Label>
              <Input
                id="tf-code"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                maxLength={8}
                className="font-mono tracking-widest"
              />
            </div>
            <Button type="submit" disabled={pending}>
              Turn on
            </Button>
          </form>
        </div>
      )}

      {step.kind === "codes" && (
        <div className="space-y-2">
          <CopyBlock
            label="New backup codes (the old ones no longer work)"
            value={step.backupCodes.join("\n")}
          />
          <Button size="sm" variant="secondary" onClick={() => setStep({ kind: "idle" })}>
            Done
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
