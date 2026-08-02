const endpoint =
  process.env.AI_TUTOR_HEALTH_URL ?? "http://127.0.0.1:3000/api/health";
const response = await fetch(endpoint, {
  headers: { accept: "application/json" },
  signal: AbortSignal.timeout(5_000),
});
const body = await response.json().catch(() => null);
const passed =
  response.ok &&
  body?.status === "ok" &&
  body?.database?.configured === true &&
  body?.database?.ready === true;

process.stdout.write(
  `${JSON.stringify({
    passed,
    endpoint,
    httpStatus: response.status,
    status: body?.status ?? null,
    database: {
      configured: body?.database?.configured ?? null,
      ready: body?.database?.ready ?? null,
      latencyMs: body?.database?.latencyMs ?? null,
    },
  })}\n`,
);
if (!passed) process.exitCode = 1;
