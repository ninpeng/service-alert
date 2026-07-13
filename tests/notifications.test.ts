import { describe, expect, it } from "vitest";
import {
  buildNotificationDedupeKey,
  getNotificationEventType,
  shouldSendSlackNotification
} from "@/lib/status/notifications";
import type { NormalizedIncident } from "@/lib/status/types";

const incident: NormalizedIncident = {
  externalId: "inc-1",
  title: "API degradation",
  status: "investigating",
  impact: "minor",
  url: "https://example.com/inc-1",
  startedAt: new Date("2026-05-12T01:00:00Z"),
  updatedAt: new Date("2026-05-12T01:10:00Z"),
  resolvedAt: null,
  isMaintenance: false,
  shouldNotify: true,
  raw: {}
};

describe("buildNotificationDedupeKey", () => {
  it("uses provider, incident id, status, and update timestamp", () => {
    expect(buildNotificationDedupeKey("figma", incident)).toBe(
      "figma:inc-1:investigating:2026-05-12T01:10:00.000Z"
    );
  });
});

describe("getNotificationEventType", () => {
  it("classifies resolved incidents separately from updates", () => {
    expect(getNotificationEventType(incident)).toBe("incident_update");
    expect(getNotificationEventType({ ...incident, status: "resolved", resolvedAt: new Date() })).toBe(
      "incident_resolved"
    );
  });

  it("classifies an already-updated incident as started on first observation", () => {
    expect(
      getNotificationEventType(
        { ...incident, impact: "major" },
        { isFirstObservation: true }
      )
    ).toBe("incident_started");
    expect(
      shouldSendSlackNotification(
        { ...incident, impact: "major" },
        "incident_started"
      )
    ).toBe(true);
  });

  it("gives resolution precedence over first-observation classification", () => {
    expect(
      getNotificationEventType(
        {
          ...incident,
          status: "resolved",
          resolvedAt: new Date("2026-05-12T01:20:00Z")
        },
        { isFirstObservation: true }
      )
    ).toBe("incident_resolved");
  });
});

describe("shouldSendSlackNotification", () => {
  it("sends only major or critical non-maintenance incidents", () => {
    expect(shouldSendSlackNotification({ ...incident, impact: "minor" })).toBe(false);
    expect(
      shouldSendSlackNotification({
        ...incident,
        impact: "major",
        updatedAt: new Date("2026-05-12T01:00:00Z")
      })
    ).toBe(true);
    expect(
      shouldSendSlackNotification({
        ...incident,
        impact: "critical",
        updatedAt: new Date("2026-05-12T01:00:00Z")
      })
    ).toBe(true);
  });

  it("does not send incident update notifications", () => {
    expect(shouldSendSlackNotification({ ...incident, impact: "major" })).toBe(false);
    expect(
      shouldSendSlackNotification({
        ...incident,
        impact: "major",
        status: "resolved",
        resolvedAt: new Date("2026-05-12T01:20:00Z")
      })
    ).toBe(true);
  });
});
