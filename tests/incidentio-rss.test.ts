import { describe, expect, it, vi } from "vitest";
import {
  fetchIncidentIoRss,
  parseIncidentIoRss
} from "@/lib/status/adapters/incidentio";

const context = {
  provider: "didit" as const,
  serviceName: "Didit",
  endpoint: "https://status.didit.me/feed.rss",
  sourceComponentNames: [
    "Core APIs",
    "Business Console",
    "Hosted Verification Web App"
  ]
};

function item(input: {
  guid: string;
  link?: string;
  title: string;
  status: string;
  components?: string[];
  pubDate?: string;
}) {
  const components = input.components?.length
    ? `<br/><br/><b>Affected components</b><ul>${input.components
        .map((component) => `<li>${component}</li>`)
        .join("")}</ul>`
    : "";

  return `<item>
    <title><![CDATA[${input.title}]]></title>
    <link>${input.link ?? `https://status.didit.me/incidents/${input.guid}`}</link>
    <guid>${input.guid}</guid>
    <pubDate>${input.pubDate ?? "Mon, 13 Jul 2026 09:30:00 GMT"}</pubDate>
    <description><![CDATA[<b>Status: ${input.status}</b>${components}]]></description>
  </item>`;
}

function feed(items: string) {
  return `<?xml version="1.0" encoding="utf-8"?>
    <rss version="2.0"><channel>
      <title>Didit status</title>
      <link>https://status.didit.me/</link>
      <lastBuildDate>Mon, 13 Jul 2026 09:35:00 GMT</lastBuildDate>
      ${items}
    </channel></rss>`;
}

describe("parseIncidentIoRss", () => {
  it("keeps all three components healthy and excludes resolved history", () => {
    const snapshot = parseIncidentIoRss(
      feed(item({
        guid: "resolved-1",
        title: "Previous incident",
        status: "Resolved",
        components: [
          "Core APIs (Operational)",
          "Business Console (Operational)",
          "Hosted Verification Web App (Operational)"
        ]
      })),
      context
    );

    expect(snapshot.overallStatus).toBe("none");
    expect(snapshot.incidents).toEqual([]);
    expect(snapshot.components).toMatchObject([
      { externalId: "didit:core-apis", name: "Core APIs", status: "operational" },
      { externalId: "didit:business-console", name: "Business Console", status: "operational" },
      {
        externalId: "didit:hosted-verification-web-app",
        name: "Hosted Verification Web App",
        status: "operational"
      }
    ]);
  });

  it("normalizes active incidents and applies the most severe component state", () => {
    const snapshot = parseIncidentIoRss(
      feed(
        item({
          guid: "active-1",
          title: "API degradation",
          status: "Investigating",
          components: ["Core APIs (Partial outage)"]
        }) +
        item({
          guid: "active-2",
          title: "API outage",
          status: "Monitoring",
          components: [
            "Core APIs (Full outage)",
            "Business Console (Degraded performance)"
          ]
        })
      ),
      context
    );

    expect(snapshot.overallStatus).toBe("critical");
    expect(snapshot.components).toMatchObject([
      { name: "Core APIs", status: "major_outage" },
      { name: "Business Console", status: "degraded_performance" },
      { name: "Hosted Verification Web App", status: "operational" }
    ]);
    expect(snapshot.incidents).toMatchObject([
      {
        externalId: "active-1",
        title: "API degradation",
        status: "investigating",
        impact: "major",
        url: "https://status.didit.me/incidents/active-1",
        startedAt: new Date("2026-07-13T09:30:00.000Z"),
        updatedAt: new Date("2026-07-13T09:30:00.000Z"),
        resolvedAt: null,
        isMaintenance: false,
        shouldNotify: true
      },
      {
        externalId: "active-2",
        status: "monitoring",
        impact: "critical"
      }
    ]);
  });

  it("reports unknown active impact honestly and suppresses maintenance notifications", () => {
    const snapshot = parseIncidentIoRss(
      feed(
        item({
          guid: "unknown-1",
          title: "Provider investigation",
          status: "Investigating",
          components: ["Hosted Verification Web App (Delayed)"]
        }) +
        item({
          guid: "maintenance-1",
          link: "https://status.didit.me/maintenance/maintenance-1",
          title: "Database maintenance",
          status: "Maintenance in progress",
          components: ["Business Console (Partial outage)"]
        })
      ),
      context
    );

    expect(snapshot.overallStatus).toBe("unknown");
    expect(snapshot.components).toContainEqual(
      expect.objectContaining({
        name: "Hosted Verification Web App",
        status: "unknown"
      })
    );
    expect(snapshot.incidents).toMatchObject([
      { externalId: "unknown-1", impact: null, isMaintenance: false, shouldNotify: true },
      { externalId: "maintenance-1", isMaintenance: true, shouldNotify: false }
    ]);
  });

  it("rejects invalid RSS and non-success responses", async () => {
    expect(() => parseIncidentIoRss("<rss>", context)).toThrow(
      "Invalid incident.io RSS for Didit"
    );

    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("unavailable", { status: 503, statusText: "Service Unavailable" })
    );

    await expect(
      fetchIncidentIoRss(context.endpoint, context, fetchImpl)
    ).rejects.toThrow(
      "incident.io RSS request failed for Didit: 503 Service Unavailable"
    );
  });
});
