import { createDatabase } from "@/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  let databaseReady = false;
  let databaseLatencyMs: number | null = null;
  if (databaseUrl) {
    const startedAt = performance.now();
    const { client } = createDatabase(databaseUrl);
    const query = client`select 1 as ready`;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        query,
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error("database readiness timeout")),
            2_500,
          );
        }),
      ]);
      databaseReady = result[0]?.ready === 1;
      databaseLatencyMs = Math.round(performance.now() - startedAt);
    } catch {
      void query.catch(() => undefined);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      await client.end({ timeout: 1 }).catch(() => undefined);
    }
  }
  const status = databaseUrl && !databaseReady ? "degraded" : "ok";

  return Response.json(
    {
      status,
      release: "0.1.0",
      deterministicDemo: true,
      database: {
        configured: Boolean(databaseUrl),
        ready: databaseReady,
        latencyMs: databaseLatencyMs,
      },
      realtimeRequiresPreflight: true,
    },
    {
      status: status === "ok" ? 200 : 503,
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}
