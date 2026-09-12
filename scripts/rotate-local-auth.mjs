import { generateKeyPairSync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const config = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
if (
  !/^CONVEX_DEPLOYMENT=anonymous:/m.test(config) ||
  process.env.CONVEX_DEPLOY_KEY
) {
  throw new Error("This utility only supports the anonymous local deployment.");
}
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const values = [
  [
    "JWT_PRIVATE_KEY",
    privateKey.export({ type: "pkcs8", format: "pem" }).replaceAll("\n", " "),
  ],
  [
    "JWKS",
    JSON.stringify({
      keys: [{ ...publicKey.export({ format: "jwk" }), use: "sig" }],
    }),
  ],
];
for (const [name, value] of values) {
  try {
    execFileSync(
      process.execPath,
      ["node_modules/convex/bin/main.js", "env", "set", "--", name, value],
      {
        stdio: "pipe",
        windowsHide: true,
      },
    );
  } catch {
    // Never forward child output: CLI failures can include credential arguments.
    console.error(
      `Unable to replace ${name}. Check that the local backend is running.`,
    );
    process.exit(1);
  }
}
console.log("Local signing key replaced. No credential values logged.");
