import { useState } from "react";
import {
  applyDateClick,
  formatDay,
  formatMonth,
  isInRange,
  monthGrid,
  monthOf,
  rangeLabel,
  shiftMonth,
  toIso,
  WEEKDAYS,
  type Range,
} from "./dateRange";

// A ticket-style calendar: click the arrival day, then click the day the trip
// ends. Hovering after the first click previews the range, as a booking site
// does, and days before today cannot be picked.
export function DateRangePicker({
  start,
  end,
  onChange,
  today = toIso(new Date()),
}: {
  start: string | null;
  end: string | null;
  onChange: (range: { start: string | null; end: string | null }) => void;
  today?: string;
}) {
  const range: Range = { start, end };
  const [hovered, setHovered] = useState<string | null>(null);
  const [view, setView] = useState(() => monthOf(start ?? today));

  const preview: Range =
    start && !end && hovered && hovered > start
      ? { start, end: hovered }
      : range;
  const grid = monthGrid(view.year, view.month, today);

  return (
    <div className="calendar">
      <div className="calendar-head">
        <button
          type="button"
          className="quiet-button"
          aria-label="Previous month"
          onClick={() => setView(shiftMonth(view.year, view.month, -1))}
        >
          ‹
        </button>
        <strong>{formatMonth(view.year, view.month)}</strong>
        <button
          type="button"
          className="quiet-button"
          aria-label="Next month"
          onClick={() => setView(shiftMonth(view.year, view.month, 1))}
        >
          ›
        </button>
      </div>
      <div className="calendar-grid" role="grid">
        {WEEKDAYS.map((day, index) => (
          <span key={index} className="calendar-weekday" aria-hidden="true">
            {day}
          </span>
        ))}
        {grid.flat().map((cell, index) =>
          cell === null ? (
            <span key={`blank-${index}`} className="calendar-blank" />
          ) : (
            <button
              key={cell.iso}
              type="button"
              className={[
                "calendar-day",
                isInRange(preview, cell.iso) ? "in-range" : "",
                cell.iso === preview.start ? "range-start" : "",
                cell.iso === preview.end ? "range-end" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              disabled={cell.disabled}
              aria-pressed={isInRange(range, cell.iso)}
              aria-label={formatDay(cell.iso)}
              onMouseEnter={() => setHovered(cell.iso)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onChange(applyDateClick(range, cell.iso))}
            >
              {cell.day}
            </button>
          ),
        )}
      </div>
      <div className="calendar-foot">
        <span>
          {start ? formatDay(start) : "Arrival —"}
          {" → "}
          {end ? formatDay(end) : "Departure —"}
        </span>
        <em>{rangeLabel(preview)}</em>
        {(start || end) && (
          <button
            type="button"
            className="quiet-button"
            onClick={() => onChange({ start: null, end: null })}
          >
            Clear dates
          </button>
        )}
      </div>
    </div>
  );
}
