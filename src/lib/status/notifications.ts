import type { NormalizedIncident, NotificationEventType, ProviderId } from "./types";

export function buildNotificationDedupeKey(provider: ProviderId, incident: NormalizedIncident) {
  const updatedAt = incident.updatedAt ?? incident.startedAt ?? new Date(0);
  return [provider, incident.externalId, incident.status, updatedAt.toISOString()].join(":");
}

export function getNotificationEventType(incident: NormalizedIncident): NotificationEventType {
  const status = incident.status.toLowerCase();

  if (status.includes("resolved") || status.includes("complete")) {
    return "incident_resolved";
  }

  if (
    incident.startedAt &&
    incident.updatedAt &&
    Math.abs(incident.startedAt.getTime() - incident.updatedAt.getTime()) < 1000
  ) {
    return "incident_started";
  }

  return "incident_update";
}

export function shouldSendSlackNotification(incident: NormalizedIncident) {
  return (
    incident.shouldNotify &&
    !incident.isMaintenance &&
    isMajorOrCriticalImpact(incident.impact) &&
    getNotificationEventType(incident) !== "incident_update"
  );
}

function isMajorOrCriticalImpact(impact: string | null) {
  const normalized = impact?.toLowerCase();
  return normalized === "major" || normalized === "critical";
}
