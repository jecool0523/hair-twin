# ADR-0007: Auth — Invite-Only Access and Owner Bootstrap

Date: 2026-07-16

## Status

Design accepted. **Not implemented** — by CTO decision, SupabaseStore/Auth start
only after mask-contract schema parity and a green Docker Supabase CI. This
document is the contract that implementation must satisfy.

## Context

Hair Twin holds customer face photos. There is no consumer surface and never
will be: the only users are salon staff. An open sign-up page would let anyone
create an account against a database of face images and hope RLS holds — that is
the wrong shape of risk to accept for zero product benefit.

The DB already models the authority: `salon_memberships(salon_id, profile_id,
role)` with `private.has_salon_role()` / `private.is_salon_member()` driving
every policy (20260715120200_rls.sql). Auth must feed that model, not invent a
parallel one.

## Decision

### 1. No public signup

Disable it at the provider (`config.toml` → `[auth] enable_signup = false`, and
the same in the hosted project's settings). There is no "create account" route in
the app. A person exists as a user only because someone with authority invited
them.

### 2. Bootstrap creates the first owner

The first owner cannot invite themselves, so an admin bootstrap script creates
the initial `organization` → `salon` → `profile` → `salon_memberships(owner)`
chain. It:

- runs server-side with the environment's `sb_secret_` key (never in a browser,
  never in CI, never in application code paths);
- is **idempotent** — re-running with the same inputs must not create a second
  organization/salon/owner. Key off stable natural inputs (org name + salon name
  + owner email), upsert, and assert exactly-one afterwards. A bootstrap that
  double-runs and silently forks a tenant is worse than one that fails;
- **writes an `audit_events` row** for every production bootstrap (who ran it,
  which org/salon/owner it created) — creating a tenant with a privileged key is
  exactly the action that must leave evidence;
- refuses to run against a project that already has that salon unless explicitly
  asked to adopt it.

### 3. Owners and admins invite stylists

`owner`/`admin` may invite; `stylist` may not. Invitation uses Supabase Auth's
invite flow (a `sb_secret_`-authenticated server action — the browser's
`sb_publishable_` key cannot invite). The invite carries no authority by itself.

### 4. Accepting an invite links profile + membership

On acceptance the server creates the `profiles` row for the new `auth.users.id`
and the `salon_memberships` row granting the intended role. **Membership is
created by the server after acceptance**, not embedded in the invite token, so a
stale or replayed invite cannot mint access.

### 5. Access follows membership only

A user reaches exactly the salons they hold a membership in. This is already
enforced by RLS and does not need application logic; the application must simply
not work around it (no service-key reads on behalf of a browser request).

### 6. `user_metadata` is NEVER an authority

Supabase's `user_metadata` is user-writable. A policy or code path that reads a
role out of a JWT claim or user metadata is a privilege-escalation bug, not a
shortcut. Authority is read from `salon_memberships` via the `private.*` helpers.

> If you find yourself writing `auth.jwt() ->> 'role'` to decide access, stop.

### 7. `salon_memberships` is the single source of truth

Role changes are membership-table changes. There is no second place to look, and
no cache that can disagree.

### 8. Secret key scope

`SUPABASE_SECRET_KEY` is for bootstrap, invites, and server/worker operations. It
bypasses RLS, so every use is a deliberate decision. It must never be:
`NEXT_PUBLIC_`-prefixed, present in the browser bundle, committed, logged, or
placed in CI (PR CI uses a disposable local stack and needs no real key).

## Environment variables (names only — values live in a secret store)

GitHub → staging Environment secrets:

- `SUPABASE_ACCESS_TOKEN`
- `STAGING_PROJECT_ID`
- `STAGING_DB_PASSWORD`

App staging runtime:

- `NEXT_PUBLIC_SUPABASE_URL` (browser-safe)
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (browser-safe, `sb_publishable_`)
- `SUPABASE_SECRET_KEY` (server/worker only, `sb_secret_`)

Legacy `service_role` keys are not adopted for this structure.

## Consequences

Positive:

- The attack surface for face data is "be invited by a salon owner".
- Authority lives in one table the DB already enforces on.
- Bootstrap leaves an audit trail and cannot silently fork tenants.

Tradeoffs:

- Onboarding a salon needs an operator to run bootstrap — deliberate friction
  during pilot, and it must be scripted before scaling past a few salons.
- Losing the sole owner of a salon needs an operator recovery path; that path is
  privileged and must be audited (not designed here).
- Invite emails depend on provider deliverability; a pilot salon that never
  receives one needs a manual fallback.

## Open questions for implementation

1. Should `organization` ownership be modelled separately from `salon` ownership
   for franchise HQ, or is owner-per-salon enough for pilot?
2. Do we need a `pending_invites` table for visibility, or is the provider's
   invite state sufficient?
3. Owner recovery/transfer procedure and who may execute it.
