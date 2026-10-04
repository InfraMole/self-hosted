// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RedirectButton } from "@/components/billing/billing-buttons";
import { UsageMeter } from "@/components/billing/usage-meter";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CLOUD_TIER,
  CLOUD_TIERS,
  COMMUNITY_WORKSPACE_LIMIT,
  OVER_LIMIT_GRACE_DAYS,
  PLAN_LABEL,
  daysUntil,
  usageLevel,
  type Usage,
} from "@/lib/billing-plans";
import { formatDateTime } from "@/lib/format";
import { hasRole } from "@/server/authz";
import { tenantDb } from "@/server/db";
import { stripeConfigured } from "@/server/modules/billing/gateway";
import { currentLicence } from "@/server/modules/billing/licence";
import { getUsage } from "@/server/modules/billing/limits";
import { workspaceSubscription } from "@/server/modules/billing/subscriptions";
import { requireWorkspace } from "@/server/tenancy";
import { checkoutAction, portalAction } from "./actions";

export const metadata: Metadata = { title: "Billing" };

const STATUS_NOTE: Record<string, string> = {
  past_due:
    "The last payment failed. Stripe is retrying — update the payment method to keep the plan.",
  unpaid: "Payments failed; discovery is paused until a plan is active again.",
  canceled: "The subscription was cancelled; discovery is paused until you choose a plan.",
  incomplete: "The first payment has not completed yet.",
};

export default async function BillingPage({
  params,
  searchParams,
}: PageProps<"/w/[slug]/settings/billing">) {
  const { slug } = await params;
  const ctx = await requireWorkspace(slug);
  if (!hasRole(ctx.role, "ADMIN")) notFound();
  const isOwner = ctx.role === "OWNER";
  const checkout = (await searchParams).checkout;
  const [usage, members] = await Promise.all([
    getUsage(ctx.workspaceId),
    tenantDb(ctx).membership.count({ where: { workspaceId: ctx.workspaceId } }),
  ]);
  const level = usageLevel(usage);

  return (
    <>
      <PageHeader title="Billing" description="Your plan and what counts towards it." />
      <div className="flex max-w-3xl flex-col gap-6 p-6">
        <Link
          href={`/w/${ctx.workspaceSlug}/settings`}
          className="text-subtle self-start text-xs hover:underline"
        >
          ← Settings
        </Link>
        {checkout === "success" && (
          <p
            role="status"
            className="border-success/50 text-success rounded-md border px-3 py-2 text-sm"
          >
            Thanks! Stripe confirmed the payment; the plan updates here within a few seconds.
          </p>
        )}
        {checkout === "cancel" && (
          <p role="status" className="text-muted text-sm">
            Checkout was cancelled — nothing changed.
          </p>
        )}

        <Card>
          <CardHeader className="flex items-center justify-between gap-4">
            <CardTitle>{PLAN_LABEL[usage.plan]}</CardTitle>
            <PlanStatus usage={usage} level={level} />
          </CardHeader>
          <CardContent className="space-y-4">
            <UsageMeter usage={usage} />
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-subtle text-xs">Members</dt>
                <dd>
                  <span className="font-mono">{members}</span>
                  <span className="text-muted">
                    {usage.memberLimit === null ? " · unlimited" : ` of ${usage.memberLimit}`}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-subtle text-xs">Change history</dt>
                <dd>
                  <span className="font-mono">{usage.historyDays}</span> days
                </dd>
              </div>
            </dl>
            {usage.note && <p className="text-muted text-xs">{usage.note}</p>}
            {usage.edition === "cloud" && (
              <CloudSection
                slug={ctx.workspaceSlug}
                workspaceId={ctx.workspaceId}
                isOwner={isOwner}
              />
            )}
            {usage.edition === "community" && (
              <p className="text-muted text-sm">
                Community is free and open source (AGPLv3): unlimited servers and VMs,{" "}
                {COMMUNITY_WORKSPACE_LIMIT} workspace per installation. Several workspaces, priority
                support or a commercial licence: InfraMole Business.
              </p>
            )}
            {usage.edition === "business" && <LicenceSection />}
          </CardContent>
        </Card>
        <p className="text-subtle text-xs">
          Limits never delete data. On paid Cloud plans you can go over the server/VM limit for{" "}
          {OVER_LIMIT_GRACE_DAYS} days before adding more is blocked; hosts you already have keep
          reporting.
        </p>
      </div>
    </>
  );
}

function PlanStatus({ usage, level }: { usage: Usage; level: ReturnType<typeof usageLevel> }) {
  if (usage.plan === "cloud-trial" && usage.trialEndsAt)
    return (
      <span className="text-accent text-xs">
        Free trial — {daysUntil(usage.trialEndsAt)} days left
      </span>
    );
  if (usage.paused)
    return (
      <span className="text-warning text-xs">
        Discovery paused — choose a plan
        {usage.deletesAt &&
          ` before ${usage.deletesAt.slice(0, 10)}, when this workspace is deleted`}
      </span>
    );
  if (usage.graceEndsAt)
    return (
      <span className="text-warning text-xs">
        Over the limit — {daysUntil(usage.graceEndsAt)} days of grace left
      </span>
    );
  if (level === "over" || level === "at")
    return <span className="text-warning text-xs">Limit reached — you can’t add servers/VMs</span>;
  if (level === "near") return <span className="text-warning text-xs">Close to the limit</span>;
  return null;
}

async function CloudSection({
  slug,
  workspaceId,
  isOwner,
}: {
  slug: string;
  workspaceId: string;
  isOwner: boolean;
}) {
  if (!stripeConfigured())
    return <p className="text-muted text-sm">Billing is not enabled on this installation.</p>;
  const sub = await workspaceSubscription(workspaceId);
  const current = sub.active && sub.tier ? CLOUD_TIER[sub.tier] : null;
  return (
    <div className="space-y-4">
      {current ? (
        <p className="text-sm">
          {current.name} — {current.priceEur} € per month.
          {sub.currentPeriodEnd && (
            <span className="text-muted">
              {" "}
              {sub.cancelAtPeriodEnd ? "Ends" : "Renews"} {formatDateTime(sub.currentPeriodEnd)}.
            </span>
          )}{" "}
          <span className="text-muted">Change or cancel the plan in “Manage billing”.</span>
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          {CLOUD_TIERS.map((key) => {
            const t = CLOUD_TIER[key];
            return (
              <div key={key} className="border-border bg-surface-2/40 rounded-md border p-3">
                <div className="flex items-baseline justify-between">
                  <span className="font-semibold">{t.name}</span>
                  <span className="text-sm font-medium">{t.priceEur} €/mo</span>
                </div>
                <ul className="text-muted mt-2 space-y-0.5 text-xs">
                  <li>{t.nodes} servers and VMs</li>
                  <li>{t.members === null ? "Unlimited members" : `${t.members} members`}</li>
                  <li>{t.historyDays} days of history</li>
                </ul>
                {isOwner && (
                  <div className="mt-3">
                    <RedirectButton
                      label={`Choose ${t.name}`}
                      pendingLabel="Opening Checkout…"
                      variant={key === "team" ? "default" : "secondary"}
                      action={checkoutAction.bind(null, slug, key)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {STATUS_NOTE[sub.status] && <p className="text-warning text-xs">{STATUS_NOTE[sub.status]}</p>}
      {isOwner ? (
        sub.hasCustomer && (
          <RedirectButton
            label="Manage billing"
            pendingLabel="Opening…"
            variant="secondary"
            action={portalAction.bind(null, slug)}
          />
        )
      ) : (
        <p className="text-subtle text-xs">Only workspace owners can change the plan.</p>
      )}
      <p className="text-subtle text-xs">
        More than 250 servers and VMs? Write to{" "}
        <a href="mailto:sales@inframole.com" className="underline-offset-4 hover:underline">
          sales@inframole.com
        </a>
        .
      </p>
    </div>
  );
}

function LicenceSection() {
  const licence = currentLicence();
  return licence.valid ? (
    <p className="text-sm">
      Licence <span className="font-mono text-xs">{licence.payload.id.slice(0, 8)}</span> for{" "}
      <span className="font-medium">{licence.payload.licensee}</span>, valid until{" "}
      {licence.payload.expiresAt.slice(0, 10)}. Unlimited servers, VMs and workspaces.
    </p>
  ) : (
    <p className="text-warning text-sm">
      {licence.reason} Until a valid licence is set (
      <span className="font-mono text-xs">DEPMAP_LICENSE_KEY</span>), Community rules apply (one
      workspace). Nothing is removed.
    </p>
  );
}
