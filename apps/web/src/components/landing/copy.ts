// SPDX-License-Identifier: AGPL-3.0-only
import type { Locale } from "@/lib/i18n";

/**
 * Copy of the public website (landing, header, footer) per language (M14,
 * ADR-026). `es` is typed as `typeof en`, so a missing or extra string is a
 * type error. Copy rules (docs/UI.md) apply in every language: "could be
 * affected" / "podría verse afectado", never "will break".
 */
const en = {
  nav: {
    home: "InfraMole home",
    how: "How it works",
    map: "The map",
    security: "Security",
    faq: "FAQ",
    pricing: "Pricing",
    docs: "Docs",
    signIn: "Sign in",
    getStarted: "Get started",
  },
  hero: {
    eyebrow: "infrastructure dependency mapping",
    title: ["See what depends", "on what."],
    lead: "digs through your servers, apps, databases and domains, maps how they connect, and shows what could be affected before you change or switch off anything. Lightweight and read-only — for small IT teams, MSPs and homelabs.",
    startTrial: "Start free trial",
    installFree: "Install free",
    backToDemo: "Back to the demo",
    tryDemo: "Try the demo",
    howItWorks: "How it works",
    trialNote: (days: number) =>
      `${days}-day free trial. No card needed. Or self-host Community — free and open source.`,
    freeNote:
      "Free and open source (AGPLv3). Up and running on your own server in about ten minutes.",
    sourceCode: "Source code on GitHub",
  },
  miniMap: {
    label: "Example map: domains, applications, databases and servers",
    ifFails: (name: string, n: number) =>
      n === 0
        ? `If ${name} fails, nothing recorded depends on it`
        : `If ${name} fails, ${n} could be affected`,
    hint: "Click any resource",
    select: (name: string) => `Show what could be affected if ${name} fails`,
    nothing: "Nothing recorded depends on it.",
    note: "Detected and inferred links stay suggestions until someone on your team confirms them.",
    confidence: { confirmed: "Confirmed", detected: "Detected", inferred: "Inferred" },
    kinds: {
      domain: "domain",
      app: "application",
      database: "database",
      server: "server",
      hypervisor: "hypervisor",
      vm: "virtual machine",
      lb: "load balancer",
    },
    layers: ["Entry points", "Load balancing", "Servers and hosts"],
    illustrationLabel:
      "Illustration of the map: domains on top, a load balancer below them, and at the bottom a server box with its applications and a hypervisor box holding a virtual machine with its databases.",
  },
  map: {
    eyebrow: "The map",
    title: "Your infrastructure, drawn for you — and readable",
    body: "Nobody draws anything. The map is built from what InfraMole knows, in layers you can read at a glance.",
    points: [
      {
        title: "In layers",
        body: "Entry points and domains on top, then applications and data, then servers and hosts.",
      },
      {
        title: "Servers as boxes",
        body: "What runs on a server or hypervisor is drawn inside it. Collapse a box to see the big picture.",
      },
      {
        title: "Ask “what if?”",
        body: "Pick any resource and see what could be affected if it fails, with how sure each link is.",
      },
      {
        title: "Save and share",
        body: "Save views with their filters and positions, share them by link, export PNG or PDF.",
      },
    ],
  },
  sources: {
    eyebrow: "What it discovers",
    title: "Start with what you already have",
    groups: [
      {
        title: "The agent",
        note: "Windows and Linux · read-only · outbound HTTPS only",
        items: [
          "Hosts, services, listening ports and the connections between them",
          "IIS sites and SQL Server databases",
          "nginx and Apache sites, PostgreSQL and MySQL databases",
          "Docker containers and Compose projects",
          "Reverse-proxy targets: nginx, Apache, HAProxy, Traefik, IIS",
          "Kubernetes nodes and workloads",
        ],
      },
      {
        title: "Integrations",
        note: "Read-only tokens, encrypted at rest",
        items: [
          "Azure: virtual machines",
          "AWS: EC2 instances and RDS databases",
          "Cloudflare: DNS records and what they point to",
          "NetBox and Zabbix: start from the inventory you already keep",
        ],
      },
      {
        title: "Files",
        note: "Reviewed before anything is saved",
        items: [
          "CSV or JSON from your spreadsheet or another tool",
          "docker-compose files",
          "Proxmox, Azure, AWS and Cloudflare exports",
        ],
      },
    ],
    more: "More clouds, load balancers, DNS providers, hypervisors, NAS and PRTG are in preview",
    moreLink: "See all integrations →",
  },
  useCases: {
    eyebrow: "When it helps",
    title: "For the moments you need to know what depends on what",
    items: [
      {
        title: "Before a change",
        body: "Patching SQL01 tonight? See what could be affected — and who to warn — before, not after.",
      },
      {
        title: "During an outage",
        body: "Something is down. See what else depends on it, and how sure each link is, in seconds.",
      },
      {
        title: "Taking over a network",
        body: "A new client or a network nobody documented: install the agent and have a map the same day.",
      },
      {
        title: "Your homelab",
        body: "Proxmox, Docker and a NAS: finally a picture of what runs where — self-hosted and free.",
      },
    ],
  },
  faq: {
    eyebrow: "Questions",
    title: "Frequently asked",
    items: [
      {
        q: "Is it a monitoring tool?",
        a: "No. There are no alerts, metrics or uptime checks. InfraMole maps what you have and what depends on what — use it next to your monitoring, not instead of it.",
      },
      {
        q: "What does the agent send, and can it run commands?",
        a: "Host facts, services, listening ports and aggregated connections, plus the workloads listed above. Never passwords, file contents, command lines or environment variables. It has no command channel, and `inframole-agent dry-run` prints exactly what it would send.",
      },
      {
        q: "Does it need inbound ports or a VPN?",
        a: "No. The agent only makes outbound HTTPS requests to your InfraMole server.",
      },
      {
        q: "Where is my data?",
        a: "On your server. Self-hosted InfraMole sends nothing to us — no telemetry, no licence check. It only talks to the providers you connect and your mail server.",
      },
      {
        q: "How many servers can I map?",
        a: "Community has no limit on servers or VMs — one workspace per installation. A small server (2 GB RAM) is enough for about a hundred servers.",
      },
      {
        q: "What does it run on?",
        a: "Docker Compose on Linux (recommended), or Docker Desktop on Windows and macOS for a trial — x86-64 or ARM64. Setup takes about ten minutes.",
      },
      {
        q: "What is the licence?",
        a: "AGPL-3.0: free to use, study and modify. Organisations that cannot accept the AGPL can get a commercial licence.",
      },
    ],
  },
  how: {
    eyebrow: "Install → Discover → Understand",
    title: "A map that builds itself, and people who make it true",
    steps: [
      {
        title: "Install",
        body: "Run one small read-only agent per server — a single signed binary for Windows or Linux. Or bring what you already have: Azure, AWS, Cloudflare, Proxmox, Docker Compose or a CSV.",
      },
      {
        title: "Discover",
        body: "Hosts, services and the connections between them are observed and turned into suggestions — each one says where it came from and how sure we are.",
      },
      {
        title: "Understand",
        body: "Your team confirms what matters and adds the context only people know. Then open the map, or ask what could be affected before a change or during an outage.",
      },
    ],
  },
  honesty: {
    eyebrow: "Honest by design",
    title: "Suggestions, never guesses dressed up as facts",
    body: "Every relationship carries its confidence, everywhere: on the map, in lists and in impact results. You decide what is true; InfraMole keeps track of what changed and when.",
    not: [
      { strong: "Not monitoring.", rest: "No alerts, no dashboards to stare at." },
      { strong: "Not a CMDB.", rest: "No forms to fill in before you get value." },
      { strong: "Never remote control.", rest: "It cannot run anything on your machines." },
    ],
    confidence: {
      confirmed: {
        label: "Confirmed",
        body: "A person on your team said so. Only confirmed dependencies are presented as dependencies.",
      },
      detected: {
        label: "Detected",
        body: "Observed by an agent or an integration — for example, a live connection to port 1433.",
      },
      inferred: {
        label: "Inferred",
        body: "A reasonable guess from names or placement. Shown faintly, and never counted as fact.",
      },
    },
  },
  security: {
    eyebrow: "Security",
    title: "Built to be trusted with a map of your infrastructure",
    items: {
      readOnly: {
        title: "Read-only agent",
        body: "It reports what it sees and has no command channel. The platform never executes anything on your machines.",
      },
      noSecrets: {
        title: "No secrets collected",
        body: "No passwords, file contents, command-line arguments or environment variables. Integration tokens are encrypted and read-only.",
      },
      isolation: {
        title: "Isolation, enforced twice",
        body: "Every workspace is separated in the application and again by row-level security in the database.",
      },
      twoFactor: {
        title: "2FA and passkeys",
        body: "For every account, and workspaces can require them. Included in every edition, Community too.",
      },
      audit: {
        title: "Audit log",
        body: "Who did what, append-only, kept for a year — members, integrations, agents and settings.",
      },
      data: {
        title: "Your data stays yours",
        body: "Export a workspace or delete it at any time. Or self-host InfraMole and keep everything in-house.",
      },
    },
  },
  pricing: {
    eyebrow: "Pricing",
    title: "Your infrastructure. Your choice.",
    intro:
      "Self-host InfraMole for free, or let us run it for you. Cloud pricing is based only on servers and VMs — everything else you discover is unlimited.",
    selfHosted: { label: "Self-hosted", note: "You run InfraMole on your own servers." },
    cloud: { label: "Cloud", note: "We run and maintain InfraMole for you." },
    business: {
      name: "Business",
      tag: "Enterprise",
      from: "from",
      perYear: "per year",
      lines: [
        "Everything in Community",
        "Multiple workspaces — one per client or department",
        "Signed offline licence — no phone-home",
        "Priority email support",
        "Commercial licence as an alternative to the AGPL",
      ],
      contact: "Contact sales@inframole.com →",
    },
    mostTeams: "Most teams",
    perMonth: "per month",
    upTo: ["Up to", "servers and VMs"],
    unlimitedMembers: "Unlimited members",
    members: (n: number) => `${n} members`,
    history: (days: number) => `${days} days change history`,
    cloudCommon: [
      "Agents",
      "Azure, AWS and Cloudflare integrations",
      "Applications, databases, containers, domains and discovered services unlimited",
    ],
    startTrial: "Start free trial",
    comingSoon: "Coming soon",
    trialOpen: (days: number) =>
      `Every Cloud workspace starts with ${days} days of Team, free — no card needed.`,
    trialSoon: (days: number) =>
      `InfraMole Cloud opens soon: every Cloud workspace will start with ${days} days of Team, free — no card needed.`,
    moreThan: (n: number | null) => `More than ${n} servers?`,
    talkToUs: "Talk to us",
    earlyAccess: "Early-access prices; they may change before general availability.",
  },
  community: {
    name: "Community",
    tag: "Free & Open Source — AGPLv3",
    price: "Free",
    forever: "forever",
    unlimited: ["", "Unlimited", " servers and VMs"],
    workspaces: (n: number) => `${n} workspace${n === 1 ? "" : "s"}`,
    lines: [
      "Agents for Windows and Linux, dependency map and impact analysis",
      "Azure, AWS and Cloudflare integrations; CSV, Compose and platform imports",
      "Two-factor authentication, passkeys and audit log",
      "Docker Compose deployment, x86-64 and ARM64",
    ],
    installGuide: "Install guide →",
    sourceCode: "Source code →",
  },
  openSource: {
    eyebrow: "Get InfraMole",
    intro:
      "InfraMole is free and open source: run it on your own server, with every server and VM you have. A hosted Cloud and a Business edition for larger teams are planned.",
    plannedTitle: "Cloud & Business",
    planned: "Planned",
    cloud: ["InfraMole Cloud", "— we run and maintain InfraMole for you."],
    business: [
      "InfraMole Business",
      "— self-hosted, with several workspaces, priority support and a commercial licence as an alternative to the AGPL.",
    ],
    interested: "Interested? Write to sales@inframole.com →",
  },
  finalCta: {
    title: "Know what is under the ground.",
    trial: "Map your first servers in minutes. 14 days free, no card, no sales call.",
    free: "Free and open source. Map your first servers in minutes — no sales call.",
  },
  footer: {
    tagline: "See what depends on what.",
    agent: "What the agent collects",
    docs: "Docs",
    signIn: "Sign in",
  },
  language: {
    switchTo: "Español",
    switchLabel: "Ver esta página en español",
    suggestion: "¿Prefieres leer InfraMole en español?",
    suggestionAction: "Ver en español",
    dismiss: "Cerrar",
  },
};

export type SiteCopy = typeof en;

const es: SiteCopy = {
  nav: {
    home: "Inicio de InfraMole",
    how: "Cómo funciona",
    map: "El mapa",
    security: "Seguridad",
    faq: "Preguntas",
    pricing: "Precios",
    docs: "Documentación",
    signIn: "Iniciar sesión",
    getStarted: "Empezar",
  },
  hero: {
    eyebrow: "mapa de dependencias de infraestructura",
    title: ["Descubre qué depende", "de qué."],
    lead: "explora tus servidores, aplicaciones, bases de datos y dominios, dibuja cómo se conectan y te muestra qué podría verse afectado antes de cambiar o apagar nada. Ligero y de solo lectura — para equipos de IT pequeños, MSP y homelabs.",
    startTrial: "Prueba gratis",
    installFree: "Instalar gratis",
    backToDemo: "Volver a la demo",
    tryDemo: "Probar la demo",
    howItWorks: "Cómo funciona",
    trialNote: (days: number) =>
      `${days} días de prueba gratis, sin tarjeta. O instala Community en tu servidor — gratis y de código abierto.`,
    freeNote:
      "Gratis y de código abierto (AGPLv3). Funcionando en tu propio servidor en unos diez minutos.",
    sourceCode: "Código fuente en GitHub",
  },
  miniMap: {
    label: "Mapa de ejemplo: dominios, aplicaciones, bases de datos y servidores",
    ifFails: (name: string, n: number) =>
      n === 0
        ? `Si ${name} falla, no hay nada registrado que dependa de él`
        : `Si ${name} falla, ${n} podrían verse afectados`,
    hint: "Pulsa cualquier recurso",
    select: (name: string) => `Ver qué podría verse afectado si falla ${name}`,
    nothing: "No hay nada registrado que dependa de él.",
    note: "Las relaciones detectadas e inferidas siguen siendo sugerencias hasta que alguien de tu equipo las confirma.",
    confidence: { confirmed: "Confirmada", detected: "Detectada", inferred: "Inferida" },
    kinds: {
      domain: "dominio",
      app: "aplicación",
      database: "base de datos",
      server: "servidor",
      hypervisor: "hipervisor",
      vm: "máquina virtual",
      lb: "balanceador",
    },
    layers: ["Puntos de entrada", "Balanceo", "Servidores y hosts"],
    illustrationLabel:
      "Ilustración del mapa: dominios arriba, un balanceador debajo y, abajo del todo, la caja de un servidor con sus aplicaciones y la de un hipervisor con una máquina virtual y sus bases de datos.",
  },
  map: {
    eyebrow: "El mapa",
    title: "Tu infraestructura, dibujada para ti — y legible",
    body: "Nadie dibuja nada. El mapa se construye con lo que InfraMole sabe, en capas que se leen de un vistazo.",
    points: [
      {
        title: "Por capas",
        body: "Arriba los puntos de entrada y dominios; después aplicaciones y datos; abajo servidores y hosts.",
      },
      {
        title: "Servidores como cajas",
        body: "Lo que se ejecuta en un servidor o hipervisor se dibuja dentro. Pliega una caja para ver el conjunto.",
      },
      {
        title: "Pregunta «¿y si…?»",
        body: "Elige cualquier recurso y mira qué podría verse afectado si falla, con la certeza de cada relación.",
      },
      {
        title: "Guarda y comparte",
        body: "Guarda vistas con sus filtros y posiciones, compártelas por enlace y expórtalas en PNG o PDF.",
      },
    ],
  },
  sources: {
    eyebrow: "Qué descubre",
    title: "Empieza con lo que ya tienes",
    groups: [
      {
        title: "El agente",
        note: "Windows y Linux · solo lectura · solo HTTPS saliente",
        items: [
          "Equipos, servicios, puertos en escucha y las conexiones entre ellos",
          "Sitios de IIS y bases de datos de SQL Server",
          "Sitios de nginx y Apache, bases de datos PostgreSQL y MySQL",
          "Contenedores Docker y proyectos Compose",
          "Destinos de proxies inversos: nginx, Apache, HAProxy, Traefik, IIS",
          "Nodos y cargas de trabajo de Kubernetes",
        ],
      },
      {
        title: "Integraciones",
        note: "Tokens de solo lectura, cifrados en reposo",
        items: [
          "Azure: máquinas virtuales",
          "AWS: instancias EC2 y bases de datos RDS",
          "Cloudflare: registros DNS y a qué apuntan",
          "NetBox y Zabbix: parte del inventario que ya tienes",
        ],
      },
      {
        title: "Ficheros",
        note: "Se revisan antes de guardar nada",
        items: [
          "CSV o JSON de tu hoja de cálculo u otra herramienta",
          "Ficheros docker-compose",
          "Exportaciones de Proxmox, Azure, AWS y Cloudflare",
        ],
      },
    ],
    more: "Más nubes, balanceadores, proveedores DNS, hipervisores, NAS y PRTG están en preview",
    moreLink: "Ver todas las integraciones →",
  },
  useCases: {
    eyebrow: "Cuándo ayuda",
    title: "Para los momentos en que necesitas saber qué depende de qué",
    items: [
      {
        title: "Antes de un cambio",
        body: "¿Parcheas SQL01 esta noche? Mira qué podría verse afectado — y a quién avisar — antes, no después.",
      },
      {
        title: "Durante una caída",
        body: "Algo no funciona. Mira qué más depende de ello, y con qué certeza, en segundos.",
      },
      {
        title: "Al heredar una red",
        body: "Un cliente nuevo o una red que nadie documentó: instala el agente y ten un mapa el mismo día.",
      },
      {
        title: "Tu homelab",
        body: "Proxmox, Docker y un NAS: por fin una imagen de qué se ejecuta dónde — autoalojado y gratis.",
      },
    ],
  },
  faq: {
    eyebrow: "Preguntas",
    title: "Preguntas frecuentes",
    items: [
      {
        q: "¿Es una herramienta de monitorización?",
        a: "No. No hay alertas, métricas ni comprobaciones de disponibilidad. InfraMole mapea lo que tienes y qué depende de qué — úsalo junto a tu monitorización, no en su lugar.",
      },
      {
        q: "¿Qué envía el agente? ¿Puede ejecutar órdenes?",
        a: "Datos del equipo, servicios, puertos en escucha y conexiones agregadas, más las cargas de trabajo de arriba. Nunca contraseñas, contenido de ficheros, líneas de comandos ni variables de entorno. No tiene canal de órdenes, e `inframole-agent dry-run` muestra exactamente lo que enviaría.",
      },
      {
        q: "¿Necesita puertos de entrada o una VPN?",
        a: "No. El agente solo hace peticiones HTTPS salientes a tu servidor de InfraMole.",
      },
      {
        q: "¿Dónde están mis datos?",
        a: "En tu servidor. InfraMole autoalojado no nos envía nada — ni telemetría ni comprobación de licencia. Solo habla con los proveedores que conectes y con tu servidor de correo.",
      },
      {
        q: "¿Cuántos servidores puedo mapear?",
        a: "Community no tiene límite de servidores ni de máquinas virtuales — un espacio de trabajo por instalación. Un servidor pequeño (2 GB de RAM) basta para unos cien servidores.",
      },
      {
        q: "¿Dónde se instala?",
        a: "Docker Compose en Linux (recomendado), o Docker Desktop en Windows y macOS para probarlo — x86-64 o ARM64. La instalación lleva unos diez minutos.",
      },
      {
        q: "¿Qué licencia tiene?",
        a: "AGPL-3.0: libre para usar, estudiar y modificar. Las organizaciones que no pueden aceptar la AGPL pueden obtener una licencia comercial.",
      },
    ],
  },
  how: {
    eyebrow: "Instalar → Descubrir → Entender",
    title: "Un mapa que se construye solo, y personas que lo hacen verdad",
    steps: [
      {
        title: "Instalar",
        body: "Un agente pequeño y de solo lectura por servidor — un único binario firmado para Windows o Linux. O aprovecha lo que ya tienes: Proxmox, Azure, AWS, Cloudflare, Docker Compose o un CSV.",
      },
      {
        title: "Descubrir",
        body: "Se observan los equipos, los servicios y las conexiones entre ellos, y se convierten en sugerencias — cada una dice de dónde viene y cuánta certeza tenemos.",
      },
      {
        title: "Entender",
        body: "Tu equipo confirma lo que importa y añade el contexto que solo conocen las personas. Después abre el mapa, o pregunta qué podría verse afectado antes de un cambio o durante una caída.",
      },
    ],
  },
  honesty: {
    eyebrow: "Honesto por diseño",
    title: "Sugerencias, nunca suposiciones disfrazadas de hechos",
    body: "Cada relación muestra su nivel de certeza en todas partes: en el mapa, en las listas y en los análisis de impacto. Tú decides qué es verdad; InfraMole registra qué cambió y cuándo.",
    not: [
      { strong: "No es monitorización.", rest: "Ni alertas ni paneles que vigilar." },
      { strong: "No es una CMDB.", rest: "Ni formularios que rellenar antes de sacarle partido." },
      {
        strong: "Nunca control remoto.",
        rest: "No puede ejecutar nada en tus máquinas.",
      },
    ],
    confidence: {
      confirmed: {
        label: "Confirmada",
        body: "Lo ha dicho una persona de tu equipo. Solo las dependencias confirmadas se presentan como dependencias.",
      },
      detected: {
        label: "Detectada",
        body: "Observada por un agente o una integración — por ejemplo, una conexión activa al puerto 1433.",
      },
      inferred: {
        label: "Inferida",
        body: "Una suposición razonable a partir de nombres o ubicación. Se muestra atenuada y nunca cuenta como un hecho.",
      },
    },
  },
  security: {
    eyebrow: "Seguridad",
    title: "Hecho para que puedas confiarle el mapa de tu infraestructura",
    items: {
      readOnly: {
        title: "Agente de solo lectura",
        body: "Informa de lo que ve y no tiene canal de órdenes. La plataforma nunca ejecuta nada en tus máquinas.",
      },
      noSecrets: {
        title: "No recoge secretos",
        body: "Ni contraseñas, ni contenido de ficheros, ni argumentos de línea de comandos, ni variables de entorno. Los tokens de las integraciones se guardan cifrados y son de solo lectura.",
      },
      isolation: {
        title: "Aislamiento, por partida doble",
        body: "Cada espacio de trabajo está separado en la aplicación y, además, por seguridad a nivel de fila en la base de datos.",
      },
      twoFactor: {
        title: "2FA y llaves de acceso",
        body: "Para todas las cuentas, y cada espacio de trabajo puede exigirlas. Incluido en todas las ediciones, también en Community.",
      },
      audit: {
        title: "Registro de auditoría",
        body: "Quién hizo qué, solo de escritura y guardado durante un año — miembros, integraciones, agentes y ajustes.",
      },
      data: {
        title: "Tus datos siguen siendo tuyos",
        body: "Exporta o elimina un espacio de trabajo cuando quieras. O instala InfraMole en tus servidores y guárdalo todo en casa.",
      },
    },
  },
  pricing: {
    eyebrow: "Precios",
    title: "Tu infraestructura. Tu elección.",
    intro:
      "Instala InfraMole gratis en tus servidores, o deja que lo gestionemos por ti. El precio de Cloud depende solo de los servidores y máquinas virtuales — todo lo demás que descubras es ilimitado.",
    selfHosted: { label: "Autoalojado", note: "InfraMole funciona en tus propios servidores." },
    cloud: { label: "Cloud", note: "Nosotros gestionamos y mantenemos InfraMole por ti." },
    business: {
      name: "Business",
      tag: "Empresas",
      from: "desde",
      perYear: "al año",
      lines: [
        "Todo lo de Community",
        "Varios espacios de trabajo — uno por cliente o departamento",
        "Licencia firmada sin conexión — sin llamadas a casa",
        "Soporte prioritario por correo",
        "Licencia comercial como alternativa a la AGPL",
      ],
      contact: "Escribe a sales@inframole.com →",
    },
    mostTeams: "La más elegida",
    perMonth: "al mes",
    upTo: ["Hasta", "servidores y máquinas virtuales"],
    unlimitedMembers: "Miembros ilimitados",
    members: (n: number) => `${n} miembros`,
    history: (days: number) => `${days} días de historial de cambios`,
    cloudCommon: [
      "Agentes",
      "Integraciones con Azure, AWS y Cloudflare",
      "Aplicaciones, bases de datos, contenedores, dominios y servicios descubiertos ilimitados",
    ],
    startTrial: "Prueba gratis",
    comingSoon: "Próximamente",
    trialOpen: (days: number) =>
      `Cada espacio de trabajo Cloud empieza con ${days} días del plan Team gratis — sin tarjeta.`,
    trialSoon: (days: number) =>
      `InfraMole Cloud abrirá pronto: cada espacio de trabajo Cloud empezará con ${days} días del plan Team gratis — sin tarjeta.`,
    moreThan: (n: number | null) => `¿Más de ${n} servidores?`,
    talkToUs: "Hablemos",
    earlyAccess: "Precios de acceso anticipado; pueden cambiar antes del lanzamiento general.",
  },
  community: {
    name: "Community",
    tag: "Gratis y de código abierto — AGPLv3",
    price: "Gratis",
    forever: "para siempre",
    unlimited: ["Servidores y máquinas virtuales ", "ilimitados", ""],
    workspaces: (n: number) => `${n} espacio${n === 1 ? "" : "s"} de trabajo`,
    lines: [
      "Agentes para Windows y Linux, mapa de dependencias y análisis de impacto",
      "Integraciones con Azure, AWS y Cloudflare; importación de CSV, Compose y plataformas",
      "Autenticación en dos pasos, llaves de acceso y registro de auditoría",
      "Despliegue con Docker Compose, x86-64 y ARM64",
    ],
    installGuide: "Guía de instalación →",
    sourceCode: "Código fuente →",
  },
  openSource: {
    eyebrow: "Consigue InfraMole",
    intro:
      "InfraMole es gratis y de código abierto: instálalo en tu propio servidor, con todos los servidores y máquinas virtuales que tengas. Hay previstas una versión Cloud gestionada y una edición Business para equipos más grandes.",
    plannedTitle: "Cloud y Business",
    planned: "Previsto",
    cloud: ["InfraMole Cloud", "— nosotros gestionamos y mantenemos InfraMole por ti."],
    business: [
      "InfraMole Business",
      "— autoalojado, con varios espacios de trabajo, soporte prioritario y una licencia comercial como alternativa a la AGPL.",
    ],
    interested: "¿Te interesa? Escribe a sales@inframole.com →",
  },
  finalCta: {
    title: "Conoce lo que hay bajo tierra.",
    trial:
      "Mapea tus primeros servidores en minutos. 14 días gratis, sin tarjeta ni llamadas comerciales.",
    free: "Gratis y de código abierto. Mapea tus primeros servidores en minutos — sin llamadas comerciales.",
  },
  footer: {
    tagline: "Descubre qué depende de qué.",
    agent: "Qué recoge el agente",
    docs: "Documentación",
    signIn: "Iniciar sesión",
  },
  language: {
    switchTo: "English",
    switchLabel: "View this page in English",
    suggestion: "Prefer to read InfraMole in English?",
    suggestionAction: "View in English",
    dismiss: "Dismiss",
  },
};

export const SITE_COPY: Record<Locale, SiteCopy> = { en, es };
