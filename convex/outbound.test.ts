/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { isSendableAddress, providerMessageId, requestMessage } from "./outbound";

const modules = import.meta.glob("./**/*.ts");
const token = (letter: string) => letter.repeat(43);

const brief = {
  name: "Wellness Escape",
  evaluationDate: "2027-05-23",
  travelMonth: "October",
  travelerCount: 16,
  minimumViableTravelers: 12,
  confirmedTravelers: 8,
  nights: 7,
  earliestDepartureDate: "2027-10-10",
  preferredDepartureDate: "2027-10-15",
  latestDepartureDate: "2027-10-25",
  flexibleDates: true,
  proposalDecisionDate: "2027-06-10",
  targetRetailPricePerPerson: 3500,
  flightsIncluded: false,
  experienceLevel: 2,
  pace: "relaxed",
  climates: ["warm"],
  desiredExperiences: ["yoga"],
  importantRequirements: ["strong_wellness_focus"],
  travelerTypes: ["private_groups"],
  transportationNeeds: ["private_transportation"],
  accessibilityNeeds: [],
  notes: "Private wellness group. Include one gentle outdoor experience.",
};

test("the request email carries the link and nothing about the travellers", () => {
  const message = requestMessage(
    brief,
    "Island Wellbeing Indonesia",
    "https://example.convex.site/#respond=abc",
  );
  expect(message.subject).toBe("Trip request: Wellness Escape");
  expect(message.text).toContain("https://example.convex.site/#respond=abc");
  expect(message.text).toContain("Hello Island Wellbeing Indonesia");
  expect(message.text).toContain("16 travellers");
  // The client's own words never travel: a supplier is asked to quote, not to
  // read the advisor's notes about the group.
  expect(message.text).not.toContain("gentle outdoor");
  expect(message.html).not.toContain("gentle outdoor");
  expect(message.text).not.toContain("<");

  // A supplier name is a person's input, so the html version is escaped.
  const escaped = requestMessage(brief, "A <script> name", "https://example.test/");
  expect(escaped.html).toContain("A &lt;script&gt; name");
  expect(escaped.text).toContain("A <script> name");
});

test("the provider's message id is read from whichever field it uses", () => {
  expect(providerMessageId({ message_id: "a" })).toBe("a");
  expect(providerMessageId({ messageId: "b" })).toBe("b");
  expect(providerMessageId({ id: "c" })).toBe("c");
  expect(providerMessageId({})).toBe("");
  expect(providerMessageId(null)).toBe("");
});

test("a trial workspace cannot send, and nothing is written", async () => {
  const t = convexTest(schema, modules).withIdentity({ subject: "advisor" });
  const { briefId } = await t.mutation(api.briefs.create, {
    brief,
    selectedDestinationSlugs: ["bali"],
  });
  await t.mutation(api.briefs.setShortlist, {
    briefId,
    operators: [
      {
        operatorSlug: "p1",
        operatorName: "Island Wellbeing Indonesia",
        capabilityToken: token("a"),
      },
    ],
  });
  const row = (await t.query(api.briefs.get, { briefId }))!.shortlist[0];
  await expect(
    t.action(api.outbound.sendRequest, {
      briefOperatorId: row._id,
      email: "hello@operator.example",
    }),
  ).rejects.toThrow("cannot send email");
  const after = (await t.query(api.briefs.get, { briefId }))!.shortlist[0];
  expect(after.sentAt).toBeUndefined();
  expect(after.email).toBeUndefined();
});

test("the one address a request may go to is decided by a named rule", () => {
  expect(isSendableAddress("  Bookings@Operator.Example ")).toBe(true);
  expect(isSendableAddress("name+tag@sub.domain.example")).toBe(true);
  expect(isSendableAddress("not-an-address")).toBe(false);
  expect(isSendableAddress("two addresses@example.com")).toBe(false);
  expect(isSendableAddress("no@tld")).toBe(false);
  expect(isSendableAddress("")).toBe(false);
  expect(isSendableAddress(`${"x".repeat(320)}@example.com`)).toBe(false);
});
