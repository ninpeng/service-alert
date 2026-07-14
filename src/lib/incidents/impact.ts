export const INCIDENT_IMPACT_LABELS = {
  critical: "심각",
  major: "주요",
  minor: "일부",
  none: "영향 없음"
} as const;

export type RecognizedIncidentImpact = keyof typeof INCIDENT_IMPACT_LABELS;

export const RECOGNIZED_INCIDENT_IMPACTS = Object.keys(INCIDENT_IMPACT_LABELS) as RecognizedIncidentImpact[];

export function getIncidentImpactLabel(value: string | null) {
  return value && Object.hasOwn(INCIDENT_IMPACT_LABELS, value)
    ? INCIDENT_IMPACT_LABELS[value as RecognizedIncidentImpact]
    : "알 수 없음";
}
