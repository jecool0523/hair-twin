import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { SearchX } from "lucide-react";

/**
 * Reached when a session id in the URL is unknown or has expired (unsaved
 * consultations are swept after their retention window). We explain it in
 * salon language and offer a clean restart rather than a raw 404.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4">
      <Card className="max-w-md">
        <CardContent className="flex flex-col items-center gap-4 py-14 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <SearchX className="h-6 w-6" />
          </div>
          <p className="text-lg font-medium">상담을 찾을 수 없습니다</p>
          <p className="text-sm text-muted-foreground">
            이미 종료되었거나 보관 기간이 지나 삭제된 상담입니다. 저장에
            동의하지 않은 상담은 일정 시간 후 자동으로 삭제됩니다.
          </p>
          <Link
            href="/"
            className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            새 상담 시작
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
