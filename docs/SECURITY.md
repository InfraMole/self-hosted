# Security

This product stores a map of customers' infrastructure: hostnames, IPs, open
ports, running software and who talks to whom. For an attacker that is a
**reconnaissance goldmine**. Treat all workspace data as sensitive.

## 1. Principles

1. **Read-only towards infrastructure.** The platform never executes commands
   on customer machines. The agent has no remote-execution capability of any
   kind; server responses may only carry configuration.
2. **Minimum data.** Collect only what serves "what depends on what". No
   secrets, no file contents, no command-line arguments, no environment
   variables, no user data.
3. **Tenant isolation is the #1 invariant.** A cross-workspace leak is a
   critical incident.
4. **Secrets are hashed at rest**, shown once, revocable and rotatable.
5. **Defence in depth**: app-level scoping + DB composite FKs + tests.

## 2. Assets

| Asset                               | Sensitivity        |
| ----------------------------------- | ------------------ |
| Workspace inventory & relationships | High (recon value) |
| Agent observations                  | High               |
| User credentials / sessions         | High               |
| Agent secrets, enrollment tokens    | High               |
| Change history                      | Medium             |

## 3. Actors & trust boundaries

```
[Browser user] ──TLS──▶ [Web app] ──▶ [Postgres]
[Agent on customer host] ──TLS (outbound only)──▶ [Web app /api/agent]
```

- Users are authenticated by session cookie; authorised per workspace via
  Membership + role.
- Agents are authenticated by per-agent bearer secret; authorised only to
  write observations for their own workspace.
- The DB is never exposed publicly.

## 4. Threat model (STRIDE-lite)

| #   | Threat                                                            | Mitigation                                                                                                                                                                                                                     | Status                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | User reads/modifies another workspace's data (IDOR)               | `requireWorkspace()` via membership; every query scoped by `workspaceId`; `notFound` instead of 403; composite FKs; integration tests                                                                                          | ✅ guard + tests; composite FKs on relationships (M2, DB-level test)                                                                                                                                                                                                                                                                                                                           |
| T2  | Credential stuffing / brute force on login                        | Better Auth rate limiting; scrypt password hashing; min password length 10                                                                                                                                                     | M0 ✅                                                                                                                                                                                                                                                                                                                                                                                          |
| T3  | Session theft                                                     | httpOnly, `Secure` (prod), `SameSite=Lax` cookies; DB sessions revocable                                                                                                                                                       | M0 ✅                                                                                                                                                                                                                                                                                                                                                                                          |
| T4  | CSRF on mutations                                                 | Server Actions (origin-checked by Next.js); Better Auth origin checks (`trustedOrigins`)                                                                                                                                       | M0 ✅                                                                                                                                                                                                                                                                                                                                                                                          |
| T5  | XSS via user content (notes, names, links)                        | React escaping; no `dangerouslySetInnerHTML`; notes rendered as plain text (markdown deferred; would need a sanitiser); links `https:` only + `rel=noopener noreferrer nofollow`; CSP                                          | ✅ M1                                                                                                                                                                                                                                                                                                                                                                                          |
| T6  | Leaked agent secret                                               | Per-agent secret (blast radius = one agent), hashed (sha256), revocable, rotatable; secret only allows _writing_ observations                                                                                                  | ✅ M5 (sha256 at rest, per-agent, revocable, rotation on re-enroll)                                                                                                                                                                                                                                                                                                                            |
| T7  | Leaked enrollment token                                           | Expiring, revocable, optional max uses, hashed                                                                                                                                                                                 | ✅ M5 (hashed, expiring 1h–30d, max uses, revocable; atomic use count)                                                                                                                                                                                                                                                                                                                         |
| T8  | Malicious/oversized agent payloads (DoS, injection)               | Zod schema, strict size limits (e.g. 1 MB), array caps, rate limit per agent, reject unknown schema versions                                                                                                                   | ✅ M5 (strict zod, 8 KB / 1 MB streamed limits, array caps, 10/min per IP/agent)                                                                                                                                                                                                                                                                                                               |
| T9  | Agent spoofing another host / poisoning map                       | Agent can only write to its workspace; detected data is UNCONFIRMED until a human confirms; resource identity bound to agent id                                                                                                | ✅ M6 (workspace from credential only; host bound to agent id; identity resolution only within the workspace and only for a unique owner; everything detected is UNCONFIRMED until a human confirms)                                                                                                                                                                                           |
| T10 | Platform compromise → attacker pushes commands to agents          | **By design impossible**: agent has no command channel; only config values it validates locally (bounded interval, toggles)                                                                                                    | ✅ M5 (no command channel; config clamped locally)                                                                                                                                                                                                                                                                                                                                             |
| T11 | Supply chain on agent binary                                      | Reproducible builds, SHA256SUMS signed keyless with Sigstore, build provenance, optional Authenticode; in-app install commands verify checksums before running                                                                 | ✅ M8b (`agent-release.yml`, AGENT.md §10)                                                                                                                                                                                                                                                                                                                                                     |
| T12 | Sensitive data over-collection                                    | Allow-listed collectors; no args/env/files; documented list in `AGENT.md`                                                                                                                                                      | ✅ M5 (allow-listed structs, no cmdline/env; server rejects unknown fields)                                                                                                                                                                                                                                                                                                                    |
| T13 | Secrets in logs                                                   | Never log tokens, cookies, payload bodies; structured logs with redaction                                                                                                                                                      | ongoing                                                                                                                                                                                                                                                                                                                                                                                        |
| T14 | SQL injection                                                     | Prisma parameterised queries; no raw SQL with string concatenation                                                                                                                                                             | ongoing                                                                                                                                                                                                                                                                                                                                                                                        |
| T16 | Stored integration credentials leak (DB dump, logs)               | ADR-018 D: read-only scopes only, AES-256-GCM with tenant-bound AAD, key outside the DB (env) with rotation, never logged/returned, opt-in; prefer export upload (A) or agent collectors (C)                                   | ✅ `server/crypto.ts` + `modules/integrations` (sealed at rest, AAD bound to workspace + row, re-sealed on key rotation, secret never returned — only last-4 hint, ADMIN+, disabled without key). M23 (ADR-034): least-privilege guidance per provider; Clouding keys cannot be read-only (stated in the form); provider hosts are constants — Google `token_uri` from the key file is ignored |
| T17 | SSRF through server-side integration sync                         | https only, public endpoints only (block private/link-local/metadata ranges), timeouts, response caps                                                                                                                          | ✅ `server/safe-fetch.ts` (https only, public destinations checked at connect time — DNS-rebinding safe —, no redirects, timeout, size cap)                                                                                                                                                                                                                                                    |
| T18 | Agent collector credential theft on the host                      | Token only in a separate private file (Unix mode checked, Windows ACL documented), read-only PVEAuditor role, never sent to Depmap, collectors only enabled locally (server cannot configure them), TLS verified, no redirects | ✅ M8b (`agent/internal/inventory`)                                                                                                                                                                                                                                                                                                                                                            |
| T19 | Invitation link forwarded / leaked                                | Token hashed, 7-day expiry, single use, revocable; bound to the invited email (must sign in with it); email masked on the page; `Referrer-Policy: no-referrer` on `/invite`; accept rate-limited per user                      | ✅ M8b (`modules/members`)                                                                                                                                                                                                                                                                                                                                                                     |
| T20 | Privilege escalation through role management                      | ADMIN cannot grant/change/remove OWNER; at least one OWNER always; invitations never downgrade; every check server-side and tenant-scoped (tests)                                                                              | ✅ M8b                                                                                                                                                                                                                                                                                                                                                                                         |
| T21 | Open redirect after sign-in (`?next=`)                            | Only same-origin absolute paths (`lib/safe-next.ts`, unit tested)                                                                                                                                                              | ✅ M8b                                                                                                                                                                                                                                                                                                                                                                                         |
| T22 | Tenant leak through an application bug (missing workspace filter) | Postgres RLS with a non-bypass runtime role, explicit scopes, fail-closed default, regression tests (incl. Prisma query batching)                                                                                              | ✅ M8c (ADR-020)                                                                                                                                                                                                                                                                                                                                                                               |
| T15 | Insider / support access                                          | Workspace audit log (customer-visible); staff DB sessions only via `db-shell.sh` with a mandatory reason, recorded as `operator.db_access` + `access.log`; encrypted backups whose key is kept off the server                  | ✅ M8c (accountability; host root remains trusted)                                                                                                                                                                                                                                                                                                                                             |

## 5. Implemented controls (M0)

- Env validation on first use (`src/server/env.ts`, lazy so builds need no
  secrets); `BETTER_AUTH_SECRET` ≥ 32 chars; in production
  `BETTER_AUTH_URL` must be `https://` (only `localhost` is exempt, for local
  production builds). Error messages never echo values.
- Better Auth: email+password (scrypt hash, min 10 / max 128 chars), DB
  sessions (14 days), origin check on every auth request (foreign `Origin` →
  403, verified), built-in rate limiting in production: 100 req/min global,
  **5/min on sign-in and sign-up**. Storage is in-memory → per instance; move
  to `storage: "database"` before running more than one instance.
- **Sign-in/sign-up run in the browser against `/api/auth`**, never through
  server actions calling `auth.api.*` (that would bypass rate limiting).
- Generic "Invalid email or password." copy (no account enumeration).
- Security headers (`next.config.ts`): `Content-Security-Policy`
  (baseline, `'unsafe-inline'` scripts — nonce-based CSP is backlog),
  `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: DENY`,
  `Permissions-Policy`, HSTS in production builds, no `X-Powered-By`.
- Workspace access via membership only; non-members and unknown slugs get the
  same 404; malformed slugs are rejected before querying.
- Abuse guard: a user can own at most 20 workspaces.
- `server-only` imports in server modules.
- Health endpoint reveals no internals (`{"status":"ok"|"degraded"}`).
- Docker runtime image runs as a non-root user.

## 5b. Agent controls (M5)

- Agent API authenticates with `Authorization: Bearer dmp_agt_…` (shape
  checked before any DB lookup; lookup by sha256). The workspace comes only
  from the credential.
- Enrollment returns 401 for any token problem without saying which.
- Request bodies are streamed with a hard byte limit (Content-Length is not
  trusted); JSON only (415 otherwise).
- In-memory rate limits: enroll 10/min per client IP (`clientIp`: behind
  our proxy with `TRUST_PROXY=true`, `X-Real-IP` overwritten by Caddy;
  otherwise the rightmost `X-Forwarded-For` entry), report 10/min per
  agent. Per-instance, like the auth limiter.
- Agent side: https only (unless `--insecure-dev`), TLS ≥ 1.2, redirects
  refused, config file ACL-restricted, token can be passed via env var.
- Raw observations are deleted after 7 days (opportunistically on each
  report of that agent).

## 5c. Import controls (M8)

- MEMBER+ only (preview included); workspace-scoped matching only.
- Input ≤ 1 MB, ≤ 2000 resources / 5000 relationships; every row validated
  with the same zod schema as the UI (IPs, https links, allow-listed
  metadata); YAML parsed with `maxAliasCount: 50`.
- All-or-nothing apply, re-planned server-side (the client preview is never
  trusted). No credentials are accepted or stored (ADR-017/018 option A: platform
  exports are produced by the user's own CLI).

## 5d. Accounts & email (M8b)

- `server/mail.ts`: plain-text mail only (no HTML); recipient and subject
  are forced to one line (no header injection through names). Without
  `SMTP_URL`, dev prints mails to the console and production drops them
  with a warning that never contains the body (it may carry a token).
- With a mailer, **email verification is required** to sign in
  (`requireEmailVerification`, verification link valid 1 h, resent on
  sign-in) and to accept an invitation (invitations are bound to the email).
- Password reset: 1 h single-use token, same neutral answer whether or not
  the account exists, **all sessions revoked** on reset, tighter Better Auth
  rate limits on `/request-password-reset`, `/send-verification-email`,
  `/reset-password`. Reset and invite pages set `Referrer-Policy:
no-referrer` (token in the URL).

## 5q. Invite-only sign-up and the public demo (M13, ADR-025)

- `SIGNUP=closed`: account creation is decided server-side in the Better Auth
  `user.create` hook (form and SSO): first account of the installation or a
  pending, unexpired invitation for that exact address. Tested.
- Demo (`DEMO_MODE`): the shared account's password is public by design; the
  account is a VIEWER (no writes), and account endpoints that could lock other
  visitors out are refused (`DEMO_LOCKED_PATHS` in `server/auth.ts`, password
  reset for the demo address too); it cannot leave the workspace or create
  workspaces. Data is fictional and rebuilt every 24 h. Sign-in uses the
  normal rate-limited endpoint. Feedback from the demo is allowed. Demo
  sign-ins are **not** written to the account-level audit log (anonymous
  visitors' IPs would otherwise be kept 365 days); their sessions expire after
  14 days of inactivity and are deleted by the retention job.
- The demo's lookup of its workspace uses `systemDb("demo: find the demo
workspace")`; the rebuild deletes it with the audited-delete bypass, like
  workspace deletion.

## 5p. In-app feedback (M12)

- Emailed as plain text to `FEEDBACK_EMAIL` (no HTML, headers single-line),
  sender as Reply-To; nothing stored in the database; no third-party widget
  or script. Any member can send; 5 per user per hour. The page field is a
  path only (anything else is dropped, so no tokens from query strings); the
  dialog asks users not to include secrets.

## 5o. Terms acceptance and legal pages (M12)

- On Cloud every new account (email or Google/Microsoft) stores
  `termsVersion` + `termsAcceptedAt` from a server-side Better Auth hook;
  the fields are declared `input: false`, so a client cannot set or forge
  them (tested). The sign-up page (and sign-in, when SSO can create an
  account) shows the notice with links.
- Legal pages, the self-hosting guide and the `/docs` portal are rendered from repository Markdown **at build time**
  (`marked`, trusted content, no user input, nothing read at runtime), so
  `dangerouslySetInnerHTML` there carries no injection risk. User-supplied
  Markdown must never go through this path (resource notes stay plain text).
- Only strictly necessary cookies are used (session, sign-in security), so
  no consent banner is needed; the legal notice says so. Adding analytics
  would change that.

## 5n. Bulk actions and retirement (M10)

- Bulk archive / delete and retirement are MEMBER+, scoped to the workspace
  (ids from other tenants are ignored — tested), capped at 500 ids, and record
  a user change event per resource; retirement is also audited
  (`workspace.source_retired` with counts). The retirement outcome is passed
  back in the URL as two integers only (no reflected text).

## 5l. Billing & licences (M9)

- Limits are enforced server-side at every place that adds a billable node
  (create, type/status change, import apply, new agent enrollment); they
  never delete data or stop reporting agents. Enrollment refusal rolls back
  the transaction (the token use is not consumed) and returns 402 with a
  human message the agent prints.
- Business licences: Ed25519-signed, verified offline against public keys
  compiled into the build (`licence-keys.ts`) — no phone-home, and a
  licence cannot be forged or edited (tested: tampered payload, foreign key,
  expiry). The private key is generated and kept by the vendor
  (`scripts/licence.mjs keygen`), never on servers or in the repository.

## 5m. Stripe (M9)

- Checkout and the Customer Portal are hosted by Stripe: no card or payment
  data reaches Depmap. We store the customer and subscription ids, status,
  quantity and period end only.
- Webhook: signature verified with `STRIPE_WEBHOOK_SECRET` (bad signature →
  400, nothing applied; tested with real SDK signatures). For every
  subscription event the subscription is re-fetched from Stripe (ordering
  and replay cannot roll state back) and applied only if the Stripe customer
  is the one we created for that workspace (metadata pointing elsewhere is
  ignored — tested).
- Only OWNERs start Checkout or open the Portal. Stripe API errors are
  logged by type and shown to users as a generic message (Stripe error texts
  can contain key fragments). Plan changes are audited
  (`billing.plan_changed`).

## 5k. Retention (M8c)

The retention table in `DATA_MODEL.md` §7 is enforced by the maintenance job
(tested: exactly the expired rows go, idempotent). Personal data with no
further purpose (ended invitations with emails, revoked agents with their
last IP, expired sessions and tokens) is deleted, not kept "just in case".

## 5j. Data export and deletion (M8c)

- **Export** (ADMIN+, `GET /w/[slug]/settings/export`): JSON
  `depmap-workspace-export/1` — workspace, members, resources and CONFIRMED
  relationships in the JSON importer's shape (re-importable, tested),
  suggestions, agents (no secrets), integrations (config only — credentials
  never exported), discovery exclusion rules (M15), changes, audit log. Audited as `workspace.exported`.
- **Workspace deletion** (OWNER, exact-name confirmation): cascades
  everything (sealed credentials included); only an account-level audit event
  with counts remains.
- **Account deletion** (Better Auth `deleteUser` with password or a fresh
  SSO session): workspaces where the user is the only member are deleted;
  shared workspaces record `member.left`; refused while the user is the only
  owner of a workspace with other members. Sessions, accounts, 2FA and
  passkeys go with the user.

## 5i. Row Level Security (M8c, ADR-020)

- Runtime role `depmap_app` (no superuser, no BYPASSRLS); policies on every
  tenant table; scope set per transaction by `src/server/db.ts`; unscoped
  queries see nothing. `systemDb` call sites are few and each states why.
- Verified by `rls.test.ts` (a query that forgets its filter only sees its
  tenant; writes into another tenant are refused; concurrent queries of
  different tenants never share a statement; malformed scope ids rejected;
  no leak across pooled connections) and by running the **whole integration
  suite and the production stack as `depmap_app`**.

## 5h. SSO (M8c)

- Google and Microsoft via Better Auth social providers (authorization code +
  PKCE + state), enabled per provider by env. Microsoft tenant configurable
  (`organizations` recommended for B2B).
- Account linking keeps Better Auth's safe defaults: an SSO identity joins an
  existing account only if the provider asserts a **verified** email (Google
  does; Microsoft only with verified-email claims — protects against the
  "nOAuth" unverified-email takeover) and the local email is verified.
  Otherwise the user gets "sign in with your password, then connect it".
- `advanced.disableOriginCheck: false` is set explicitly: callback URLs and
  origins are always checked (Better Auth would skip them in test
  environments); an external `callbackURL` gets 403 (tested).
- New sign-in methods are audited (`auth.sign_in_method_added`). SSO
  sign-ins rely on the provider's MFA; the workspace "require 2FA" policy
  still requires TOTP on the Depmap account.

## 5g. Two-factor authentication and passkeys (M8c)

- Better Auth `twoFactor` plugin: TOTP (RFC 6238) + 10 single-use backup
  codes; secret and codes stored encrypted (tested: neither appears in the
  row). Enabling requires the password and a valid code; disabling and
  regenerating codes require the password. Sign-in with a password returns
  `twoFactorRedirect` and no session until `/two-factor` verifies a code;
  "trust this device" lasts 30 days. Tighter rate limits on
  `/two-factor/*`.
- Passkeys (`@better-auth/passkey`, WebAuthn): rpID/origin derived from
  `BETTER_AUTH_URL`; removal only of the user's own keys (server action).
- Workspace policy "require 2FA" (OWNER; refused unless the owner has 2FA, so
  the last owner cannot be locked out).
- Audit: 2FA on/off and passkey add/remove are recorded from the database
  state (`modules/account`), never from client claims.

## 5f. Audit log (M8c)

- `modules/audit`: `recordAudit(tx, …)` is called **in the same
  transaction** as the action for members (invite, revoke, join, role change,
  remove, leave), integrations (create, delete, manual sync), agents (token
  create/revoke, enroll, revoke) and workspace creation; Better Auth hooks
  record sign-ins (session IP/UA) and password resets at account level.
- Agent self-update (M22, ADR-033): opt-in in the agent's local config only;
  the InfraMole server can neither trigger nor redirect it (still no command
  channel). A release is installed only if its `manifest.json` verifies
  against an Ed25519 public key compiled into the agent, the binary matches
  the signed hash, the version is strictly newer (no rollback attacks) and
  the binary runs; the previous binary is kept and restored automatically if
  the new one never reports. The private key is the repository secret
  `AGENT_UPDATE_SIGNING_KEY` of `InfraMole/agent` (used only by the release
  workflow) plus the maintainer's offline backup; losing it means shipping a
  new key in a release installed by hand. Compromise of GitHub's release
  storage alone cannot make agents install a binary (the signature is
  separate from the storage).
- Weekly digest (M21, ADR-032): opt-in per member; counts and resource
  names only (no IPs, no change summaries), plain text. Unsubscribe links
  are an HMAC of the membership id with `BETTER_AUTH_SECRET` (no login, no
  stored token); only POST unsubscribes (link scanners that GET are
  harmless), with `List-Unsubscribe` + `List-Unsubscribe-Post` headers.
  Built per workspace with the tenant-scoped client; the cron lookup of due
  memberships is the only cross-workspace query (`systemDb`).
- Indexing (M18): a private install's `robots.txt` is `Disallow: /` and its
  sitemap is empty, so sign-in pages of self-hosted instances are not
  advertised to search engines; a public site never lists or allows the
  application paths (`/w/`, `/api/`, auth pages).
- Map export (M17) is rendered in the browser from data the user can
  already see; nothing is uploaded or stored, and no third-party library
  processes the map.
- Linux workloads (M20, ADR-031): nginx / Apache configs are read for
  server names and ports only (bounded: 200 files, depth 10, 2 MB each;
  certificate and key directives are never decoded); PostgreSQL and MySQL
  are opt-in and use the local socket with the agent's OS identity (peer /
  unix_socket / auth_socket) — the agent never stores or sends a password
  and gives up if one is required. Hand-written minimal protocol clients
  send exactly one fixed read-only query.
- Windows workloads (M16, ADR-028): the agent reads only the site list of
  `applicationHost.config` (never paths, pools or stored credentials — unit
  tested with a fixture full of them) and, **only when enabled locally**,
  SQL Server database names through the service's own Windows identity
  (integrated auth; no password stored; one fixed read-only query). The
  server schema is strict (`physicalPath` → 422). The server can never turn
  either on: it only advertises that it accepts the section.
- Discovery exclusion rules (M15) change what the workspace is told about
  its infrastructure, so creating and deleting them is audited
  (`discovery.rule_created` / `discovery.rule_deleted`, MEMBER+, same as
  reviewing). A rule's resource is checked to belong to the workspace; the
  table has RLS and a CHECK that a rule narrows something.
- Sensitive _reads_ (exports) are audited; ordinary page views are not
  (data minimisation).
- Append-only enforced by a DB trigger; 365-day retention
  (`pruneAuditEvents`). Metadata never contains tokens or secrets (tested:
  a dump of the table contains none of the invitation / enrollment tokens or
  integration secrets).
- Visible to ADMIN+ of the workspace at Settings › Audit log (404 for lower
  roles, like non-members).

## 5e. Deployment (M8b)

- `deploy/docker-compose.prod.yml`: only Caddy publishes ports (80 → 308,
  443 TLS); Postgres and the app are on an `internal: true` network; `web`
  runs read-only, non-root, `no-new-privileges`. Caddy caps request bodies
  at 4 MB and replaces client `X-Forwarded-*`; `X-Real-IP` is set to the TCP
  peer.
- Client-IP spoofing verified end to end: requests carrying different fake
  `X-Real-IP`/`X-Forwarded-For` values still hit the same sign-up rate limit.
- Secrets from `deploy/scripts/gen-secrets.sh` (openssl), `deploy/.env`
  gitignored and `chmod 600`; backups include the DB but never the
  encryption key (keep it separately). Rotation procedures: DEPLOYMENT.md §7.

## 6. Secret handling conventions

- Generate with `crypto.randomBytes(32)` → base64url, prefixed for
  identification (`dmp_enr_…`, `dmp_agt_…`).
- Store `sha256(secret)` + a short non-secret prefix for lookup/UI.
- Compare with `crypto.timingSafeEqual`.
- Show once at creation; never retrievable later.

## 7. Transport

- TLS mandatory in production (terminated by the reverse proxy); HSTS header.
- Agent refuses non-HTTPS endpoints unless started with an explicit
  `--insecure-dev` flag.

## 8. Backlog hardening

- Postgres Row Level Security as a second tenancy layer.
- Audit log (who changed what; admin actions).
- 2FA / passkeys (Better Auth plugins), SSO for MSPs.
- mTLS for agents.
- Per-workspace data export & deletion (GDPR).
