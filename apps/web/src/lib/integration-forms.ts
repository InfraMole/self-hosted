// SPDX-License-Identifier: AGPL-3.0-only
/** Client-safe form definitions for integrations (validation lives server-side in providers.ts). */

export type IntegrationKindName = "AZURE" | "AWS" | "CLOUDFLARE";

export interface FieldDef {
  name: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
  optional?: boolean;
}

export interface IntegrationForm {
  label: string;
  /** Least-privilege guidance shown next to the form. */
  permissions: string;
  imports: string;
  config: FieldDef[];
  secret: FieldDef[];
}

export const INTEGRATION_FORMS: Record<IntegrationKindName, IntegrationForm> = {
  AZURE: {
    label: "Azure",
    permissions:
      "App registration (service principal) with the built-in Reader role on the subscription — nothing more.",
    imports: "Virtual machines with private/public IPs, size, region, OS and tags.",
    config: [
      { name: "tenantId", label: "Tenant ID", placeholder: "00000000-0000-0000-0000-000000000000" },
      {
        name: "subscriptionId",
        label: "Subscription ID",
        placeholder: "00000000-0000-0000-0000-000000000000",
      },
    ],
    secret: [
      {
        name: "clientId",
        label: "Client (application) ID",
        placeholder: "00000000-0000-0000-0000-000000000000",
      },
      { name: "clientSecret", label: "Client secret", secret: true },
    ],
  },
  AWS: {
    label: "AWS",
    permissions:
      "Dedicated IAM user with an inline policy allowing only ec2:DescribeInstances and rds:DescribeDBInstances.",
    imports: "EC2 instances (Name tag, IPs, platform) and RDS databases, for one region.",
    config: [{ name: "region", label: "Region", placeholder: "eu-central-1" }],
    secret: [
      { name: "accessKeyId", label: "Access key ID", placeholder: "AKIA…" },
      { name: "secretAccessKey", label: "Secret access key", secret: true },
    ],
  },
  CLOUDFLARE: {
    label: "Cloudflare",
    permissions:
      "API token (not the global key) with Zone:Read and DNS:Read on the zones you want.",
    imports:
      "A / AAAA / CNAME records as domains; proxied ones exposed through Cloudflare; origins linked by IP.",
    config: [
      {
        name: "zones",
        label: "Zones (optional)",
        placeholder: "example.com, other.org — empty = all",
        optional: true,
      },
    ],
    secret: [{ name: "apiToken", label: "API token", secret: true }],
  },
};
