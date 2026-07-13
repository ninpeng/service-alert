import type {
  NormalizedIncident,
  OverallStatus,
  ProviderId,
  ProviderSnapshot
} from "../types";

export interface GoogleWorkspaceContext {
  provider: ProviderId;
  serviceName: string;
  sourceServiceName: string;
  endpoint: string;
}

export function parseGoogleWorkspaceStatus(
  payload: unknown,
  context: GoogleWorkspaceContext
): ProviderSnapshot {
  if (!Array.isArray(payload)) {
    throw new Error(
      "Invalid Google Workspace response for " + context.serviceName + ": expected an array"
    );
  }

  const activeRecords = payload
    .filter(isRecord)
    .filter((incident) => stringValue(incident.service_name) === context.sourceServiceName)
    .filter(isActiveIncident);
  const incidents = activeRecords.map((incident) => normalizeIncident(incident, context));
  const overallStatus = activeRecords
    .map((incident) => severityState(incident.severity).overallStatus)
    .reduce(moreSevereStatus, "none");
  const componentStatus = overallToComponentStatus(overallStatus);

  return {
    service: {
      provider: context.provider,
      name: context.serviceName,
      endpoint: context.endpoint
    },
    overallStatus,
    checkedAt: new Date(),
    components: [
      {
        externalId: context.provider,
        name: context.serviceName,
        status: componentStatus,
        updatedAt: latestDate(incidents.map((incident) => incident.updatedAt))
      }
    ],
    incidents
  };
}

export async function fetchGoogleWorkspaceStatus(
  endpoint: string,
  context: GoogleWorkspaceContext,
  fetchImpl: typeof fetch = fetch
): Promise<ProviderSnapshot> {
  const response = await fetchImpl(endpoint, {
    headers: { accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(
      "Google Workspace request failed for " +
        context.serviceName +
        ": " +
        response.status +
        " " +
        response.statusText
    );
  }

  return parseGoogleWorkspaceStatus(await response.json(), context);
}

function isActiveIncident(incident: Record<string, unknown>) {
  return !stringValue(incident.end) && latestStatus(incident) !== "AVAILABLE";
}

function normalizeIncident(
  incident: Record<string, unknown>,
  context: GoogleWorkspaceContext
): NormalizedIncident {
  const externalId = requiredString(incident.id, "incident.id", context.serviceName);
  const severity = severityState(incident.severity);
  const uri = stringValue(incident.uri);

  return {
    externalId,
    title: extractTitle(
      stringValue(incident.external_desc),
      context.serviceName + " incident"
    ),
    status: latestStatus(incident),
    impact: severity.impact,
    url: uri
      ? new URL(uri, "https://www.google.com/appsstatus/dashboard/").toString()
      : "https://www.google.com/appsstatus/dashboard/",
    startedAt: parseOptionalDate(incident.begin),
    updatedAt: parseOptionalDate(incident.modified),
    resolvedAt: null,
    isMaintenance: false,
    shouldNotify: true,
    raw: incident
  };
}

function latestStatus(incident: Record<string, unknown>) {
  const update = isRecord(incident.most_recent_update) ? incident.most_recent_update : null;
  return stringValue(update?.status) ?? "unknown";
}

function severityState(value: unknown): {
  impact: string | null;
  overallStatus: OverallStatus;
} {
  const severity = stringValue(value)?.toLowerCase();

  if (severity === "low") {
    return { impact: "minor", overallStatus: "minor" };
  }
  if (severity === "medium") {
    return { impact: "major", overallStatus: "major" };
  }
  if (severity === "high" || severity === "critical") {
    return { impact: "critical", overallStatus: "critical" };
  }

  return { impact: null, overallStatus: "unknown" };
}

function overallToComponentStatus(status: OverallStatus) {
  const statuses: Record<OverallStatus, string> = {
    none: "operational",
    minor: "degraded_performance",
    major: "partial_outage",
    critical: "major_outage",
    unknown: "unknown"
  };
  return statuses[status];
}

function extractTitle(description: string | null, fallback: string) {
  if (!description) {
    return fallback;
  }

  const lines = description
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const titleMarker = lines.findIndex(
    (line) => line.replaceAll("*", "").trim().toLowerCase() === "title"
  );
  const candidate = titleMarker >= 0 ? lines[titleMarker + 1] : lines[0];
  return candidate?.replace(/^\*\*|\*\*$/g, "").trim() || fallback;
}

function latestDate(values: Array<Date | null>) {
  const timestamps = values
    .filter((value): value is Date => Boolean(value))
    .map((value) => value.getTime());
  return timestamps.length > 0 ? new Date(Math.max(...timestamps)) : null;
}

function parseOptionalDate(value: unknown) {
  const source = stringValue(value);
  if (!source) {
    return null;
  }
  const date = new Date(source);
  return Number.isNaN(date.getTime()) ? null : date;
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

function requiredString(value: unknown, field: string, serviceName: string) {
  const result = stringValue(value);
  if (!result) {
    throw new Error("Missing Google Workspace field for " + serviceName + ": " + field);
  }
  return result;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
