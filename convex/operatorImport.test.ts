import { expect, test } from "vitest";
import { cleanSourceUrl } from "./operatorImport";

// An operator's page import is the one place a link holder can point this
// deployment at any address on the internet, so the rule is narrow by design:
// a whole https address, with no credentials embedded in it.
test("only a plain https page is worth fetching", () => {
  expect(cleanSourceUrl("https://operator.example/trips/bali")).toBe(
    "https://operator.example/trips/bali",
  );
  expect(cleanSourceUrl("  https://operator.example/trips/bali  ")).toBe(
    "https://operator.example/trips/bali",
  );
});

test("anything else is refused rather than fetched", () => {
  expect(cleanSourceUrl("http://operator.example/trips/bali")).toBeNull();
  expect(cleanSourceUrl("https://user:secret@operator.example/trips")).toBeNull();
  expect(cleanSourceUrl("file:///C:/secrets.txt")).toBeNull();
  expect(cleanSourceUrl("operator.example/trips/bali")).toBeNull();
  expect(cleanSourceUrl("")).toBeNull();
});
