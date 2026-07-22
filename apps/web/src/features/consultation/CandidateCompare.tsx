"use client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Loader2, ShieldAlert, Eye, EyeOff } from "lucide-react";
import type { CandidateView, JobView } from "@/lib/dto";
import type { StylistVerdict } from "@/lib/domain/types";
import { qualityLabel, qualityTone } from "./labels";

export function CandidateCompare({
  job,
  sourceUrl,
  mode,
  onVerdict,
  selectedForSave,
  onToggleSave,
}: {
  job: JobView;
  sourceUrl?: string;
  mode: "stylist" | "customer";
  onVerdict: (candidateId: string, verdict: StylistVerdict) => void;
  selectedForSave: Set<string>;
  onToggleSave: (candidateId: string) => void;
}) {
  const customerVisible = job.candidates.filter((c) => c.customerVisible);
  const shown = mode === "customer" ? customerVisible : job.candidates;

  // Policy rule 4: before the stylist approves anything, the customer sees a
  // "미용사 검수 중" state — never the candidates themselves.
  if (mode === "customer" && customerVisible.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-lg font-medium">미용사 검수 중</p>
          <p className="max-w-md text-sm text-muted-foreground">
            담당 미용사가 결과를 확인하고 있습니다. 검수를 마친 스타일만
            보여드릴게요. 잠시만 기다려 주세요.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {mode === "customer" ? "스타일 미리보기" : "후보 비교 · 품질 검수"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className={cn(
            "grid gap-4",
            mode === "customer"
              ? "grid-cols-1 sm:grid-cols-2"
              : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3",
          )}
        >
          {/* Original */}
          <figure className="space-y-2">
            <div className="relative aspect-[3/4] overflow-hidden rounded-lg bg-black/90">
              {sourceUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={sourceUrl}
                  alt="원본"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-white/60">
                  원본 없음
                </div>
              )}
              <span className="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
                원본
              </span>
            </div>
          </figure>

          {shown.map((c) => (
            <CandidateTile
              key={c.id}
              candidate={c}
              mode={mode}
              onVerdict={onVerdict}
              selected={selectedForSave.has(c.id)}
              onToggleSave={onToggleSave}
            />
          ))}
        </div>

        {mode === "stylist" && (
          <p className="mt-4 text-xs text-muted-foreground">
            <ShieldAlert className="mr-1 inline h-3 w-3" />
            고객 화면에는 <strong>&quot;사용 가능&quot;으로 승인한 후보만</strong>{" "}
            표시됩니다. 승인 전에는 고객에게 &quot;미용사 검수 중&quot; 상태가
            보입니다. 자동 검수 차단·재생성 후보는 승인해도 노출되지 않습니다.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function CandidateTile({
  candidate: c,
  mode,
  onVerdict,
  selected,
  onToggleSave,
}: {
  candidate: CandidateView;
  mode: "stylist" | "customer";
  onVerdict: (id: string, v: StylistVerdict) => void;
  selected: boolean;
  onToggleSave: (id: string) => void;
}) {
  return (
    <figure className="space-y-2">
      <div className="relative aspect-[3/4] overflow-hidden rounded-lg bg-black/90">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={c.mediaUrl}
          alt={c.variantLabel}
          className={cn(
            "h-full w-full object-cover",
            c.hardFail && mode === "stylist" && "opacity-70",
          )}
        />
        <span className="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
          {c.variantLabel}
        </span>
        {mode === "stylist" && (
          <span className="absolute right-2 top-2 flex flex-col items-end gap-1">
            <Badge tone={qualityTone(c.qualityStatus)}>
              {qualityLabel(c.qualityStatus)}
            </Badge>
            {/* Live customer-exposure state, derived from the current verdict. */}
            <Badge tone={c.customerVisible ? "success" : "neutral"}>
              {c.customerVisible ? (
                <>
                  <Eye className="h-3 w-3" /> 고객 노출 중
                </>
              ) : (
                <>
                  <EyeOff className="h-3 w-3" /> 고객 비노출
                </>
              )}
            </Badge>
          </span>
        )}
      </div>

      {mode === "stylist" && (
        <div className="space-y-2 text-xs">
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-muted-foreground">
            <span>얼굴 유사도: {pct(c.signals.identitySimilarity)}</span>
            <span>헤어외 변화: {pct(c.signals.nonHairDiff)}</span>
            <span>사실성: {pct(c.signals.realismScore)}</span>
            <span>스타일 일치: {pct(c.signals.styleMatch)}</span>
          </div>
          {(c.softFlags.length > 0 || c.hardReasons.length > 0) && (
            <ul className="list-inside list-disc text-[hsl(var(--warning))]">
              {[...c.hardReasons, ...c.softFlags].map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}

          {/* Policy rule 3: approval is only offered when the candidate is
              approvable. Hard-fail / regenerate can never reach the customer. */}
          {c.canApprove ? (
            <div className="flex flex-wrap gap-1.5 pt-1">
              <VerdictButton
                active={c.stylistVerdict === "usable"}
                tone="success"
                onClick={() => onVerdict(c.id, "usable")}
              >
                {c.stylistVerdict === "usable" ? "고객에게 공개됨" : "사용 가능"}
              </VerdictButton>
              <VerdictButton
                active={c.stylistVerdict === "needs_manual_review"}
                tone="secondary"
                onClick={() => onVerdict(c.id, "needs_manual_review")}
              >
                수동 검토
              </VerdictButton>
              <VerdictButton
                active={c.stylistVerdict === "regenerate"}
                tone="danger"
                onClick={() => onVerdict(c.id, "regenerate")}
              >
                재생성
              </VerdictButton>
            </div>
          ) : (
            <p className="rounded bg-[hsl(var(--danger))]/10 px-2 py-1 text-[hsl(var(--danger))]">
              {c.notApprovableReason ?? "고객 노출 불가"}
            </p>
          )}

          {c.customerVisible && (
            <label className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                checked={selected}
                onChange={() => onToggleSave(c.id)}
              />
              저장 대상에 포함
            </label>
          )}
        </div>
      )}
    </figure>
  );
}

function VerdictButton({
  active,
  tone,
  onClick,
  children,
}: {
  active: boolean;
  tone: "success" | "secondary" | "danger";
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      size="sm"
      variant={active ? tone : "outline"}
      className="h-8 px-2 text-xs"
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}
