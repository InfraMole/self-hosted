-- Per-node "Pro" subscriptions from ADR-019 become the Team tier (ADR-023).
UPDATE "workspace_subscription" SET "tier" = 'team' WHERE "status" <> 'none' AND "tier" IS NULL;
