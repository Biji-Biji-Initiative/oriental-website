export function ownsVoiceConnectAttempt(activeAttempt: number, candidateAttempt: number, status: string) {
  return activeAttempt === candidateAttempt && status !== "idle";
}
