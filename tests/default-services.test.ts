import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { ensureDefaultServices } from "@/lib/db/seed-defaults";
import { defaultMonitoredServices, findDefaultService } from "@/lib/status/default-services";

describe("AI provider defaults", () => {
  it("defines ten services with the approved AI source filters", () => {
    expect(defaultMonitoredServices).toHaveLength(10);
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
  });

  it("seeds every default through the existing upsert boundary", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = {
      monitoredService: { upsert }
    } as unknown as PrismaClient;

    await ensureDefaultServices(prisma);

    expect(upsert).toHaveBeenCalledTimes(10);
    expect(upsert.mock.calls.map(([input]) => input.where.name)).toEqual(
      expect.arrayContaining(["OpenAI", "Claude", "Gemini"])
    );
  });
});
