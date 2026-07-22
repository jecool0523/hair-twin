import { notFound } from "next/navigation";
import { ConsultationConsole } from "@/features/consultation/ConsultationConsole";
import { buildSessionView } from "@/lib/services/views";

export const dynamic = "force-dynamic";

/**
 * The consultation console, keyed by a session id in the URL.
 * Refreshing this page resumes the same consultation (server-rendered initial
 * state), rather than starting a new one.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const initialSession = await buildSessionView(id);
  if (!initialSession) notFound();

  return (
    <main className="min-h-dvh bg-background">
      <ConsultationConsole
        sessionId={id}
        initialSession={initialSession}
      />
    </main>
  );
}
