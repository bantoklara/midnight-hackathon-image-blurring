export type AppStep =
  | "upload"
  | "scan"
  | "review"
  | "redact"
  | "compare"
  | "verified";
  
export type DetectionType = "face" | "license_plate" | "text";

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
