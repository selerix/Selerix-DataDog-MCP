/**
 * Aggregation helper — run a bag of named async fetchers in parallel via
 * `Promise.allSettled`, push labeled rejection messages onto a caveats array,
 * and return a typed object whose values are `null` for any rejected fetcher.
 *
 * Designed for the aggregation-tool pattern where one failed sub-call should
 * not poison the whole response (the surviving values still flow through, and
 * the partial-data condition is surfaced via the returned `caveats` array).
 */

export type Fetchers = Record<string, () => Promise<unknown>>;

export type Aggregated<T extends Fetchers> = {
  [K in keyof T]: Awaited<ReturnType<T[K]>> | null;
};

/**
 * Default rejection-reason → string formatter. Handles Error instances,
 * strings, and falls back to JSON.stringify. Override per call when the API
 * client throws structured exceptions you want to unpack differently.
 */
export function defaultFormatReason(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "string") return reason;
  try {
    return JSON.stringify(reason);
  } catch {
    return String(reason);
  }
}

export async function aggregate<T extends Fetchers>(
  fetchers: T,
  caveats: string[],
  formatReason: (reason: unknown) => string = defaultFormatReason,
): Promise<Aggregated<T>> {
  const labels = Object.keys(fetchers) as (keyof T & string)[];
  const settled = await Promise.allSettled(labels.map((label) => fetchers[label]()));

  const out: Record<string, unknown> = {};
  settled.forEach((r, i) => {
    const label = labels[i];
    if (r.status === "fulfilled") {
      out[label] = r.value;
    } else {
      caveats.push(`${label} failed: ${formatReason(r.reason)}`);
      out[label] = null;
    }
  });
  return out as Aggregated<T>;
}
