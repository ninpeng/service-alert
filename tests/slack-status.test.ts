import { describe, expect, it } from "vitest";
import { parseSlackCurrentStatus } from "@/lib/status/adapters/slack";

describe("parseSlackCurrentStatus", () => {
  it("normalizes Slack status and active incidents", () => {
    const snapshot = parseSlackCurrentStatus({
      status: "active",
      date_created: "2026-05-12T10:00:00-07:00",
      date_updated: "2026-05-12T10:05:00-07:00",
      active_incidents: [
        {
          id: "slack-1",
          title: "Some users cannot send messages",
          type: "incident",
          status: "active",
          date_created: "2026-05-12T10:00:00-07:00",
          date_updated: "2026-05-12T10:05:00-07:00",
          url: "https://slack-status.com/incident/slack-1"
        }
      ]
    });

    expect(snapshot.components).toEqual([
      {
        externalId: "slack",
        name: "Slack",
        status: "degraded_performance",
        updatedAt: new Date("2026-05-12T10:05:00-07:00")
      }
    ]);
    expect(snapshot.incidents[0]).toMatchObject({
      externalId: "slack-1",
      title: "Some users cannot send messages",
      status: "active",
      impact: "incident",
      shouldNotify: true
    });
  });
});
