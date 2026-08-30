export function portfolioCalendarDate(
  value: string | Date = new Date(),
): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Helsinki",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(typeof value === "string" ? new Date(value) : value);
}

export function marketDataTimelineTime(
  asOf: string,
  currentAsOf: string,
): string {
  const endOfObservationDay = `${asOf.slice(0, 10)}T23:59:59.999Z`;
  return endOfObservationDay > currentAsOf
    ? currentAsOf
    : endOfObservationDay;
}
