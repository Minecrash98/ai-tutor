import { expect, test } from "@playwright/test";

test("publishes a non-secret health contract and a working deterministic entry", async ({
  page,
  request,
}) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBe(true);
  expect(response.headers()["cache-control"]).toContain("no-store");
  const health = (await response.json()) as Record<string, unknown>;
  expect(health).toMatchObject({
    status: "ok",
    release: "0.1.0",
    deterministicDemo: true,
    realtimeRequiresPreflight: true,
  });
  expect(Object.keys(health).sort()).toEqual(
    [
      "database",
      "deterministicDemo",
      "realtimeRequiresPreflight",
      "release",
      "status",
    ].sort(),
  );
  const database = health.database as {
    configured: boolean;
    ready: boolean;
    latencyMs: number | null;
  };
  if (database.configured) {
    expect(database.ready).toBe(true);
    expect(database.latencyMs).toEqual(expect.any(Number));
    expect(database.latencyMs).toBeGreaterThanOrEqual(0);
  } else {
    expect(database).toEqual({
      configured: false,
      ready: false,
      latencyMs: null,
    });
  }
  expect(JSON.stringify(health)).not.toMatch(
    /token|password|secret|database_url|openai_api_key/i,
  );

  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "打开内容周围的空隙演示" }),
  ).toBeEnabled();
});
