# Hair Twin CTO Technical Harness

## Setup Date

2026-07-01

## Local Project State

The repository is currently documentation-first. No application scaffold, `package.json`, local `.env` file, Supabase folder, Prisma schema, Drizzle config, or Vercel project linkage was present during setup.

Existing durable docs:

- `PROJECT_PLAN.md`
- `COO_OPERATING_SYSTEM.md`
- `COO_KNOWLEDGE_BASE.md`
- `COO_DECISION_PIPELINE.md`
- `.agents/CMO.md`
- `.agents/CTO.md`

## Runtime Status

Available on PATH:

- Node.js `v22.17.1`
- npm `11.7.0`
- Git `2.51.0.windows.1`

Available through the Codex bundled runtime:

- Node.js
- pnpm
- Python
- Git

Not found on PATH during setup:

- `vercel`
- `supabase`
- `pnpm`
- `bun`

This is acceptable for the current stage because connector tools are available and no app has been scaffolded yet. Install project-local CLIs only when a runnable app/backend exists.

## Plugin And Skill Harness

Loaded or verified for future CTO work:

- Build Web Apps: frontend app/prototype workflow.
- Product Design: saved Hair Twin context, design brief, ideation, audit, prototype, image-to-code workflows.
- Vercel: bootstrap/deployment guidance and connector tools.
- Supabase: database/security guidance and connector tools.

Product Design saved context already includes:

- Hair Twin workspace root.
- `PROJECT_PLAN.md`.
- COO operating docs.
- Premium salon-native product stance.

## MCP And Connector Status

Supabase:

- Connector access verified by listing projects.
- Related candidate project: `Hair Try-On` (`ixbxgrdvwtzdakniuwnd`), status `INACTIVE`.
- Do not attach this repo to that project until the user confirms it.
- Workspace `.mcp.json` is configured for Supabase docs-only, read-only remote MCP access.

Vercel:

- Connector access verified by listing teams.
- Team: `Je_CooL's projects` (`team_QOjgbqx5hA8DqImZ5hfkQDtw`).
- No Vercel projects were listed at setup time.

## Default Stack Recommendation For First App Build

Do not lock this until the first prototype request is concrete, but the default path is:

- Frontend: React + Vite for fast local prototype work, unless Next.js/Vercel deployment becomes the immediate goal.
- UI: salon-native dashboard/tool surface, not a marketing landing page.
- Styling: local CSS or a lightweight component system first; add shadcn only if the app needs a larger control surface.
- Backend: Supabase after data model and privacy requirements are explicit.
- Deployment: Vercel preview after there is a runnable app.
- AI pipeline: begin with provider-agnostic interface around image generation/editing so model choices can change.

## CTO Guardrails

- Never store raw face images by default.
- Separate temporary preview from saved consultation record.
- Require explicit consent before capture/save.
- Keep generated image lineage for auditability.
- Use project-scoped Supabase access before database writes.
- Enable RLS on every exposed table.
- Never expose service-role keys or secret keys to frontend code.
- Avoid production data in MCP workflows.
- Verify generated outputs with salon workflow criteria, not only image aesthetics.

## Next Environment Steps

Only after the user chooses the next build direction:

1. Scaffold the prototype app.
2. Add package manager lockfile.
3. Add `.env.example` with names only, no secrets.
4. Select or create Supabase project.
5. Scope Supabase MCP to the selected project.
6. Link/create Vercel project.
7. Add first database schema and RLS policies.
8. Start local dev server and verify the full consultation path.
