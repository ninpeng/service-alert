import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { ensureDefaultServices } from "@/lib/db/seed-defaults";
import { defaultMonitoredServices, findDefaultService } from "@/lib/status/default-services";

describe("AI provider defaults", () => {
  it("defines eleven services with the approved source filters", () => {
    expect(defaultMonitoredServices).toHaveLength(11);
    expect(findDefaultService("openai")).toMatchObject({
      name: "OpenAI",
      providerKind: "statuspage",
      endpoint: "https://status.openai.com/api/v2/summary.json",
      excludedComponentNames: ["FedRAMP", "Ads Manager", "Ads API"]
    });
    expect(findDefaultService("claude")).toMatchObject({
      name: "Claude",
      providerKind: "statuspage",
      endpoint: "https://status.claude.com/api/v2/summary.json",
      excludedComponentNames: ["Claude for Government"]
    });
    expect(findDefaultService("gemini")).toMatchObject({
      name: "Gemini",
      providerKind: "google-workspace",
      endpoint: "https://www.google.com/appsstatus/dashboard/incidents.json",
      sourceServiceName: "Gemini"
    });
    expect(findDefaultService("didit")).toMatchObject({
      name: "Didit",
      providerKind: "incidentio-rss",
      endpoint: "https://status.didit.me/feed.rss",
      sourceComponentNames: [
        "Core APIs",
        "Business Console",
        "Hosted Verification Web App"
      ]
    });
  });

  it("seeds every default through the existing upsert boundary", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = {
      monitoredService: { upsert }
    } as unknown as PrismaClient;

    await ensureDefaultServices(prisma);

    expect(upsert).toHaveBeenCalledTimes(11);
    expect(upsert.mock.calls.map(([input]) => input.where.name)).toEqual(
      expect.arrayContaining(["OpenAI", "Claude", "Gemini", "Didit"])
    );
  });
});
