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
- explicit model/quality/size selection and a process-wide HTTP-attempt budget;
- cleanup of uploaded results when database finalization fails;
- a pinned local OpenCV YuNet/SFace scorer plus hard blocking of unmeasured results;
- graceful termination plus `/healthz`, `/readyz`, and aggregate `/metrics`;
- a non-root, hosting-neutral OCI image definition.

The quality status and exposure policy mirror the TypeScript domain.
`HAIR_TWIN_CV_PROVIDER=fail_closed` remains the safe default. The explicit
`local_cv` adapter uses pinned OpenCV 4.13.0.92, MIT-licensed YuNet, and
Apache-2.0 SFace inside a bounded child process. Vectors and image intermediates
remain in memory. Model files are downloaded from the official OpenCV Zoo and
SHA-256 verified during the Docker build; they are not committed.

Run tests and the worker:

```powershell
python -m unittest discover -s tests -v
python -m app.main
```

`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, provider settings, and the explicit
external-transfer gates are required for the production-shaped process.
Provider responses and decoded mask/source dimensions are bounded before
allocation; private object paths must match the claimed salon and session.

The worker refuses real-provider startup unless model, quality, size, privacy
gates, API key, and `OPENAI_IMAGE_MAX_CALLS_PER_PROCESS > 0` are all explicit.
Retries consume that same call budget. The actual demo defaults to zero retries,
one candidate, and a `source` size resolved to an explicit GPT Image 2 size.
Use `.env.example` only as a variable
inventory; never commit its filled-in copy.

See `docs/operations/actual-ai-demo.md` for metrics, licenses, cost approval,
retention, and the end-to-end demo procedure.
