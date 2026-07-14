# Incident History Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대시보드를 현재 상태 중심으로 유지하면서, `/incidents`에서 최근 30일 장애 이력을 URL 기반 필터와 25건 페이지네이션으로 조회한다.

**Architecture:** Next.js 서버 페이지가 query string을 정규화하고 Prisma 조회 모듈을 직접 호출한다. 검색 규칙, Prisma 조건, 데이터 접근, 순수 렌더 컴포넌트를 분리해 각 경계를 테스트하며 별도 JSON API나 클라이언트 데이터 라이브러리는 추가하지 않는다.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma 7, SQLite, Vitest, lucide-react, 기존 CSS

## Global Constraints

- 메인 대시보드는 현재 상태를 한눈에 보는 주 화면으로 유지한다.
- `/incidents`는 최근 30일, 실제 장애, 전체 서비스, 전체 상태, 최신순을 기본값으로 사용한다.
- query parameter는 `q`, `service`, `state`, `impact`, `period`, `type`, `page`만 허용한다.
- 페이지 크기는 정확히 25건이다.
- 새 npm dependency와 Prisma schema 변경을 추가하지 않는다.
- 별도 JSON API, mutation, 인증, localhost 바인딩을 추가하지 않는다.
- 필터와 페이지 링크는 URL에 상태를 보존하고 조건 변경 시 `page`를 제거한다.
- 커밋 메시지에 `NO-JIRA`를 넣지 않는다.
- Node 22.22.0과 기존 pnpm 10.28.2를 사용한다.

---

## File Structure

### 새 파일

- `src/lib/incidents/search-params.ts`: URL 입력 정규화, 기간 시작 시각, 검색 URL 생성.
- `src/lib/incidents/query.ts`: 종료 상태 판정과 Prisma `where`/`orderBy` 생성.
- `src/lib/incidents/data.ts`: Prisma repository와 병렬 count/list/service 조회.
- `src/app/AppSidebar.tsx`: 대시보드와 장애 이력 페이지가 공유하는 사이드바.
- `src/app/incidents/IncidentSearchView.tsx`: 필터, 결과 table, 빈 상태, pagination의 순수 서버 렌더 UI.
- `src/app/incidents/page.tsx`: search params, 데이터 조회, 범위 밖 page redirect를 연결.
- `src/app/incidents/error.tsx`: DB 조회 오류 경계와 재시도.
- `tests/incident-search-params.test.ts`: URL 계약 단위 테스트.
- `tests/incident-search-query.test.ts`: Prisma 조건과 상태 판정 단위 테스트.
- `tests/incident-search-data.test.ts`: repository orchestration과 pagination 단위 테스트.
- `tests/app-sidebar.test.tsx`: 공유 내비게이션 정적 렌더 테스트.
- `tests/incident-search-view.test.tsx`: 필터, 결과, 빈 상태, pagination 정적 렌더 테스트.

### 수정 파일

- `src/app/page.tsx`: 공유 사이드바 사용, `최근 장애`의 `전체 이력` 링크 추가.
- `src/app/globals.css`: active nav, 필터, table, pagination, mobile layout 스타일.
- `README.md`: `/incidents` 사용 경로 추가.
- `docs/ROADMAP.md`: 상태 상세와 검색 항목 완료 표시.

---

### Task 1: Search Parameter Contract

**Files:**
- Create: `src/lib/incidents/search-params.ts`
- Create: `tests/incident-search-params.test.ts`

**Interfaces:**
- Consumes: Next.js `searchParams`와 동일한 `Record<string, string | string[] | undefined>`.
- Produces: `IncidentSearchFilters`, `parseIncidentSearchParams`, `getIncidentPeriodStart`, `buildIncidentSearchHref`, `INCIDENTS_PER_PAGE`.

- [ ] **Step 1: Write the failing parameter tests**

```ts
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
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
PATH=/Users/ninpeng/.local/share/fnm/node-versions/v22.22.0/installation/bin:$PATH pnpm test tests/incident-search-params.test.ts
```

Expected: FAIL because `@/lib/incidents/search-params` does not exist.

- [ ] **Step 3: Implement the parameter module**

```ts
import { defaultMonitoredServices } from "../status/default-services";

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
) {
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
  return query ? `/incidents?${query}` : "/incidents";
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
```

- [ ] **Step 4: Run the test and verify GREEN**

Run the focused command from Step 2.

Expected: `1` test file and `4` tests pass.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/lib/incidents/search-params.ts tests/incident-search-params.test.ts
git commit -m "feat: 장애 이력 검색 조건 추가"
```

---

### Task 2: Prisma Query And Data Boundary

**Files:**
- Create: `src/lib/incidents/query.ts`
- Create: `src/lib/incidents/data.ts`
- Create: `tests/incident-search-query.test.ts`
- Create: `tests/incident-search-data.test.ts`

**Interfaces:**
- Consumes: `IncidentSearchFilters`, `getIncidentPeriodStart`, `INCIDENTS_PER_PAGE` from Task 1.
- Produces: `TERMINAL_INCIDENT_STATUSES`, `isResolvedIncident`, `buildIncidentWhere`, `incidentOrderBy`, `IncidentSearchRow`, `IncidentServiceOption`, `IncidentSearchData`, `loadIncidentSearchData`.

- [ ] **Step 1: Write failing Prisma condition tests**

```ts
import { describe, expect, it } from "vitest";
import { buildIncidentWhere, incidentOrderBy, isResolvedIncident } from "@/lib/incidents/query";
import { parseIncidentSearchParams } from "@/lib/incidents/search-params";

describe("incident search query", () => {
  const now = new Date("2026-07-14T00:00:00.000Z");

  it("builds the default 30-day non-maintenance condition", () => {
    expect(buildIncidentWhere(parseIncidentSearchParams({}), now)).toEqual({
      AND: [
        { isMaintenance: false },
        {
          OR: [
            { updatedAt: { gte: new Date("2026-06-14T00:00:00.000Z") } },
            { AND: [{ updatedAt: null }, { startedAt: { gte: new Date("2026-06-14T00:00:00.000Z") } }] },
            {
              AND: [
                { updatedAt: null },
                { startedAt: null },
                { firstSeenAt: { gte: new Date("2026-06-14T00:00:00.000Z") } }
              ]
            }
          ]
        }
      ]
    });
  });

  it("combines search, service, state, impact, and maintenance filters", () => {
    const where = buildIncidentWhere(parseIncidentSearchParams({
      q: "login",
      service: "jira",
      state: "resolved",
      impact: "unknown",
      period: "all",
      type: "maintenance"
    }), now);

    expect(where).toEqual({
      AND: [
        {
          OR: [
            { title: { contains: "login" } },
            { service: { is: { name: { contains: "login" } } } },
            { service: { is: { provider: { contains: "login" } } } }
          ]
        },
        { service: { is: { provider: "jira" } } },
        {
          OR: [
            { resolvedAt: { not: null } },
            { status: { in: ["resolved", "complete", "completed", "postmortem"] } }
          ]
        },
        { OR: [{ impact: null }, { impact: "" }] },
        { isMaintenance: true }
      ]
    });
  });

  it("classifies persisted rows and exposes a stable order", () => {
    expect(isResolvedIncident({ status: "monitoring", resolvedAt: null })).toBe(false);
    expect(isResolvedIncident({ status: "resolved", resolvedAt: null })).toBe(true);
    expect(isResolvedIncident({ status: "monitoring", resolvedAt: new Date() })).toBe(true);
    expect(incidentOrderBy).toEqual([
      { updatedAt: "desc" },
      { startedAt: "desc" },
      { firstSeenAt: "desc" },
      { id: "desc" }
    ]);
  });
});
```

- [ ] **Step 2: Run query tests and verify RED**

Run:

```bash
PATH=/Users/ninpeng/.local/share/fnm/node-versions/v22.22.0/installation/bin:$PATH pnpm test tests/incident-search-query.test.ts
```

Expected: FAIL because `@/lib/incidents/query` does not exist.

- [ ] **Step 3: Implement `query.ts`**

```ts
import type { Prisma } from "../../generated/prisma/client";
import { getIncidentPeriodStart, type IncidentSearchFilters } from "./search-params";

export const TERMINAL_INCIDENT_STATUSES = ["resolved", "complete", "completed", "postmortem"];

export const incidentOrderBy: Prisma.IncidentOrderByWithRelationInput[] = [
  { updatedAt: "desc" },
  { startedAt: "desc" },
  { firstSeenAt: "desc" },
  { id: "desc" }
];

export function isResolvedIncident(incident: { status: string; resolvedAt: Date | null }) {
  return Boolean(incident.resolvedAt) || TERMINAL_INCIDENT_STATUSES.includes(incident.status.toLowerCase());
}

export function buildIncidentWhere(filters: IncidentSearchFilters, now = new Date()): Prisma.IncidentWhereInput {
  const AND: Prisma.IncidentWhereInput[] = [];

  if (filters.q) {
    AND.push({
      OR: [
        { title: { contains: filters.q } },
        { service: { is: { name: { contains: filters.q } } } },
        { service: { is: { provider: { contains: filters.q } } } }
      ]
    });
  }

  if (filters.service !== "all") {
    AND.push({ service: { is: { provider: filters.service } } });
  }

  if (filters.state === "resolved") {
    AND.push({
      OR: [
        { resolvedAt: { not: null } },
        { status: { in: TERMINAL_INCIDENT_STATUSES } }
      ]
    });
  } else if (filters.state === "active") {
    AND.push({
      AND: [
        { resolvedAt: null },
        { status: { notIn: TERMINAL_INCIDENT_STATUSES } }
      ]
    });
  }

  if (filters.impact === "unknown") {
    AND.push({ OR: [{ impact: null }, { impact: "" }] });
  } else if (filters.impact !== "all") {
    AND.push({ impact: filters.impact });
  }

  if (filters.type === "incident") {
    AND.push({ isMaintenance: false });
  } else if (filters.type === "maintenance") {
    AND.push({ isMaintenance: true });
  }

  const periodStart = getIncidentPeriodStart(filters.period, now);
  if (periodStart) {
    AND.push({
      OR: [
        { updatedAt: { gte: periodStart } },
        { AND: [{ updatedAt: null }, { startedAt: { gte: periodStart } }] },
        { AND: [{ updatedAt: null }, { startedAt: null }, { firstSeenAt: { gte: periodStart } }] }
      ]
    });
  }

  return AND.length > 0 ? { AND } : {};
}
```

- [ ] **Step 4: Run query tests and verify GREEN**

Expected: `3` query tests pass.

- [ ] **Step 5: Write failing data-boundary tests**

```ts
import { describe, expect, it, vi } from "vitest";
import { loadIncidentSearchData, type IncidentSearchRepository } from "@/lib/incidents/data";
import { parseIncidentSearchParams } from "@/lib/incidents/search-params";

describe("loadIncidentSearchData", () => {
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
```

- [ ] **Step 6: Run data tests and verify RED**

Run:

```bash
PATH=/Users/ninpeng/.local/share/fnm/node-versions/v22.22.0/installation/bin:$PATH pnpm test tests/incident-search-data.test.ts
```

Expected: FAIL because `@/lib/incidents/data` does not exist.

- [ ] **Step 7: Implement `data.ts` with a narrow repository**

```ts
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
  listServices: () => prisma.monitoredService.findMany({
    select: { name: true, provider: true },
    orderBy: { name: "asc" }
  }),
  countIncidents: (where) => prisma.incident.count({ where }),
  listIncidents: (query) => prisma.incident.findMany({
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
```

- [ ] **Step 8: Run both Task 2 test files and verify GREEN**

Run:

```bash
PATH=/Users/ninpeng/.local/share/fnm/node-versions/v22.22.0/installation/bin:$PATH pnpm test tests/incident-search-query.test.ts tests/incident-search-data.test.ts
```

Expected: `2` files and `5` tests pass.

- [ ] **Step 9: Commit Task 2**

```bash
git add src/lib/incidents/query.ts src/lib/incidents/data.ts tests/incident-search-query.test.ts tests/incident-search-data.test.ts
git commit -m "feat: 장애 이력 조회 조건 추가"
```

---

### Task 3: Shared Navigation And Dashboard Entry

**Files:**
- Create: `src/app/AppSidebar.tsx`
- Create: `tests/app-sidebar.test.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: existing `.app-shell`, `.sidebar`, `.brand`, `.nav-list` styles.
- Produces: `AppSidebar({ activePage })`, `IncidentHistoryLink()`.

- [ ] **Step 1: Write the failing navigation render test**

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppSidebar, IncidentHistoryLink } from "@/app/AppSidebar";

describe("incident history navigation", () => {
  it("links the shared sidebar to the dashboard and incident history", () => {
    const html = renderToStaticMarkup(<AppSidebar activePage="incidents" />);
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/incidents"');
    expect(html).toContain('aria-current="page"');
  });

  it("renders the compact dashboard entry link", () => {
    const html = renderToStaticMarkup(<IncidentHistoryLink />);
    expect(html).toContain('href="/incidents"');
    expect(html).toContain("전체 이력");
  });
});
```

- [ ] **Step 2: Run the navigation test and verify RED**

Run:

```bash
PATH=/Users/ninpeng/.local/share/fnm/node-versions/v22.22.0/installation/bin:$PATH pnpm test tests/app-sidebar.test.tsx
```

Expected: FAIL because `@/app/AppSidebar` does not exist.

- [ ] **Step 3: Implement the shared navigation component**

```tsx
import { ArrowRight, RadioTower } from "lucide-react";

export function AppSidebar({ activePage }: { activePage: "dashboard" | "incidents" }) {
  return (
    <aside className="sidebar">
      <a className="brand" href="/">
        <RadioTower aria-hidden="true" size={24} />
        <span>서비스 알림</span>
      </a>
      <nav className="nav-list" aria-label="주요 화면">
        <a className={activePage === "dashboard" ? "active" : undefined} href="/" aria-current={activePage === "dashboard" ? "page" : undefined}>대시보드</a>
        <a href="/#services">서비스</a>
        <a className={activePage === "incidents" ? "active" : undefined} href="/incidents" aria-current={activePage === "incidents" ? "page" : undefined}>장애 이력</a>
        <a href="/#worker">수집 실행</a>
      </nav>
    </aside>
  );
}

export function IncidentHistoryLink() {
  return (
    <a className="section-action" href="/incidents">
      전체 이력
      <ArrowRight aria-hidden="true" size={15} />
    </a>
  );
}
```

- [ ] **Step 4: Replace the inline sidebar and add the dashboard link**

In `src/app/page.tsx`:

```tsx
import { AppSidebar, IncidentHistoryLink } from "./AppSidebar";
```

Remove `RadioTower` from the lucide import, replace the existing `<aside>` block with:

```tsx
<AppSidebar activePage="dashboard" />
```

Add the link to the `최근 장애` section heading:

```tsx
<div className="section-heading">
  <div>
    <h2>최근 장애</h2>
    <p>예정 점검은 저장하지만 Slack 알림에서는 제외합니다.</p>
  </div>
  <IncidentHistoryLink />
</div>
```

Append these focused rules to `globals.css`:

```css
.nav-list a.active {
  background: rgba(255, 255, 255, 0.12);
  color: #ffffff;
}

.section-action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--accent);
  font-size: 13px;
  font-weight: 720;
  white-space: nowrap;
}
```

- [ ] **Step 5: Run the focused test, dashboard tests, typecheck, and verify GREEN**

```bash
PATH=/Users/ninpeng/.local/share/fnm/node-versions/v22.22.0/installation/bin:$PATH pnpm test tests/app-sidebar.test.tsx tests/dashboard.test.ts
PATH=/Users/ninpeng/.local/share/fnm/node-versions/v22.22.0/installation/bin:$PATH pnpm typecheck
```

Expected: both files pass and TypeScript exits `0`.

- [ ] **Step 6: Commit Task 3**

```bash
git add src/app/AppSidebar.tsx src/app/page.tsx src/app/globals.css tests/app-sidebar.test.tsx
git commit -m "feat: 장애 이력 화면 진입점 추가"
```

---

### Task 4: Incident Search Page, Results, And Error State

**Files:**
- Create: `src/app/incidents/IncidentSearchView.tsx`
- Create: `src/app/incidents/page.tsx`
- Create: `src/app/incidents/error.tsx`
- Create: `tests/incident-search-view.test.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `AppSidebar`, `IncidentSearchData`, `buildIncidentSearchHref`, `isResolvedIncident`, `formatDashboardDateTime`.
- Produces: `IncidentSearchView`, `/incidents` server page, route error boundary.

- [ ] **Step 1: Write failing view tests**

```tsx
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
    const html = renderToStaticMarkup(<IncidentSearchView data={{
      filters: parseIncidentSearchParams({ service: "jira", state: "resolved" }),
      services: [{ name: "JIRA", provider: "jira" }],
      incidents: [row],
      totalCount: 1,
      totalPages: 1,
      isPageOutOfRange: false
    }} />);

    expect(html).toContain("장애 이력");
    expect(html).toContain('name="state" value="resolved"');
    expect(html).toContain("JIRA login outage");
    expect(html).toContain("해결됨");
    expect(html).toContain("마지막 수집");
    expect(html).toContain('href="https://status.example/incidents/1"');
  });

  it("renders an empty state and preserves filters in pagination", () => {
    const empty = renderToStaticMarkup(<IncidentSearchView data={{
      filters: parseIncidentSearchParams({ q: "missing", page: "2" }),
      services: [],
      incidents: [],
      totalCount: 0,
      totalPages: 1,
      isPageOutOfRange: false
    }} />);
    expect(empty).toContain("조건에 맞는 장애 이력이 없습니다");

    const paged = renderToStaticMarkup(<IncidentSearchView data={{
      filters: parseIncidentSearchParams({ q: "login", page: "2" }),
      services: [],
      incidents: [row],
      totalCount: 51,
      totalPages: 3,
      isPageOutOfRange: false
    }} />);
    expect(paged).toContain('/incidents?q=login');
    expect(paged).toContain('page=3');
    expect(paged).toContain("2 / 3");
  });

  it("renders the route error recovery state", () => {
    const html = renderToStaticMarkup(<IncidentsError error={new Error("db failed")} reset={() => undefined} />);
    expect(html).toContain("장애 이력을 불러오지 못했습니다");
    expect(html).toContain("다시 시도");
  });
});
```

- [ ] **Step 2: Run the view test and verify RED**

Run:

```bash
PATH=/Users/ninpeng/.local/share/fnm/node-versions/v22.22.0/installation/bin:$PATH pnpm test tests/incident-search-view.test.tsx
```

Expected: FAIL because `IncidentSearchView` does not exist.

- [ ] **Step 3: Implement the pure view component**

Create `IncidentSearchView.tsx` with these complete responsibilities:

```tsx
import { ExternalLink, RotateCcw, Search } from "lucide-react";
import { AppSidebar } from "../AppSidebar";
import { formatDashboardDateTime } from "../../lib/dashboard/date-format";
import type { IncidentSearchData, IncidentSearchRow } from "../../lib/incidents/data";
import { isResolvedIncident } from "../../lib/incidents/query";
import { buildIncidentSearchHref } from "../../lib/incidents/search-params";

const stateOptions = [
  ["all", "전체"],
  ["active", "진행 중"],
  ["resolved", "해결됨"]
] as const;

const impactOptions = [
  ["all", "전체"], ["critical", "심각"], ["major", "주요"],
  ["minor", "일부"], ["none", "영향 없음"], ["unknown", "알 수 없음"]
] as const;
const periodOptions = [["24h", "24시간"], ["7d", "7일"], ["30d", "30일"], ["all", "전체"]] as const;
const typeOptions = [["incident", "장애"], ["maintenance", "예정 점검"], ["all", "전체"]] as const;

export function IncidentSearchView({ data }: { data: IncidentSearchData }) {
  const { filters } = data;
  const serviceOptions: Array<readonly [string, string]> = [
    ["all", "전체 서비스"],
    ...data.services.map((service) => [service.provider, service.name] as const)
  ];

  return (
    <main className="app-shell">
      <AppSidebar activePage="incidents" />
      <section className="content incident-history-content">
        <header className="topbar incident-history-header">
          <div>
            <h1>장애 이력</h1>
            <p>과거 장애를 서비스, 상태, 영향도와 기간으로 조회합니다.</p>
          </div>
        </header>

        <section className="incident-filter-band" aria-label="장애 이력 필터">
          <nav className="segmented-control" aria-label="진행 상태">
            {stateOptions.map(([value, label]) => (
              <a
                key={value}
                className={filters.state === value ? "active" : undefined}
                href={buildIncidentSearchHref(filters, { state: value, page: 1 })}
                aria-current={filters.state === value ? "page" : undefined}
              >
                {label}
              </a>
            ))}
          </nav>

          <form className="incident-filter-form" method="get" action="/incidents">
            <input type="hidden" name="state" value={filters.state} />
            <label className="incident-filter-search">
              <span>검색</span>
              <input name="q" type="search" maxLength={100} defaultValue={filters.q} placeholder="장애 제목 또는 서비스" />
            </label>
            <FilterSelect label="서비스" name="service" value={filters.service} options={serviceOptions} />
            <FilterSelect label="영향도" name="impact" value={filters.impact} options={impactOptions} />
            <FilterSelect label="기간" name="period" value={filters.period} options={periodOptions} />
            <FilterSelect label="유형" name="type" value={filters.type} options={typeOptions} />
            <div className="incident-filter-actions">
              <button className="command-button" type="submit"><Search aria-hidden="true" size={16} />조회</button>
              <a className="secondary-command" href="/incidents"><RotateCcw aria-hidden="true" size={16} />초기화</a>
            </div>
          </form>
        </section>

        <section className="panel incident-results">
          <div className="section-heading">
            <div><h2>검색 결과</h2><p>{periodText(filters.period)} · 총 {data.totalCount}건</p></div>
          </div>
          {data.incidents.length > 0 ? <IncidentTable incidents={data.incidents} /> : (
            <div className="empty-state incident-empty"><strong>조건에 맞는 장애 이력이 없습니다.</strong><a href="/incidents">기본 조건으로 돌아가기</a></div>
          )}
          <Pagination data={data} />
        </section>
      </section>
    </main>
  );
}

function FilterSelect({ label, name, value, options }: {
  label: string;
  name: string;
  value: string;
  options: readonly (readonly [string, string])[];
}) {
  return <label><span>{label}</span><select name={name} defaultValue={value}>{options.map(([optionValue, text]) => <option key={optionValue} value={optionValue}>{text}</option>)}</select></label>;
}

function IncidentTable({ incidents }: { incidents: IncidentSearchRow[] }) {
  return <div className="incident-table-wrap"><table className="incident-history-table"><thead><tr><th>서비스</th><th>장애</th><th>상태 / 영향도</th><th>발생 / 해결</th><th>마지막 수집</th><th><span className="sr-only">원문</span></th></tr></thead><tbody>{incidents.map((incident) => {
    const resolved = isResolvedIncident(incident);
    const sourceUrl = incident.url ?? incident.service.endpoint;
    return <tr key={incident.id}><td data-label="서비스"><strong>{incident.service.name}</strong><small>{incident.service.provider}</small></td><td data-label="장애"><strong>{incident.title}</strong>{incident.isMaintenance ? <small>예정 점검</small> : null}</td><td data-label="상태 / 영향도"><span className={`status-pill ${resolved ? "success" : "danger"}`}><span aria-hidden="true" />{resolved ? "해결됨" : "진행 중"}</span><small>{impactText(incident.impact)}</small></td><td data-label="발생 / 해결"><time>{formatDate(incident.startedAt)}</time><small>{incident.resolvedAt ? `해결 ${formatDate(incident.resolvedAt)}` : "해결 기록 없음"}</small></td><td data-label="마지막 수집"><time>{formatDate(incident.lastSeenAt)}</time></td><td data-label="원문"><a className="icon-button incident-source-button" href={sourceUrl} target="_blank" rel="noreferrer" aria-label={`${incident.service.name} 장애 원문 열기`} title="원문 열기"><ExternalLink aria-hidden="true" size={16} /></a></td></tr>;
  })}</tbody></table></div>;
}

function Pagination({ data }: { data: IncidentSearchData }) {
  if (data.totalCount === 0) return null;
  return <nav className="incident-pagination" aria-label="장애 이력 페이지"><span>{data.filters.page > 1 ? <a href={buildIncidentSearchHref(data.filters, { page: data.filters.page - 1 })}>이전</a> : <span aria-disabled="true">이전</span>}</span><strong>{data.filters.page} / {data.totalPages}</strong><span>{data.filters.page < data.totalPages ? <a href={buildIncidentSearchHref(data.filters, { page: data.filters.page + 1 })}>다음</a> : <span aria-disabled="true">다음</span>}</span></nav>;
}

function formatDate(value: Date | null) { return formatDashboardDateTime(value?.toISOString() ?? null, "기록 없음"); }
function impactText(value: string | null) { return ({ critical: "심각", major: "주요", minor: "일부", none: "영향 없음" } as Record<string, string>)[value ?? ""] ?? "알 수 없음"; }
function periodText(value: string) { return ({ "24h": "최근 24시간", "7d": "최근 7일", "30d": "최근 30일", all: "전체 기간" } as Record<string, string>)[value] ?? "최근 30일"; }
```

- [ ] **Step 4: Connect the server page and canonical redirect**

```tsx
import { redirect } from "next/navigation";
import { IncidentSearchView } from "./IncidentSearchView";
import { loadIncidentSearchData } from "../../lib/incidents/data";
import { buildIncidentSearchHref, parseIncidentSearchParams, type RawIncidentSearchParams } from "../../lib/incidents/search-params";

export const dynamic = "force-dynamic";

export default async function IncidentsPage({ searchParams }: { searchParams: Promise<RawIncidentSearchParams> }) {
  const filters = parseIncidentSearchParams(await searchParams);
  const data = await loadIncidentSearchData(filters);

  if (data.isPageOutOfRange) {
    redirect(buildIncidentSearchHref(filters, { page: data.totalPages }));
  }

  return <IncidentSearchView data={data} />;
}
```

- [ ] **Step 5: Add the route error boundary**

```tsx
"use client";

import { RefreshCw, TriangleAlert } from "lucide-react";

export default function IncidentsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="route-error"><TriangleAlert aria-hidden="true" size={22} /><h1>장애 이력을 불러오지 못했습니다.</h1><p>데이터베이스 연결과 로그를 확인한 뒤 다시 시도해 주세요.</p><button className="command-button" type="button" onClick={reset}><RefreshCw aria-hidden="true" size={16} />다시 시도</button><a href="/">대시보드로 돌아가기</a></main>;
}
```

- [ ] **Step 6: Add the complete responsive style surface**

Append CSS for these stable selectors and values:

```css
.incident-history-content { align-content: start; }
.incident-history-header h1 { font-size: 30px; }
.incident-filter-band { border: 1px solid var(--border); border-radius: 8px; background: var(--panel); }
.segmented-control { display: flex; gap: 4px; border-bottom: 1px solid var(--border); padding: 12px 16px; }
.segmented-control a { padding: 7px 11px; border-radius: 6px; color: var(--muted); font-size: 13px; font-weight: 700; }
.segmented-control a.active { background: #e8f0ff; color: var(--accent); }
.incident-filter-form { display: grid; grid-template-columns: minmax(220px, 1.6fr) repeat(4, minmax(120px, 0.7fr)) auto; gap: 12px; align-items: end; padding: 16px; }
.incident-filter-form label { display: grid; gap: 6px; min-width: 0; color: var(--muted); font-size: 12px; font-weight: 700; }
.incident-filter-form input, .incident-filter-form select { width: 100%; min-width: 0; height: 38px; border: 1px solid var(--border); border-radius: 6px; background: #fff; color: var(--text); padding: 0 10px; font: inherit; }
.incident-filter-actions { display: flex; gap: 8px; }
.command-button, .secondary-command { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 38px; border-radius: 6px; padding: 0 12px; font-size: 13px; font-weight: 720; }
.command-button { border: 1px solid var(--accent); background: var(--accent); color: #fff; cursor: pointer; }
.secondary-command { border: 1px solid var(--border); background: #fff; color: var(--text); }
.incident-table-wrap { overflow-x: auto; }
.incident-history-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.incident-history-table th, .incident-history-table td { border-bottom: 1px solid var(--border); padding: 13px 14px; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
.incident-history-table th { background: var(--panel-subtle); color: var(--muted); font-size: 12px; }
.incident-history-table td { font-size: 13px; }
.incident-history-table th:nth-child(1) { width: 13%; }
.incident-history-table th:nth-child(2) { width: 31%; }
.incident-history-table th:nth-child(3) { width: 16%; }
.incident-history-table th:nth-child(4) { width: 17%; }
.incident-history-table th:nth-child(5) { width: 15%; }
.incident-history-table th:nth-child(6) { width: 8%; }
.incident-history-table strong, .incident-history-table small, .incident-history-table time { display: block; }
.incident-history-table small { margin-top: 5px; color: var(--muted); }
.incident-source-button { width: 34px; height: 34px; }
.incident-pagination { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; padding: 14px 16px; font-size: 13px; }
.incident-pagination > span:last-child { text-align: right; }
.incident-pagination [aria-disabled="true"] { color: #98a2b3; }
.incident-empty { display: grid; gap: 8px; }
.incident-empty a { color: var(--accent); font-weight: 700; }
.route-error { display: grid; justify-items: start; gap: 12px; max-width: 520px; margin: 12vh auto; padding: 24px; }
.route-error h1, .route-error p { margin: 0; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }

@media (max-width: 1100px) {
  .incident-filter-form { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .incident-filter-actions { align-self: end; }
}

@media (max-width: 700px) {
  .segmented-control { overflow-x: auto; }
  .incident-filter-form { grid-template-columns: 1fr; }
  .incident-filter-actions { display: grid; grid-template-columns: 1fr 1fr; width: 100%; }
  .command-button, .secondary-command { width: 100%; }
  .incident-history-table, .incident-history-table tbody, .incident-history-table tr, .incident-history-table td { display: block; width: 100%; }
  .incident-history-table thead { display: none; }
  .incident-history-table tr { border-bottom: 1px solid var(--border); padding: 10px 14px; }
  .incident-history-table td { display: grid; grid-template-columns: minmax(90px, 0.35fr) minmax(0, 1fr); gap: 12px; border: 0; padding: 7px 0; }
  .incident-history-table td::before { content: attr(data-label); grid-column: 1; grid-row: 1 / -1; color: var(--muted); font-size: 12px; font-weight: 700; }
  .incident-history-table td > * { grid-column: 2; }
}
```

- [ ] **Step 7: Run focused UI tests, typecheck, lint, and verify GREEN**

```bash
PATH=/Users/ninpeng/.local/share/fnm/node-versions/v22.22.0/installation/bin:$PATH pnpm test tests/incident-search-view.test.tsx tests/app-sidebar.test.tsx
PATH=/Users/ninpeng/.local/share/fnm/node-versions/v22.22.0/installation/bin:$PATH pnpm typecheck
PATH=/Users/ninpeng/.local/share/fnm/node-versions/v22.22.0/installation/bin:$PATH pnpm lint
```

Expected: focused tests pass; TypeScript and ESLint exit `0`.

- [ ] **Step 8: Commit Task 4**

```bash
git add src/app/incidents src/app/globals.css tests/incident-search-view.test.tsx
git commit -m "feat: 장애 이력 검색 화면 추가"
```

---

### Task 5: Documentation, Full Verification, And Browser QA

**Files:**
- Modify: `README.md`
- Modify: `docs/ROADMAP.md`

**Interfaces:**
- Consumes: all Task 1-4 behavior.
- Produces: documented `/incidents` workflow and verified production build.

- [ ] **Step 1: Update README and roadmap with exact behavior**

Add to README execution documentation:

````md
전체 장애 이력은 아래 주소에서 검색합니다.

```text
http://localhost:3333/incidents
```

기본 조회 범위는 최근 30일의 실제 장애이며, 서비스·진행 상태·영향도·기간·유형 필터를 URL에 유지합니다.
````

Add directly under `## 6순위: 상태 상세와 검색` in `docs/ROADMAP.md`:

```md
상태: 완료 (2026-07-14)
```

- [ ] **Step 2: Run the complete automated verification**

```bash
PATH=/Users/ninpeng/.local/share/fnm/node-versions/v22.22.0/installation/bin:$PATH pnpm test
PATH=/Users/ninpeng/.local/share/fnm/node-versions/v22.22.0/installation/bin:$PATH pnpm typecheck
PATH=/Users/ninpeng/.local/share/fnm/node-versions/v22.22.0/installation/bin:$PATH pnpm lint
PATH=/Users/ninpeng/.local/share/fnm/node-versions/v22.22.0/installation/bin:$PATH pnpm build
git diff --check
```

Expected: all test files pass; typecheck, lint, production build, and diff check exit `0`.

- [ ] **Step 3: Restart only the web LaunchAgent after build**

Run:

```bash
launchctl kickstart -k gui/$(id -u)/com.service-alert.web
```

Do not trigger `com.service-alert.worker`; this feature is read-only and a manual worker run could send Slack notifications.

Expected: `launchctl print gui/$(id -u)/com.service-alert.web` reports `state = running` and both `/` and `/incidents` return HTTP `200`.

- [ ] **Step 4: Run Browser plugin QA**

Required flow:

```text
http://localhost:3333/
→ 최근 장애의 전체 이력
→ /incidents 기본 최근 30일 결과
→ 서비스 필터 적용
→ 해결됨 segmented control 적용
→ URL과 결과 변경 확인
→ 초기화
→ /incidents?page=999 canonical redirect 확인
→ 페이지 이동 또는 결과 없음 상태 확인
```

Verify with Browser plugin on `1440x900` and `390x844`:

- page title and URL are correct;
- meaningful content renders and no Next.js overlay appears;
- console has no relevant error or warning;
- filters preserve URL state;
- table has no clipping or incoherent overlap;
- mobile rows do not require horizontal scrolling;
- external source link has the expected `href` without navigating away during QA.

- [ ] **Step 5: Review React changes against the React best-practices skill**

Confirm:

- filtering remains server-rendered and adds no client fetch waterfall;
- only `error.tsx` is a client component;
- service, count, and incident list queries run in parallel;
- no large third-party dependency or unnecessary memoization was added;
- static option arrays are module-level constants.

- [ ] **Step 6: Commit documentation and any QA-only corrections**

```bash
git add README.md docs/ROADMAP.md
git commit -m "docs: 장애 이력 검색 사용법 추가"
```

- [ ] **Step 7: Verify final branch state**

```bash
git status --short --branch
git log --oneline main..HEAD
git diff --stat main...HEAD
git diff --check main...HEAD
```

Expected: clean `feature/incident-history-search` branch with the design, plan, focused implementation commits, tests, and documentation only.
