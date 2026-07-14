import { describe, expect, it, vi } from "vitest";
import { incidentSearchRowSelect, loadIncidentSearchData, type IncidentSearchRepository } from "@/lib/incidents/data";
import { parseIncidentSearchParams } from "@/lib/incidents/search-params";

describe("loadIncidentSearchData", () => {
  it("selects only fields required by the incident search row", () => {
    expect(incidentSearchRowSelect).toEqual({
      id: true,
      title: true,
      status: true,
      impact: true,
      url: true,
      startedAt: true,
      updatedAt: true,
      resolvedAt: true,
      firstSeenAt: true,
      lastSeenAt: true,
      isMaintenance: true,
      service: {
        select: { name: true, provider: true, endpoint: true }
      }
    });
  });

  it("loads service options, count, and one 25-row page in parallel", async () => {
    const repository: IncidentSearchRepository = {
      listServices: vi.fn().mockResolvedValue([{ name: "JIRA", provider: "jira" }]),
      countIncidents: vi.fn().mockResolvedValue(51),
      listIncidents: vi.fn().mockResolvedValue([])
    };
    const filters = parseIncidentSearchParams({ service: "jira", page: "2" });

    const result = await loadIncidentSearchData(filters, repository, new Date("2026-07-14T00:00:00.000Z"));

    expect(result.totalCount).toBe(51);
    expect(result.totalPages).toBe(3);
    expect(result.isPageOutOfRange).toBe(false);
    expect(repository.listIncidents).toHaveBeenCalledWith(expect.objectContaining({ skip: 25, take: 25 }));
  });

  it("marks every out-of-range page for canonical redirect", async () => {
    const repository: IncidentSearchRepository = {
      listServices: vi.fn().mockResolvedValue([]),
      countIncidents: vi.fn().mockResolvedValue(2),
      listIncidents: vi.fn().mockResolvedValue([])
    };

    const result = await loadIncidentSearchData(parseIncidentSearchParams({ page: "9" }), repository);
    expect(result.totalPages).toBe(1);
    expect(result.isPageOutOfRange).toBe(true);

    repository.countIncidents = vi.fn().mockResolvedValue(0);
    const emptyResult = await loadIncidentSearchData(parseIncidentSearchParams({ page: "2" }), repository);
    expect(emptyResult.totalPages).toBe(1);
    expect(emptyResult.isPageOutOfRange).toBe(true);
  });
});
