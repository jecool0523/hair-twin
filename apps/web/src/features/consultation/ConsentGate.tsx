"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck } from "lucide-react";

export interface ConsentValue {
  saveImagesConsented: boolean;
  saveReportConsented: boolean;
}

export function ConsentGate({
  wordingVersion,
  onConsent,
  busy,
}: {
  wordingVersion: string;
  onConsent: (v: ConsentValue) => void;
  busy?: boolean;
}) {
  const [saveImages, setSaveImages] = useState(false);
  const [saveReport, setSaveReport] = useState(false);

  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <CardTitle>상담 시작 전 동의</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="rounded-md bg-muted p-4 text-sm leading-relaxed text-muted-foreground">
          <Badge tone="warning" className="mb-2">
            임시 문구 · 법률 검토 필요
          </Badge>
          <p>
            이 서비스는 <strong>시술 전 상담을 돕기 위한 미리보기</strong>입니다.
            생성 결과는 참고용이며 실제 시술 결과를 보장하지 않습니다. 촬영한
            이미지는 상담 진행에만 사용되며, <strong>저장에 동의하지 않으면
            일정 시간 후 자동으로 삭제</strong>됩니다.
          </p>
          <p className="mt-2 text-xs opacity-70">
            문구 버전: {wordingVersion} (확정 전 초안)
          </p>
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4"
            checked={saveImages}
            onChange={(e) => setSaveImages(e.target.checked)}
          />
          <span className="text-sm">
            <span className="font-medium">이미지 저장에 동의합니다.</span>
            <span className="block text-muted-foreground">
              동의하지 않아도 상담 미리보기는 진행할 수 있습니다. 동의 시에만
              결과 이미지가 보존됩니다.
            </span>
          </span>
        </label>

        <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4"
            checked={saveReport}
            onChange={(e) => setSaveReport(e.target.checked)}
          />
          <span className="text-sm">
            <span className="font-medium">상담 리포트 저장에 동의합니다.</span>
            <span className="block text-muted-foreground">
              재방문 상담을 위해 선택한 스타일과 메모를 보존합니다.
            </span>
          </span>
        </label>

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            촬영 진행에는 동의가 필요합니다. 저장 동의는 선택입니다.
          </p>
          <Button
            size="lg"
            disabled={busy}
            onClick={() =>
              onConsent({
                saveImagesConsented: saveImages,
                saveReportConsented: saveReport,
              })
            }
          >
            {busy ? "진행 중…" : "동의하고 촬영 시작"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
