// SPDX-License-Identifier: AGPL-3.0-only
import { SiteFooter, SiteHeader } from "@/components/landing/landing";
import { SAMPLE_REPORT } from "@/lib/agent-sample";
import type { Locale } from "@/lib/i18n";

// Honesty about data collection (docs/AGENT.md §3). Both languages must say
// exactly the same thing: when the agent changes, change both.
const copy = {
  en: {
    eyebrow: "transparency",
    title: "What the agent collects",
    intro: [
      "is a single, signed, read-only binary for Windows and Linux. Every five minutes it sends one small report over HTTPS. It has",
      "no command channel",
      ": the server can only answer with its reporting settings, never tell it to run anything.",
    ],
    dryRun:
      "See for yourself before installing anything — this prints the exact report and sends nothing:",
    collectedTitle: "Collected, and why",
    dataHeader: "Data",
    whyHeader: "Why",
    collected: [
      {
        data: "Hostname, FQDN, OS name and version, kernel, architecture, boot time",
        why: "Identify the machine and show what it is.",
      },
      {
        data: "Machine ID (only when enrolling)",
        why: "Recognise the same machine after a reinstall of the agent, instead of creating a duplicate.",
      },
      {
        data: "Network interfaces: name, MAC, IP addresses (loopback skipped)",
        why: "Match connections from other hosts to this one.",
      },
      {
        data: "Running services: name, display name, state, start type",
        why: "Show what runs on the host (IIS, SQL Server, nginx…).",
      },
      {
        data: "Listening TCP ports and the owning process name / path",
        why: "Know what the host offers to others.",
      },
      {
        data: "Established TCP connections, aggregated per peer, port and process — counts and first/last seen",
        why: "Suggest who depends on whom. Shown as “detected”, never as confirmed.",
      },
      {
        data: "Windows: IIS site names and their bindings (protocol, port, host name) — hourly",
        why: "Show the sites that run on the server, and point connections to the right one.",
      },
      {
        data: "Windows, only if you turn it on: SQL Server database names (system databases excluded) — hourly",
        why: "Show the databases that live on the server, so impact can name them.",
      },
      {
        data: "Linux: nginx and Apache site names and ports; only if you turn them on, PostgreSQL and MySQL / MariaDB database names — hourly",
        why: "The same, for Linux servers.",
      },
      {
        data: "Reverse-proxy targets of those sites (nginx, Apache, HAProxy, IIS ARR): host and port only — hourly",
        why: "Suggest which application each site forwards to.",
      },
      {
        data: "Linux with Docker: container names, images, state, published ports and Compose project / service / depends_on — hourly",
        why: "Show what runs in containers (databases, proxies, apps) and how they depend on each other.",
      },
    ],
    neverTitle: "Never collected",
    never: [
      "Passwords, credentials or tokens",
      "File contents or user documents",
      "Process command lines or arguments",
      "Environment variables",
      "Browser data",
      "Logged-in users",
      "Packet contents — only which peer and port, never the data",
    ],
    enforced:
      "Enforced twice: the agent's data structures have no fields for any of this, and the server rejects any report with a field it does not expect.",
    sampleTitle: "A real report",
    sampleNote:
      "Shortened to one item per list. This sample is checked against the live protocol schema in our test suite.",
    goodTitle: "Good to know",
    good: [
      {
        strong: "Aggregated, not recorded.",
        rest: "Connections are sampled every 30 seconds and summarised per peer, port and process. Loopback, link-local and multicast traffic is ignored. Raw reports are kept for 7 days.",
      },
      {
        strong: "Permissions.",
        rest: "It runs as a service (LocalSystem or root) so it can see which process owns a port. Without admin rights it still works, with fewer process names.",
      },
      {
        strong: "Web servers and databases.",
        rest: "Sites come from the web server's own configuration (IIS, nginx, Apache); paths, certificates, keys and any stored credentials are never read. Databases (SQL Server, PostgreSQL, MySQL / MariaDB) are off until you enable them on the host: the agent then logs in locally with its own service identity — no password is ever stored — and runs a single query for database names.",
      },
      {
        strong: "Optional Proxmox inventory.",
        rest: "Only if you enable it on the host, with a read-only token that never leaves the machine: node, VM and container names, ids, status and memory size. Nothing else from the API is kept.",
      },
      {
        strong: "Containers, hypervisors and Kubernetes.",
        rest: "Docker is read from the container list only — never inspected, so environment variables are never read. vCenter, Hyper-V, Xen Orchestra and Kubernetes collectors are off until you enable them on the host, with read-only accounts whose credentials never leave the machine; they send names, placement, size and IPs, never secrets, config maps or environment variables.",
      },
      {
        strong: "Verifiable.",
        rest: "Releases are signed and published with SHA-256 checksums; the install commands verify them before running.",
      },
    ],
    update: [
      "Updates only if you allow it.",
      "Self-update is off unless you turn it on in the agent's own configuration. It then installs only releases signed with the InfraMole key built into the agent, never an older version, and the InfraMole server can never trigger it.",
    ],
    remove: [
      "Easy to remove.",
      "stops the service and deletes its configuration. Revoking the agent in InfraMole rejects its reports immediately.",
    ],
  },
  es: {
    eyebrow: "transparencia",
    title: "Qué recoge el agente",
    intro: [
      "es un único binario firmado y de solo lectura para Windows y Linux. Cada cinco minutos envía un pequeño informe por HTTPS. No tiene",
      "canal de órdenes",
      ": el servidor solo puede responder con su configuración de envío, nunca pedirle que ejecute nada.",
    ],
    dryRun:
      "Compruébalo tú mismo antes de instalar nada — esto muestra el informe exacto y no envía nada:",
    collectedTitle: "Qué recoge, y para qué",
    dataHeader: "Dato",
    whyHeader: "Para qué",
    collected: [
      {
        data: "Nombre del equipo, FQDN, nombre y versión del sistema operativo, kernel, arquitectura, hora de arranque",
        why: "Identificar la máquina y mostrar qué es.",
      },
      {
        data: "Identificador de la máquina (solo al registrarse)",
        why: "Reconocer la misma máquina tras reinstalar el agente, en lugar de crear un duplicado.",
      },
      {
        data: "Interfaces de red: nombre, MAC, direcciones IP (sin loopback)",
        why: "Relacionar las conexiones de otros equipos con este.",
      },
      {
        data: "Servicios en ejecución: nombre, nombre visible, estado, tipo de inicio",
        why: "Mostrar qué se ejecuta en el equipo (IIS, SQL Server, nginx…).",
      },
      {
        data: "Puertos TCP en escucha y el nombre / ruta del proceso propietario",
        why: "Saber qué ofrece el equipo a los demás.",
      },
      {
        data: "Conexiones TCP establecidas, agregadas por destino, puerto y proceso — recuentos y primera/última vez vistas",
        why: "Sugerir quién depende de quién. Se muestran como «detectadas», nunca como confirmadas.",
      },
      {
        data: "Windows: nombres de los sitios de IIS y sus enlaces (protocolo, puerto, nombre de host) — cada hora",
        why: "Mostrar los sitios que se ejecutan en el servidor y dirigir las conexiones al correcto.",
      },
      {
        data: "Windows, solo si lo activas: nombres de las bases de datos de SQL Server (sin las de sistema) — cada hora",
        why: "Mostrar las bases de datos que viven en el servidor, para que el impacto pueda nombrarlas.",
      },
      {
        data: "Linux: nombres y puertos de los sitios de nginx y Apache; solo si lo activas, nombres de las bases de datos de PostgreSQL y MySQL / MariaDB — cada hora",
        why: "Lo mismo, en servidores Linux.",
      },
      {
        data: "Destinos de proxy inverso de esos sitios (nginx, Apache, HAProxy, ARR de IIS): solo host y puerto — cada hora",
        why: "Sugerir a qué aplicación reenvía cada sitio.",
      },
      {
        data: "Linux con Docker: nombres de contenedores, imágenes, estado, puertos publicados y proyecto / servicio / depends_on de Compose — cada hora",
        why: "Mostrar qué se ejecuta en contenedores (bases de datos, proxies, aplicaciones) y cómo dependen entre sí.",
      },
    ],
    neverTitle: "Nunca se recoge",
    never: [
      "Contraseñas, credenciales o tokens",
      "Contenido de ficheros o documentos de usuario",
      "Líneas de comandos o argumentos de los procesos",
      "Variables de entorno",
      "Datos del navegador",
      "Usuarios con sesión iniciada",
      "Contenido de los paquetes — solo con qué equipo y puerto, nunca los datos",
    ],
    enforced:
      "Garantizado dos veces: las estructuras de datos del agente no tienen campos para nada de esto, y el servidor rechaza cualquier informe con un campo que no espera.",
    sampleTitle: "Un informe real",
    sampleNote:
      "Recortado a un elemento por lista. Este ejemplo se valida contra el esquema real del protocolo en nuestros tests.",
    goodTitle: "Conviene saber",
    good: [
      {
        strong: "Agregado, no grabado.",
        rest: "Las conexiones se muestrean cada 30 segundos y se resumen por destino, puerto y proceso. Se ignora el tráfico loopback, link-local y multicast. Los informes en bruto se guardan 7 días.",
      },
      {
        strong: "Permisos.",
        rest: "Se ejecuta como servicio (LocalSystem o root) para poder ver qué proceso usa cada puerto. Sin permisos de administrador sigue funcionando, con menos nombres de proceso.",
      },
      {
        strong: "Servidores web y bases de datos.",
        rest: "Los sitios se leen de la propia configuración del servidor web (IIS, nginx, Apache); nunca se leen rutas, certificados, claves ni credenciales guardadas. Las bases de datos (SQL Server, PostgreSQL, MySQL / MariaDB) están desactivadas hasta que las actives en el equipo: entonces el agente inicia sesión localmente con la identidad de su propio servicio — nunca se guarda una contraseña — y ejecuta una única consulta con los nombres de las bases de datos.",
      },
      {
        strong: "Inventario de Proxmox opcional.",
        rest: "Solo si lo activas en el equipo, con un token de solo lectura que nunca sale de la máquina: nombres de nodos, máquinas virtuales y contenedores, identificadores, estado y memoria. No se guarda nada más de la API.",
      },
      {
        strong: "Contenedores, hipervisores y Kubernetes.",
        rest: "Docker se lee solo de la lista de contenedores — nunca se inspeccionan, así que las variables de entorno nunca se leen. Los colectores de vCenter, Hyper-V, Xen Orchestra y Kubernetes están desactivados hasta que los actives en el equipo, con cuentas de solo lectura cuyas credenciales nunca salen de la máquina; envían nombres, ubicación, tamaño e IP, nunca secretos, config maps ni variables de entorno.",
      },
      {
        strong: "Verificable.",
        rest: "Las versiones se firman y se publican con sumas SHA-256; los comandos de instalación las comprueban antes de ejecutar nada.",
      },
    ],
    update: [
      "Solo se actualiza si lo permites.",
      "La actualización automática está desactivada salvo que la actives en la propia configuración del agente. Entonces solo instala versiones firmadas con la clave de InfraMole que lleva el agente, nunca una anterior, y el servidor InfraMole nunca puede provocarla.",
    ],
    remove: [
      "Fácil de quitar.",
      "detiene el servicio y borra su configuración. Revocar el agente en InfraMole rechaza sus informes al instante.",
    ],
  },
} satisfies Record<Locale, unknown>;

/** Public "What the agent collects" page (/agent and /es/agent). */
export function AgentPage({ locale }: { locale: Locale }) {
  const t = copy[locale];
  return (
    <div className="light flex min-h-full flex-1 flex-col" lang={locale}>
      <SiteHeader locale={locale} />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-14 sm:px-6">
        <p className="text-accent font-mono text-xs tracking-wide">{t.eyebrow}</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{t.title}</h1>
        <p className="text-muted mt-4 max-w-2xl text-base leading-relaxed">
          <span className="font-mono text-[0.95em]">inframole-agent</span> {t.intro[0]}{" "}
          <strong className="text-foreground">{t.intro[1]}</strong>
          {t.intro[2]}
        </p>
        <div className="border-border bg-surface mt-6 rounded-lg border p-4 text-sm">
          {t.dryRun}
          <pre className="bg-surface-2 mt-3 overflow-x-auto rounded-md px-3 py-2 font-mono text-[13px]">
            inframole-agent dry-run
          </pre>
        </div>

        <h2 className="mt-14 text-xl font-semibold">{t.collectedTitle}</h2>
        <div className="border-border mt-4 overflow-hidden rounded-lg border">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-2 text-muted text-xs">
              <tr>
                <th className="px-4 py-2 font-medium">{t.dataHeader}</th>
                <th className="px-4 py-2 font-medium">{t.whyHeader}</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {t.collected.map((c) => (
                <tr key={c.data} className="align-top">
                  <td className="px-4 py-3">{c.data}</td>
                  <td className="text-muted px-4 py-3">{c.why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2 className="mt-14 text-xl font-semibold">{t.neverTitle}</h2>
        <ul className="text-muted mt-4 grid gap-2 text-sm sm:grid-cols-2">
          {t.never.map((n) => (
            <li key={n} className="flex gap-2">
              <span className="bg-danger mt-2 size-1.5 shrink-0 rounded-full" aria-hidden />
              {n}
            </li>
          ))}
        </ul>
        <p className="text-muted mt-4 max-w-2xl text-sm leading-relaxed">{t.enforced}</p>

        <h2 className="mt-14 text-xl font-semibold">{t.sampleTitle}</h2>
        <p className="text-muted mt-2 text-sm">{t.sampleNote}</p>
        <pre className="border-border bg-surface mt-4 max-h-[520px] overflow-auto rounded-lg border p-4 font-mono text-[12.5px] leading-relaxed">
          {JSON.stringify(SAMPLE_REPORT, null, 2)}
        </pre>

        <h2 className="mt-14 text-xl font-semibold">{t.goodTitle}</h2>
        <ul className="text-muted mt-4 space-y-3 text-sm leading-relaxed">
          {t.good.map((g) => (
            <li key={g.strong}>
              <strong className="text-foreground">{g.strong}</strong> {g.rest}
            </li>
          ))}
          <li>
            <strong className="text-foreground">{t.update[0]}</strong> {t.update[1]}
          </li>
          <li>
            <strong className="text-foreground">{t.remove[0]}</strong>{" "}
            <span className="font-mono text-[0.95em]">inframole-agent uninstall</span> {t.remove[1]}
          </li>
        </ul>
      </main>
      <SiteFooter locale={locale} />
    </div>
  );
}
