/** UTC calendar day used as crawl run_day key. */
export function utcRunDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}
