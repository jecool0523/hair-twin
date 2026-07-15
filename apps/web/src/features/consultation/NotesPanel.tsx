"use client";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { NotebookPen, Check } from "lucide-react";
import type { ConsultationNote } from "@/lib/domain/types";

export function NotesPanel({
  note,
  onSave,
}: {
  note: ConsultationNote;
  onSave: (n: Omit<ConsultationNote, "updatedAt">) => Promise<void> | void;
}) {
  const [memoKo, setMemo] = useState(note.memoKo);
  const [feasibility, setFeasibility] = useState(note.feasibility);
  const [estimatedPrice, setPrice] = useState(note.estimatedPrice);
  const [estimatedTime, setTime] = useState(note.estimatedTime);
  const [careNotesKo, setCare] = useState(note.careNotesKo);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    await onSave({ memoKo, feasibility, estimatedPrice, estimatedTime, careNotesKo });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <NotebookPen className="h-5 w-5 text-primary" /> 미용사 상담 메모
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-muted-foreground">시술 난이도</span>
            <select
              value={feasibility}
              onChange={(e) =>
                setFeasibility(e.target.value as ConsultationNote["feasibility"])
              }
              className="w-full rounded-md border bg-background px-2 py-2"
            >
              <option value="">선택</option>
              <option value="easy">쉬움</option>
              <option value="moderate">보통</option>
              <option value="hard">어려움</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-muted-foreground">예상 가격</span>
            <input
              value={estimatedPrice}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="예: 8만원"
              className="w-full rounded-md border bg-background px-2 py-2"
            />
          </label>
          <label className="space-y-1">
            <span className="text-muted-foreground">예상 소요 시간</span>
            <input
              value={estimatedTime}
              onChange={(e) => setTime(e.target.value)}
              placeholder="예: 2시간"
              className="w-full rounded-md border bg-background px-2 py-2"
            />
          </label>
        </div>
        <label className="block space-y-1">
          <span className="text-muted-foreground">상담 메모</span>
          <textarea
            value={memoKo}
            onChange={(e) => setMemo(e.target.value)}
            rows={2}
            placeholder="시술 가능성, 고객 요청 사항 등"
            className="w-full rounded-md border bg-background px-2 py-2"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-muted-foreground">관리 방법</span>
          <textarea
            value={careNotesKo}
            onChange={(e) => setCare(e.target.value)}
            rows={2}
            placeholder="홈케어, 재방문 주기 등"
            className="w-full rounded-md border bg-background px-2 py-2"
          />
        </label>
        <Button variant="secondary" size="sm" onClick={save}>
          {saved ? (
            <>
              <Check className="h-4 w-4" /> 저장됨
            </>
          ) : (
            "메모 저장"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
