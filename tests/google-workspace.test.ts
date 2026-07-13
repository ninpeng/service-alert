import { describe, expect, it } from "vitest";
import {
  fetchGoogleWorkspaceStatus,
  parseGoogleWorkspaceStatus
} from "@/lib/status/adapters/google-workspace";

const context = {
  provider: "gemini" as const,
  serviceName: "Gemini",
  sourceServiceName: "Gemini",
  endpoint: "https://www.google.com/appsstatus/dashboard/incidents.json"
};

describe("parseGoogleWorkspaceStatus", () => {
  it("keeps only active Gemini web/app incidents and maps medium severity", () => {
    const snapshot = parseGoogleWorkspaceStatus(
      [
        {
          id: "gemini-active",
          service_name: "Gemini",
          begin: "2026-07-13T00:00:00Z",
          end: null,
          modified: "2026-07-13T00:10:00Z",
          external_desc: "**Title**\nGemini prompts are failing\n**Description**\nElevated errors",
          severity: "medium",
          uri: "incidents/gemini-active",
          most_recent_update: { status: "SERVICE_DISRUPTION" }
        },
        {
          id: "gemini-resolved",
          service_name: "Gemini",
          begin: "2026-07-12T00:00:00Z",
          end: "2026-07-12T01:00:00Z",
          modified: "2026-07-12T01:00:00Z",
          external_desc: "**Title**\nResolved Gemini incident",
          severity: "medium",
          uri: "incidents/gemini-resolved",
          most_recent_update: { status: "AVAILABLE" }
        },
        {
          id: "gmail-active",
          service_name: "Gmail",
          begin: "2026-07-13T00:00:00Z",
          end: null,
          modified: "2026-07-13T00:10:00Z",
          external_desc: "**Title**\nGmail outage",
          severity: "high",
          uri: "incidents/gmail-active",
          most_recent_update: { status: "SERVICE_OUTAGE" }
        }
      ],
      context
    );

    expect(snapshot.overallStatus).toBe("major");
    expect(snapshot.components).toMatchObject([
      { externalId: "gemini", name: "Gemini", status: "partial_outage" }
    ]);
    expect(snapshot.incidents).toMatchObject([
      {
        externalId: "gemini-active",
        title: "Gemini prompts are failing",
        status: "SERVICE_DISRUPTION",
        impact: "major",
        url: "https://www.google.com/appsstatus/dashboard/incidents/gemini-active",
        startedAt: new Date("2026-07-13T00:00:00Z"),
        updatedAt: new Date("2026-07-13T00:10:00Z"),
        resolvedAt: null,
        isMaintenance: false,
        shouldNotify: true
      }
    ]);
  });

  it("reports unknown instead of healthy for an unrecognized active severity", () => {
    const snapshot = parseGoogleWorkspaceStatus(
      [
        {
          id: "gemini-unknown",
          service_name: "Gemini",
          end: null,
          severity: "unexpected",
          most_recent_update: { status: "SERVICE_INFORMATION" }
        }
      ],
      context
    );

    expect(snapshot.overallStatus).toBe("unknown");
    expect(snapshot.components[0].status).toBe("unknown");
    expect(snapshot.incidents[0].impact).toBeNull();
  });

  it("rejects a non-array response with the provider name", () => {
    expect(() => parseGoogleWorkspaceStatus({}, context)).toThrow(
      "Invalid Google Workspace response for Gemini: expected an array"
    );
  });

  it("rejects non-OK responses with the provider-specific error", async () => {
    let requestedEndpoint = "";
    let requestedAccept = "";
    const fetchImpl: typeof fetch = async (input, init) => {
      requestedEndpoint = String(input);
      requestedAccept = new Headers(init?.headers).get("accept") ?? "";
      return new Response(null, {
        status: 503,
        statusText: "Service Unavailable"
      });
    };

    await expect(fetchGoogleWorkspaceStatus(context.endpoint, context, fetchImpl)).rejects.toThrow(
      "Google Workspace request failed for Gemini: 503 Service Unavailable"
    );
    expect(requestedEndpoint).toBe(context.endpoint);
    expect(requestedAccept).toBe("application/json");
  });

  it("passes successful JSON responses through the Gemini parser", async () => {
    const payload = [
      {
        id: "gemini-fetch",
        service_name: "Gemini",
        end: null,
        severity: "low",
        most_recent_update: { status: "SERVICE_INFORMATION" }
      }
    ];
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" }
      });

    const snapshot = await fetchGoogleWorkspaceStatus(context.endpoint, context, fetchImpl);

    expect(snapshot.service).toMatchObject({ provider: "gemini", name: "Gemini" });
    expect(snapshot.overallStatus).toBe("minor");
    expect(snapshot.incidents).toMatchObject([
      { externalId: "gemini-fetch", status: "SERVICE_INFORMATION", impact: "minor" }
    ]);
  });
});
