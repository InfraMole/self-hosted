// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { FileUp } from "lucide-react";
import { RELATIONSHIP_TYPE_INFO, type RelationshipType } from "@depmap/graph";
import type { ImportPreview } from "@/app/w/[slug]/library/import/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { RESOURCE_TYPES } from "@/lib/resource-presentation";
import { cn } from "@/lib/utils";
import type { ImportRequest, ImportResult } from "@/server/modules/importers/importers";

const EXAMPLES = {
  csv: `name,type,environment,criticality,ip_addresses,hostname,os,tags,description
APP01,server,production,high,10.0.0.23,app01,Windows Server 2022,iis;web,Main web server
SQL01,server,production,critical,10.0.0.40,sql01,Windows Server 2019,mssql,SQL Server host`,
  relationships: `from,type,to,note
APP01,uses database,SQL01,Orders database`,
  json: `{
  "resources": [
    { "id": "api", "name": "CustomerAPI", "type": "api", "environment": "prod" },
    { "id": "db", "name": "CustomersDB", "type": "database", "ipAddresses": ["10.0.0.41"] }
  ],
  "relationships": [
    { "from": "api", "type": "USES_DATABASE", "to": "db" }
  ]
}`,
  compose: `services:
  web:
    image: nginx:1.27
    ports: ["8080:80"]
    depends_on: [api]
  api:
    image: shop/api:2.1
    depends_on: [db]
  db:
    image: postgres:17`,
};

const PLATFORM_COMMANDS = [
  ["Proxmox VE", "pvesh get /cluster/resources --output-format json > proxmox.json"],
  ["Azure", "az vm list -d --output json > azure-vms.json"],
  ["AWS EC2", "aws ec2 describe-instances --output json > ec2.json"],
  ["AWS RDS", "aws rds describe-db-instances --output json > rds.json"],
] as const;

const ACTION_STYLE = {
  create: "border-success/50 text-success",
  update: "border-warning/50 text-warning",
  unchanged: "border-border text-subtle",
  exists: "border-border text-subtle",
} as const;

interface Props {
  slug: string;
  preview: (req: ImportRequest) => Promise<{ preview?: ImportPreview; error?: string }>;
  apply: (req: ImportRequest) => Promise<{ result?: ImportResult; error?: string }>;
}

export function ImportForm({ slug, preview: previewAction, apply: applyAction }: Props) {
  const [text, setText] = useState("");
  const [format, setFormat] = useState<
    "auto" | "csv" | "json" | "docker-compose" | "proxmox" | "azure" | "aws"
  >("auto");
  const [project, setProject] = useState("");
  const [asSuggestions, setAsSuggestions] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const request = (): ImportRequest => ({
    text,
    format,
    project: project || undefined,
    relationshipsAsSuggestions: asSuggestions,
  });
  const reset = () => {
    setPreview(null);
    setResult(null);
    setError(null);
  };

  const canImport =
    preview &&
    preview.errors.length === 0 &&
    preview.counts.create + preview.counts.update + preview.counts.relationships > 0;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="format">Format</Label>
            <Select
              id="format"
              value={format}
              onChange={(e) => {
                setFormat(e.target.value as typeof format);
                reset();
              }}
              className="w-44"
            >
              <option value="auto">Detect automatically</option>
              <option value="csv">CSV</option>
              <option value="json">JSON</option>
              <option value="docker-compose">Docker Compose</option>
              <option value="proxmox">Proxmox export</option>
              <option value="azure">Azure export</option>
              <option value="aws">AWS export</option>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="project">Compose project</Label>
            <Input
              id="project"
              value={project}
              onChange={(e) => {
                setProject(e.target.value);
                reset();
              }}
              placeholder="compose"
              className="w-40"
            />
          </div>
          <label className="text-muted flex h-8 items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={asSuggestions}
              onChange={(e) => {
                setAsSuggestions(e.target.checked);
                reset();
              }}
              className="accent-accent"
            />
            Import CSV/JSON relationships as suggestions to review
          </label>
          <label className="border-border-strong text-muted hover:text-foreground ml-auto inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border px-3 text-xs">
            <FileUp className="size-3.5" /> Upload file
            <input
              type="file"
              accept=".csv,.json,.yml,.yaml,.txt"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > 1024 * 1024) {
                  setError("File is larger than 1 MB.");
                  return;
                }
                setText(await file.text());
                reset();
              }}
            />
          </label>
        </div>

        <Textarea
          aria-label="Data to import"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            reset();
          }}
          rows={14}
          spellCheck={false}
          placeholder="Paste CSV, JSON or a docker-compose.yml here…"
          className="font-mono text-xs leading-relaxed"
        />

        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            disabled={pending || !text.trim()}
            onClick={() =>
              startTransition(async () => {
                reset();
                const res = await previewAction(request());
                if (res.error) setError(res.error);
                else setPreview(res.preview ?? null);
              })
            }
          >
            Preview
          </Button>
          <Button
            disabled={pending || !canImport}
            onClick={() =>
              startTransition(async () => {
                const res = await applyAction(request());
                if (res.error) setError(res.error);
                else {
                  setResult(res.result ?? null);
                  setPreview(null);
                }
              })
            }
          >
            {pending ? "Working…" : "Import"}
          </Button>
          {error && (
            <p role="alert" className="text-danger text-xs">
              {error}
            </p>
          )}
        </div>

        {result && (
          <div
            role="status"
            className="border-success/40 bg-surface rounded-lg border px-4 py-3 text-sm"
          >
            Imported from <span className="font-mono">{result.format}</span>: {result.created}{" "}
            created, {result.updated} updated, {result.unchanged} unchanged, {result.relationships}{" "}
            relationships
            {result.suggestions > 0 && ` (${result.suggestions} as suggestions)`}.
            <div className="mt-2 flex gap-3 text-xs">
              <Link href={`/w/${slug}/library`} className="text-accent hover:underline">
                Go to Library
              </Link>
              {result.suggestions > 0 && (
                <Link href={`/w/${slug}/suggestions`} className="text-accent hover:underline">
                  Review suggestions
                </Link>
              )}
              <Link
                href={`/w/${slug}/changes?actor=import`}
                className="text-accent hover:underline"
              >
                See changes
              </Link>
            </div>
          </div>
        )}

        {preview && <PreviewPanel preview={preview} />}
      </div>

      <aside className="text-muted flex flex-col gap-4 text-xs">
        <p className="text-foreground text-sm font-medium">Platform exports</p>
        <p>
          Run the command where your credentials already live and upload the JSON — InfraMole never
          sees a token. Placement (node hosts VM) is imported as confirmed; resources arrive as{" "}
          <em>Discovered</em>.
        </p>
        {PLATFORM_COMMANDS.map(([label, command]) => (
          <div key={label}>
            <span className="text-foreground">{label}</span>
            <pre className="border-border bg-surface mt-1 overflow-x-auto rounded-md border px-2 py-1.5 font-mono text-[10px] leading-relaxed whitespace-pre">
              {command}
            </pre>
          </div>
        ))}
        <p className="text-foreground mt-2 text-sm font-medium">Formats</p>
        <p>
          Re-importing is safe: rows are matched by <code className="font-mono">id</code> (or name +
          type) and only the columns you provide are updated — notes and other human context are
          never cleared. Relationships from files you write are confirmed; docker-compose{" "}
          <code className="font-mono">depends_on</code> becomes suggestions.
        </p>
        {(
          [
            ["Resources CSV", "csv"],
            ["Relationships CSV", "relationships"],
            ["JSON", "json"],
            ["Docker Compose", "compose"],
          ] as const
        ).map(([label, key]) => (
          <div key={key}>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-foreground">{label}</span>
              <button
                type="button"
                className="text-accent hover:underline"
                onClick={() => {
                  setText(EXAMPLES[key]);
                  setFormat("auto");
                  reset();
                }}
              >
                Use example
              </button>
            </div>
            <pre className="border-border bg-surface overflow-x-auto rounded-md border px-2 py-1.5 font-mono text-[10px] leading-relaxed whitespace-pre">
              {EXAMPLES[key].split("\n").slice(0, 3).join("\n")}
              {EXAMPLES[key].split("\n").length > 3 ? "\n…" : ""}
            </pre>
          </div>
        ))}
      </aside>
    </div>
  );
}

function PreviewPanel({ preview }: { preview: ImportPreview }) {
  const c = preview.counts;
  return (
    <section className="flex flex-col gap-3" aria-label="Preview">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted">
          Detected <span className="text-foreground font-mono">{preview.format}</span>:
        </span>
        <Badge className={ACTION_STYLE.create}>{c.create} new</Badge>
        <Badge className={ACTION_STYLE.update}>{c.update} to update</Badge>
        <Badge className={ACTION_STYLE.unchanged}>{c.unchanged} unchanged</Badge>
        <Badge className={ACTION_STYLE.create}>{c.relationships} relationships</Badge>
      </div>

      {preview.errors.length > 0 && (
        <ul className="border-danger/40 rounded-lg border px-4 py-2 text-xs">
          <li className="text-danger mb-1 font-medium">
            {preview.errors.length} error(s) — nothing will be imported until they are fixed
          </li>
          {preview.errors.map((e, i) => (
            <li key={i} className="text-muted font-mono">
              {e.row > 0 ? `row ${e.row}: ` : ""}
              {e.message}
            </li>
          ))}
        </ul>
      )}
      {preview.warnings.length > 0 && (
        <ul className="text-warning text-xs">
          {preview.warnings.map((w, i) => (
            <li key={i}>⚠ {w}</li>
          ))}
        </ul>
      )}

      {preview.resources.length > 0 && (
        <div className="border-border overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-border text-subtle border-b text-left text-[11px] tracking-wider uppercase">
                <th className="px-3 py-2 font-medium">Row</th>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {preview.resources.map((r) => (
                <tr key={r.row}>
                  <td className="text-subtle px-3 py-1.5 font-mono text-xs">{r.row}</td>
                  <td className="px-3 py-1.5 font-mono text-[13px]">{r.name}</td>
                  <td className="text-muted px-3 py-1.5 text-xs">
                    {RESOURCE_TYPES[r.type as keyof typeof RESOURCE_TYPES]?.label ?? r.type}
                  </td>
                  <td className="px-3 py-1.5 text-xs">
                    <Badge className={ACTION_STYLE[r.action]}>{r.action}</Badge>
                    {r.action === "update" && (
                      <span className="text-muted ml-2 font-mono">{r.changes.join(", ")}</span>
                    )}
                    {r.matchedBy === "name" && (
                      <span className="text-subtle ml-2">matched existing by name</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {preview.relationships.length > 0 && (
        <ul className="border-border divide-border divide-y rounded-lg border text-sm">
          {preview.relationships.map((r) => (
            <li key={`${r.row}-${r.from}-${r.to}`} className="flex items-center gap-2 px-3 py-1.5">
              <span className="font-mono text-[13px]">{r.from}</span>
              <span className="text-accent text-xs">
                {RELATIONSHIP_TYPE_INFO[r.type as RelationshipType]?.label ?? r.type}
              </span>
              <span className="font-mono text-[13px]">{r.to}</span>
              <Badge className={cn("ml-auto", ACTION_STYLE[r.action])}>
                {r.action === "exists" ? "already exists" : "new"}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
