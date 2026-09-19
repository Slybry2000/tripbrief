import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "edge-runtime",
    include: ["convex/**/*.test.ts", "src/**/*.test.ts"],
    // Shared test fixtures live in a `.test.ts` file so Convex leaves them out of
    // the deployed backend, which also makes them look like a suite to vitest.
    exclude: ["**/node_modules/**", "**/dist/**", "convex/fixtures.test.ts"],
    // Deployments run in demo mode unless told otherwise. The suite tests the
    // real paths by default; demo behaviour has its own tests, which switch it on.
    env: { DEMO_MODE: "off" },
  },
});
