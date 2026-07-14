import { defaultMonitoredServices } from "../status/default-services";
import type { Route } from "next";

export const INCIDENTS_PER_PAGE = 25;

export type IncidentStateFilter = "all" | "active" | "resolved";
export type IncidentImpactFilter = "all" | "critical" | "major" | "minor" | "none" | "unknown";
export type IncidentPeriodFilter = "24h" | "7d" | "30d" | "all";
export type IncidentTypeFilter = "incident" | "maintenance" | "all";
export type RawIncidentSearchParams = Record<string, string | string[] | undefined>;

export interface IncidentSearchFilters {
  q: string;
  service: string;
  state: IncidentStateFilter;
  impact: IncidentImpactFilter;
  period: IncidentPeriodFilter;
  type: IncidentTypeFilter;
  page: number;
}

const states = new Set<IncidentStateFilter>(["all", "active", "resolved"]);
const impacts = new Set<IncidentImpactFilter>(["all", "critical", "major", "minor", "none", "unknown"]);
const periods = new Set<IncidentPeriodFilter>(["24h", "7d", "30d", "all"]);
const types = new Set<IncidentTypeFilter>(["incident", "maintenance", "all"]);

export function parseIncidentSearchParams(raw: RawIncidentSearchParams): IncidentSearchFilters {
  const state = first(raw.state);
  const impact = first(raw.impact);
  const period = first(raw.period);
  const type = first(raw.type);
  const requestedService = (first(raw.service) ?? "all").trim() || "all";
  const parsedPage = Number.parseInt(first(raw.page) ?? "1", 10);

  return {
    q: (first(raw.q) ?? "").trim().slice(0, 100),
    service:
      requestedService === "all" || defaultMonitoredServices.some((service) => service.provider === requestedService)
        ? requestedService
        : "all",
    state: states.has(state as IncidentStateFilter) ? state as IncidentStateFilter : "all",
    impact: impacts.has(impact as IncidentImpactFilter) ? impact as IncidentImpactFilter : "all",
    period: periods.has(period as IncidentPeriodFilter) ? period as IncidentPeriodFilter : "30d",
    type: types.has(type as IncidentTypeFilter) ? type as IncidentTypeFilter : "incident",
    page: Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1
  };
}

export function getIncidentPeriodStart(period: IncidentPeriodFilter, now = new Date()) {
  const durations: Partial<Record<IncidentPeriodFilter, number>> = {
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000
  };
  const duration = durations[period];
  return duration ? new Date(now.getTime() - duration) : null;
}

export function buildIncidentSearchHref(
  filters: IncidentSearchFilters,
  overrides: Partial<IncidentSearchFilters> = {}
): Route {
  const next = { ...filters, ...overrides };
  const params = new URLSearchParams();

  if (next.q) params.set("q", next.q);
  if (next.service !== "all") params.set("service", next.service);
  if (next.state !== "all") params.set("state", next.state);
  if (next.impact !== "all") params.set("impact", next.impact);
  if (next.period !== "30d") params.set("period", next.period);
  if (next.type !== "incident") params.set("type", next.type);
  if (next.page > 1) params.set("page", String(next.page));

  const query = params.toString();
  return (query ? `/incidents?${query}` : "/incidents") as Route;
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
