import type { OverallStatus, ProviderId, ProviderSnapshot } from "../types";

interface StatuspageContext {
  provider: ProviderId;
  serviceName: string;
  endpoint: string;
}

interface StatuspageSummary {
  page?: {
    id?: string;
    name?: string;
    url?: string;
    updated_at?: string;
  };
  components?: Array<{
    id?: string;
    name?: string;
    status?: string;
    updated_at?: string;
  }>;
  incidents?: Array<Record<string, unknown>>;
  scheduled_maintenances?: Array<Record<string, unknown>>;
  status?: {
    indicator?: string;
    description?: string;
  };
}

export function parseStatuspageSummary(payload: StatuspageSummary, context: StatuspageContext): ProviderSnapshot {
  return {
    service: {
      provider: context.provider,
      name: context.serviceName,
      endpoint: context.endpoint
    },
    overallStatus: parseOverallStatus(payload.status?.indicator),
    checkedAt: new Date(),
    components: (payload.components ?? []).map((component) => ({
      externalId: requiredString(component.id, "component.id"),
      name: component.name ?? "Unknown component",
      status: component.status ?? "unknown",
      updatedAt: parseOptionalDate(component.updated_at)
    })),
    incidents: [
      ...(payload.incidents ?? []).map((incident) => parseStatuspageIncident(incident, false)),
      ...(payload.scheduled_maintenances ?? []).map((maintenance) => parseStatuspageIncident(maintenance, true))
    ]
  };
}

export async function fetchStatuspageSummary(
  endpoint: string,
  context: StatuspageContext,
  fetchImpl: typeof fetch = fetch
): Promise<ProviderSnapshot> {
  const response = await fetchImpl(endpoint, {
    headers: {
      accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Statuspage request failed for ${context.serviceName}: ${response.status} ${response.statusText}`);
  }

  return parseStatuspageSummary((await response.json()) as StatuspageSummary, context);
}

function parseStatuspageIncident(incident: Record<string, unknown>, isMaintenance: boolean) {
  const id = requiredString(incident.id, "incident.id");
  const status = stringValue(incident.status) ?? "unknown";
  const resolvedAt = parseOptionalDate(incident.resolved_at);

  return {
    externalId: isMaintenance ? `maintenance:${id}` : id,
    title: stringValue(incident.name) ?? "Untitled incident",
    status,
    impact: stringValue(incident.impact),
    url: stringValue(incident.shortlink) ?? stringValue(incident.url),
    startedAt: parseOptionalDate(incident.created_at) ?? parseOptionalDate(incident.scheduled_for),
    updatedAt: parseOptionalDate(incident.updated_at) ?? parseOptionalDate(incident.created_at),
    resolvedAt,
    isMaintenance,
    shouldNotify: !isMaintenance,
    raw: incident
  };
}

function parseOverallStatus(indicator: string | undefined): OverallStatus {
  if (indicator === "none" || indicator === "minor" || indicator === "major" || indicator === "critical") {
    return indicator;
  }

  return "unknown";
}

function parseOptionalDate(value: unknown): Date | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function requiredString(value: unknown, field: string) {
  const result = stringValue(value);

  if (!result) {
    throw new Error(`Missing required Statuspage field: ${field}`);
  }

  return result;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
