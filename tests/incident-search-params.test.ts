import { describe, expect, it } from "vitest";
import {
  buildIncidentSearchHref,
  getIncidentPeriodStart,
  INCIDENTS_PER_PAGE,
  parseIncidentSearchParams
} from "@/lib/incidents/search-params";

describe("parseIncidentSearchParams", () => {
  it("uses the approved 30-day incident defaults", () => {
    expect(parseIncidentSearchParams({})).toEqual({
      q: "",
      service: "all",
      state: "all",
      impact: "all",
      period: "30d",
      type: "incident",
      page: 1
    });
    expect(INCIDENTS_PER_PAGE).toBe(25);
  });

  it("normalizes arrays, invalid choices, pages, and long queries", () => {
    const filters = parseIncidentSearchParams({
      q: [`  ${"a".repeat(120)}  `, "ignored"],
      service: "jira",
      state: "broken",
      impact: "critical",
      period: "7d",
      type: "maintenance",
      page: "-5"
    });

    expect(filters.q).toBe("a".repeat(100));
    expect(filters).toMatchObject({
      service: "jira",
      state: "all",
      impact: "critical",
      period: "7d",
      type: "maintenance",
      page: 1
    });
    expect(parseIncidentSearchParams({ service: "not-configured" }).service).toBe("all");
  });

  it("accepts only complete positive safe integer page values", () => {
    for (const value of ["2junk", "1.5", "01", "0", "-1", "9007199254740992"]) {
      expect(parseIncidentSearchParams({ page: value }).page).toBe(1);
    }

    expect(parseIncidentSearchParams({ page: "25" }).page).toBe(25);
  });
});

describe("incident search dates and URLs", () => {
  it("calculates a deterministic period start", () => {
    const now = new Date("2026-07-14T00:00:00.000Z");
    expect(getIncidentPeriodStart("24h", now)?.toISOString()).toBe("2026-07-13T00:00:00.000Z");
    expect(getIncidentPeriodStart("7d", now)?.toISOString()).toBe("2026-07-07T00:00:00.000Z");
    expect(getIncidentPeriodStart("30d", now)?.toISOString()).toBe("2026-06-14T00:00:00.000Z");
    expect(getIncidentPeriodStart("all", now)).toBeNull();
  });

  it("preserves non-default filters and removes page when requested", () => {
    const filters = parseIncidentSearchParams({
      q: "JIRA 장애",
      service: "jira",
      state: "active",
      impact: "major",
      period: "7d",
      type: "all",
      page: "3"
    });

    expect(buildIncidentSearchHref(filters, { state: "resolved", page: 1 })).toBe(
      "/incidents?q=JIRA+%EC%9E%A5%EC%95%A0&service=jira&state=resolved&impact=major&period=7d&type=all"
    );
  });
});
