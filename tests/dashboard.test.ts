import { describe, expect, it } from "vitest";
import {
  buildOperationalStatus,
  summarizeRecentLogContent
} from "@/lib/dashboard/operational-status";
import { formatDashboardDateTime } from "@/lib/dashboard/date-format";
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

describe("buildOperationalStatus", () => {
  it("summarizes the last worker run and next expected run without exposing the Slack webhook", () => {
    const status = buildOperationalStatus({
      generatedAt: new Date("2026-06-16T00:10:00.000Z"),
      slackWebhookUrl: "https://hooks.slack.com/services/example",
      workerRuns: [
        {
          id: "run-1",
          status: "SUCCESS",
          startedAt: new Date("2026-06-16T00:04:30.000Z"),
          finishedAt: new Date("2026-06-16T00:05:00.000Z"),
          providersChecked: 7,
          providersFailed: 0,
          errorMessage: null
        }
      ],
      logs: {
        web: summarizeRecentLogContent(""),
        worker: summarizeRecentLogContent("DEP0205 warning\nfetch failed\n")
      }
    });

    expect(status.lastWorkerRun).toEqual({
      id: "run-1",
      status: "SUCCESS",
      startedAt: "2026-06-16T00:04:30.000Z",
      finishedAt: "2026-06-16T00:05:00.000Z",
      providersChecked: 7,
      providersFailed: 0,
      errorMessage: null
    });
    expect(status.nextWorkerRunAt).toBe("2026-06-16T00:10:00.000Z");
    expect(status.slackWebhookConfigured).toBe(true);
    expect(status.logs.worker).toEqual({
      exists: true,
      hasRecentEntries: true,
      lastLines: ["DEP0205 warning", "fetch failed"]
    });
  });

  it("reports missing worker and blank Slack webhook safely", () => {
    const status = buildOperationalStatus({
      generatedAt: new Date("2026-06-16T00:10:00.000Z"),
      slackWebhookUrl: "   ",
      workerRuns: [],
      logs: {
        web: { exists: false, hasRecentEntries: false, lastLines: [] },
        worker: { exists: false, hasRecentEntries: false, lastLines: [] }
      }
    });

    expect(status.lastWorkerRun).toBeNull();
    expect(status.nextWorkerRunAt).toBeNull();
    expect(status.slackWebhookConfigured).toBe(false);
  });
});

describe("formatDashboardDateTime", () => {
  it("uses a deterministic Korean 24-hour format across server and client rendering", () => {
    expect(formatDashboardDateTime("2026-06-16T03:52:00.000Z")).toBe("6월 16일 12:52");
    expect(formatDashboardDateTime(null, "없음")).toBe("없음");
  });
});
