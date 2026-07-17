let runtimePickerPromise: Promise<boolean> | undefined;

async function fetchRuntimePickerFlag(fetcher: typeof window.fetch) {
  try {
    const response = await fetcher("/api/client-config", {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return false;
    const payload: unknown = await response.json();
    return Boolean(
      payload &&
        typeof payload === "object" &&
        (payload as { voiceVariantPicker?: unknown }).voiceVariantPicker === true,
    );
  } catch {
    // Runtime governance fails closed; a config outage must not expose an
    // experiment control that health and release verification report as off.
    return false;
  }
}

/**
 * The voice register picker is always available in development. Production
 * first requires the runtime flag from `/api/client-config`. URL parameters
 * and browser storage have no authority over whether the picker is visible.
 */
export async function readTunerFlag(fetcher?: typeof window.fetch, environment = process.env.NODE_ENV) {
  if (environment !== "production") return true;

  let enabled: boolean;
  if (fetcher) {
    enabled = await fetchRuntimePickerFlag(fetcher);
  } else {
    if (!runtimePickerPromise) runtimePickerPromise = fetchRuntimePickerFlag(window.fetch.bind(window));
    enabled = await runtimePickerPromise;
  }
  return enabled;
}
