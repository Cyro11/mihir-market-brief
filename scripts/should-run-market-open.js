import { pathToFileURL } from "node:url";

function partsInNewYork(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23"
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

function ymd(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function observedFixedHoliday(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = date.getUTCDay();
  if (dayOfWeek === 6) return ymd(year, month, day - 1);
  if (dayOfWeek === 0) return ymd(year, month, day + 1);
  return ymd(year, month, day);
}

function nthWeekday(year, month, weekday, nth) {
  let count = 0;
  for (let day = 1; day <= 31; day += 1) {
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCMonth() !== month - 1) break;
    if (date.getUTCDay() === weekday) {
      count += 1;
      if (count === nth) return ymd(year, month, day);
    }
  }
  throw new Error(`No weekday ${weekday} #${nth} in ${year}-${month}`);
}

function lastWeekday(year, month, weekday) {
  for (let day = 31; day >= 1; day -= 1) {
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCMonth() === month - 1 && date.getUTCDay() === weekday) return ymd(year, month, day);
  }
  throw new Error(`No weekday ${weekday} in ${year}-${month}`);
}

function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function goodFriday(year) {
  const easter = easterSunday(year);
  easter.setUTCDate(easter.getUTCDate() - 2);
  return ymd(easter.getUTCFullYear(), easter.getUTCMonth() + 1, easter.getUTCDate());
}

export function nyseFullHolidays(year) {
  return new Set([
    observedFixedHoliday(year, 1, 1),
    nthWeekday(year, 1, 1, 3),
    nthWeekday(year, 2, 1, 3),
    goodFriday(year),
    lastWeekday(year, 5, 1),
    observedFixedHoliday(year, 6, 19),
    observedFixedHoliday(year, 7, 4),
    nthWeekday(year, 9, 1, 1),
    nthWeekday(year, 11, 4, 4),
    observedFixedHoliday(year, 12, 25)
  ]);
}

export function shouldRunMarketOpen(date = new Date(), eventName = process.env.GITHUB_EVENT_NAME || "schedule") {
  if (eventName === "workflow_dispatch") {
    return { shouldRun: true, reason: "manual workflow dispatch" };
  }

  const ny = partsInNewYork(date);
  const year = Number(ny.year);
  const minute = Number(ny.minute);
  const hour = Number(ny.hour);
  const localDate = `${ny.year}-${ny.month}-${ny.day}`;
  const isWeekday = !["Sat", "Sun"].includes(ny.weekday);
  const isHoliday = nyseFullHolidays(year).has(localDate);
  const isMarketOpenWindow = hour === 9 && minute >= 35 && minute <= 50;

  return {
    shouldRun: isWeekday && !isHoliday && isMarketOpenWindow,
    reason: `${localDate} ${ny.hour}:${ny.minute} America/New_York; weekday=${isWeekday}; holiday=${isHoliday}; window=${isMarketOpenWindow}`
  };
}

function main() {
  const check = shouldRunMarketOpen();
  console.log(`should_run=${check.shouldRun ? "true" : "false"}`);
  console.log(`reason=${check.reason}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
