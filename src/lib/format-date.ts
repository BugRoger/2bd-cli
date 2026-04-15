export function formatDateSentence(now?: Date): string {
  const date = now ?? new Date();

  const dayNameFormatter = new Intl.DateTimeFormat("en-US", { weekday: "long" });
  const monthFormatter = new Intl.DateTimeFormat("en-US", { month: "long" });
  const yearFormatter = new Intl.DateTimeFormat("en-US", { year: "numeric" });
  const dayFormatter = new Intl.DateTimeFormat("en-US", { day: "2-digit" });
  const hourFormatter = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    hour12: false,
  });
  const minuteFormatter = new Intl.DateTimeFormat("en-US", {
    minute: "2-digit",
  });
  const tzFormatter = new Intl.DateTimeFormat("en-US", {
    timeZoneName: "short",
  });

  const dayName = dayNameFormatter.format(date);
  const month = monthFormatter.format(date);
  const day = dayFormatter.format(date);
  const year = yearFormatter.format(date);

  const hourRaw = hourFormatter.format(date);
  // Intl may return "24" for midnight in some engines; normalize to "00"
  const hour = hourRaw === "24" ? "00" : hourRaw.padStart(2, "0");

  const minuteRaw = minuteFormatter.format(date);
  const minute = minuteRaw.padStart(2, "0");

  // Extract timezone abbreviation from a formatted string like "4/15/2026, CET"
  const tzParts = tzFormatter.formatToParts(date);
  const tzAbbr = tzParts.find((p) => p.type === "timeZoneName")?.value ?? "UTC";

  return `Today is ${dayName}, ${month} ${day}, ${year} at ${hour}:${minute} ${tzAbbr}.`;
}
