import { fromZonedTime } from "date-fns-tz";
import { localDate } from "@/lib/tasks/parser";

export interface ImportedCalendarEvent {
  title: string;
  description: string | null;
  scheduledDate: string;
  timeLabel: string | null;
}

type IcsProperty = {
  name: string;
  params: Record<string, string>;
  value: string;
};

type DateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const MAX_FILE_CHARACTERS = 5_000_000;
const MAX_EVENTS = 5_000;
const MAX_IMPORTS = 2_000;
const MAX_RECURRENCE_OCCURRENCES = 200;
const RECURRENCE_HORIZON_DAYS = 365 * 3;

function parseProperty(line: string): IcsProperty | null {
  const colon = line.indexOf(":");
  if (colon < 1) return null;
  const nameAndParams = line.slice(0, colon);
  const [name = "", ...rawParams] = nameAndParams.split(";");
  const params = Object.fromEntries(
    rawParams.flatMap((part) => {
      const separator = part.indexOf("=");
      if (separator < 1) return [];
      return [
        [
          part.slice(0, separator).toUpperCase(),
          part.slice(separator + 1).replace(/^"|"$/g, ""),
        ],
      ];
    }),
  );
  return {
    name: name.toUpperCase(),
    params,
    value: line.slice(colon + 1),
  };
}

function decodeText(value: string) {
  return value
    .replace(/\\[nN]/g, "\n")
    .replace(/\\([\\,;])/g, "$1")
    .trim();
}

function parseDateParts(property: IcsProperty): DateParts | null {
  const value = property.value.trim();
  const match = value.match(
    /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?Z?)?$/,
  );
  if (!match) return null;
  const parts: DateParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4] ?? 0),
    minute: Number(match[5] ?? 0),
    second: Number(match[6] ?? 0),
  };
  const check = new Date(
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    ),
  );
  if (
    check.getUTCFullYear() !== parts.year ||
    check.getUTCMonth() !== parts.month - 1 ||
    check.getUTCDate() !== parts.day ||
    parts.hour > 23 ||
    parts.minute > 59 ||
    parts.second > 59
  )
    return null;
  return parts;
}

function dateKey(parts: DateParts, property: IcsProperty) {
  const value = property.value.trim();
  if (property.params.VALUE?.toUpperCase() === "DATE" || !value.includes("T"))
    return `${parts.year.toString().padStart(4, "0")}-${parts.month
      .toString()
      .padStart(2, "0")}-${parts.day.toString().padStart(2, "0")}`;

  const wallTime = new Date(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const instant = value.endsWith("Z")
    ? new Date(
        Date.UTC(
          parts.year,
          parts.month - 1,
          parts.day,
          parts.hour,
          parts.minute,
          parts.second,
        ),
      )
    : property.params.TZID
      ? (() => {
          try {
            return fromZonedTime(wallTime, property.params.TZID);
          } catch {
            return wallTime;
          }
        })()
      : wallTime;
  return localDate(instant);
}

function dayOffset(start: DateParts, candidate: DateParts) {
  const startValue = Date.UTC(start.year, start.month - 1, start.day);
  const candidateValue = Date.UTC(
    candidate.year,
    candidate.month - 1,
    candidate.day,
  );
  return Math.floor((candidateValue - startValue) / 86_400_000);
}

function addCalendarDays(parts: DateParts, amount: number): DateParts {
  const date = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day + amount),
  );
  return {
    ...parts,
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function parseRule(value: string) {
  return Object.fromEntries(
    value.split(";").flatMap((item) => {
      const separator = item.indexOf("=");
      if (separator < 1) return [];
      return [
        [item.slice(0, separator).toUpperCase(), item.slice(separator + 1)],
      ];
    }),
  );
}

function recurrenceDates(
  start: DateParts,
  startProperty: IcsProperty,
  ruleText: string,
  today: string,
) {
  const rule = parseRule(ruleText);
  const frequency = rule.FREQ;
  if (
    !frequency ||
    !["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(frequency)
  )
    return [dateKey(start, startProperty)].filter((date) => date >= today);
  const interval = Math.max(1, Math.min(365, Number(rule.INTERVAL) || 1));
  const requestedCount = Number(rule.COUNT);
  const countLimit = Number.isFinite(requestedCount)
    ? Math.max(1, Math.min(requestedCount, 36_600))
    : 36_600;
  const untilProperty = rule.UNTIL
    ? parseProperty(`UNTIL:${rule.UNTIL}`)
    : null;
  const untilParts = untilProperty ? parseDateParts(untilProperty) : null;
  const byDays = rule.BYDAY?.split(",").map((value) =>
    value.slice(-2).toUpperCase(),
  );
  const weekdayCodes = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  const startDate = new Date(Date.UTC(start.year, start.month - 1, start.day));
  const todayParts = today.split("-").map(Number);
  const horizon = new Date(
    Date.UTC(
      todayParts[0],
      todayParts[1] - 1,
      todayParts[2] + RECURRENCE_HORIZON_DAYS,
    ),
  );
  const dates: string[] = [];
  let seenOccurrences = 0;
  const maximumDays = Math.max(
    0,
    Math.min(
      36_600,
      Math.ceil((horizon.getTime() - startDate.getTime()) / 86_400_000),
    ),
  );

  for (let offset = 0; offset <= maximumDays; offset += 1) {
    const candidate = addCalendarDays(start, offset);
    const date = new Date(
      Date.UTC(candidate.year, candidate.month - 1, candidate.day),
    );
    const day = weekdayCodes[date.getUTCDay()];
    const daysSinceStart = dayOffset(start, candidate);
    const weekStartOffset = (startDate.getUTCDay() + 6) % 7;
    const weeksSinceStart = Math.floor((daysSinceStart + weekStartOffset) / 7);
    const monthsSinceStart =
      (candidate.year - start.year) * 12 + candidate.month - start.month;
    const matches =
      offset === 0 ||
      (frequency === "DAILY" && daysSinceStart % interval === 0) ||
      (frequency === "WEEKLY" &&
        weeksSinceStart % interval === 0 &&
        (byDays?.length
          ? byDays.includes(day)
          : day === weekdayCodes[startDate.getUTCDay()])) ||
      (frequency === "MONTHLY" &&
        monthsSinceStart % interval === 0 &&
        (rule.BYMONTHDAY
          ? rule.BYMONTHDAY.split(",").some((value) => {
              const dayOfMonth = Number(value);
              const monthLength = new Date(
                Date.UTC(candidate.year, candidate.month, 0),
              ).getUTCDate();
              const normalized =
                dayOfMonth < 0 ? monthLength + dayOfMonth + 1 : dayOfMonth;
              return normalized === candidate.day;
            })
          : rule.BYDAY
            ? rule.BYDAY.split(",").some((value) => {
                const weekday = value.slice(-2).toUpperCase();
                if (weekday !== day) return false;
                const ordinal = Number(value.slice(0, -2));
                if (!ordinal) return true;
                if (ordinal > 0)
                  return Math.ceil(candidate.day / 7) === ordinal;
                const daysRemaining =
                  new Date(
                    Date.UTC(candidate.year, candidate.month, 0),
                  ).getUTCDate() - candidate.day;
                return Math.floor(daysRemaining / 7) + 1 === Math.abs(ordinal);
              })
            : candidate.day === start.day)) ||
      (frequency === "YEARLY" &&
        (candidate.year - start.year) % interval === 0 &&
        candidate.month === start.month &&
        candidate.day === start.day);
    if (!matches) continue;
    if (
      untilParts &&
      Date.UTC(candidate.year, candidate.month - 1, candidate.day) >
        Date.UTC(untilParts.year, untilParts.month - 1, untilParts.day)
    )
      break;
    seenOccurrences += 1;
    if (seenOccurrences > countLimit) break;
    const key = dateKey(candidate, startProperty);
    if (key >= today) dates.push(key);
    if (dates.length >= MAX_RECURRENCE_OCCURRENCES) break;
  }
  return dates;
}

export function parseIcsCalendar(text: string, today: string) {
  if (text.length > MAX_FILE_CHARACTERS)
    throw new Error(
      "This calendar file is too large to import (5 MB maximum).",
    );
  const lines = text
    .replace(/^\uFEFF/, "")
    .replace(/\r?\n[ \t]/g, "")
    .split(/\r?\n/);
  const events: IcsProperty[][] = [];
  let current: IcsProperty[] | null = null;
  for (const line of lines) {
    if (line.toUpperCase() === "BEGIN:VEVENT") {
      if (events.length >= MAX_EVENTS)
        throw new Error(
          `Calendar files can contain up to ${MAX_EVENTS} events.`,
        );
      current = [];
    } else if (line.toUpperCase() === "END:VEVENT") {
      if (current) events.push(current);
      current = null;
    } else if (current) {
      const property = parseProperty(line);
      if (property) current.push(property);
    }
  }
  if (!events.length)
    throw new Error("No calendar events were found in this .ics file.");

  const imported: ImportedCalendarEvent[] = [];
  let skipped = 0;
  for (const properties of events) {
    const get = (name: string) => properties.find((item) => item.name === name);
    const startProperty = get("DTSTART");
    const summary = get("SUMMARY");
    const status = get("STATUS")?.value.toUpperCase();
    const start = startProperty ? parseDateParts(startProperty) : null;
    if (!startProperty || !start || status === "CANCELLED") {
      skipped += 1;
      continue;
    }
    const title = decodeText(summary?.value ?? "").slice(0, 500);
    if (!title) {
      skipped += 1;
      continue;
    }
    const rule = get("RRULE")?.value;
    const recurrence = rule
      ? recurrenceDates(start, startProperty, rule, today)
      : [dateKey(start, startProperty)].filter((date) => date >= today);
    const recurrenceDatesFromFile = properties
      .filter((property) => property.name === "RDATE")
      .flatMap((property) =>
        property.value.split(",").flatMap((value) => {
          const dateProperty = { ...property, value };
          const parts = parseDateParts(dateProperty);
          if (!parts) return [];
          const date = dateKey(parts, dateProperty);
          return date >= today ? [date] : [];
        }),
      );
    const dates = [...new Set([...recurrence, ...recurrenceDatesFromFile])];
    const excluded = new Set(
      properties
        .filter((property) => property.name === "EXDATE")
        .flatMap((property) =>
          property.value.split(",").flatMap((value) => {
            const dateProperty = { ...property, value };
            const parts = parseDateParts(dateProperty);
            return parts ? [dateKey(parts, dateProperty)] : [];
          }),
        ),
    );
    const remainingDates = dates.filter((date) => !excluded.has(date));
    if (!remainingDates.length) {
      skipped += 1;
      continue;
    }
    const description = decodeText(get("DESCRIPTION")?.value ?? "").slice(
      0,
      20_000,
    );
    const timeLabel = startProperty.value.includes("T")
      ? `${start.hour.toString().padStart(2, "0")}:${start.minute
          .toString()
          .padStart(
            2,
            "0",
          )} (${startProperty.params.TZID ?? (startProperty.value.endsWith("Z") ? "UTC" : "local time")})`
      : null;
    for (const scheduledDate of remainingDates) {
      imported.push({
        title,
        description: description || null,
        scheduledDate,
        timeLabel,
      });
      if (imported.length >= MAX_IMPORTS) break;
    }
    if (imported.length >= MAX_IMPORTS) break;
  }
  imported.sort(
    (left, right) =>
      left.scheduledDate.localeCompare(right.scheduledDate) ||
      left.title.localeCompare(right.title),
  );
  return { events: imported, skipped };
}
