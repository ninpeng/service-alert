import type { ProviderSnapshot } from "../types";

interface SlackCurrentStatus {
  status?: string;
  date_created?: string;
  date_updated?: string;
  active_incidents?: Array<Record<string, unknown>>;
}

export function parseSlackCurrentStatus(payload: SlackCurrentStatus): ProviderSnapshot {
  const updatedAt = parseOptionalDate(payload.date_updated) ?? parseOptionalDate(payload.date_created) ?? new Date();
  const incidents = (payload.active_incidents ?? []).map((incident) => {
    const id = stringValue(incident.id) ?? stringValue(incident.url) ?? stringValue(incident.title) ?? "slack-incident";
    const status = stringValue(incident.status) ?? stringValue(payload.status) ?? "unknown";

    return {
      externalId: id,
      title: stringValue(incident.title) ?? stringValue(incident.name) ?? "Slack incident",
      status,
      impact: stringValue(incident.type) ?? "incident",
      url: stringValue(incident.url),
      startedAt: parseOptionalDate(incident.date_created) ?? parseOptionalDate(payload.date_created),
      updatedAt: parseOptionalDate(incident.date_updated) ?? updatedAt,
      resolvedAt: parseOptionalDate(incident.date_resolved),
      isMaintenance: false,
      shouldNotify: true,
      raw: incident
    };
  });

  return {
    service: {
      provider: "slack",
      name: "Slack",
      endpoint: "https://slack-status.com/api/v2.0.0/current"
    },
    overallStatus: payload.status === "ok" ? "none" : incidents.length > 0 ? "minor" : "unknown",
    checkedAt: new Date(),
    components: [
      {
        externalId: "slack",
        name: "Slack",
        status: payload.status === "ok" ? "operational" : "degraded_performance",
        updatedAt
      }
    ],
    incidents
  };
}

export async function fetchSlackCurrentStatus(endpoint: string, fetchImpl: typeof fetch = fetch): Promise<ProviderSnapshot> {
  const response = await fetchImpl(endpoint, {
    headers: {
      accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Slack status request failed: ${response.status} ${response.statusText}`);
  }

  return parseSlackCurrentStatus((await response.json()) as SlackCurrentStatus);
}

function parseOptionalDate(value: unknown): Date | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
