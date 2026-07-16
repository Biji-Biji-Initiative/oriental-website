const TUNER_DISABLED_KEY = "oriental.voiceTunerHidden";

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
 * first requires the runtime flag from `/api/client-config`; query/local
 * preferences can hide an allowed picker but can never bypass a disabled one.
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
  if (!enabled) return false;

  try {
    const voices = new URLSearchParams(window.location.search).get("voices");
    if (voices === "1") window.localStorage.removeItem(TUNER_DISABLED_KEY);
    if (voices === "0") window.localStorage.setItem(TUNER_DISABLED_KEY, "1");
    return window.localStorage.getItem(TUNER_DISABLED_KEY) !== "1";
  } catch {
    // Config explicitly allows the picker; unavailable preferences should not
    // hide the QA control in that environment.
    return true;
  }
}
