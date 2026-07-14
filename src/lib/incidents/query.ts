import type { Prisma } from "../../generated/prisma/client";
import { RECOGNIZED_INCIDENT_IMPACTS } from "./impact";
import { getIncidentPeriodStart, type IncidentSearchFilters } from "./search-params";

export const TERMINAL_INCIDENT_STATUSES = ["resolved", "complete", "completed", "postmortem"];

export const incidentOrderBy: Prisma.IncidentOrderByWithRelationInput[] = [
  { updatedAt: "desc" },
  { startedAt: "desc" },
  { firstSeenAt: "desc" },
  { id: "desc" }
];

export function isResolvedIncident(incident: { status: string; resolvedAt: Date | null }) {
  return Boolean(incident.resolvedAt) || TERMINAL_INCIDENT_STATUSES.includes(incident.status.toLowerCase());
}

export function buildIncidentWhere(
  filters: IncidentSearchFilters,
  now = new Date()
): Prisma.IncidentWhereInput {
  const AND: Prisma.IncidentWhereInput[] = [];

  if (filters.q) {
    AND.push({
      OR: [
        { title: { contains: filters.q } },
        { service: { is: { name: { contains: filters.q } } } },
        { service: { is: { provider: { contains: filters.q } } } }
      ]
    });
  }

  if (filters.service !== "all") {
    AND.push({ service: { is: { provider: filters.service } } });
  }

  if (filters.state === "resolved") {
    AND.push({
      OR: [
        { resolvedAt: { not: null } },
        { status: { in: TERMINAL_INCIDENT_STATUSES } }
      ]
    });
  } else if (filters.state === "active") {
    AND.push({
      AND: [
        { resolvedAt: null },
        { status: { notIn: TERMINAL_INCIDENT_STATUSES } }
      ]
    });
  }

  if (filters.impact === "unknown") {
    AND.push({ OR: [{ impact: null }, { impact: "" }, { impact: { notIn: RECOGNIZED_INCIDENT_IMPACTS } }] });
  } else if (filters.impact !== "all") {
    AND.push({ impact: filters.impact });
  }

  if (filters.type === "incident") {
    AND.push({ isMaintenance: false });
  } else if (filters.type === "maintenance") {
    AND.push({ isMaintenance: true });
  }

  const periodStart = getIncidentPeriodStart(filters.period, now);
  if (periodStart) {
    AND.push({
      OR: [
        { updatedAt: { gte: periodStart } },
        { AND: [{ updatedAt: null }, { startedAt: { gte: periodStart } }] },
        { AND: [{ updatedAt: null }, { startedAt: null }, { firstSeenAt: { gte: periodStart } }] }
      ]
    });
  }

  return AND.length > 0 ? { AND } : {};
}
