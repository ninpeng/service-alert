import { describe, expect, it } from "vitest";
import {
  buildResolvedMissingIncidents,
  getFirstObservedIncidentIds
} from "@/lib/worker/check-services";
import type { NormalizedIncident, ProviderSnapshot } from "@/lib/status/types";

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

const activeIncident: NormalizedIncident = {
  externalId: "base",
  title: "Provider outage",
  status: "investigating",
  impact: "major",
  url: null,
  startedAt: new Date("2026-07-13T00:00:00Z"),
  updatedAt: new Date("2026-07-13T00:10:00Z"),
  resolvedAt: null,
  isMaintenance: false,
  shouldNotify: true,
  raw: {}
};

describe("getFirstObservedIncidentIds", () => {
  it("finds incident IDs that are new to the local database", () => {
    expect(
      getFirstObservedIncidentIds(
        [
          { ...activeIncident, externalId: "existing" },
          { ...activeIncident, externalId: "new" }
        ],
        ["existing"]
      )
    ).toEqual(new Set(["new"]));
  });

  it("excludes maintenance and non-notifying incidents", () => {
    expect(
      getFirstObservedIncidentIds(
        [
          { ...activeIncident, externalId: "eligible" },
          { ...activeIncident, externalId: "maintenance", isMaintenance: true },
          { ...activeIncident, externalId: "silent", shouldNotify: false }
        ],
        []
      )
    ).toEqual(new Set(["eligible"]));
  });
});

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

  it("resolves a Didit incident when the RSS feed no longer returns it", () => {
    const diditSnapshot: ProviderSnapshot = {
      ...snapshot,
      service: {
        provider: "didit",
        name: "Didit",
        endpoint: "https://status.didit.me/feed.rss"
      }
    };
    const resolved = buildResolvedMissingIncidents(diditSnapshot, [
      {
        externalId: "didit-active",
        title: "Didit outage",
        status: "investigating",
        impact: "major",
        url: "https://status.didit.me/incidents/didit-active",
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
        externalId: "didit-active",
        status: "resolved",
        resolvedAt: checkedAt
      }
    ]);
  });
});
