/** Which of the two journeys the user picked on the landing screen. */
export type AppMode = "protect" | "verify";

export type AppStep =
  // shared
  | "upload"
  // protect path: detect, review, redact, commit
  | "scan"
  | "review"
  | "redact"
  | "compare"
  | "verified"
  // verify path: no detection or redaction happens, so it skips straight to the check
  | "verifyId"
  | "verifyResult";
  
/**
 * There is no licence-plate detector — that category only ever existed as a
 * hardcoded demo value. Plates are covered incidentally by OCR, which reads the
 * characters on them as text.
 */
export type DetectionType = "face" | "text";

export interface Detection {
  id: string;
  type: DetectionType;
  label: string;
  risk: "critical" | "high" | "medium";
  x: number;
  y: number;
  width: number;
  height: number;
  selected: boolean;
}
