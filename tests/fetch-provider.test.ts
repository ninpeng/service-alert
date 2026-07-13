import { describe, expect, it, vi } from "vitest";
import {
  fetchDefaultProviderSnapshot,
  fetchProviderSnapshot
} from "@/lib/status/fetch-provider";

describe("fetchProviderSnapshot", () => {
  it("carries the OpenAI exclusion config through the runtime service record", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          components: [{ id: "fedramp", name: "FedRAMP", status: "major_outage" }],
          incidents: [],
          status: { indicator: "critical" }
        }),
        { status: 200 }
      )
    );

    const snapshot = await fetchProviderSnapshot(
      {
        name: "OpenAI",
        provider: "openai",
        endpoint: "https://status.openai.com/api/v2/summary.json"
      },
      fetchImpl
    );

    expect(snapshot.components).toEqual([]);
    expect(snapshot.overallStatus).toBe("none");
  });

  it("dispatches Gemini to the Google Workspace adapter", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }));

    const snapshot = await fetchProviderSnapshot(
      {
        name: "Gemini",
        provider: "gemini",
        endpoint: "https://www.google.com/appsstatus/dashboard/incidents.json"
      },
      fetchImpl
    );

    expect(snapshot.service.provider).toBe("gemini");
    expect(snapshot.components).toMatchObject([
      { externalId: "gemini", status: "operational" }
    ]);
  });

  it("rejects a Google Workspace service without a source service name", async () => {
    await expect(
      fetchDefaultProviderSnapshot({
        name: "Gemini",
        provider: "gemini",
        providerKind: "google-workspace",
        endpoint: "https://www.google.com/appsstatus/dashboard/incidents.json",
        enabled: true,
        slackEnabled: true
      })
    ).rejects.toThrow("Missing Google Workspace service filter for Gemini");
  });

  it("dispatches Didit to the incident.io RSS adapter", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        `<?xml version="1.0"?><rss><channel><title>Didit status</title></channel></rss>`,
        { status: 200 }
      )
    );

    const snapshot = await fetchProviderSnapshot(
      {
        name: "Didit",
        provider: "didit",
        endpoint: "https://status.didit.me/feed.rss"
      },
      fetchImpl
    );

    expect(snapshot.service.provider).toBe("didit");
    expect(snapshot.components).toMatchObject([
      { externalId: "didit:core-apis", status: "operational" },
      { externalId: "didit:business-console", status: "operational" },
      { externalId: "didit:hosted-verification-web-app", status: "operational" }
    ]);
  });

  it("rejects incident.io RSS config without source components", async () => {
    await expect(
      fetchDefaultProviderSnapshot({
        name: "Didit",
        provider: "didit",
        providerKind: "incidentio-rss",
        endpoint: "https://status.didit.me/feed.rss",
        enabled: true,
        slackEnabled: true
      })
    ).rejects.toThrow("Missing incident.io component config for Didit");
  });
});
