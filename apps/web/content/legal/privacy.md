# Privacy Policy — InfraMole Cloud

> **DRAFT — needs legal review before publication.** Effective date: `[EFFECTIVE DATE]`.

`[COMPANY LEGAL NAME]`, `[ADDRESS]` ("we") operates InfraMole Cloud. For data
our customers put into their workspaces we act as **processor** on their
behalf (see the DPA); for account and billing data we act as **controller**.
Contact: `[DPO / PRIVACY CONTACT]`.

## 1. What we process

**Account data** (controller): name, email address, password hash (we never
store passwords), two-factor authentication secrets (encrypted), passkey
public keys, sign-in events (time, IP address, browser/OS summary), when you accepted
the Terms of Service and which version, and — if you use Google or
Microsoft sign-in — the provider account identifier.

**Workspace data** (processor, on behalf of the customer): the infrastructure
inventory the customer creates or imports (resource names, types, IP
addresses, hostnames, notes, relationships), data reported by the InfraMole
agent (hostname, OS, network interfaces, running services, listening ports,
aggregated TCP connections with process names — **never** passwords, file
contents, command-line arguments, environment variables or user documents),
member names and emails, invitations, and the workspace audit log.

**Integration credentials** (processor, optional): read-only cloud API
credentials the customer chooses to store, encrypted with AES-256-GCM and
never shown again.

**Billing data** (controller): handled by our payment provider; we keep
the subscription status and plan, not card numbers.

We do **not** use workspace data for advertising, profiling or training
models, and we do not sell data.

## 2. Why (legal bases)

- Providing the service you signed up for — contract (Art. 6(1)(b) GDPR).
- Security of the service: sign-in events, audit log, rate limiting —
  legitimate interest (Art. 6(1)(f)) and legal obligations (Art. 32).
- Transactional emails (verification, password reset, invitations) —
  contract.
- Billing and accounting records — legal obligation (Art. 6(1)(c)).

## 3. How long

We follow the retention table in our documentation (summary): raw agent
reports 7 days; connection observations 30 days after last seen; change
history 30, 90 or 365 days depending on the plan; audit log 365 days; ended invitations 30 days; expired sessions
and tokens deleted on expiry. Deleting a workspace deletes all its data
immediately; deleting your account deletes your user data and the workspaces
where you were the only member. Encrypted backups keep deleted data for up
to `[BACKUP_KEEP_DAYS, default 14]` days. Billing records are kept as long
as tax law requires.

## 4. Where and who

Data is hosted in the European Union by `[HOSTING PROVIDER]`. Sub-processors
are listed on the [sub-processors page](/legal/subprocessors). Transfers outside the EEA, if any, rely on
the European Commission's adequacy decisions or Standard Contractual Clauses.

## 5. Your rights

Access, rectification, erasure, restriction, portability (Settings › Data ›
Export) and objection; you can delete your account yourself (Account &
security › Delete account). For workspace data, contact the workspace owner
(the controller); we assist them. You may complain to your data protection
authority.

## 6. Security

Summary of measures: TLS everywhere, encrypted secrets, database-enforced
tenant isolation (Row Level Security), two-factor authentication and passkeys,
an append-only audit log, encrypted backups and least-privilege access by our
staff (every database session is logged with a reason). Our technical and
organisational measures (DPA Annex II) are available on request.

## 7. Cookies

Only strictly necessary cookies: the session cookie and the security cookies
of the sign-in process. No analytics, advertising or tracking cookies.

## 8. Changes

We will announce material changes by email to account holders at least
`[30]` days in advance.
