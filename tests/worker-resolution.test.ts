import { describe, expect, it } from "vitest";
import { buildResolvedMissingIncidents } from "@/lib/worker/check-services";
import type { ProviderSnapshot } from "@/lib/status/types";

const checkedAt = new Date("2026-05-14T10:00:00Z");

const snapshot: ProviderSnapshot = {
  service: {
    provider: "jira",
    name: "JIRA",
    endpoint: "https://jira-software.status.atlassian.com/api/v2/summary.json"
  },
  overallStatus: "none",
  checkedAt,
  components: [],
  incidents: []
};

describe("buildResolvedMissingIncidents", () => {
  it("marks previously active incidents as resolved when the provider no longer returns them", () => {
    const resolved = buildResolvedMissingIncidents(snapshot, [
      {
        externalId: "inc-1",
        title: "Jira outage",
        status: "monitoring",
        impact: "critical",
        url: "https://example.com/inc-1",
        startedAt: new Date("2026-05-14T09:00:00Z"),
        updatedAt: new Date("2026-05-14T09:30:00Z"),
        resolvedAt: null,
        isMaintenance: false,
        shouldNotify: true,
        rawPayload: "{\"id\":\"inc-1\"}"
      }
    ]);

    expect(resolved).toMatchObject([
      {
        externalId: "inc-1",
        title: "Jira outage",
        status: "resolved",
        impact: "critical",
        updatedAt: checkedAt,
        resolvedAt: checkedAt,
        isMaintenance: false,
        shouldNotify: true,
        raw: {
          id: "inc-1",
          resolvedByMissingFromProvider: true
        }
      }
    ]);
  });

  it("does not resolve AWS RSS items or incidents still present in the snapshot", () => {
    expect(
      buildResolvedMissingIncidents(
        {
          ...snapshot,
          service: {
            ...snapshot.service,
            provider: "aws"
          }
        },
        [
          {
            externalId: "aws-1",
            title: "AWS event",
            status: "update",
            impact: "major",
            url: "https://example.com/aws-1",
            startedAt: checkedAt,
            updatedAt: checkedAt,
            resolvedAt: null,
            isMaintenance: false,
            shouldNotify: true,
            rawPayload: "{}"
          }
        ]
      )
    ).toEqual([]);

    expect(
      buildResolvedMissingIncidents(
        {
          ...snapshot,
          incidents: [
            {
              externalId: "inc-1",
              title: "Jira outage",
              status: "monitoring",
              impact: "critical",
              url: "https://example.com/inc-1",
              startedAt: checkedAt,
              updatedAt: checkedAt,
              resolvedAt: null,
              isMaintenance: false,
              shouldNotify: true,
              raw: {}
            }
          ]
        },
        [
          {
            externalId: "inc-1",
            title: "Jira outage",
            status: "monitoring",
            impact: "critical",
            url: "https://example.com/inc-1",
            startedAt: checkedAt,
            updatedAt: checkedAt,
            resolvedAt: null,
            isMaintenance: false,
            shouldNotify: true,
            rawPayload: "{}"
          }
        ]
      )
    ).toEqual([]);
  });

  it("resolves a Gemini incident when it leaves the active Workspace feed", () => {
    const geminiSnapshot: ProviderSnapshot = {
      ...snapshot,
      service: {
        provider: "gemini",
        name: "Gemini",
        endpoint: "https://www.google.com/appsstatus/dashboard/incidents.json"
      }
    };
    const resolved = buildResolvedMissingIncidents(geminiSnapshot, [
      {
        externalId: "gemini-active",
        title: "Gemini outage",
        status: "SERVICE_DISRUPTION",
        impact: "major",
        url: "https://www.google.com/appsstatus/dashboard/incidents/gemini-active",
        startedAt: new Date("2026-07-13T00:00:00Z"),
        updatedAt: new Date("2026-07-13T00:10:00Z"),
        resolvedAt: null,
        isMaintenance: false,
        shouldNotify: true,
        rawPayload: "{}"
      }
    ]);

    expect(resolved).toMatchObject([
      {
        externalId: "gemini-active",
        status: "resolved",
        resolvedAt: checkedAt
      }
    ]);
  });
});
