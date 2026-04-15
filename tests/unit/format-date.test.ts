import { describe, it, expect } from "vitest";
import { formatDateSentence } from "../../src/lib/format-date.js";

describe("formatDateSentence", () => {
  it("formats a known date into the expected sentence", () => {
    // Tuesday, April 15, 2026 at 14:35 in UTC
    const date = new Date("2026-04-15T14:35:00Z");
    const result = formatDateSentence(date);

    // The exact output depends on the system timezone, but structure is fixed.
    // We test the structure rather than exact values since TZ varies by machine.
    expect(result).toMatch(
      /^Today is (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (January|February|March|April|May|June|July|August|September|October|November|December) \d{2}, \d{4} at ([01]\d|2[0-3]):\d{2} [A-Z0-9+\-]+\.$/
    );
  });

  it("starts with 'Today is'", () => {
    const date = new Date("2026-04-15T14:35:00Z");
    const result = formatDateSentence(date);
    expect(result.startsWith("Today is ")).toBe(true);
  });

  it("ends with a period", () => {
    const date = new Date("2026-04-15T14:35:00Z");
    const result = formatDateSentence(date);
    expect(result.endsWith(".")).toBe(true);
  });

  it("contains a day name", () => {
    const date = new Date("2026-04-15T14:35:00Z");
    const result = formatDateSentence(date);
    expect(result).toMatch(
      /Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday/
    );
  });

  it("contains a full month name", () => {
    const date = new Date("2026-04-15T14:35:00Z");
    const result = formatDateSentence(date);
    expect(result).toMatch(
      /January|February|March|April|May|June|July|August|September|October|November|December/
    );
  });

  it("contains a four-digit year", () => {
    const date = new Date("2026-04-15T14:35:00Z");
    const result = formatDateSentence(date);
    expect(result).toMatch(/\b\d{4}\b/);
  });

  it("contains a zero-padded two-digit day", () => {
    // Use a date with a single-digit day to verify zero-padding
    const date = new Date("2026-01-05T10:00:00Z");
    const result = formatDateSentence(date);
    // The day should be zero-padded (e.g., "05" not "5")
    expect(result).toMatch(/\b\d{2},/);
  });

  it("contains 24-hour time in HH:mm format", () => {
    const date = new Date("2026-04-15T14:35:00Z");
    const result = formatDateSentence(date);
    expect(result).toMatch(/at ([01]\d|2[0-3]):\d{2}/);
  });

  it("contains a timezone abbreviation", () => {
    const date = new Date("2026-04-15T14:35:00Z");
    const result = formatDateSentence(date);
    // Timezone abbreviation: uppercase letters and may include +/- and numbers (e.g., "GMT+2", "UTC", "CET")
    expect(result).toMatch(/[A-Z0-9+\-]+\.$/);
  });

  it("uses en-US locale (English day and month names)", () => {
    // Wednesday, July 04, 2029
    const date = new Date("2029-07-04T12:00:00Z");
    const result = formatDateSentence(date);
    expect(result).toMatch(/July/);
    // Verify it does NOT contain non-English month names
    expect(result).not.toMatch(/Juli|Julio|Juillet/);
  });

  it("defaults to current date when no argument is provided", () => {
    const result = formatDateSentence();
    // Just verify it matches the format -- we cannot know the exact date
    expect(result).toMatch(
      /^Today is (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (January|February|March|April|May|June|July|August|September|October|November|December) \d{2}, \d{4} at ([01]\d|2[0-3]):\d{2} [A-Z0-9+\-]+\.$/
    );
  });

  it("returns a single-line string with no newlines", () => {
    const date = new Date("2026-04-15T14:35:00Z");
    const result = formatDateSentence(date);
    expect(result).not.toContain("\n");
  });
});
