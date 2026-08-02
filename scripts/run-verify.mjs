import { spawnSync } from "node:child_process";

const competition = process.argv.includes("--competition");
const commands = [
  ["preflight"],
  ["lint"],
  ["typecheck"],
  ["test"],
  ["build"],
  ["test:e2e"],
];

if (competition) {
  commands.push(
    ["status:check"],
    ["research:check"],
    ["research:test"],
    ["compliance:check"],
    ["test:e2e:performance"],
    ["test:e2e:matrix"],
    ["audit", "--prod", "--audit-level", "high"],
  );
}

for (const args of commands) {
  console.log(`\n[verify] pnpm ${args.join(" ")}`);
  const result =
    process.platform === "win32"
      ? spawnSync(
          process.env.ComSpec ?? "cmd.exe",
          [
            "/d",
            "/s",
            "/c",
            ["pnpm", ...args]
              .map((argument) =>
                /^[\w@./:-]+$/.test(argument)
                  ? argument
                  : `"${argument.replaceAll('"', '""')}"`,
              )
              .join(" "),
          ],
          {
            cwd: process.cwd(),
            env: process.env,
            stdio: "inherit",
          },
        )
      : spawnSync("pnpm", args, {
          cwd: process.cwd(),
          env: process.env,
          stdio: "inherit",
        });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
