// A pick is only as good as the comparison it was made on. The comparison is live,
// so a reply can land, or an operator can revise its price, between the moment the
// agency reads the page and the moment it clicks. This fingerprint names exactly
// what was on screen, so the server can refuse a pick made on figures that have
// since moved. The browser and the selection mutation both call this one function,
// which is the only way the two can agree on what "the same comparison" means.

// Only what an agency weighs when it chooses. Bookkeeping is left out on purpose:
// an announcement stamp, a standardisation stamp, how the reply arrived, the stored
// email text and the submission time all change without the offer changing, and a
// pick refused over one of them would teach the agency to ignore the refusal.
export type ComparedProposal = {
  id: string;
  netPricePerPerson: number;
  currency: string;
  startDate: string;
  endDate: string;
  nights: number;
  availability: string;
  // The note and the quote are what the requirement grid shows under each answer,
  // so a revised explanation is a revised answer.
  requirementAnswers?: readonly {
    key: string;
    answer: string;
    note?: string;
    quote?: string;
  }[];
};

export type ComparisonFingerprint = {
  // The whole comparison: the set of proposals and every deciding field of each.
  overall: string;
  // One entry per proposal, so the page can say which reply moved.
  each: Record<string, string>;
};

// Bumped if the serialisation ever changes, so an old page is refused plainly
// rather than matched by accident.
const VERSION = "v1";

// Spacing and letter case are how a reply is typed, not what it offers.
const text = (value: string | undefined) => (value ?? "").replace(/\s+/g, " ").trim();
const number = (value: number) => (Number.isFinite(value) ? String(value) : "");

function serialise(proposal: ComparedProposal): string {
  const answers = (proposal.requirementAnswers ?? [])
    .map((item) => [text(item.key), text(item.answer), text(item.note), text(item.quote)])
    // Stored order is whatever order the answers were written in, which says
    // nothing about the offer.
    .sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
  return JSON.stringify([
    number(proposal.netPricePerPerson),
    text(proposal.currency).toUpperCase(),
    text(proposal.startDate),
    text(proposal.endDate),
    number(proposal.nights),
    text(proposal.availability),
    answers,
  ]);
}

// 64-bit FNV-1a over the UTF-8 bytes. It is not a security measure: the only
// person who can pick is the brief's owner. It only has to be deterministic,
// synchronous, identical in the browser and the Convex runtime, and short.
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK = 0xffffffffffffffffn;

function hash(input: string): string {
  let value = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(input)) {
    value = ((value ^ BigInt(byte)) * FNV_PRIME) & MASK;
  }
  return value.toString(16).padStart(16, "0");
}

export function comparisonFingerprint(
  proposals: readonly ComparedProposal[],
): ComparisonFingerprint {
  const each: Record<string, string> = {};
  for (const proposal of proposals) each[proposal.id] = hash(serialise(proposal));
  // Sorted by id, because a query's return order is not part of what was seen.
  const lines = Object.keys(each)
    .sort()
    .map((id) => `${id}=${each[id]}`);
  return { overall: `${VERSION}-${lines.length}-${hash(lines.join("\n"))}`, each };
}

export const STALE_PICK_MESSAGE =
  "A reply changed since you last looked. Review the updated comparison, then choose again.";
