# Hair Twin AI worker

This dependency-light Python poller is the production-shaped generation path.
In Supabase mode the web app queues jobs; only the worker may claim and mutate
their lifecycle.

```text
generation_jobs -> claim RPC -> private source + mask download
  -> provider adapter -> quality gate -> private result upload
  -> atomic result/QC finish RPC (or retryable/permanent failure RPC)
```

Implemented controls:

- service-role-only claim, transition, finish, and failure RPCs;
- tenant/session path validation in both database and Storage adapters;
- lossless grid-PNG decoding and source-sized RGBA edit-mask conversion;
- deterministic mock provider only when both `HAIR_TWIN_PROVIDER=mock` and
  `HAIR_TWIN_ALLOW_MOCK=true` are explicitly set;
- OpenAI Images multipart edit transport, bounded retries, and safe errors;
- cleanup of uploaded results when database finalization fails;
- hard blocking of unmeasured external results.

The quality status and exposure policy mirror the TypeScript domain. Real
pixel-based identity, landmark, non-hair, and realism measurement is still a
production launch gate; vectors and image intermediates must remain in memory.

Run tests and the worker:

```powershell
python -m unittest discover -s tests -v
python -m app.main
```

`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, provider settings, and the explicit
external-transfer gates are required for the production-shaped process.
Provider responses and decoded mask/source dimensions are bounded before
allocation; private object paths must match the claimed salon and session.
