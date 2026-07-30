import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { AuthContext } from "../supabase/auth";
import { supabasePublicConfig } from "../supabase/config";
import { decodeGridPng, encodeGridPng } from "../media/grid-png";
import { fromRows, toRows, type MaskAssetRow, type MaskContractRow } from "./mask-contract-mapping";
import { runSupabaseRetentionSweep } from "../services/supabase-retention";
import type { HairTwinStore, MaskContractRecord, MediaToken, StoredAsset } from "./types";
import type { AuditEvent, ConsultationSession, GeneratedCandidate, GenerationJob, QualityCheckResult, SourceImageRef } from "../domain/types";

type Row = Record<string, unknown>;

export class SupabaseStore implements HairTwinStore {
  private readonly pending = new Map<string, StoredAsset>();
  private readonly url: string;
  private readonly key: string;

  constructor(private readonly auth: AuthContext) {
    const config = supabasePublicConfig();
    this.url = config.url;
    this.key = config.publishableKey;
  }

  private async rest(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await fetch(`${this.url}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: this.key,
        authorization: `Bearer ${this.auth.accessToken}`,
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Supabase request failed (${response.status})`);
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  private async rows(path: string): Promise<Row[]> {
    const value = await this.rest(path);
    return Array.isArray(value) ? (value as Row[]) : [];
  }

  private async insert(table: string, body: Row | Row[]): Promise<Row[]> {
    const value = await this.rest(table, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(body),
    });
    return Array.isArray(value) ? (value as Row[]) : [];
  }

  private async patch(table: string, query: string, body: Row): Promise<Row[]> {
    const value = await this.rest(`${table}?${query}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(body),
    });
    return Array.isArray(value) ? (value as Row[]) : [];
  }

  private async rpc(name: string, body: Row): Promise<unknown> {
    return this.rest(`rpc/${name}`, { method: "POST", body: JSON.stringify(body) });
  }

  private storageHeaders(mime?: string) {
    return {
      apikey: this.key,
      authorization: `Bearer ${this.auth.accessToken}`,
      ...(mime ? { "content-type": mime, "x-upsert": "false" } : {}),
    };
  }

  private storageUrl(bucket: string, path: string) {
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    return `${this.url}/storage/v1/object/${bucket}/${encoded}`;
  }

  private async upload(bucket: string, path: string, bytes: Buffer, mime: string) {
    const response = await fetch(this.storageUrl(bucket, path), {
      method: "POST",
      headers: this.storageHeaders(mime),
      body: new Uint8Array(bytes),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`private Storage upload failed (${response.status})`);
  }

  private async download(bucket: string, path: string) {
    const response = await fetch(this.storageUrl(bucket, path), {
      headers: this.storageHeaders(),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`private Storage download failed (${response.status})`);
    return Buffer.from(await response.arrayBuffer());
  }

  private async remove(bucket: string, path: string) {
    let lastStatus = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetch(this.storageUrl(bucket, path), { method: "DELETE", headers: this.storageHeaders(), cache: "no-store" });
      lastStatus = response.status;
      if (response.ok || response.status === 404) return;
    }
    throw new Error(`private Storage cleanup failed (${lastStatus})`);
  }

  private async sessionFromRow(row: Row): Promise<ConsultationSession> {
    const sessionId = String(row.id);
    const [notes, sources] = await Promise.all([
      this.rows(`consultation_notes?select=*&session_id=eq.${sessionId}&limit=1`),
      this.rows(`source_images?select=id&session_id=eq.${sessionId}&order=created_at.desc&limit=1`),
    ]);
    let consent: ConsultationSession["consent"];
    if (row.consent_id) {
      const consentRows = await this.rows(`consent_records?select=*&id=eq.${row.consent_id}&limit=1`);
      const c = consentRows[0];
      if (c) consent = {
        captureConsented: Boolean(c.capture_consented),
        saveImagesConsented: Boolean(c.save_images_consented),
        saveReportConsented: Boolean(c.save_report_consented),
        wordingVersion: String(c.wording_version),
        consentedAt: String(c.consented_at),
        ...(c.revoked_at ? { revokedAt: String(c.revoked_at) } : {}),
      };
    }
    const note = notes[0];
    return {
      id: sessionId,
      salonId: String(row.salon_id),
      stylistId: String(row.stylist_id ?? this.auth.userId),
      customerAlias: String(row.customer_alias),
      stage: row.stage as ConsultationSession["stage"],
      ...(consent ? { consent } : {}),
      ...(sources[0]?.id ? { sourceImageId: String(sources[0].id) } : {}),
      ...(row.selected_style_id ? { selectedStyleId: String(row.selected_style_id) } : {}),
      note: {
        memoKo: String(note?.memo ?? ""),
        feasibility: (note?.feasibility ?? "") as ConsultationSession["note"]["feasibility"],
        estimatedPrice: String(note?.estimated_price ?? ""),
        estimatedTime: String(note?.estimated_time ?? ""),
        careNotesKo: String(note?.care_notes ?? ""),
        updatedAt: String(note?.updated_at ?? row.updated_at),
      },
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      ...(row.expires_at ? { expiresAt: String(row.expires_at) } : {}),
    };
  }

  async createSession(session: ConsultationSession) {
    const [row] = await this.insert("consultation_sessions", {
      id: session.id,
      salon_id: this.auth.salonId,
      stylist_id: this.auth.userId,
      customer_alias: session.customerAlias,
      stage: session.stage,
      expires_at: session.expiresAt ?? null,
    });
    await this.insert("consultation_notes", {
      salon_id: this.auth.salonId,
      session_id: session.id,
      memo: session.note.memoKo,
      feasibility: session.note.feasibility,
      estimated_price: session.note.estimatedPrice,
      estimated_time: session.note.estimatedTime,
      care_notes: session.note.careNotesKo,
    });
    return this.sessionFromRow(row!);
  }

  async getSession(id: string) {
    const row = (await this.rows(`consultation_sessions?select=*&id=eq.${encodeURIComponent(id)}&limit=1`))[0];
    return row ? this.sessionFromRow(row) : undefined;
  }

  async updateSession(id: string, patchValue: Partial<ConsultationSession>) {
    const update: Row = {};
    if (patchValue.stage) update.stage = patchValue.stage;
    if (patchValue.selectedStyleId !== undefined) update.selected_style_id = patchValue.selectedStyleId ?? null;
    if (patchValue.expiresAt !== undefined) update.expires_at = patchValue.expiresAt ?? null;
    if (patchValue.customerAlias) update.customer_alias = patchValue.customerAlias;
    if (patchValue.consent) {
      const [consent] = await this.insert("consent_records", {
        salon_id: this.auth.salonId,
        capture_consented: patchValue.consent.captureConsented,
        save_images_consented: patchValue.consent.saveImagesConsented,
        save_report_consented: patchValue.consent.saveReportConsented,
        wording_version: patchValue.consent.wordingVersion,
        consented_at: patchValue.consent.consentedAt,
      });
      update.consent_id = consent!.id;
    }
    if (patchValue.note) {
      await this.patch("consultation_notes", `session_id=eq.${id}`, {
        memo: patchValue.note.memoKo,
        feasibility: patchValue.note.feasibility,
        estimated_price: patchValue.note.estimatedPrice,
        estimated_time: patchValue.note.estimatedTime,
        care_notes: patchValue.note.careNotesKo,
      });
    }
    const rows = Object.keys(update).length
      ? await this.patch("consultation_sessions", `id=eq.${id}`, update)
      : await this.rows(`consultation_sessions?select=*&id=eq.${id}&limit=1`);
    return rows[0] ? this.sessionFromRow(rows[0]) : undefined;
  }

  private extension(mime: string) {
    const ext: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
    const value = ext[mime];
    if (!value) throw new Error("unsupported image MIME");
    return value;
  }

  async putAsset(asset: StoredAsset) {
    const source = (await this.rows(`source_images?select=id&id=eq.${asset.id}&limit=1`))[0];
    const generated = source ? undefined : (await this.rows(`generated_assets?select=id&id=eq.${asset.id}&limit=1`))[0];
    if (source) {
      if (!asset.saved) await this.rpc("expire_unsaved_asset", { p_asset_id: asset.id });
      else await this.rpc("save_asset_with_consent", { p_asset_id: asset.id });
    } else if (generated) {
      if (!asset.saved) await this.rpc("expire_unsaved_asset", { p_asset_id: asset.id });
      else await this.rpc("save_asset_with_consent", { p_asset_id: asset.id });
    } else {
      this.pending.set(asset.id, asset);
    }
    return asset;
  }

  async putSourceImage(ref: SourceImageRef) {
    const asset = this.pending.get(ref.id);
    if (!asset) {
      const existing = (await this.rows(`source_images?select=id&id=eq.${ref.id}&limit=1`))[0];
      if (!existing) throw new Error("source bytes are not pending in this request");
      await this.patch("source_images", `id=eq.${ref.id}`, { saved: ref.saved, expires_at: ref.expiresAt ?? null });
      return ref;
    }
    const path = `${this.auth.salonId}/${ref.sessionId}/${ref.id}.${this.extension(ref.mime)}`;
    await this.upload("source-images-private", path, asset.bytes, ref.mime);
    try {
      await this.insert("source_images", {
        id: ref.id, salon_id: this.auth.salonId, session_id: ref.sessionId,
        storage_path: path, mime: ref.mime, width: ref.width, height: ref.height,
        saved: ref.saved, expires_at: ref.expiresAt ?? null,
      });
      this.pending.delete(ref.id);
      return ref;
    } catch (error) {
      await this.remove("source-images-private", path);
      throw error;
    }
  }

  async getSourceImage(id: string) {
    const row = (await this.rows(`source_images?select=*&id=eq.${id}&limit=1`))[0];
    if (!row) return undefined;
    return {
      id: String(row.id), sessionId: String(row.session_id), mime: String(row.mime),
      width: Number(row.width), height: Number(row.height), createdAt: String(row.created_at),
      saved: Boolean(row.saved), ...(row.expires_at ? { expiresAt: String(row.expires_at) } : {}),
    } satisfies SourceImageRef;
  }

  private async assetRow(id: string): Promise<{ row: Row; bucket: string; kind: StoredAsset["kind"] } | undefined> {
    const source = (await this.rows(`source_images?select=*&id=eq.${id}&limit=1`))[0];
    if (source) return { row: source, bucket: "source-images-private", kind: "source" };
    const mask = (await this.rows(`mask_assets?select=*&id=eq.${id}&limit=1`))[0];
    if (mask) return { row: mask, bucket: "masks-private", kind: mask.kind === "region_map" ? "region_map" : "mask" };
    const generated = (await this.rows(`generated_assets?select=*&id=eq.${id}&limit=1`))[0];
    if (generated) return { row: generated, bucket: "generated-assets-private", kind: "candidate" };
    return undefined;
  }

  async getAsset(id: string) {
    const pending = this.pending.get(id);
    if (pending) return pending;
    const found = await this.assetRow(id);
    if (!found) return undefined;
    const stored = await this.download(found.bucket, String(found.row.storage_path));
    const isGrid = found.kind === "mask" || found.kind === "region_map";
    const width = Number(found.row.width ?? 0);
    const height = Number(found.row.height ?? 0);
    return {
      id, kind: found.kind, sessionId: String(found.row.session_id),
      mime: isGrid ? "application/octet-stream" : String(found.row.mime),
      width, height,
      bytes: isGrid ? decodeGridPng(stored, width, height) : stored,
      createdAt: String(found.row.created_at ?? new Date().toISOString()),
      saved: Boolean(found.row.saved),
      ...(found.row.expires_at ? { expiresAt: String(found.row.expires_at) } : {}),
    } satisfies StoredAsset;
  }

  async markAssetSaved(id: string, saved: boolean) {
    const found = await this.assetRow(id);
    if (!found) return;
    if (saved) {
      await this.rpc("save_asset_with_consent", { p_asset_id: id });
      return;
    }
    await this.rpc("expire_unsaved_asset", { p_asset_id: id });
  }

  async putMaskContract(contract: MaskContractRecord) {
    const mapped = toRows(contract, this.auth.salonId);
    await this.insert("mask_contracts", mapped.contract as unknown as Row);
    const uploaded: string[] = [];
    try {
      for (const row of mapped.assets) {
        const pending = this.pending.get(row.id);
        if (!pending) throw new Error(`mask bytes ${row.id} are not pending in this request`);
        const png = encodeGridPng(pending.bytes, row.width, row.height);
        await this.upload("masks-private", row.storage_path, png, "image/png");
        uploaded.push(row.storage_path);
      }
      if (mapped.assets.length) await this.insert("mask_assets", mapped.assets as unknown as Row[]);
      mapped.assets.forEach((row) => this.pending.delete(row.id));
      return contract;
    } catch (error) {
      await Promise.all(uploaded.map((path) => this.remove("masks-private", path)));
      await this.rest(`mask_contracts?id=eq.${contract.id}`, { method: "DELETE" }).catch(() => undefined);
      throw error;
    }
  }

  private async maskContract(id: string) {
    const contract = (await this.rows(`mask_contracts?select=*&id=eq.${id}&limit=1`))[0];
    if (!contract) return undefined;
    const assets = await this.rows(`mask_assets?select=*&mask_contract_id=eq.${id}`);
    return fromRows({ contract: contract as unknown as MaskContractRow, assets: assets as unknown as MaskAssetRow[] });
  }

  getMaskContract(id: string) { return this.maskContract(id); }
  async listMaskContractsForSource(sourceImageId: string) {
    const contracts = await this.rows(`mask_contracts?select=*&source_image_id=eq.${sourceImageId}&order=created_at.desc,attempt.desc`);
    return Promise.all(contracts.map(async (contract) => {
      const assets = await this.rows(`mask_assets?select=*&mask_contract_id=eq.${contract.id}`);
      return fromRows({ contract: contract as unknown as MaskContractRow, assets: assets as unknown as MaskAssetRow[] });
    }));
  }

  private async jobFromRow(row: Row): Promise<GenerationJob> {
    const candidates = await this.rows(`generated_assets?select=id&job_id=eq.${row.id}&order=created_at.asc`);
    return {
      id: String(row.id), sessionId: String(row.session_id), sourceImageId: String(row.source_image_id),
      styleId: String(row.style_id), mode: row.mode as GenerationJob["mode"], status: row.status as GenerationJob["status"],
      candidateCount: Number(row.candidate_count), attempts: Number(row.attempts), maxAttempts: Number(row.max_attempts),
      candidateIds: candidates.map((candidate) => String(candidate.id)),
      ...(row.failure_reason ? { failureReason: String(row.failure_reason) } : {}),
      provider: String(row.provider), model: String(row.model), maskContractId: String(row.mask_contract_id),
      maskContractVersion: String(row.mask_contract_version), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    };
  }

  async createJob(job: GenerationJob) {
    const [row] = await this.insert("generation_jobs", {
      id: job.id, salon_id: this.auth.salonId, session_id: job.sessionId,
      source_image_id: job.sourceImageId, style_id: job.styleId, mode: job.mode,
      status: "queued", candidate_count: job.candidateCount, attempts: job.attempts,
      max_attempts: job.maxAttempts, provider: job.provider, model: job.model,
      mask_contract_id: job.maskContractId, mask_contract_version: job.maskContractVersion,
    });
    return this.jobFromRow(row!);
  }

  async getJob(id: string) {
    const row = (await this.rows(`generation_jobs?select=*&id=eq.${id}&limit=1`))[0];
    return row ? this.jobFromRow(row) : undefined;
  }

  async updateJob(id: string, value: Partial<GenerationJob>) {
    if (value.status === "created" && value.maskContractId) {
      await this.rpc("retry_generation_job", { p_job_id: id, p_mask_contract_id: value.maskContractId });
      return this.getJob(id);
    }
    const update: Row = {};
    if (value.status) update.status = value.status === "created" ? "queued" : value.status;
    if (value.attempts !== undefined) update.attempts = value.attempts;
    if (value.failureReason !== undefined) update.failure_reason = value.failureReason ?? null;
    if (value.maskContractId) update.mask_contract_id = value.maskContractId;
    if (value.maskContractVersion) update.mask_contract_version = value.maskContractVersion;
    if (value.provider !== undefined) update.provider = value.provider;
    if (value.model !== undefined) update.model = value.model;
    const rows = await this.patch("generation_jobs", `id=eq.${id}`, update);
    return rows[0] ? this.jobFromRow(rows[0]) : undefined;
  }

  async listJobsForSession(sessionId: string) {
    const rows = await this.rows(`generation_jobs?select=*&session_id=eq.${sessionId}&order=created_at.asc`);
    return Promise.all(rows.map((row) => this.jobFromRow(row)));
  }

  private qualityFromRow(row: Row): QualityCheckResult {
    const signals = (row.signals ?? {}) as Record<string, number>;
    return {
      status: row.status as QualityCheckResult["status"], hardFail: Boolean(row.hard_fail),
      softFlags: (row.soft_flags ?? []) as string[], hardReasons: (row.hard_reasons ?? []) as string[],
      signals: {
        identitySimilarity: Number(signals.identity_similarity ?? 0), landmarkDelta: Number(signals.landmark_delta ?? 0),
        nonHairDiff: Number(signals.non_hair_diff ?? 0), hairCoverageRatio: Number(signals.hair_coverage_ratio ?? 0),
        faceCount: Number(signals.face_count ?? 0), realismScore: Number(signals.realism_score ?? 0),
        styleMatch: Number(signals.style_match ?? 0),
      },
      evaluatedAt: String(row.evaluated_at),
    };
  }

  private async candidateFromRow(row: Row): Promise<GeneratedCandidate> {
    const quality = (await this.rows(`quality_checks?select=*&asset_id=eq.${row.id}&limit=1`))[0];
    if (!quality) throw new Error("generated asset has no quality check");
    const job = (await this.rows(`generation_jobs?select=style_id&id=eq.${row.job_id}&limit=1`))[0];
    return {
      id: String(row.id), jobId: String(row.job_id), assetId: String(row.id), styleId: String(job?.style_id ?? ""),
      variantLabel: String(row.variant_label), seed: Number(row.seed ?? 0), quality: this.qualityFromRow(quality),
      ...(row.stylist_verdict ? { stylistVerdict: row.stylist_verdict as GeneratedCandidate["stylistVerdict"] } : {}),
      provider: String(row.provider), model: String(row.model), createdAt: String(row.created_at),
    };
  }

  async putCandidate(_candidate: GeneratedCandidate): Promise<GeneratedCandidate> {
    throw new Error("production candidates are created only by worker_finish_generation_job");
  }

  async getCandidate(id: string) {
    const row = (await this.rows(`generated_assets?select=*&id=eq.${id}&limit=1`))[0];
    return row ? this.candidateFromRow(row) : undefined;
  }

  async updateCandidate(id: string, value: Partial<GeneratedCandidate>) {
    if (value.stylistVerdict !== undefined) {
      await this.rpc("set_generated_asset_verdict", { p_asset_id: id, p_verdict: value.stylistVerdict });
      return this.getCandidate(id);
    }
    const update: Row = {};
    if (value.stylistVerdict !== undefined) update.stylist_verdict = value.stylistVerdict ?? null;
    const rows = await this.patch("generated_assets", `id=eq.${id}`, update);
    return rows[0] ? this.candidateFromRow(rows[0]) : undefined;
  }

  async listCandidatesForJob(jobId: string) {
    const rows = await this.rows(`generated_assets?select=*&job_id=eq.${jobId}&order=created_at.asc`);
    return Promise.all(rows.map((row) => this.candidateFromRow(row)));
  }

  private mediaSecret() {
    const secret = process.env.MEDIA_TOKEN_SECRET ?? process.env.SUPABASE_SECRET_KEY;
    if (!secret) throw new Error("MEDIA_TOKEN_SECRET is required");
    return secret;
  }

  async issueMediaToken(assetId: string, ttlMs: number): Promise<MediaToken> {
    if (!(await this.assetRow(assetId))) throw new Error("asset not found");
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    const payload = Buffer.from(JSON.stringify({ assetId, exp: Date.parse(expiresAt), userId: this.auth.userId })).toString("base64url");
    const signature = createHmac("sha256", this.mediaSecret()).update(payload).digest("base64url");
    return { token: `${payload}.${signature}`, assetId, expiresAt };
  }

  async resolveMediaToken(token: string) {
    const [payload, signature] = token.split(".");
    if (!payload || !signature) return undefined;
    const expected = createHmac("sha256", this.mediaSecret()).update(payload).digest();
    let provided: Buffer;
    try { provided = Buffer.from(signature, "base64url"); } catch { return undefined; }
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return undefined;
    try {
      const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as { assetId: string; exp: number; userId: string };
      if (data.userId !== this.auth.userId || data.exp < Date.now()) return undefined;
      return data.assetId;
    } catch { return undefined; }
  }

  async appendAudit(event: AuditEvent) {
    await this.insert("audit_events", {
      id: event.id, salon_id: this.auth.salonId, session_id: event.sessionId,
      action: event.action, actor_id: this.auth.userId, detail: event.detail ?? {}, created_at: event.createdAt,
    });
  }

  async listAudit(sessionId: string) {
    const rows = await this.rows(`audit_events?select=*&session_id=eq.${sessionId}&order=created_at.asc`);
    return rows.map((row) => ({
      id: String(row.id), sessionId: String(row.session_id), action: row.action as AuditEvent["action"],
      actorId: String(row.actor_id), detail: row.detail as Record<string, unknown>, createdAt: String(row.created_at),
    }));
  }

  async sweepExpired() {
    const result = await runSupabaseRetentionSweep();
    return { removedAssets: result.deleted, deletedContracts: 0, purgedContracts: [] };
  }
}
