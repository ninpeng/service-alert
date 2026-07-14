import { describe, expect, it } from "vitest";
import { buildIncidentWhere, incidentOrderBy, isResolvedIncident } from "@/lib/incidents/query";
import { parseIncidentSearchParams } from "@/lib/incidents/search-params";

describe("incident search query", () => {
  const now = new Date("2026-07-14T00:00:00.000Z");

  it("builds the default 30-day non-maintenance condition", () => {
    expect(buildIncidentWhere(parseIncidentSearchParams({}), now)).toEqual({
      AND: [
        { isMaintenance: false },
        {
          OR: [
            { updatedAt: { gte: new Date("2026-06-14T00:00:00.000Z") } },
            { AND: [{ updatedAt: null }, { startedAt: { gte: new Date("2026-06-14T00:00:00.000Z") } }] },
            {
              AND: [
                { updatedAt: null },
                { startedAt: null },
                { firstSeenAt: { gte: new Date("2026-06-14T00:00:00.000Z") } }
              ]
            }
          ]
        }
      ]
    });
  });

  it("combines search, service, state, impact, and maintenance filters", () => {
    const where = buildIncidentWhere(
      parseIncidentSearchParams({
        q: "login",
        service: "jira",
        state: "resolved",
        impact: "unknown",
        period: "all",
        type: "maintenance"
      }),
      now
    );

    expect(where).toEqual({
      AND: [
        {
          OR: [
            { title: { contains: "login" } },
            { service: { is: { name: { contains: "login" } } } },
            { service: { is: { provider: { contains: "login" } } } }
          ]
        },
        { service: { is: { provider: "jira" } } },
        {
          OR: [
            { resolvedAt: { not: null } },
            { status: { in: ["resolved", "complete", "completed", "postmortem"] } }
          ]
        },
        { OR: [{ impact: null }, { impact: "" }] },
        { isMaintenance: true }
      ]
    });
  });

  it("classifies persisted rows and exposes a stable order", () => {
    expect(isResolvedIncident({ status: "monitoring", resolvedAt: null })).toBe(false);
    expect(isResolvedIncident({ status: "resolved", resolvedAt: null })).toBe(true);
    expect(isResolvedIncident({ status: "monitoring", resolvedAt: new Date() })).toBe(true);
    expect(incidentOrderBy).toEqual([
      { updatedAt: "desc" },
      { startedAt: "desc" },
      { firstSeenAt: "desc" },
      { id: "desc" }
    ]);
  });
});
