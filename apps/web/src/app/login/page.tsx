export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const { error, next } = await searchParams;
  return (
    <main className="mx-auto flex min-h-dvh max-w-md items-center px-6">
      <section className="w-full rounded-3xl border bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold text-primary">Hair Twin</p>
        <h1 className="mt-2 text-2xl font-bold">살롱 계정 로그인</h1>
        <p className="mt-2 text-sm text-muted-foreground">승인된 멤버 계정으로 상담을 시작하세요.</p>
        {error ? <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">이메일 또는 비밀번호를 확인해 주세요.</p> : null}
        <form action="/api/auth/login" method="post" className="mt-6 space-y-4">
          <input type="hidden" name="next" value={next?.startsWith("/") ? next : "/"} />
          <label className="block text-sm font-medium">이메일<input name="email" type="email" required autoComplete="email" className="mt-1 w-full rounded-xl border px-4 py-3" /></label>
          <label className="block text-sm font-medium">비밀번호<input name="password" type="password" required autoComplete="current-password" className="mt-1 w-full rounded-xl border px-4 py-3" /></label>
          <button className="w-full rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground">로그인</button>
        </form>
      </section>
    </main>
  );
}
