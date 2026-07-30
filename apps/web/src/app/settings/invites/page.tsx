import { resolveAuthContext } from "@/lib/supabase/auth";

export default async function InvitesPage({ searchParams }: { searchParams: Promise<{ sent?: string; error?: string }> }) {
  const [auth, state] = await Promise.all([resolveAuthContext(), searchParams]);
  if (!(["owner", "admin"] as string[]).includes(auth.role)) return <main className="p-8">초대 권한이 없습니다.</main>;
  return (
    <main className="mx-auto max-w-lg p-6 pt-16">
      <h1 className="text-2xl font-bold">살롱 멤버 초대</h1>
      <p className="mt-2 text-sm text-muted-foreground">초대는 7일 동안 유효하며 이메일 계정과 일치해야 수락됩니다.</p>
      {state.sent ? <p className="mt-4 rounded-xl bg-green-50 p-3 text-sm text-green-700">초대 이메일을 전송했습니다.</p> : null}
      {state.error ? <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">입력값을 확인해 주세요.</p> : null}
      <form action="/api/invites" method="post" className="mt-6 space-y-4 rounded-2xl border bg-white p-6">
        <label className="block text-sm font-medium">이메일<input name="email" type="email" required className="mt-1 w-full rounded-xl border px-4 py-3" /></label>
        <label className="block text-sm font-medium">역할<select name="role" className="mt-1 w-full rounded-xl border px-4 py-3"><option value="stylist">스타일리스트</option>{auth.role === "owner" ? <option value="admin">관리자</option> : null}</select></label>
        <button className="w-full rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground">초대 보내기</button>
      </form>
    </main>
  );
}
