import type { Prisma } from "../../generated/prisma/client";
import { prisma } from "../db/prisma";
import { buildIncidentWhere, incidentOrderBy } from "./query";
import { INCIDENTS_PER_PAGE, type IncidentSearchFilters } from "./search-params";

export interface IncidentServiceOption {
  name: string;
  provider: string;
}

export interface IncidentSearchRow {
  id: string;
  title: string;
  status: string;
  impact: string | null;
  url: string | null;
  startedAt: Date | null;
  updatedAt: Date | null;
  resolvedAt: Date | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  isMaintenance: boolean;
  service: {
    name: string;
    provider: string;
    endpoint: string;
  };
}

export interface IncidentListQuery {
  where: Prisma.IncidentWhereInput;
  orderBy: Prisma.IncidentOrderByWithRelationInput[];
  skip: number;
  take: number;
}

export interface IncidentSearchRepository {
  listServices(): Promise<IncidentServiceOption[]>;
  countIncidents(where: Prisma.IncidentWhereInput): Promise<number>;
  listIncidents(query: IncidentListQuery): Promise<IncidentSearchRow[]>;
}

export interface IncidentSearchData {
  filters: IncidentSearchFilters;
  services: IncidentServiceOption[];
  incidents: IncidentSearchRow[];
  totalCount: number;
  totalPages: number;
  isPageOutOfRange: boolean;
}

export const prismaIncidentSearchRepository: IncidentSearchRepository = {
  listServices: () =>
    prisma.monitoredService.findMany({
      select: { name: true, provider: true },
      orderBy: { name: "asc" }
    }),
  countIncidents: (where) => prisma.incident.count({ where }),
  listIncidents: (query) =>
    prisma.incident.findMany({
      ...query,
      include: {
        service: {
          select: { name: true, provider: true, endpoint: true }
        }
      }
    })
};

export async function loadIncidentSearchData(
  filters: IncidentSearchFilters,
  repository: IncidentSearchRepository = prismaIncidentSearchRepository,
  now = new Date()
): Promise<IncidentSearchData> {
  const where = buildIncidentWhere(filters, now);
  const query: IncidentListQuery = {
    where,
    orderBy: incidentOrderBy,
    skip: (filters.page - 1) * INCIDENTS_PER_PAGE,
    take: INCIDENTS_PER_PAGE
  };
  const [services, totalCount, incidents] = await Promise.all([
    repository.listServices(),
    repository.countIncidents(where),
    repository.listIncidents(query)
  ]);
  const totalPages = Math.max(1, Math.ceil(totalCount / INCIDENTS_PER_PAGE));

  return {
    filters,
    services,
    incidents,
    totalCount,
    totalPages,
    isPageOutOfRange: filters.page > totalPages
  };
}
