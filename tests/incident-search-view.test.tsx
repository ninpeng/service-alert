import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import IncidentsError from "@/app/incidents/error";
import { IncidentSearchView } from "@/app/incidents/IncidentSearchView";
import { parseIncidentSearchParams } from "@/lib/incidents/search-params";

const row = {
  id: "incident-1",
  title: "JIRA login outage",
  status: "resolved",
  impact: "major",
  url: "https://status.example/incidents/1",
  startedAt: new Date("2026-07-10T00:00:00.000Z"),
  updatedAt: new Date("2026-07-10T01:00:00.000Z"),
  resolvedAt: new Date("2026-07-10T01:00:00.000Z"),
  firstSeenAt: new Date("2026-07-10T00:00:05.000Z"),
  lastSeenAt: new Date("2026-07-10T01:00:05.000Z"),
  isMaintenance: false,
  service: { name: "JIRA", provider: "jira", endpoint: "https://status.example" }
};

describe("IncidentSearchView", () => {
  it("renders filters, result metadata, and source link", () => {
    const html = renderToStaticMarkup(
      <IncidentSearchView
        data={{
          filters: parseIncidentSearchParams({ service: "jira", state: "resolved" }),
          services: [{ name: "JIRA", provider: "jira" }],
          incidents: [row],
          totalCount: 1,
          totalPages: 1,
          isPageOutOfRange: false
        }}
      />
    );

    expect(html).toContain("장애 이력");
    expect(html).toContain('name="state" value="resolved"');
    expect(html).toContain("JIRA login outage");
    expect(html).toContain("해결됨");
    expect(html).toContain("마지막 수집");
    expect(html).toContain('href="https://status.example/incidents/1"');
  });

  it("renders an empty state and preserves filters in pagination", () => {
    const empty = renderToStaticMarkup(
      <IncidentSearchView
        data={{
          filters: parseIncidentSearchParams({ q: "missing", page: "2" }),
          services: [],
          incidents: [],
          totalCount: 0,
          totalPages: 1,
          isPageOutOfRange: false
        }}
      />
    );
    expect(empty).toContain("조건에 맞는 장애 이력이 없습니다");

    const paged = renderToStaticMarkup(
      <IncidentSearchView
        data={{
          filters: parseIncidentSearchParams({ q: "login", page: "2" }),
          services: [],
          incidents: [row],
          totalCount: 51,
          totalPages: 3,
          isPageOutOfRange: false
        }}
      />
    );
    expect(paged).toContain("/incidents?q=login");
    expect(paged).toContain("page=3");
    expect(paged).toContain("2 / 3");
  });

  it("renders the route error recovery state", () => {
    const html = renderToStaticMarkup(
      <IncidentsError error={new Error("db failed")} reset={() => undefined} />
    );
    expect(html).toContain("장애 이력을 불러오지 못했습니다");
    expect(html).toContain("다시 시도");
  });
});
