// SPDX-License-Identifier: AGPL-3.0-only
import type { ResourceView } from "@/server/modules/resources/resources";
import { formatLinks } from "@/server/modules/resources/schemas";

/** Flat string values for the resource form (uncontrolled inputs). */
export interface ResourceFormValues {
  name: string;
  type: string;
  environment: string;
  criticality: string;
  status: string;
  description: string;
  notes: string;
  tags: string;
  links: string;
  hostname: string;
  fqdn: string;
  os: string;
  version: string;
  ipAddresses: string;
}

export const EMPTY_FORM_VALUES: ResourceFormValues = {
  name: "",
  type: "",
  environment: "",
  criticality: "",
  status: "ACTIVE",
  description: "",
  notes: "",
  tags: "",
  links: "",
  hostname: "",
  fqdn: "",
  os: "",
  version: "",
  ipAddresses: "",
};

export function toFormValues(r: ResourceView): ResourceFormValues {
  return {
    name: r.name,
    type: r.type,
    environment: r.environment ?? "",
    criticality: r.criticality ?? "",
    status: r.status,
    description: r.description ?? "",
    notes: r.notes ?? "",
    tags: r.tags.join(", "),
    links: formatLinks(r.links),
    hostname: r.metadata.hostname ?? "",
    fqdn: r.metadata.fqdn ?? "",
    os: r.metadata.os ?? "",
    version: r.metadata.version ?? "",
    ipAddresses: (r.metadata.ipAddresses ?? []).join(", "),
  };
}
