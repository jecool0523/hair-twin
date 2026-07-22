"use client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertTriangle, RotateCcw } from "lucide-react";
import type { JobView } from "@/lib/dto";
import { jobStatusLabel, JOB_ACTIVE } from "../consultation/labels";

const STEPS = ["queued", "masking", "generating", "quality_checking"] as const;

export function GenerationProgress({
  job,
  onRetry,
  retrying,
}: {
  job: JobView;
  onRetry: () => void;
  retrying?: boolean;
}) {
  const active = JOB_ACTIVE.includes(job.status);
  const failed = job.status === "failed_retryable" || job.status === "failed_hard";
  const currentStepIdx = STEPS.indexOf(job.status as (typeof STEPS)[number]);

  return (
    <Card>
      <CardHeader>
        {/* The status Badge is a sibling of the title, not inside it: nesting it
            made screen readers announce "생성 진행 상태대기열 등록". */}
        <div className="flex items-center gap-2">
          {active && <Loader2 className="h-5 w-5 animate-spin text-primary" />}
          {failed && (
            <AlertTriangle className="h-5 w-5 text-[hsl(var(--danger))]" />
          )}
          <CardTitle>생성 진행 상태</CardTitle>
          <Badge tone={failed ? "danger" : active ? "info" : "success"}>
            {jobStatusLabel(job.status)}
          </Badge>
        </div>
        {/* Announce status changes to assistive tech without stealing focus. */}
        <p aria-live="polite" className="sr-only">
          생성 상태: {jobStatusLabel(job.status)}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <ol className="space-y-2">
          {STEPS.map((step, i) => {
            const done = currentStepIdx > i || (!active && !failed);
            const isCurrent = job.status === step;
            return (
              <li key={step} className="flex items-center gap-3 text-sm">
                <span
                  className={
                    "flex h-6 w-6 items-center justify-center rounded-full text-xs " +
                    (done
                      ? "bg-[hsl(var(--success))] text-white"
                      : isCurrent
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground")
                  }
                >
                  {done ? "✓" : i + 1}
                </span>
                <span className={isCurrent ? "font-medium" : ""}>
                  {jobStatusLabel(step)}
                </span>
                {isCurrent && active && (
                  <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                )}
              </li>
            );
          })}
        </ol>

        {active && (
          <p className="text-sm text-muted-foreground">
            상담 흐름을 끊지 않도록 생성이 백그라운드에서 진행됩니다. 잠시만
            기다려 주세요.
          </p>
        )}

        {failed && (
          <div className="space-y-3 rounded-md border border-[hsl(var(--danger))]/30 bg-[hsl(var(--danger))]/5 p-3 text-sm">
            <p className="text-[hsl(var(--danger))]">
              {job.failureReason ?? "생성에 실패했습니다."}
            </p>
            <p className="text-xs text-muted-foreground">
              시도 {job.attempts}/{job.maxAttempts}
            </p>
            {job.status === "failed_retryable" ? (
              <Button size="sm" onClick={onRetry} disabled={retrying}>
                <RotateCcw className="h-4 w-4" />
                {retrying ? "재시도 중…" : "더 안전한 설정으로 재시도"}
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">
                재시도 한도에 도달했습니다. 스타일을 다시 선택하거나 다시
                촬영해 주세요.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
