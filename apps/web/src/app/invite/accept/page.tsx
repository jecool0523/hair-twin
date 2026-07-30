import { resolveUserSession } from "@/lib/supabase/auth";

export default async function AcceptInvitePage({ searchParams }: { searchParams: Promise<{ id?: string; error?: string }> }) {
  const [session, params] = await Promise.all([resolveUserSession(), searchParams]);
  return (
    <main className="mx-auto flex min-h-dvh max-w-md items-center px-6">
      <section className="w-full rounded-3xl border bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold">살롱 초대 수락</h1>
        <p className="mt-2 text-sm text-muted-foreground">{session.email} 계정으로 멤버십을 생성합니다.</p>
        {params.error ? <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">초대가 만료·취소되었거나 계정 이메일이 일치하지 않습니다.</p> : null}
        <form action="/api/invites/accept" method="post" className="mt-6">
          <input type="hidden" name="inviteId" value={params.id ?? ""} />
          <button disabled={!params.id} className="w-full rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:opacity-50">초대 수락</button>
        </form>
      </section>
    </main>
  );
}
