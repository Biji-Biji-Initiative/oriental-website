export const LEAD_SUBMIT_TIMEOUT_MS = 18_000;

export type LeadSubmitResponse = {
  ok?: boolean;
  id?: string;
  error?: string;
  persisted?: boolean;
  notifications?: {
    email?: NotificationResult;
    slack?: NotificationResult;
  };
};

export type NotificationResult = {
  ok?: boolean;
  skipped?: boolean;
  reason?: string;
  error?: string;
};

export function notificationDelivered(response: LeadSubmitResponse | null) {
  return response?.notifications?.email?.ok === true || response?.notifications?.slack?.ok === true;
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs = LEAD_SUBMIT_TIMEOUT_MS,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export function leadSubmitErrorCopy(status: number | undefined, response: LeadSubmitResponse | null) {
  if (response?.error === "notification_failed" && response.persisted) {
    return {
      title: "Saved, but notifications need attention.",
      description:
        "Your details were stored, but the owner notification did not complete. Please use team@mereka.io if this is urgent.",
    };
  }
  if (response?.error === "turnstile_failed") {
    return {
      title: "Browser verification failed.",
      description: "Refresh and try again. If it keeps failing, email team@mereka.io.",
    };
  }
  if (response?.error === "rate_limited" || status === 429) {
    return {
      title: "Too many attempts.",
      description: "Please wait a few minutes before sending again.",
    };
  }
  if (response?.error === "invalid_payload") {
    return {
      title: "Some details look incomplete.",
      description: "Please check the highlighted fields and send again.",
    };
  }
  return {
    title: "Could not send this yet.",
    description: "Your handoff is still here. Please try again or email team@mereka.io.",
  };
}
