import { newHavenToday, recentCalendarDates } from "./ask.js";

const months = ["january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december"];
const month = months.join("|");
const countWords = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const count = String.raw`\d{1,3}|${Object.keys(countWords).join("|")}`;
const datePart = String.raw`\d{4}-\d{2}-\d{2}|(?:${month}) \d{1,2},? \d{4}`;
const period = new RegExp([
  String.raw`\b(?:between|from) (?<start>${datePart}) (?:and|through|to) (?<end>${datePart})\b`,
  String.raw`\bsince (?<since>${datePart})\b`,
  String.raw`\b(?:(?:in|for|during|from) )?(?<month>${month}) (?<year>\d{4})\b`,
  String.raw`\b(?:(?:in|during|over|within|from|for) )?(?:the )?(?<rolling>past|last|previous) (?<count>${count}) (?<units>days?|weeks?|months?|years?)\b`,
  String.raw`\b(?:(?:in|during|over|within|from|for) )?(?:the )?(?<calendar>this past|this|last|previous|past) (?<unit>week|month|year)\b`,
].join("|"), "gi");

const iso = (date) => date.toISOString().slice(0, 10);
const day = (date) => new Date(`${date}T00:00:00Z`);
const addDays = (date, count) => new Date(date.getTime() + count * 86_400_000);
const monthStart = (year, month) => new Date(Date.UTC(year, month, 1));
function readDay(value) {
  const named = value.match(/^(\w+) (\d{1,2}),? (\d{4})$/);
  if (named) {
    const m = months.indexOf(named[1]);
    const year = Number(named[3]);
    const date = new Date(Date.UTC(year, m, Number(named[2])));
    return year >= 1000 && date.getUTCMonth() === m ? iso(date) : null;
  }
  const date = day(value);
  return Number.isFinite(date.getTime()) && iso(date) === value ? value : null;
}

function rollingBounds(amount, units, today, now) {
  if (units.startsWith("day") || units.startsWith("week")) {
    const days = amount * (units.startsWith("week") ? 7 : 1);
    return days <= 366 ? recentCalendarDates(days, now) : null;
  }
  const back = amount * (units.startsWith("year") ? 12 : 1);
  if (back > 120) return null;
  const year = today.getUTCFullYear();
  const target = today.getUTCMonth() - back;
  const end = addDays(monthStart(year, target + 1), -1).getUTCDate();
  const start = new Date(Date.UTC(year, target, Math.min(today.getUTCDate(), end)));
  return { from: iso(addDays(start, 1)), to: iso(today) };
}

export function questionDates(question, now) {
  if (/\b(?:same|that|those) (?:\d{1,3}[- ](?:day|week|month|year) )?(?:date range|period|window)\b/i.test(question))
    return { issue: "Which dates should this search use? Enter the earlier date range or an explicit time window." };
  const matches = [...question.toLowerCase().matchAll(period)];
  if (!matches.length) return null;
  if (matches.length > 1) return { issue: "Specify which published event should use each date range." };
  const match = matches[0];
  const parts = match.groups;
  const today = day(newHavenToday(now));
  let bounds;
  if (parts.start || parts.since) {
    bounds = { from: readDay(parts.start ?? parts.since), to: parts.end ? readDay(parts.end) : iso(today) };
  } else if (parts.month) {
    const index = months.indexOf(parts.month);
    const year = Number(parts.year);
    if (year >= 1000) bounds = { from: iso(monthStart(year, index)),
      to: iso(addDays(monthStart(year, index + 1), -1)) };
  } else if (parts.rolling) {
    const amount = countWords[parts.count] ?? Number(parts.count);
    if (amount > 0) bounds = rollingBounds(amount, parts.units, today, now);
  } else if (parts.calendar === "past" || parts.calendar === "this past") {
    bounds = parts.unit === "month" ? recentCalendarDates(30, now) : rollingBounds(1, parts.unit, today, now);
  } else {
    const year = today.getUTCFullYear();
    const currentMonth = today.getUTCMonth();
    const monday = addDays(today, -(today.getUTCDay() + 6) % 7);
    const current = parts.calendar === "this";
    const start = parts.unit === "week" ? monday : monthStart(year, parts.unit === "month" ? currentMonth : 0);
    const previous = parts.unit === "week" ? addDays(monday, -7) :
      monthStart(year, parts.unit === "month" ? currentMonth - 1 : -12);
    bounds = { from: iso(current ? start : previous), to: iso(current ? today : addDays(start, -1)) };
  }
  if (!bounds?.from || !bounds.to || bounds.from > bounds.to)
    return { issue: "Enter a valid calendar date range in chronological order." };
  return { from: bounds.from, to: bounds.to, start: match.index, end: match.index + match[0].length };
}
