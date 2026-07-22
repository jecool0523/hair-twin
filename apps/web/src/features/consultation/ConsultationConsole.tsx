"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Scissors,
  Users,
  UserCog,
  RefreshCw,
  Save,
  Trash2,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { api, ApiError } from "@/lib/client/api";
import { CONSENT_WORDING_VERSION } from "@/lib/config";
import type { SessionView } from "@/lib/dto";
import type { StylistVerdict, ConsultationNote } from "@/lib/domain/types";
import { ConsentGate, type ConsentValue } from "./ConsentGate";
import { CapturePanel, type CapturePayload } from "../capture/CapturePanel";
import { StylePicker } from "../generation/StylePicker";
import { GenerationProgress } from "../generation/GenerationProgress";
import { CandidateCompare } from "./CandidateCompare";
import { NotesPanel } from "./NotesPanel";
import { JOB_ACTIVE } from "./labels";

type Mode = "stylist" | "customer";

function latestJob(s: SessionView) {
  return s.jobs[s.jobs.length - 1];
}

function uiStage(s: SessionView): string {
  if (s.stage === "saved") return "saved";
  if (s.stage === "discarded") return "discarded";
  if (!s.consent) return "consent";
  if (!s.hasSource) return "capture";
  const job = latestJob(s);
  if (!job) return "style";
  if (JOB_ACTIVE.includes(job.status)) return "generating";
  if (job.status === "failed_hard" || job.status === "failed_retryable")
    return "generating"; // progress card shows retry
  return "review";
}

export function ConsultationConsole({
  sessionId,
  initialSession,
}: {
  sessionId: string;
  /** Server-rendered initial state, so there is no "starting…" flash. */
  initialSession: SessionView;
}) {
  const router = useRouter();
  const [session, setSession] = useState<SessionView>(initialSession);
  const [mode, setMode] = useState<Mode>("stylist");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [selectedForSave, setSelectedForSave] = useState<Set<string>>(new Set());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async (id: string) => {
    try {
      const view = await api.getSession(id);
      setSession(view);
      setError(null);
      return view;
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "세션을 불러오지 못했습니다.",
      );
      return null;
    }
  }, []);

  // The session identity comes from the URL, so a refresh resumes this same
  // consultation. No session is created on mount.

  // Poll while a job is active.
  const stage = uiStage(session);
  useEffect(() => {
    const job = latestJob(session);
    const active = job && JOB_ACTIVE.includes(job.status);
    if (active && !pollRef.current) {
      pollRef.current = setInterval(() => refresh(sessionId), 1200);
    }
    if (!active && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [session, sessionId, refresh]);

  // NOTE: if the last approval is revoked while the customer view is open we do
  // NOT snap back to the stylist view — that would show the customer the QC
  // panel (scores, block reasons). Instead the customer view falls back to the
  // calm "미용사 검수 중" state (policy rule 4). Rule 6 only gates *entering*
  // the customer view.

  const withBusy = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : "요청에 실패했습니다.",
      );
    } finally {
      setBusy(false);
    }
  };

  const onConsent = (v: ConsentValue) =>
    withBusy(async () => {
      await api.consent(sessionId, {
        captureConsented: true,
        saveImagesConsented: v.saveImagesConsented,
        saveReportConsented: v.saveReportConsented,
        wordingVersion: CONSENT_WORDING_VERSION,
      });
      await refresh(sessionId);
    });

  const onCapture = (p: CapturePayload) =>
    withBusy(async () => {
      // Multipart: raw image bytes + the region map derived from that photo.
      // The server probes the real format/dimensions and derives the mask
      // contract; we keep only its id.
      const { maskContractId } = await api.uploadSource(sessionId, {
        blob: p.blob,
        regionMap: p.regionMap,
        preflight: {
          faceCount: p.preflight.faceCount,
          passed: p.preflight.passed,
          engine: p.preflight.engine,
        },
      });
      maskContractIdRef.current = maskContractId;
      await refresh(sessionId);
    });

  /** The persisted contract this capture produced. No client-side fallback: a
   *  job must reference real masks or not run at all. */
  const maskContractIdRef = useRef<string | null>(null);

  const onGenerate = (styleId: string, candidateCount: number) =>
    withBusy(async () => {
      const maskContractId = maskContractIdRef.current;
      if (!maskContractId) {
        throw new Error(
          "촬영 분석 데이터가 없습니다. 다시 촬영한 뒤 진행해 주세요.",
        );
      }
      await api.createJob(sessionId, {
        styleId,
        candidateCount,
        maskContractId,
      });
      await refresh(sessionId);
    });

  const onRetry = () =>
    withBusy(async () => {
      const job = latestJob(session);
      if (!job) return;
      await api.retryJob(job.id);
      await refresh(sessionId);
    });

  const onVerdict = (candidateId: string, verdict: StylistVerdict) =>
    withBusy(async () => {
      // The server rejects approving a hard-fail/regenerate candidate; the
      // error surfaces in the banner via withBusy.
      await api.setVerdict(candidateId, verdict);
      if (verdict !== "usable") {
        // Un-approving must also drop it from the save selection, otherwise a
        // stale selection could try to persist an unapproved candidate.
        setSelectedForSave((prev) => {
          const next = new Set(prev);
          next.delete(candidateId);
          return next;
        });
      }
      await refresh(sessionId);
    });

  const onSaveNote = (n: Omit<ConsultationNote, "updatedAt">) =>
    withBusy(async () => {
      await api.saveNote(sessionId, n);
      await refresh(sessionId);
    });

  const onDecision = (action: "save" | "discard") =>
    withBusy(async () => {
      await api.decide(sessionId, action, [...selectedForSave]);
      await refresh(sessionId);
    });

  const toggleSave = (id: string) =>
    setSelectedForSave((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Starting over means navigating to a brand-new consultation URL, so the
  // browser history and a later refresh both point at the right session.
  const startOver = async () => {
    setStarting(true);
    setError(null);
    try {
      const { sessionId: newId } = await api.startSession({
        stylistName: "개발용 미용사",
        customerAlias: "익명 고객",
      });
      setSelectedForSave(new Set());
      maskContractIdRef.current = null;
      router.push(`/consultation/${newId}`);
    } catch (e) {
      setStarting(false);
      setError(
        e instanceof Error ? e.message : "새 상담을 시작하지 못했습니다.",
      );
    }
  };

  const job = latestJob(session);
  // Policy rule 6: customer view/share is only enabled once the stylist has
  // approved at least one candidate.
  const approvedCount = job?.approvedCount ?? 0;
  const customerModeEnabled = approvedCount > 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Scissors className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-none">Hair Twin</h1>
            <p className="text-xs text-muted-foreground">살롱 헤어 상담 콘솔</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="neutral" className="hidden sm:inline-flex">
            {session.customerAlias}
          </Badge>
          <div className="flex overflow-hidden rounded-md border">
            <button
              onClick={() => setMode("stylist")}
              className={
                "flex items-center gap-1 px-3 py-1.5 text-sm " +
                (mode === "stylist"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background")
              }
            >
              <UserCog className="h-4 w-4" /> 미용사
            </button>
            <button
              onClick={() => customerModeEnabled && setMode("customer")}
              // Rule 6 gates *entering* the customer view. If we are already in
              // it, stay put (the view falls back to "미용사 검수 중").
              disabled={!customerModeEnabled && mode !== "customer"}
              title={
                customerModeEnabled
                  ? "고객에게 승인된 결과 보여주기"
                  : "승인된 후보가 없어 고객 보기를 사용할 수 없습니다"
              }
              className={
                "flex items-center gap-1 px-3 py-1.5 text-sm " +
                (mode === "customer"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background") +
                (!customerModeEnabled && mode !== "customer"
                  ? " cursor-not-allowed opacity-40"
                  : "")
              }
            >
              <Users className="h-4 w-4" /> 고객
              {approvedCount > 0 && (
                <span className="ml-0.5 rounded-full bg-[hsl(var(--success))] px-1.5 text-[10px] text-white">
                  {approvedCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-[hsl(var(--danger))]/30 bg-[hsl(var(--danger))]/5 p-3 text-sm text-[hsl(var(--danger))]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">{error}</span>
          {/* Every error is recoverable: re-read server state and carry on. */}
          <button
            onClick={() => refresh(sessionId)}
            className="shrink-0 underline underline-offset-2 hover:opacity-80"
          >
            다시 시도
          </button>
        </div>
      )}

      {stage === "consent" && (
        <ConsentGate
          wordingVersion={CONSENT_WORDING_VERSION}
          onConsent={onConsent}
          busy={busy}
        />
      )}

      {stage === "capture" && (
        <div className="mx-auto max-w-2xl">
          <CapturePanel onConfirm={onCapture} busy={busy} />
        </div>
      )}

      {stage === "style" && (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <StylePicker onGenerate={onGenerate} busy={busy} />
          <SourcePreview url={session.sourceUrl} />
        </div>
      )}

      {stage === "generating" && job && (
        <div className="mx-auto max-w-2xl space-y-4">
          <GenerationProgress job={job} onRetry={onRetry} retrying={busy} />
          <SourcePreview url={session.sourceUrl} />
        </div>
      )}

      {stage === "review" && job && (
        <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
          <div className="space-y-4">
            <CandidateCompare
              job={job}
              sourceUrl={session.sourceUrl}
              mode={mode}
              onVerdict={onVerdict}
              selectedForSave={selectedForSave}
              onToggleSave={toggleSave}
            />
          </div>
          {mode === "stylist" ? (
            <div className="space-y-4">
              <NotesPanel note={session.note} onSave={onSaveNote} />
              <DecisionBar
                canSave={Boolean(session.consent?.saveImagesConsented)}
                selectedCount={selectedForSave.size}
                busy={busy}
                onDecision={onDecision}
              />
            </div>
          ) : (
            <Card>
              <CardContent className="space-y-2 py-6 text-sm text-muted-foreground">
                <p className="text-base font-medium text-foreground">
                  마음에 드는 스타일이 있으신가요?
                </p>
                <p>
                  이 미리보기는 상담을 돕기 위한 참고 이미지입니다. 실제 시술
                  결과와 다를 수 있어요. 담당 미용사와 함께 확인해 주세요.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {(stage === "saved" || stage === "discarded") && (
        <Card className="mx-auto max-w-xl">
          <CardContent className="flex flex-col items-center gap-4 py-14 text-center">
            {stage === "saved" ? (
              <>
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[hsl(var(--success))]/15 text-[hsl(var(--success))]">
                  <Save className="h-6 w-6" />
                </div>
                <p className="text-lg font-medium">상담 결과가 저장되었습니다</p>
                <p className="text-sm text-muted-foreground">
                  동의하신 이미지와 메모가 보존되었습니다.
                </p>
              </>
            ) : (
              <>
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <Trash2 className="h-6 w-6" />
                </div>
                <p className="text-lg font-medium">상담 결과를 폐기했습니다</p>
                <p className="text-sm text-muted-foreground">
                  원본과 생성 이미지가 즉시 만료 처리되었습니다.
                </p>
              </>
            )}
            <Button onClick={startOver} variant="outline" disabled={starting}>
              <RefreshCw
                className={"h-4 w-4" + (starting ? " animate-spin" : "")}
              />
              {starting ? "새 상담 준비 중…" : "새 상담 시작"}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SourcePreview({ url }: { url?: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <p className="mb-2 text-xs text-muted-foreground">원본 (비공개)</p>
        <div className="relative aspect-[3/4] overflow-hidden rounded-md bg-black/90">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="원본" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-white/50">
              원본 없음
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function DecisionBar({
  canSave,
  selectedCount,
  busy,
  onDecision,
}: {
  canSave: boolean;
  selectedCount: number;
  busy?: boolean;
  onDecision: (a: "save" | "discard") => void;
}) {
  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <p className="text-sm font-medium">저장 또는 폐기</p>
        {!canSave && (
          <p className="rounded bg-muted p-2 text-xs text-muted-foreground">
            이미지 저장 동의가 없어 저장할 수 없습니다. 폐기만 가능합니다.
          </p>
        )}
        <div className="flex gap-2">
          <Button
            variant="success"
            disabled={!canSave || busy || selectedCount === 0}
            onClick={() => onDecision("save")}
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> 저장 중…
              </>
            ) : (
              <>
                <Save className="h-4 w-4" /> 저장 ({selectedCount})
              </>
            )}
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => onDecision("discard")}
          >
            <Trash2 className="h-4 w-4" /> 폐기
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          &quot;사용 가능&quot;으로 판정하고 저장 대상에 체크한 후보만
          저장됩니다.
        </p>
      </CardContent>
    </Card>
  );
}
