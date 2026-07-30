export default function Page() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-6">
      <div>
        <p className="text-sm font-medium text-neutral-500">Hair Twin</p>
        <h1 className="mt-2 text-3xl font-semibold">새 상담 시작</h1>
        <p className="mt-3 text-neutral-600">고객 동의를 확인한 뒤 새 상담을 명시적으로 시작합니다.</p>
      </div>
      <form action="/api/sessions" method="post" className="grid gap-4 rounded-2xl border p-6">
        <label className="grid gap-2 text-sm font-medium">
          스타일리스트 이름
          <input name="stylistName" required defaultValue="담당 스타일리스트" className="rounded-lg border px-3 py-2" />
        </label>
        <label className="grid gap-2 text-sm font-medium">
          고객 별칭
          <input name="customerAlias" required defaultValue="익명 고객" className="rounded-lg border px-3 py-2" />
        </label>
        <button type="submit" className="rounded-lg bg-black px-4 py-3 font-medium text-white">상담 시작</button>
      </form>
    </main>
  );
}
