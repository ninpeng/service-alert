import { describe, expect, it } from "vitest";
import { getLatestDataUpdatedAt, isActionableActiveIncident, summarizeDashboardStatus } from "@/lib/dashboard/summary";

describe("summarizeDashboardStatus", () => {
  it("prioritizes active incidents over component degradation", () => {
    expect(
      summarizeDashboardStatus({
        components: [{ status: "operational" }],
        incidents: [{ status: "investigating", isMaintenance: false }]
      })
    ).toBe("active_incident");
  });

  it("reports degraded when components are not fully operational", () => {
    expect(
      summarizeDashboardStatus({
        components: [{ status: "degraded_performance" }],
        incidents: []
      })
    ).toBe("degraded");
  });

  it("does not count non-notifiable feed items as active incidents", () => {
    expect(
      summarizeDashboardStatus({
        components: [{ status: "operational" }],
        incidents: [{ status: "update", isMaintenance: false, shouldNotify: false }]
      })
    ).toBe("operational");
  });
});

describe("isActionableActiveIncident", () => {
  it("excludes maintenance, resolved incidents, and non-notifiable feed items", () => {
    expect(isActionableActiveIncident({ status: "investigating", isMaintenance: false })).toBe(true);
    expect(isActionableActiveIncident({ status: "resolved", isMaintenance: false })).toBe(false);
    expect(isActionableActiveIncident({ status: "update", isMaintenance: false, shouldNotify: false })).toBe(false);
    expect(isActionableActiveIncident({ status: "scheduled", isMaintenance: true })).toBe(false);
  });
});

describe("getLatestDataUpdatedAt", () => {
  it("uses the latest completed worker run as the DB refresh time", () => {
    const latest = getLatestDataUpdatedAt({
      services: [
        {
          components: [{ checkedAt: new Date("2026-05-13T00:00:00.000Z") }],
          incidents: [{ lastSeenAt: new Date("2026-05-13T00:01:00.000Z") }]
        }
      ],
      workerRuns: [
        { status: "SUCCESS", finishedAt: new Date("2026-05-13T00:05:00.000Z") },
        { status: "RUNNING", finishedAt: null }
      ]
    });

    expect(latest?.toISOString()).toBe("2026-05-13T00:05:00.000Z");
  });

  it("falls back to persisted service data timestamps when there is no completed worker run", () => {
    const latest = getLatestDataUpdatedAt({
      services: [
        {
          components: [{ checkedAt: new Date("2026-05-13T00:02:00.000Z") }],
          incidents: [{ lastSeenAt: new Date("2026-05-13T00:03:00.000Z") }]
        }
      ],
      workerRuns: []
    });

    expect(latest?.toISOString()).toBe("2026-05-13T00:03:00.000Z");
  });
});
