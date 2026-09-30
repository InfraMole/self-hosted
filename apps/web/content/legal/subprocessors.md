# Sub-processors — InfraMole Cloud

> **DRAFT — to be confirmed with the actual contracts before publication.**
> Last updated: `[EFFECTIVE DATE]`.

| Sub-processor                                                                    | Purpose                                            | Data                                                                                     | Location            | Status                       |
| -------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------- | ---------------------------- |
| `[HOSTING PROVIDER]` (e.g. an EU provider such as Hetzner, OVHcloud or Scaleway) | Servers, block storage, backups storage            | All workspace and account data (backups encrypted with a key the provider does not hold) | EU                  | to confirm                   |
| `[EMAIL PROVIDER]` (SMTP)                                                        | Verification, password reset and invitation emails | Recipient email, name, message text with a one-time link                                 | EU region preferred | to confirm                   |
| Stripe (M9, Cloud billing)                                                       | Payments and subscriptions                         | Billing contact, payment method (held by Stripe), subscription                           | EU / US (SCCs)      | when billing launches        |
| Google / Microsoft (optional, user-initiated SSO)                                | Sign-in                                            | OAuth identity, email                                                                    | Provider regions    | only if the user chooses SSO |

**Not sub-processors** (no customer data): GitHub (source code and agent
release hosting; agents download binaries from there), Sigstore (signing of
release checksums), Let's Encrypt (TLS certificates for our domain).

Customer-configured integrations (the APIs of Azure, AWS, Cloudflare or any
other cloud provider the customer connects) are called on
the customer's instruction with the customer's own credentials; those
providers act under the customer's own contracts with them.
