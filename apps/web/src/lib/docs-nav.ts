// SPDX-License-Identifier: AGPL-3.0-only
import { localePath, type Locale } from "./i18n";

/**
 * Documentation portal (/docs, /es/docs) — navigation manifest. Order here is
 * the order of the sidebar and of "Previous / Next". Each page is
 * apps/web/content/docs/<slug>.md (English) and
 * apps/web/content/docs-es/<slug>.md (Spanish, M14), rendered at build time
 * (lib/docs-render.ts). Both languages share slugs; docs-i18n.test.ts checks
 * that every page exists in both.
 */
export interface DocPage {
  slug: string;
  title: string;
}

export interface DocSection {
  title: string;
  pages: DocPage[];
}

type Titled = { title: string; es: string };

const NAV: (Titled & { pages: (Titled & { slug: string })[] })[] = [
  {
    title: "Getting started",
    es: "Primeros pasos",
    pages: [
      { slug: "getting-started", title: "What is InfraMole", es: "Qué es InfraMole" },
      { slug: "quickstart", title: "Quickstart", es: "Inicio rápido" },
    ],
  },
  {
    title: "Installation guide",
    es: "Guía de instalación",
    pages: [
      { slug: "installation/requirements", title: "Requirements", es: "Requisitos" },
      { slug: "installation/linux", title: "Install on Linux", es: "Instalar en Linux" },
      { slug: "installation/windows", title: "Install on Windows", es: "Instalar en Windows" },
      { slug: "installation/macos", title: "Install on macOS", es: "Instalar en macOS" },
      { slug: "installation/configuration", title: "Configuration", es: "Configuración" },
    ],
  },
  {
    title: "Agent",
    es: "Agente",
    pages: [
      { slug: "agent/overview", title: "How the agent works", es: "Cómo funciona el agente" },
      { slug: "agent/install", title: "Install the agent", es: "Instalar el agente" },
      { slug: "agent/windows-workloads", title: "IIS and SQL Server", es: "IIS y SQL Server" },
      {
        slug: "agent/linux-workloads",
        title: "nginx, Apache, Docker and databases on Linux",
        es: "nginx, Apache, Docker y bases de datos en Linux",
      },
      { slug: "agent/proxmox", title: "Proxmox inventory", es: "Inventario de Proxmox" },
      { slug: "agent/kubernetes", title: "Kubernetes", es: "Kubernetes" },
      {
        slug: "agent/hypervisors",
        title: "vCenter, Hyper-V and XCP-ng",
        es: "vCenter, Hyper-V y XCP-ng",
      },
      { slug: "agent/manage", title: "Manage and remove", es: "Gestionar y desinstalar" },
    ],
  },
  {
    title: "User manual",
    es: "Manual de uso",
    pages: [
      { slug: "manual/library", title: "Library", es: "Library (inventario)" },
      {
        slug: "manual/relationships",
        title: "Relationships and suggestions",
        es: "Relaciones y sugerencias",
      },
      { slug: "manual/map-and-impact", title: "Map and impact", es: "Mapa e impacto" },
      { slug: "manual/changes", title: "Changes", es: "Cambios" },
      { slug: "manual/imports", title: "Import files", es: "Importar ficheros" },
      { slug: "manual/integrations", title: "Integrations", es: "Integraciones" },
      {
        slug: "manual/members-and-security",
        title: "Members and security",
        es: "Miembros y seguridad",
      },
    ],
  },
  {
    title: "Operations",
    es: "Operación",
    pages: [
      { slug: "operations/backups", title: "Backup and restore", es: "Copias de seguridad" },
      { slug: "operations/upgrade", title: "Upgrade guide", es: "Actualizar" },
      {
        slug: "operations/troubleshooting",
        title: "Troubleshooting",
        es: "Solución de problemas",
      },
    ],
  },
  {
    title: "Reference",
    es: "Referencia",
    pages: [
      { slug: "reference/environment", title: "Environment variables", es: "Variables de entorno" },
      { slug: "reference/editions", title: "Editions and limits", es: "Ediciones y límites" },
      {
        slug: "reference/relationship-types",
        title: "Relationship types",
        es: "Tipos de relación",
      },
    ],
  },
];

const pick = (t: Titled, locale: Locale) => (locale === "es" ? t.es : t.title);

export function docsNav(locale: Locale): DocSection[] {
  return NAV.map((s) => ({
    title: pick(s, locale),
    pages: s.pages.map((p) => ({ slug: p.slug, title: pick(p, locale) })),
  }));
}

export function docPages(locale: Locale): (DocPage & { section: string })[] {
  return docsNav(locale).flatMap((s) => s.pages.map((p) => ({ ...p, section: s.title })));
}

/** English navigation — kept for callers that are not language-aware. */
export const DOCS_NAV: DocSection[] = docsNav("en");
export const DOC_PAGES = docPages("en");

export function findDoc(slug: string, locale: Locale = "en") {
  const pages = docPages(locale);
  const i = pages.findIndex((p) => p.slug === slug);
  if (i < 0) return null;
  return { page: pages[i]!, prev: pages[i - 1] ?? null, next: pages[i + 1] ?? null };
}

/** Base URL of the docs in a language: "/docs" or "/es/docs". */
export function docsBase(locale: Locale): string {
  return localePath(locale, "/docs");
}

/** Labels of the docs chrome (sidebar, breadcrumbs, prev/next, copy buttons). */
export const DOCS_UI = {
  en: {
    docs: "Docs",
    menu: "Documentation menu",
    navLabel: "Documentation",
    search: "Search the docs",
    searchLabel: "Search the documentation",
    results: (n: number) => `${n} result${n === 1 ? "" : "s"}`,
    noResults: "No results",
    onThisPage: "On this page",
    prevNext: "Previous and next",
    previous: "Previous",
    next: "Next",
    copy: "Copy",
    copied: "Copied",
    copyFailed: "Select & copy",
    copyLabel: "Copy to clipboard",
    callouts: { note: "Note", tip: "Tip", warning: "Warning" },
  },
  es: {
    docs: "Documentación",
    menu: "Menú de la documentación",
    navLabel: "Documentación",
    search: "Buscar en la documentación",
    searchLabel: "Buscar en la documentación",
    results: (n: number) => `${n} resultado${n === 1 ? "" : "s"}`,
    noResults: "Sin resultados",
    onThisPage: "En esta página",
    prevNext: "Anterior y siguiente",
    previous: "Anterior",
    next: "Siguiente",
    copy: "Copiar",
    copied: "Copiado",
    copyFailed: "Selecciona y copia",
    copyLabel: "Copiar al portapapeles",
    callouts: { note: "Nota", tip: "Consejo", warning: "Atención" },
  },
} satisfies Record<Locale, unknown>;

export type DocsUi = (typeof DOCS_UI)["en"];
