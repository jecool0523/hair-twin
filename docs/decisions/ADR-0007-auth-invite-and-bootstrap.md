# ADR-0007: Invite-only Auth and membership authority

Date: 2026-07-16
Status: Accepted and implemented locally

## Decision

There is no public signup. An operator bootstraps the first audited salon owner;
after that, owners and admins invite staff. Admins may invite stylists, owners
may invite admins or stylists, and stylists may not invite.

Invite creation, revocation, and acceptance are database-authoritative,
`SECURITY DEFINER` RPCs. They normalize email, use server timestamps and a fixed
TTL, reject terminal/expired/replayed state, and do not grant execute to anon or
service-role clients. Delivery is performed through an explicit server email
provider; production refuses a missing provider instead of silently succeeding.

`accept_salon_invite` reads a confirmed authenticated email from `auth.users`, creates
the profile and membership atomically, records an audit event, and is idempotent
for the same user. Authority is always read from `salon_memberships` through
RLS helpers. JWT/user metadata never grants a role.

Login and refresh use Supabase Auth with HttpOnly cookies. Every protected
request validates the user with Auth, resolves exactly one salon membership,
and passes the user's access token to PostgREST/Storage. A server secret is not
used to read application data on behalf of browser users.

Browser state changes require an exact same-origin `Origin` header. Login,
logout, invite, and session-start forms are size-bounded URL-encoded requests,
and post-login redirects accept only canonical internal paths. A GET of `/`
renders the start screen without creating a consultation; session creation is
an explicit POST.

## Secret scope

`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is browser-safe.
`SUPABASE_SECRET_KEY` is server/worker-only and is used only for deliberate
administrative, worker, and retention operations. It must not be logged,
committed, browser-prefixed, or used as a substitute for browser RLS.

## Remaining operations

- Provide an idempotent, audited hosted-environment owner bootstrap runbook.
- Configure and verify invite deliverability in staging.
- Define sole-owner recovery/transfer and franchise ownership procedures.
