import { expect, test } from "vitest";
import { extractOutputText, validateAnalysis } from "./analysis";

test("AI analysis accepts only complete, source-grounded structured drafts", () => {
  const source = "Transfer is included. Two step-free rooms are available.";
  const draft = validateAnalysis(
    JSON.stringify({
      assessments: [
        {
          requirementNumber: 1,
          status: "yes",
          evidence: "Transfer is included.",
        },
        {
          requirementNumber: 2,
          status: "yes",
          evidence: "Two step-free rooms are available.",
        },
      ],
      caveats: ["Confirm final availability."],
    }),
    source,
    [1, 2],
  );
  expect(draft.assessments).toHaveLength(2);
  expect(() =>
    validateAnalysis(
      JSON.stringify({
        assessments: [
          { requirementNumber: 1, status: "yes", evidence: "Invented" },
        ],
        caveats: [],
      }),
      source,
      [1, 2],
    ),
  ).toThrow("evidence");
});

test("AI response extraction rejects non-response payloads", () => {
  expect(extractOutputText({ output: [{ content: [{ text: "{}" }] }] })).toBe(
    "{}",
  );
  expect(() => extractOutputText({ output: [] })).toThrow("no structured");
});
