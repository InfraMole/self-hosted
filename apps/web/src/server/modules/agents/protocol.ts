// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Agent wire protocol v1 — the SOURCE OF TRUTH for the Go agent's payloads
 * (docs/AGENT.md §5, ADR-004). Pure zod: exported as JSON Schema to
 * agent/contract/report.v1.schema.json and checked against the Go golden file.
 *
 * Objects are .strict(): unknown fields are rejected, so an agent can never
 * smuggle extra data (e.g. process command lines) into storage.
 */
import { z } from "zod";

export const PROTOCOL_VERSION = 1;

export const AGENT_LIMITS = {
  enrollBodyBytes: 8 * 1024,
  reportBodyBytes: 1024 * 1024,
  interfaces: 64,
  addressesPerInterface: 32,
  services: 1000,
  listeners: 500,
  connections: 2000,
  inventoryItems: 2000,
} as const;

export const REPORT_INTERVAL = { min: 60, max: 3600, default: 300 } as const;
export const SAMPLE_INTERVAL_SEC = 30;

const text = (max: number) => z.string().max(max);
const port = z.number().int().min(0).max(65535);
const datetime = z.iso.datetime({ offset: true });
const agentOs = z.enum(["windows", "linux"]);

export const enrollRequestSchema = z
  .object({
    enrollmentToken: text(128),
    /** Stable machine identifier (MachineGuid / /etc/machine-id). */
    machineId: text(128).min(8),
    hostname: text(253).min(1),
    os: agentOs,
    osVersion: text(128),
    arch: text(32),
    agentVersion: text(32),
  })
  .strict();
export type EnrollRequest = z.infer<typeof enrollRequestSchema>;

const processRef = z
  .object({
    name: text(256),
    path: text(1024).optional(),
    pid: z.number().int().nonnegative().optional(),
  })
  .strict();

export const reportSchemaV1 = z
  .object({
    schemaVersion: z.literal(1),
    agentVersion: text(32),
    collectedAt: datetime,
    /** Start of the sampling window aggregated in `connections`. */
    windowStart: datetime,
    host: z
      .object({
        hostname: text(253).min(1),
        fqdn: text(253).optional(),
        os: agentOs,
        osName: text(128),
        osVersion: text(128),
        kernelVersion: text(128).optional(),
        arch: text(32),
        bootTime: datetime.optional(),
      })
      .strict(),
    interfaces: z
      .array(
        z
          .object({
            name: text(128),
            mac: text(32).optional(),
            /** CIDR notation, e.g. "10.0.0.23/24". */
            addresses: z.array(text(64)).max(AGENT_LIMITS.addressesPerInterface),
          })
          .strict(),
      )
      .max(AGENT_LIMITS.interfaces),
    services: z
      .array(
        z
          .object({
            name: text(256),
            displayName: text(256).optional(),
            state: text(32),
            startType: text(32).optional(),
          })
          .strict(),
      )
      .max(AGENT_LIMITS.services),
    listeners: z
      .array(
        z
          .object({
            proto: z.enum(["tcp", "tcp6"]),
            address: text(64),
            port,
            process: processRef.optional(),
          })
          .strict(),
      )
      .max(AGENT_LIMITS.listeners),
    connections: z
      .array(
        z
          .object({
            proto: z.enum(["tcp", "tcp6"]),
            direction: z.enum(["inbound", "outbound"]),
            /** Local listening port for inbound; 0 for outbound (ephemeral). */
            localPort: port,
            remoteAddress: text(64),
            /** Remote port for outbound; 0 for inbound (ephemeral). */
            remotePort: port,
            process: processRef.optional(),
            /** Number of samples in which the connection was seen. */
            count: z.number().int().min(1).max(1_000_000),
            firstSeen: datetime,
            lastSeen: datetime,
          })
          .strict(),
      )
      .max(AGENT_LIMITS.connections),
    /** Set when the agent had to drop items to respect the limits above. */
    truncated: z.boolean().optional(),
    /**
     * Optional platform inventory from an agent-side collector (ADR-018 C),
     * configured only in the agent's local config. Only the fields the
     * importer uses are accepted; the server feeds them to the importer.
     */
    inventory: z
      .object({
        source: z.literal("proxmox"),
        collectedAt: datetime,
        items: z
          .array(
            z
              .object({
                id: text(64).min(1),
                type: z.enum(["node", "qemu", "lxc"]),
                node: text(64).optional(),
                name: text(253).optional(),
                vmid: z.number().int().nonnegative().optional(),
                status: text(32).optional(),
                maxmem: z.number().nonnegative().optional(),
                template: z.number().int().min(0).max(1).optional(),
              })
              .strict(),
          )
          .max(AGENT_LIMITS.inventoryItems),
      })
      .strict()
      .optional(),
  })
  .strict();
export type ReportV1 = z.infer<typeof reportSchemaV1>;

export interface AgentConfig {
  reportIntervalSec: number;
  sampleIntervalSec: number;
}

export function agentConfig(reportIntervalSec: number): AgentConfig {
  const clamped = Math.min(
    REPORT_INTERVAL.max,
    Math.max(REPORT_INTERVAL.min, Math.round(reportIntervalSec)),
  );
  return { reportIntervalSec: clamped, sampleIntervalSec: SAMPLE_INTERVAL_SEC };
}

/** Short, non-echoing description of validation issues for 422 responses. */
export function describeIssues(error: z.ZodError, max = 5): string[] {
  return error.issues.slice(0, max).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
}
