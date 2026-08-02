import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const migrationRoot = resolve(process.cwd(), "apps", "web", "drizzle");
const journal = JSON.parse(
  readFileSync(resolve(migrationRoot, "meta", "_journal.json"), "utf8"),
);
if (journal.version !== "7" || journal.dialect !== "postgresql") {
  throw new Error("unsupported migration journal");
}

const client = postgres(databaseUrl, {
  prepare: false,
  connect_timeout: 10,
  max: 1,
});
try {
  await client.unsafe("create schema if not exists drizzle");
  await client.unsafe(
    "create table if not exists drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)",
  );
  const applied = await client.unsafe(
    "select hash, created_at from drizzle.__drizzle_migrations order by created_at",
  );
  const appliedByTimestamp = new Map(
    applied.map((row) => [Number(row.created_at), String(row.hash)]),
  );
  for (const entry of journal.entries) {
    const migrationPath = resolve(migrationRoot, entry.tag + ".sql");
    const content = readFileSync(migrationPath, "utf8");
    const hash = createHash("sha256").update(content).digest("hex");
    const existing = appliedByTimestamp.get(entry.when);
    if (existing) {
      if (existing !== hash) {
        throw new Error(
          "migration " +
            entry.tag +
            " hash mismatch: database=" +
            existing +
            " file=" +
            hash,
        );
      }
      process.stdout.write(
        JSON.stringify({
          migration: entry.tag,
          status: "already-applied",
          hash,
        }) + "\n",
      );
      continue;
    }
    const statements = content
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);
    await client.begin(async (transaction) => {
      for (const statement of statements) {
        await transaction.unsafe(statement);
      }
      await transaction.unsafe(
        "insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)",
        [hash, entry.when],
      );
    });
    process.stdout.write(
      JSON.stringify({
        migration: entry.tag,
        status: "applied",
        hash,
        statements: statements.length,
      }) + "\n",
    );
  }
} finally {
  await client.end({ timeout: 5 });
}
