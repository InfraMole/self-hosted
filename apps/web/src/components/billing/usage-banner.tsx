// SPDX-License-Identifier: AGPL-3.0-only
import Link from "next/link";
import { daysUntil, usageLevel, type Usage } from "@/lib/billing-plans";

/** Thin banner for the plan state (ADR-023): trial, paused, grace, near/at the limit. */
export function UsageBanner({ usage, billingHref }: { usage: Usage; billingHref: string | null }) {
  const text = bannerText(usage);
  if (!text) return null;
  const calm = usage.plan === "cloud-trial" && !text.urgent;
  return (
    <div
      role="status"
      className={
        calm
          ? "border-border bg-surface text-muted flex items-center justify-between gap-4 border-b px-6 py-1.5 text-xs"
          : "border-warning/40 bg-warning/10 text-warning flex items-center justify-between gap-4 border-b px-6 py-1.5 text-xs"
      }
    >
      <span>{text.message}</span>
      {billingHref ? (
        <Link
          href={billingHref}
          className="shrink-0 font-medium underline-offset-4 hover:underline"
        >
          {usage.paused || usage.plan === "cloud-trial" ? "Choose a plan →" : "View plan →"}
        </Link>
      ) : (
        <span className="shrink-0">Ask a workspace admin.</span>
      )}
    </div>
  );
}

function bannerText(usage: Usage): { message: string; urgent: boolean } | null {
  if (usage.paused)
    return {
      message:
        "The free trial has ended: agents, imports and integrations are paused. Everything you mapped is still here.",
      urgent: true,
    };
  if (usage.plan === "cloud-trial" && usage.trialEndsAt) {
    const days = daysUntil(usage.trialEndsAt);
    return {
      message: `Free trial: ${days} day${days === 1 ? "" : "s"} left. No card needed until you choose a plan.`,
      urgent: days <= 3,
    };
  }
  if (usage.graceEndsAt)
    return {
      message: `Over the plan (${usage.nodes} of ${usage.limit} servers/VMs). New servers can still be added for ${daysUntil(usage.graceEndsAt)} more days. Nothing is removed.`,
      urgent: true,
    };
  const level = usageLevel(usage);
  if (level === "ok" || usage.limit === null) return null;
  return {
    message:
      level === "near"
        ? `${usage.nodes} of ${usage.limit} servers/VMs used on your plan.`
        : `Plan limit reached (${usage.nodes} of ${usage.limit} servers/VMs): new servers, VMs and agents can’t be added. Nothing was removed.`,
    urgent: true,
  };
}
