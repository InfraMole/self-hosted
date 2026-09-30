// SPDX-License-Identifier: AGPL-3.0-only
/** Client-safe form definitions for integrations (validation lives server-side in providers.ts). */

export const INTEGRATION_KINDS = [
  "AZURE",
  "AWS",
  "CLOUDFLARE",
  "HETZNER",
  "DIGITALOCEAN",
  "SCALEWAY",
  "OVHCLOUD",
  "GOOGLE_CLOUD",
  "CLOUDING",
] as const;
export type IntegrationKindName = (typeof INTEGRATION_KINDS)[number];

export interface FieldDef {
  name: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
  optional?: boolean;
  /** Multi-line value (e.g. a JSON key file). */
  multiline?: boolean;
  /** Fixed choices (rendered as a select; the first is the default). */
  options?: { value: string; label: string }[];
}

export interface IntegrationForm {
  label: string;
  /** Least-privilege guidance shown next to the form. */
  permissions: string;
  imports: string;
  config: FieldDef[];
  secret: FieldDef[];
  /**
   * Built from the provider's API documentation but not yet verified against
   * a real account (ADR-034): labelled "Preview" wherever it is offered.
   */
  preview?: boolean;
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
      {
        name: "records",
        label: "Records",
        options: [
          { value: "linked", label: "Only records pointing to servers in InfraMole" },
          { value: "all", label: "All A / AAAA / CNAME records" },
        ],
      },
    ],
    secret: [{ name: "apiToken", label: "API token", secret: true }],
  },

  HETZNER: {
    label: "Hetzner Cloud",
    preview: true,
    permissions:
      "Project API token with Read permission (Security › API tokens) — never Read & Write.",
    imports:
      "Servers with public/private IPs, type, location, image and labels; load balancers with their targets.",
    config: [],
    secret: [{ name: "apiToken", label: "API token (read)", secret: true }],
  },
  DIGITALOCEAN: {
    label: "DigitalOcean",
    preview: true,
    permissions:
      "Personal access token with read-only scopes: droplet:read, load_balancer:read, database:read.",
    imports:
      "Droplets with IPs, size, region and tags; load balancers with their droplets; managed databases.",
    config: [],
    secret: [{ name: "apiToken", label: "Access token", placeholder: "dop_v1_…", secret: true }],
  },
  SCALEWAY: {
    label: "Scaleway",
    preview: true,
    permissions:
      "API key of an IAM application whose policy grants only InstancesReadOnly, LoadBalancersReadOnly and RelationalDatabasesReadOnly.",
    imports:
      "Instances with IPs, type and image; load balancers with their backend IPs; managed databases — for the zones you list.",
    config: [{ name: "zones", label: "Zones", placeholder: "fr-par-1, nl-ams-1" }],
    secret: [{ name: "secretKey", label: "Secret key", secret: true }],
  },
  OVHCLOUD: {
    label: "OVHcloud",
    preview: true,
    permissions:
      "Application key + consumer key created with GET-only rights on /vps, /vps/*, /cloud/project, /cloud/project/*, /dedicated/server and /dedicated/server/*.",
    imports: "VPS, Public Cloud instances and dedicated servers, with their IPs.",
    config: [
      {
        name: "endpoint",
        label: "API endpoint",
        options: [
          { value: "ovh-eu", label: "OVHcloud Europe" },
          { value: "ovh-ca", label: "OVHcloud Canada" },
          { value: "ovh-us", label: "OVHcloud US" },
        ],
      },
      {
        name: "projectId",
        label: "Public Cloud project ID (optional)",
        placeholder: "empty = every project the key can read",
        optional: true,
      },
    ],
    secret: [
      { name: "applicationKey", label: "Application key" },
      { name: "applicationSecret", label: "Application secret", secret: true },
      { name: "consumerKey", label: "Consumer key", secret: true },
    ],
  },
  GOOGLE_CLOUD: {
    label: "Google Cloud",
    preview: true,
    permissions:
      "Service account with the Compute Viewer and Cloud SQL Viewer roles on the project — nothing more.",
    imports:
      "Compute Engine instances with internal/external IPs, machine type, zone and labels; Cloud SQL instances.",
    config: [
      {
        name: "projectId",
        label: "Project ID (optional)",
        placeholder: "empty = the key's project",
        optional: true,
      },
    ],
    secret: [
      {
        name: "serviceAccountKey",
        label: "Service account key (JSON)",
        placeholder: '{ "type": "service_account", … }',
        secret: true,
        multiline: true,
      },
    ],
  },
  CLOUDING: {
    label: "Clouding",
    preview: true,
    permissions:
      "Clouding API keys cannot be limited to reading: create one only for InfraMole, which only calls GET /v1/servers.",
    imports: "Servers with public/private IPs, vCores, RAM, image and power state.",
    config: [],
    secret: [{ name: "apiKey", label: "API key", secret: true }],
  },
};
