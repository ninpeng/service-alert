import { describe, expect, it } from "vitest";
import { buildSlackMessage } from "@/lib/slack/webhook";
import type { NormalizedIncident } from "@/lib/status/types";

const incident: NormalizedIncident = {
  externalId: "inc-1",
  title: "Automations within Jira experiencing delays for some users",
  status: "identified",
  impact: "major",
  url: "https://example.com/inc-1",
  startedAt: new Date("2026-05-12T01:00:00Z"),
  updatedAt: new Date("2026-05-12T01:10:00Z"),
  resolvedAt: null,
  isMaintenance: false,
  shouldNotify: true,
  raw: {}
};

describe("buildSlackMessage", () => {
  it("builds a Korean Slack message while preserving the provider title", () => {
    const message = buildSlackMessage({
      serviceName: "JIRA",
      provider: "jira",
      incident,
      eventType: "incident_update"
    });

    expect(message.text).toContain("[JIRA] 장애 업데이트");
    expect(message.text).toContain(incident.title);
    expect(JSON.stringify(message.blocks)).toContain("*상태:* 원인 파악 중");
    expect(JSON.stringify(message.blocks)).toContain("*영향도:* 주요 장애");
    expect(JSON.stringify(message.blocks)).not.toContain("*Status:*");
  });
});
