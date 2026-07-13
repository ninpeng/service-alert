import type {
  NormalizedComponent,
  NormalizedIncident,
  OverallStatus,
  ProviderId,
  ProviderSnapshot
} from "../types";

interface StatuspageContext {
  provider: ProviderId;
  serviceName: string;
  endpoint: string;
  excludedComponentNames?: readonly string[];
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
  const sourceComponents = payload.components ?? [];
  const excludedNames = new Set(context.excludedComponentNames ?? []);
  const excludedIds = new Set(
    sourceComponents
      .filter((component) => component.name && excludedNames.has(component.name))
      .map((component) => requiredString(component.id, "component.id"))
  );
  const componentPayloads = sourceComponents.filter(
    (component) => !excludedIds.has(requiredString(component.id, "component.id"))
  );
  const incidentPayloads = (payload.incidents ?? []).filter((incident) =>
    includesRetainedComponent(incident, excludedIds)
  );
  const maintenancePayloads = (payload.scheduled_maintenances ?? []).filter((maintenance) =>
    includesRetainedComponent(maintenance, excludedIds)
  );
  const components: NormalizedComponent[] = componentPayloads.map((component) => ({
    externalId: requiredString(component.id, "component.id"),
    name: component.name ?? "Unknown component",
    status: component.status ?? "unknown",
    updatedAt: parseOptionalDate(component.updated_at)
  }));
  const incidents: NormalizedIncident[] = [
    ...incidentPayloads.map((incident) => parseStatuspageIncident(incident, false)),
    ...maintenancePayloads.map((maintenance) => parseStatuspageIncident(maintenance, true))
  ];

  return {
    service: {
      provider: context.provider,
      name: context.serviceName,
      endpoint: context.endpoint
    },
    overallStatus:
      excludedNames.size === 0
        ? parseOverallStatus(payload.status?.indicator)
        : summarizeFilteredStatus(components, incidents),
    checkedAt: new Date(),
    components,
    incidents
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

function parseStatuspageIncident(incident: Record<string, unknown>, isMaintenance: boolean): NormalizedIncident {
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

function includesRetainedComponent(incident: Record<string, unknown>, excludedIds: ReadonlySet<string>) {
  if (!Array.isArray(incident.components) || incident.components.length === 0) {
    return true;
  }

  return incident.components.some((component) => {
    if (!isRecord(component)) {
      return true;
    }

    const id = stringValue(component.id);
    return !id || !excludedIds.has(id);
  });
}

function summarizeFilteredStatus(components: NormalizedComponent[], incidents: NormalizedIncident[]): OverallStatus {
  const candidates: OverallStatus[] = [
    ...components.map((component) => componentStatus(component.status)),
    ...incidents
      .filter((incident) => !incident.isMaintenance && incident.resolvedAt === null)
      .map((incident) => parseOverallStatus(incident.impact ?? undefined))
  ];

  return candidates.reduce(moreSevereStatus, "none");
}

function componentStatus(status: string): OverallStatus {
  const values: Record<string, OverallStatus> = {
    operational: "none",
    degraded_performance: "minor",
    partial_outage: "major",
    major_outage: "critical"
  };

  return values[status] ?? "unknown";
}

function moreSevereStatus(left: OverallStatus, right: OverallStatus): OverallStatus {
  const rank: Record<OverallStatus, number> = {
    none: 0,
    unknown: 1,
    minor: 2,
    major: 3,
    critical: 4
  };

  return rank[right] > rank[left] ? right : left;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
