const TUNER_STORAGE_KEY = "oriental.voiceTuner";

/**
 * The voice register picker is a tuning tool, not public UI: always on in dev;
 * on production it only appears after visiting /?voices=1 (cleared again with
 * /?voices=0). The choice persists per browser in localStorage.
 */
export function readTunerFlag() {
  try {
    const voices = new URLSearchParams(window.location.search).get("voices");
    if (voices === "1") window.localStorage.setItem(TUNER_STORAGE_KEY, "1");
    if (voices === "0") window.localStorage.removeItem(TUNER_STORAGE_KEY);
    return process.env.NODE_ENV !== "production" || window.localStorage.getItem(TUNER_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
