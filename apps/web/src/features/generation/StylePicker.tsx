"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { STYLE_PRESETS } from "@/lib/domain/style-presets";
import { Sparkles } from "lucide-react";

export function StylePicker({
  onGenerate,
  busy,
}: {
  onGenerate: (styleId: string, candidateCount: number) => void;
  busy?: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [count, setCount] = useState(3);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" /> 헤어스타일 선택
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
          {STYLE_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelected(p.id)}
              className={cn(
                "rounded-lg border p-3 text-left transition-colors",
                selected === p.id
                  ? "border-primary ring-2 ring-primary/40"
                  : "hover:bg-muted",
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: p.accent }}
                />
                <span className="font-medium">{p.displayNameKo}</span>
              </div>
              <Badge tone="neutral" className="mt-2">
                {p.categoryLabelKo}
              </Badge>
              <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                {p.consultationSummaryKo}
              </p>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <label className="flex items-center gap-2 text-sm">
            생성 후보 수
            <select
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="rounded-md border bg-background px-2 py-1"
            >
              {[2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}개
                </option>
              ))}
            </select>
          </label>
          <Button
            size="lg"
            disabled={!selected || busy}
            onClick={() => selected && onGenerate(selected, count)}
          >
            {busy ? "작업 생성 중…" : "생성 시작"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          생성 결과는 얼굴/정체성을 유지하고 헤어 영역만 편집하는 통제된
          미리보기입니다. 실제 시술 결과를 보장하지 않습니다.
        </p>
      </CardContent>
    </Card>
  );
}
