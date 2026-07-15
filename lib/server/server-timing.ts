export type ServerTimingMetrics = Record<string, number | undefined>;

export function serializeServerTiming(metrics: ServerTimingMetrics) {
  return Object.entries(metrics)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]))
    .map(([name, duration]) => `${name};dur=${Math.max(0, duration).toFixed(1)}`)
    .join(", ");
}
