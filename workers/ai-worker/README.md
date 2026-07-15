# Hair Twin AI Worker (Python)

The production home for long-running image generation, mask processing, and
CV-based quality scoring (ADR-0001, system-design §2). It is **skeleton-only**
in this first slice: the running consultation flow is driven by the in-process
worker simulation in `apps/web/src/lib/services/generation-worker.ts`, which
uses the identical Provider Adapter + Quality Gate contracts. Moving the work
here requires no product/UI change.

## Boundary

```
generation_jobs (Postgres)  --poll-->  worker
  -> load source image + hair_edit mask (private bucket)
  -> Provider Adapter (mock | openai | self-hosted)
  -> CV quality signals (identity / landmark / non-hair diff / realism)
  -> Quality Gate (same thresholds as the TS domain)
  -> write generated_assets + quality_checks
  -> update job status
```

## Contracts mirrored from the TS domain

- `app/providers/base.py` ↔ `apps/web/src/lib/providers/adapter.ts`
- `app/quality/gate.py`   ↔ `apps/web/src/lib/domain/quality.ts`
- `app/masks/region_map.py` ↔ `apps/web/src/lib/domain/masks.ts`

Keep the thresholds and status enums in sync across both implementations.

## Not wired yet (ADR-0003)

- Supabase connection (poller + storage) — placeholders in `app/storage/`.
- Real OpenAI image-edit call + CV models — `providers/openai_image_edit.py`,
  `quality/` are stubs.

## Run (once wired)

```
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
python -m app.main
```
