export type AppStep =
  | "upload"
  | "scan"
  | "review"
  | "redact"
  | "compare"
  | "verified";
  
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
