import { redirect } from "next/navigation";
import { startSession } from "@/lib/services/consultation";

// Entry point: starting a consultation is an explicit action that mints a
// session and then hands off to a stable, refreshable URL. The consultation
// itself lives at /consultation/[id] so a reload resumes it instead of
// silently abandoning it and creating a new one.
export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await startSession({
    stylistName: "개발용 미용사",
    customerAlias: "익명 고객",
  });
  // redirect() throws control flow — must not be inside a try/catch.
  redirect(`/consultation/${session.id}`);
}
