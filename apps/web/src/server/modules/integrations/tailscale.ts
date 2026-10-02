// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tailscale (M27, ADR-042): the tailnet's devices and their addresses. A
 * device that is already in the Library (same name or host name) only gets
 * its tailnet addresses added, so traffic the agents see over Tailscale
 * resolves to the right machine; see parse-platforms.ts#tailscale.
 */
import { z } from "zod";
import type { TailnetDevice, TailnetInput } from "@/server/modules/importers/parse-platforms";
import { getJson, parseBody } from "./cloud-providers";
import { IntegrationError, last4, type Provider } from "./provider-base";

const TAILSCALE = "https://api.tailscale.com/api/v2";

const tailscaleConfig = z.object({
  /** Tailnet name; "-" = the credential's own tailnet. */
  tailnet: z
    .string()
    .trim()
    .max(200)
    .regex(/^(-|[A-Za-z0-9._@-]+)$/, 'The tailnet name, or "-" for the key\'s tailnet')
    .default("-"),
  create: z.enum(["tagged", "none", "all"]).default("tagged"),
});

/**
 * An OAuth client (recommended: does not expire; scope devices:core:read) or
 * an API access token (expires after at most 90 days).
 */
const tailscaleSecret = z.object({
  clientId: z.string().trim().max(200).optional().or(z.literal("")),
  secret: z
    .string()
    .trim()
    .regex(/^tskey-[A-Za-z0-9-]{10,}$/, "Starts with tskey-"),
});

interface ApiDevice {
  id?: string;
  nodeId?: string;
  name?: string;
  hostname?: string;
  addresses?: string[];
  os?: string;
  tags?: string[];
}

export const tailscale: Provider<
  z.infer<typeof tailscaleConfig>,
  z.infer<typeof tailscaleSecret>
> = {
  configSchema: tailscaleConfig,
  secretSchema: tailscaleSecret,
  hint: (s) => last4(s.secret),
  async fetchExport(config, secret, { http }) {
    let bearer = secret.secret;
    if (secret.clientId) {
      const res = await http(`${TAILSCALE}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: secret.clientId,
          client_secret: secret.secret,
        }).toString(),
      });
      const body = parseBody(res, "Tailscale") as { access_token?: unknown };
      if (res.status !== 200 || typeof body.access_token !== "string")
        throw new IntegrationError(
          "Tailscale login failed — check the OAuth client ID and secret.",
        );
      bearer = body.access_token;
    }
    const body = await getJson<{ devices?: ApiDevice[] }>(
      http,
      "Tailscale",
      `${TAILSCALE}/tailnet/${encodeURIComponent(config.tailnet)}/devices`,
      { authorization: `Bearer ${bearer}` },
    );
    const devices: TailnetDevice[] = (body.devices ?? []).slice(0, 2000).flatMap((d) => {
      const id = d.nodeId ?? d.id;
      return id && d.name
        ? [
            {
              id,
              name: d.name,
              hostname: d.hostname,
              addresses: d.addresses ?? [],
              os: d.os,
              tags: d.tags ?? [],
            },
          ]
        : [];
    });
    const doc: TailnetInput = { tailnet: config.tailnet, create: config.create, devices };
    return { format: "tailscale", text: JSON.stringify(doc) };
  },
};
