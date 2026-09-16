import { expect, test } from "vitest";
import {
  applyDateClick,
  daysBetween,
  monthGrid,
  rangeLabel,
  shiftMonth,
} from "./dateRange";

test("the first click starts the trip and the second one finishes it", () => {
  const started = applyDateClick({ start: null, end: null }, "2026-11-10");
  expect(started).toEqual({ start: "2026-11-10", end: null });
  expect(applyDateClick(started, "2026-11-13")).toEqual({
    start: "2026-11-10",
    end: "2026-11-13",
  });
});

test("a second click before the start moves the start instead of breaking the range", () => {
  expect(
    applyDateClick({ start: "2026-11-10", end: null }, "2026-11-08"),
  ).toEqual({ start: "2026-11-08", end: null });
});

test("clicking again after a complete range starts a fresh one", () => {
  expect(
    applyDateClick({ start: "2026-11-10", end: "2026-11-13" }, "2026-12-01"),
  ).toEqual({ start: "2026-12-01", end: null });
});

test("a one-day trip is allowed and reads as the same day", () => {
  const same = applyDateClick({ start: "2026-11-10", end: null }, "2026-11-10");
  expect(same).toEqual({ start: "2026-11-10", end: "2026-11-10" });
  expect(rangeLabel(same)).toBe("Same day");
});

test("the range is described in days and nights", () => {
  expect(rangeLabel({ start: null, end: null })).toBe("Pick the arrival day");
  expect(rangeLabel({ start: "2026-11-10", end: null })).toBe(
    "Now pick the day the trip ends",
  );
  expect(rangeLabel({ start: "2026-11-10", end: "2026-11-11" })).toBe(
    "2 days, 1 night",
  );
  expect(rangeLabel({ start: "2026-11-10", end: "2026-11-16" })).toBe(
    "7 days, 6 nights",
  );
});

test("day counts survive a daylight-saving change", () => {
  // Late March in the northern hemisphere loses an hour, not a day.
  expect(daysBetween("2026-03-27", "2026-03-30")).toBe(3);
  expect(daysBetween("2026-10-23", "2026-10-26")).toBe(3);
});

test("a month is padded so the first day sits under its weekday", () => {
  // 1 November 2026 is a Sunday, so no leading blanks and no trailing ones.
  const november = monthGrid(2026, 10, "2026-01-01");
  expect(november[0][0]).toMatchObject({ iso: "2026-11-01", day: 1 });
  expect(november.every((week) => week.length === 7)).toBe(true);
  expect(november.flat().filter(Boolean)).toHaveLength(30);
  // 1 February 2026 is also a Sunday, and February is short.
  expect(monthGrid(2026, 1, "2026-01-01").flat().filter(Boolean)).toHaveLength(28);
  // 1 April 2026 is a Wednesday, so it starts three blanks in.
  const april = monthGrid(2026, 3, "2026-01-01");
  expect(april[0].slice(0, 3)).toEqual([null, null, null]);
  expect(april[0][3]).toMatchObject({ iso: "2026-04-01" });
});

test("days before today cannot be picked", () => {
  const grid = monthGrid(2026, 10, "2026-11-10");
  const days = grid.flat().filter((cell): cell is NonNullable<typeof cell> => Boolean(cell));
  expect(days.find((cell) => cell.iso === "2026-11-09")?.disabled).toBe(true);
  expect(days.find((cell) => cell.iso === "2026-11-10")?.disabled).toBe(false);
  expect(days.find((cell) => cell.iso === "2026-11-30")?.disabled).toBe(false);
});

test("paging the calendar rolls the year over in both directions", () => {
  expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
  expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
});
