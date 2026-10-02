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
  "VULTR",
  "LINODE",
  "IONOS",
  "ORACLE_CLOUD",
  "TAILSCALE",
  "PROXMOX",
  "TRUENAS",
  "SYNOLOGY",
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
  /**
   * Usually on a private network (M27, ADR-042): the server reaches it only
   * if the administrator allowed that network (INTEGRATIONS_PRIVATE_NETWORKS).
   */
  local?: boolean;
}

/** URL + optional certificate pin of a local source. */
const LOCAL_FIELDS = (placeholder: string): FieldDef[] => [
  { name: "url", label: "URL", placeholder },
  {
    name: "fingerprint",
    label: "Certificate SHA-256 fingerprint (self-signed certificates)",
    placeholder: "AB:CD:… — empty = a certificate from a trusted CA",
    optional: true,
  },
];

/**
 * DNS records read with the integration's own credential (M27). "Don't import"
 * first: existing integrations stay as they were when edited.
 */
const DNS_FIELD: FieldDef = {
  name: "dns",
  label: "DNS records",
  options: [
    { value: "off", label: "Don't import DNS records" },
    { value: "linked", label: "Only records pointing to servers in InfraMole" },
    { value: "all", label: "All A / AAAA / CNAME records" },
  ],
};

export const INTEGRATION_FORMS: Record<IntegrationKindName, IntegrationForm> = {
  AZURE: {
    label: "Azure",
    permissions:
      "App registration (service principal) with the built-in Reader role on the subscription — nothing more.",
    imports:
      "Virtual machines with private/public IPs, size, region, OS and tags; load balancers and application gateways with their backends; Azure SQL databases and PostgreSQL / MySQL flexible servers; optionally Azure DNS records.",
    config: [
      { name: "tenantId", label: "Tenant ID", placeholder: "00000000-0000-0000-0000-000000000000" },
      {
        name: "subscriptionId",
        label: "Subscription ID",
        placeholder: "00000000-0000-0000-0000-000000000000",
      },
      DNS_FIELD,
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
      "Dedicated IAM user with an inline policy allowing only ec2:DescribeInstances, rds:DescribeDBInstances, elasticloadbalancing:DescribeLoadBalancers, DescribeListeners, DescribeTargetGroups and DescribeTargetHealth — plus route53:ListHostedZones and route53:ListResourceRecordSets for DNS.",
    imports:
      "EC2 instances (Name tag, IPs, platform), RDS databases and ALB / NLB load balancers with their targets, for one region; optionally Route 53 records (turn DNS on in one AWS integration only — Route 53 is global).",
    config: [{ name: "region", label: "Region", placeholder: "eu-central-1" }, DNS_FIELD],
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
      "Servers with public/private IPs, type, location, image and labels; load balancers with their targets; optionally DNS records of the project's zones.",
    config: [DNS_FIELD],
    secret: [{ name: "apiToken", label: "API token (read)", secret: true }],
  },
  DIGITALOCEAN: {
    label: "DigitalOcean",
    preview: true,
    permissions:
      "Personal access token with read-only scopes: droplet:read, load_balancer:read, database:read — plus domain:read for DNS.",
    imports:
      "Droplets with IPs, size, region and tags; load balancers with their droplets; managed databases; optionally DNS records of your domains.",
    config: [DNS_FIELD],
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
      "Application key + consumer key created with GET-only rights on /vps, /vps/*, /cloud/project, /cloud/project/*, /dedicated/server and /dedicated/server/* — plus /domain/zone and /domain/zone/* for DNS.",
    imports:
      "VPS, Public Cloud instances and dedicated servers, with their IPs; optionally DNS records of your zones.",
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
      DNS_FIELD,
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
  VULTR: {
    label: "Vultr",
    preview: true,
    permissions:
      "Vultr API keys cannot be limited to reading: use a sub-account (user) only for InfraMole and restrict the key to your server's IP under Access Control. InfraMole only calls GET.",
    imports:
      "Instances with main / IPv6 / VPC IPs, plan, region, OS and tags; load balancers with their instances; managed databases.",
    config: [],
    secret: [{ name: "apiKey", label: "API key", secret: true }],
  },
  LINODE: {
    label: "Akamai Cloud (Linode)",
    preview: true,
    permissions:
      "Personal access token with only Linodes, NodeBalancers and Databases set to Read Only — everything else No Access.",
    imports:
      "Linodes with public and private IPs, plan, region, image and tags; NodeBalancers with their backend nodes; managed databases.",
    config: [],
    secret: [{ name: "apiToken", label: "Personal access token", secret: true }],
  },
  IONOS: {
    label: "IONOS Cloud",
    preview: true,
    permissions:
      "Token of a user that is only in a group with read access to your data centers (no create / edit privileges). Not for IONOS VPS: that is a different product.",
    imports:
      "Cloud servers (Compute Engine) of every data center, with their NIC IPs, cores and RAM.",
    config: [],
    secret: [{ name: "apiToken", label: "API token", secret: true, multiline: true }],
  },
  ORACLE_CLOUD: {
    label: "Oracle Cloud",
    preview: true,
    permissions:
      "API signing key of a user in a group whose only policies are: inspect compartments, read instance-family, read virtual-network-family and read load-balancers (in tenancy, or in one compartment).",
    imports:
      "Compute instances with their VNIC private / public IPs, shape and free-form tags; load balancers with their backends — for one region.",
    config: [
      { name: "tenancy", label: "Tenancy OCID", placeholder: "ocid1.tenancy.oc1..aaaa…" },
      { name: "user", label: "User OCID", placeholder: "ocid1.user.oc1..aaaa…" },
      { name: "fingerprint", label: "Key fingerprint", placeholder: "aa:bb:cc:…" },
      { name: "region", label: "Region", placeholder: "eu-frankfurt-1" },
      {
        name: "compartment",
        label: "Compartment OCID (optional)",
        placeholder: "empty = every compartment of the tenancy",
        optional: true,
      },
    ],
    secret: [
      {
        name: "privateKey",
        label: "API signing private key (PEM)",
        placeholder: "Contents of the .pem file",
        secret: true,
        multiline: true,
      },
    ],
  },
  TAILSCALE: {
    label: "Tailscale",
    preview: true,
    permissions:
      "OAuth client with only the devices:core:read scope (does not expire). An API access token also works but expires after at most 90 days.",
    imports:
      "Tailnet devices: their Tailscale addresses are added to the matching servers and VMs of the Library (by name). Devices not in the Library are created only if you choose so — tagged devices are usually servers.",
    config: [
      {
        name: "create",
        label: "Devices not in the Library",
        options: [
          { value: "tagged", label: "Create tagged devices (servers)" },
          { value: "none", label: "Only add addresses to existing machines" },
          { value: "all", label: "Create every device" },
        ],
      },
      {
        name: "tailnet",
        label: "Tailnet (optional)",
        placeholder: "- = the credential's tailnet",
        optional: true,
      },
    ],
    secret: [
      {
        name: "clientId",
        label: "OAuth client ID (empty for an API token)",
        optional: true,
      },
      {
        name: "secret",
        label: "OAuth client secret or API token",
        placeholder: "tskey-…",
        secret: true,
      },
    ],
  },
  PROXMOX: {
    label: "Proxmox VE",
    preview: true,
    local: true,
    permissions:
      "API token of a dedicated user with the built-in PVEAuditor role on / (privilege separation off, or the role on the token too). Guest IPs of VMs also need the QEMU guest agent in the VM.",
    imports:
      "Nodes, VMs and containers (like the pvesh export), with node IPs, container IPs and VM IPs from the guest agent. No agent needed when InfraMole can reach the API.",
    config: LOCAL_FIELDS("https://pve.example.lan:8006"),
    secret: [
      { name: "tokenId", label: "Token ID", placeholder: "inframole@pve!sync" },
      { name: "tokenSecret", label: "Token secret", secret: true },
    ],
  },
  TRUENAS: {
    label: "TrueNAS",
    preview: true,
    local: true,
    permissions:
      "API key of a dedicated user with the Read-Only Administrator role (TrueNAS 25.04 or later: JSON-RPC API).",
    imports:
      "The NAS, its SMB shares, NFS exports and iSCSI targets; machines connected to them when it is read are suggested as storing data in them.",
    config: LOCAL_FIELDS("https://truenas.example.lan"),
    secret: [{ name: "apiKey", label: "API key", secret: true }],
  },
  SYNOLOGY: {
    label: "Synology DSM",
    preview: true,
    local: true,
    permissions:
      "A dedicated DSM account without 2-step verification and read-only access to the shared folders. Connected machines are only visible to an administrator account — leave that out unless you need it.",
    imports:
      "The NAS and its shared folders; with an administrator account, machines connected when it is read (suggested as storing data in it).",
    config: LOCAL_FIELDS("https://nas.example.lan:5001"),
    secret: [
      { name: "account", label: "Account" },
      { name: "password", label: "Password", secret: true },
    ],
  },
};
