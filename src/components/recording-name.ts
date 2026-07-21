export function normalizeRecordingName(value: string): string {
  return value.replace(/\s*\r?\n\s*/g, ' ').replace(/\s+/g, ' ').trim()
}
