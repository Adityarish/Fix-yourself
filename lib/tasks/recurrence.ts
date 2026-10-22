export type SupportedFrequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
export interface RecurrenceRule {
  frequency: SupportedFrequency;
  interval: number;
  byDay: number[] | null;
}

const weekdayCodes = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

export function recurrencePhraseToRrule(phrase: string) {
  const value = phrase.trim().toLowerCase();
  if (value === "every day") return "FREQ=DAILY";
  if (value === "every week") return "FREQ=WEEKLY";
  if (value === "every month") return "FREQ=MONTHLY";
  if (value === "every year") return "FREQ=YEARLY";
  if (value === "every weekday") return "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR";
  if (value === "every weekend") return "FREQ=WEEKLY;BYDAY=SA,SU";
  const days = value.match(/^every (\d+) days?$/);
  return days ? `FREQ=DAILY;INTERVAL=${Math.max(1, Number(days[1]))}` : null;
}

export function parseRrule(rrule: string): RecurrenceRule {
  const parts: Record<string, string> = Object.fromEntries(
    rrule.split(";").map((entry) => entry.split("=", 2)),
  );
  if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(parts.FREQ))
    throw new Error("Unsupported recurrence frequency.");
  const interval = Number(parts.INTERVAL ?? 1);
  if (!Number.isInteger(interval) || interval < 1 || interval > 365)
    throw new Error("Invalid recurrence interval.");
  const byDay: number[] | undefined = parts.BYDAY?.split(",").map(
    (day: string) => weekdayCodes.indexOf(day),
  );
  if (byDay?.some((day: number) => day < 0))
    throw new Error("Invalid recurrence weekday.");
  return {
    frequency: parts.FREQ as SupportedFrequency,
    interval,
    byDay: byDay ?? null,
  };
}

export function materializeOccurrences(
  rrule: string,
  startAt: Date,
  horizonDays = 60,
  timezone = "UTC",
) {
  const rule = parseRrule(rrule);
  const start = zonedParts(startAt, timezone);
  const startDay = new Date(Date.UTC(start.year, start.month - 1, start.day));
  const horizon = new Date(startDay);
  horizon.setUTCDate(horizon.getUTCDate() + horizonDays);
  const results: Date[] = [];
  const cursor = new Date(startDay);
  const startWasMonthEnd = start.day === daysInMonth(start.year, start.month);
  while (cursor <= horizon) {
    const daysSince = Math.round(
      (cursor.getTime() - startDay.getTime()) / 86_400_000,
    );
    const monthSince =
      (cursor.getUTCFullYear() - start.year) * 12 +
      cursor.getUTCMonth() -
      (start.month - 1);
    const expectedMonthDay = startWasMonthEnd
      ? daysInMonth(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1)
      : Math.min(
          start.day,
          daysInMonth(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1),
        );
    const matches = rule.byDay
      ? rule.byDay.includes(cursor.getUTCDay()) &&
        Math.floor(daysSince / 7) % rule.interval === 0
      : rule.frequency === "DAILY"
        ? daysSince % rule.interval === 0
        : rule.frequency === "WEEKLY"
          ? daysSince % (7 * rule.interval) === 0
          : rule.frequency === "MONTHLY"
            ? cursor.getUTCDate() === expectedMonthDay &&
              monthSince % rule.interval === 0
            : cursor.getUTCDate() === expectedMonthDay &&
              cursor.getUTCMonth() === start.month - 1 &&
              (cursor.getUTCFullYear() - start.year) % rule.interval === 0;
    if (matches)
      results.push(
        zonedTimeToUtc(
          cursor.getUTCFullYear(),
          cursor.getUTCMonth() + 1,
          cursor.getUTCDate(),
          start.hour,
          start.minute,
          start.second,
          timezone,
        ),
      );
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return results;
}

export function occurrenceKey(date: Date) {
  return date.toISOString();
}

export function localDateKey(date: Date, timezone: string) {
  const parts = zonedParts(date, timezone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function localDateTimeToUtc(
  localDate: string,
  localTime: string,
  timezone: string,
) {
  const [year, month, day] = localDate.split("-").map(Number);
  const [hour, minute, second = 0] = localTime.split(":").map(Number);
  if (
    [year, month, day, hour, minute, second].some(
      (part) => !Number.isFinite(part),
    )
  )
    throw new Error("Invalid local date or time.");
  return zonedTimeToUtc(year, month, day, hour, minute, second, timezone);
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function zonedParts(date: Date, timezone: string) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<string, number>;
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timezone: string,
) {
  const desired = Date.UTC(year, month - 1, day, hour, minute, second);
  let instant = new Date(desired);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const actual = zonedParts(instant, timezone);
    const represented = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    instant = new Date(instant.getTime() + desired - represented);
  }
  return instant;
}
