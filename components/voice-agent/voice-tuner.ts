const TUNER_DISABLED_KEY = "oriental.voiceTunerHidden";

/**
 * The voice register picker is shown by default so the team can review Reka's
 * registers on the live site and pick a favourite. It can be hidden per browser
 * with /?voices=0 (re-enabled with /?voices=1); the choice persists in
 * localStorage. Always on in dev regardless of the opt-out.
 */
export function readTunerFlag() {
  try {
    const voices = new URLSearchParams(window.location.search).get("voices");
    if (voices === "1") window.localStorage.removeItem(TUNER_DISABLED_KEY);
    if (voices === "0") window.localStorage.setItem(TUNER_DISABLED_KEY, "1");
    if (process.env.NODE_ENV !== "production") return true;
    return window.localStorage.getItem(TUNER_DISABLED_KEY) !== "1";
  } catch {
    // Storage/URL unavailable: default to showing the picker.
    return true;
  }
}
