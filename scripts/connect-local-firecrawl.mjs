import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const config = readFileSync(".env.local", "utf8");
if (
  !/^CONVEX_DEPLOYMENT=anonymous:/m.test(config) ||
  process.env.CONVEX_DEPLOY_KEY
) {
  throw new Error("Only anonymous local deployments are supported.");
}
const userId = process.argv[2];
if (!userId || !/^[a-z0-9]+$/.test(userId))
  throw new Error("Supply a local test user ID.");
try {
  const credentials = JSON.parse(
    readFileSync(
      join(process.env.APPDATA, "firecrawl-cli", "credentials.json"),
      "utf8",
    ),
  );
  if (
    typeof credentials.apiKey !== "string" ||
    !credentials.apiKey.startsWith("fc-")
  )
    throw new Error();
  for (const [name, value] of [
    ["FIRECRAWL_API_KEY", credentials.apiKey],
    ["RESEARCH_TEST_USER_ID", userId],
  ]) {
    execFileSync(
      process.execPath,
      ["node_modules/convex/bin/main.js", "env", "set", "--", name, value],
      { stdio: "pipe", windowsHide: true },
    );
  }
  console.log(
    "Firecrawl connected to the local test workspace. No secrets logged.",
  );
} catch {
  console.error(
    "Local Firecrawl setup failed. Credential and child-process output suppressed.",
  );
  process.exit(1);
}
