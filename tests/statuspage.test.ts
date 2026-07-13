import { describe, expect, it } from "vitest";
import { parseStatuspageSummary } from "@/lib/status/adapters/statuspage";

describe("parseStatuspageSummary", () => {
  it("normalizes Statuspage components, active incidents, and scheduled maintenance", () => {
    const snapshot = parseStatuspageSummary(
      {
        page: {
          id: "rxpksf93ynw6",
          name: "Figma",
          url: "https://status.figma.com",
          updated_at: "2026-05-12T13:28:30.028Z"
        },
        components: [
          {
            id: "pn57gvt7sjmx",
            name: "Real-time collaboration server",
            status: "operational",
            updated_at: "2025-10-21T06:53:59.681Z"
          }
        ],
        incidents: [
          {
            id: "inc-1",
            name: "API degradation",
            status: "investigating",
            impact: "minor",
            created_at: "2026-05-12T01:00:00Z",
            updated_at: "2026-05-12T01:10:00Z",
            shortlink: "https://stspg.io/inc-1"
          }
        ],
        scheduled_maintenances: [
          {
            id: "maint-1",
            name: "Database maintenance",
            status: "scheduled",
            impact: "maintenance",
            scheduled_for: "2026-05-13T01:00:00Z",
            updated_at: "2026-05-12T00:00:00Z",
            shortlink: "https://stspg.io/maint-1"
          }
        ],
        status: {
          indicator: "minor",
          description: "Partial System Degradation"
        }
      },
      {
        provider: "figma",
        serviceName: "Figma",
        endpoint: "https://status.figma.com/api/v2/summary.json"
      }
    );

    expect(snapshot.service.provider).toBe("figma");
    expect(snapshot.overallStatus).toBe("minor");
    expect(snapshot.components).toEqual([
      {
        externalId: "pn57gvt7sjmx",
        name: "Real-time collaboration server",
        status: "operational",
        updatedAt: new Date("2025-10-21T06:53:59.681Z")
      }
    ]);
    expect(snapshot.incidents[0]).toMatchObject({
      externalId: "inc-1",
      title: "API degradation",
      status: "investigating",
      impact: "minor",
      url: "https://stspg.io/inc-1",
      shouldNotify: true,
      isMaintenance: false
    });
    expect(snapshot.incidents[1]).toMatchObject({
      externalId: "maintenance:maint-1",
      title: "Database maintenance",
      shouldNotify: false,
      isMaintenance: true
    });
  });

  it("removes excluded components and their incidents before recalculating status", () => {
    const snapshot = parseStatuspageSummary(
      {
        components: [
          { id: "chatgpt", name: "ChatGPT", status: "operational" },
          { id: "fedramp", name: "FedRAMP", status: "major_outage" }
        ],
        incidents: [
          {
            id: "fed-incident",
            name: "FedRAMP outage",
            status: "investigating",
            impact: "critical",
            components: [{ id: "fedramp", name: "FedRAMP" }]
          },
          {
            id: "global-incident",
            name: "Provider-wide degradation",
            status: "investigating",
            impact: "minor"
          }
        ],
        status: { indicator: "critical" }
      },
      {
        provider: "openai",
        serviceName: "OpenAI",
        endpoint: "https://status.openai.com/api/v2/summary.json",
        excludedComponentNames: ["FedRAMP"]
      }
    );

    expect(snapshot.components.map((component) => component.name)).toEqual(["ChatGPT"]);
    expect(snapshot.incidents.map((incident) => incident.externalId)).toEqual(["global-incident"]);
    expect(snapshot.overallStatus).toBe("minor");
  });
});
