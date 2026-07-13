# AI Provider Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox - [ ] syntax for tracking.

**Goal:** Add OpenAI, Claude, and Gemini web/app monitoring as three provider-level services while excluding special-purpose components and preserving existing provider behavior.

**Architecture:** Extend code-owned provider configuration, reuse the Statuspage adapter with exact-name exclusions for OpenAI and Claude, and add one focused Google Workspace adapter for Gemini incidents. Keep the existing ProviderSnapshot, persistence, dashboard, and notification boundaries; add explicit first-observation classification so an already-updated active incident can still produce one start notification.

**Tech Stack:** TypeScript, Node.js 22, Vitest, Prisma 7 with SQLite, Next.js 16, native fetch

## Global Constraints

- Do not add dependencies.
- Do not change the Prisma schema or dashboard component structure.
- Keep OpenAI, Claude, and Gemini as one MonitoredService each.
- Exclude OpenAI FedRAMP, Ads Manager, and Ads API.
- Exclude Claude for Government.
- Include only Google Workspace incidents whose service_name exactly equals Gemini.
- Do not send Slack messages from tests or smoke checks.
- Preserve the behavior of the existing seven providers.
- Run pnpm through the Node 22 Corepack path documented in README.md when the shell pnpm resolves to another runtime.

## File Map

- Modify src/lib/status/types.ts: add provider IDs, provider kind, and source filter metadata.
- Modify src/lib/status/default-services.ts: register the three provider defaults and exclusions.
- Create tests/default-services.test.ts: verify configuration and default seeding.
- Modify src/lib/status/adapters/statuspage.ts: filter components/incidents and recalculate filtered status.
- Modify tests/statuspage.test.ts: cover exclusions and unchanged unfiltered behavior.
- Create src/lib/status/adapters/google-workspace.ts: fetch and normalize active Gemini incidents.
- Create tests/google-workspace.test.ts: cover Gemini parsing, filtering, severity, and errors.
- Modify src/lib/status/fetch-provider.ts: dispatch the new provider kind and pass source filters.
- Create tests/fetch-provider.test.ts: verify runtime dispatch retains code-owned filters.
- Modify src/lib/status/notifications.ts: support an explicit first-observation event type.
- Modify src/lib/worker/check-services.ts: identify newly observed incident IDs before persistence.
- Modify tests/notifications.test.ts: verify first-observation delivery policy and dedupe inputs.
- Modify tests/worker-resolution.test.ts: verify Gemini recovery and first-observation ID selection.
- Modify docs/superpowers/specs/2026-07-10-ai-provider-monitoring-design.md: keep the first-observation clarification aligned with implementation.

---

### Task 1: Provider Types, Defaults, and Seeding

**Files:**
- Create: tests/default-services.test.ts
- Modify: src/lib/status/types.ts:1-18
- Modify: src/lib/status/default-services.ts:5-62

**Interfaces:**
- Produces: ProviderId values openai, claude, and gemini.
- Produces: ProviderKind value google-workspace.
- Produces: MonitoredServiceConfig.excludedComponentNames and MonitoredServiceConfig.sourceServiceName.
- Produces: default service entries consumed by fetchProviderSnapshot and ensureDefaultServices.

- [ ] **Step 1: Write the failing configuration and seeding test**

Create tests/default-services.test.ts:

~~~ts
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
~~~

- [ ] **Step 2: Run the test and verify the expected failure**

Run:

~~~sh
pnpm test -- tests/default-services.test.ts
~~~

Expected: FAIL because the AI provider IDs, provider kind, filter fields, and defaults do not exist.

- [ ] **Step 3: Extend the provider types**

Update src/lib/status/types.ts:

~~~ts
export type ProviderId =
  | "jira"
  | "bitbucket"
  | "slack"
  | "vercel"
  | "aws"
  | "notion"
  | "figma"
  | "openai"
  | "claude"
  | "gemini";

export type ProviderKind = "statuspage" | "slack-status" | "aws-rss" | "google-workspace";

export interface MonitoredServiceConfig {
  name: string;
  provider: ProviderId;
  providerKind: ProviderKind;
  endpoint: string;
  enabled: boolean;
  slackEnabled: boolean;
  excludedComponentNames?: readonly string[];
  sourceServiceName?: string;
}
~~~

Keep OverallStatus, notification types, normalized records, and ProviderSnapshot unchanged.

- [ ] **Step 4: Add the three default service objects**

Append these entries to defaultMonitoredServices in src/lib/status/default-services.ts:

~~~ts
  {
    name: "OpenAI",
    provider: "openai",
    providerKind: "statuspage",
    endpoint: "https://status.openai.com/api/v2/summary.json",
    enabled: true,
    slackEnabled: true,
    excludedComponentNames: ["FedRAMP", "Ads Manager", "Ads API"]
  },
  {
    name: "Claude",
    provider: "claude",
    providerKind: "statuspage",
    endpoint: "https://status.claude.com/api/v2/summary.json",
    enabled: true,
    slackEnabled: true,
    excludedComponentNames: ["Claude for Government"]
  },
  {
    name: "Gemini",
    provider: "gemini",
    providerKind: "google-workspace",
    endpoint: "https://www.google.com/appsstatus/dashboard/incidents.json",
    enabled: true,
    slackEnabled: true,
    sourceServiceName: "Gemini"
  }
~~~

- [ ] **Step 5: Run the focused test**

Run:

~~~sh
pnpm test -- tests/default-services.test.ts
~~~

Expected: PASS with 2 tests.

- [ ] **Step 6: Commit the provider metadata**

~~~sh
git add src/lib/status/types.ts src/lib/status/default-services.ts tests/default-services.test.ts
git commit -m "Add AI provider defaults"
~~~

---

### Task 2: Statuspage Component and Incident Filtering

**Files:**
- Modify: tests/statuspage.test.ts
- Modify: src/lib/status/adapters/statuspage.ts

**Interfaces:**
- Consumes: MonitoredServiceConfig.excludedComponentNames from Task 1.
- Produces: StatuspageContext.excludedComponentNames.
- Produces: filtered ProviderSnapshot values consumed unchanged by persistence.

- [ ] **Step 1: Add a failing filter test**

Add this case to tests/statuspage.test.ts:

~~~ts
  it("removes excluded components and their incidents before recalculating status", () => {
    const snapshot = parseStatuspageSummary(
      {
        components: [
          { id: "chatgpt", name: "ChatGPT", status: "operational" },
          { id: "fedramp", name: "FedRAMP", status: "major_outage" }
        ],
        incidents: [
          {
            id: "fed-incident",
            name: "FedRAMP outage",
            status: "investigating",
            impact: "critical",
            components: [{ id: "fedramp", name: "FedRAMP" }]
          },
          {
            id: "global-incident",
            name: "Provider-wide degradation",
            status: "investigating",
            impact: "minor"
          }
        ],
        status: { indicator: "critical" }
      },
      {
        provider: "openai",
        serviceName: "OpenAI",
        endpoint: "https://status.openai.com/api/v2/summary.json",
        excludedComponentNames: ["FedRAMP"]
      }
    );

    expect(snapshot.components.map((component) => component.name)).toEqual(["ChatGPT"]);
    expect(snapshot.incidents.map((incident) => incident.externalId)).toEqual(["global-incident"]);
    expect(snapshot.overallStatus).toBe("minor");
  });
~~~

The existing Figma test remains the regression test proving that an unfiltered provider still trusts the source page indicator.

- [ ] **Step 2: Run the Statuspage test and verify failure**

Run:

~~~sh
pnpm test -- tests/statuspage.test.ts
~~~

Expected: FAIL because StatuspageContext does not accept exclusions and the FedRAMP records remain.

- [ ] **Step 3: Add exclusion metadata and filtered parsing**

In src/lib/status/adapters/statuspage.ts, extend imports and context:

~~~ts
import type {
  NormalizedComponent,
  NormalizedIncident,
  OverallStatus,
  ProviderId,
  ProviderSnapshot
} from "../types";

interface StatuspageContext {
  provider: ProviderId;
  serviceName: string;
  endpoint: string;
  excludedComponentNames?: readonly string[];
}
~~~

Replace parseStatuspageSummary with this flow:

~~~ts
export function parseStatuspageSummary(
  payload: StatuspageSummary,
  context: StatuspageContext
): ProviderSnapshot {
  const sourceComponents = payload.components ?? [];
  const excludedNames = new Set(context.excludedComponentNames ?? []);
  const excludedIds = new Set(
    sourceComponents
      .filter((component) => component.name && excludedNames.has(component.name))
      .map((component) => requiredString(component.id, "component.id"))
  );
  const componentPayloads = sourceComponents.filter(
    (component) => !excludedIds.has(requiredString(component.id, "component.id"))
  );
  const incidentPayloads = (payload.incidents ?? []).filter((incident) =>
    includesRetainedComponent(incident, excludedIds)
  );
  const maintenancePayloads = (payload.scheduled_maintenances ?? []).filter((maintenance) =>
    includesRetainedComponent(maintenance, excludedIds)
  );
  const components: NormalizedComponent[] = componentPayloads.map((component) => ({
    externalId: requiredString(component.id, "component.id"),
    name: component.name ?? "Unknown component",
    status: component.status ?? "unknown",
    updatedAt: parseOptionalDate(component.updated_at)
  }));
  const incidents: NormalizedIncident[] = [
    ...incidentPayloads.map((incident) => parseStatuspageIncident(incident, false)),
    ...maintenancePayloads.map((maintenance) => parseStatuspageIncident(maintenance, true))
  ];

  return {
    service: {
      provider: context.provider,
      name: context.serviceName,
      endpoint: context.endpoint
    },
    overallStatus:
      excludedNames.size === 0
        ? parseOverallStatus(payload.status?.indicator)
        : summarizeFilteredStatus(components, incidents),
    checkedAt: new Date(),
    components,
    incidents
  };
}
~~~

- [ ] **Step 4: Add exact-ID incident filtering and severity helpers**

Add these helpers in src/lib/status/adapters/statuspage.ts:

~~~ts
function includesRetainedComponent(
  incident: Record<string, unknown>,
  excludedIds: ReadonlySet<string>
) {
  if (!Array.isArray(incident.components) || incident.components.length === 0) {
    return true;
  }

  return incident.components.some((component) => {
    if (!isRecord(component)) {
      return true;
    }

    const id = stringValue(component.id);
    return !id || !excludedIds.has(id);
  });
}

function summarizeFilteredStatus(
  components: NormalizedComponent[],
  incidents: NormalizedIncident[]
): OverallStatus {
  const candidates: OverallStatus[] = [
    ...components.map((component) => componentStatus(component.status)),
    ...incidents
      .filter((incident) => !incident.isMaintenance)
      .map((incident) => parseOverallStatus(incident.impact ?? undefined))
  ];

  return candidates.reduce(moreSevereStatus, "none");
}

function componentStatus(status: string): OverallStatus {
  const values: Record<string, OverallStatus> = {
    operational: "none",
    degraded_performance: "minor",
    partial_outage: "major",
    major_outage: "critical"
  };

  return values[status] ?? "unknown";
}

function moreSevereStatus(left: OverallStatus, right: OverallStatus): OverallStatus {
  const rank: Record<OverallStatus, number> = {
    none: 0,
    unknown: 1,
    minor: 2,
    major: 3,
    critical: 4
  };

  return rank[right] > rank[left] ? right : left;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
~~~

Annotate parseStatuspageIncident to return NormalizedIncident. Leave its field mapping unchanged.

- [ ] **Step 5: Run focused and regression tests**

Run:

~~~sh
pnpm test -- tests/statuspage.test.ts
pnpm typecheck
~~~

Expected: Statuspage tests PASS and TypeScript reports no errors.

- [ ] **Step 6: Commit Statuspage filtering**

~~~sh
git add src/lib/status/adapters/statuspage.ts tests/statuspage.test.ts
git commit -m "Filter Statuspage components"
~~~

---

### Task 3: Google Workspace Gemini Adapter

**Files:**
- Create: src/lib/status/adapters/google-workspace.ts
- Create: tests/google-workspace.test.ts

**Interfaces:**
- Produces: parseGoogleWorkspaceStatus(payload, context): ProviderSnapshot.
- Produces: fetchGoogleWorkspaceStatus(endpoint, context, fetchImpl): Promise<ProviderSnapshot>.
- Context fields: provider, serviceName, sourceServiceName, endpoint.

- [ ] **Step 1: Write failing Gemini normalization tests**

Create tests/google-workspace.test.ts:

~~~ts
import { describe, expect, it } from "vitest";
import { parseGoogleWorkspaceStatus } from "@/lib/status/adapters/google-workspace";

const context = {
  provider: "gemini" as const,
  serviceName: "Gemini",
  sourceServiceName: "Gemini",
  endpoint: "https://www.google.com/appsstatus/dashboard/incidents.json"
};

describe("parseGoogleWorkspaceStatus", () => {
  it("keeps only active Gemini web/app incidents and maps medium severity", () => {
    const snapshot = parseGoogleWorkspaceStatus(
      [
        {
          id: "gemini-active",
          service_name: "Gemini",
          begin: "2026-07-13T00:00:00Z",
          end: null,
          modified: "2026-07-13T00:10:00Z",
          external_desc: "**Title**\nGemini prompts are failing\n**Description**\nElevated errors",
          severity: "medium",
          uri: "incidents/gemini-active",
          most_recent_update: { status: "SERVICE_DISRUPTION" }
        },
        {
          id: "gemini-resolved",
          service_name: "Gemini",
          begin: "2026-07-12T00:00:00Z",
          end: "2026-07-12T01:00:00Z",
          modified: "2026-07-12T01:00:00Z",
          external_desc: "**Title**\nResolved Gemini incident",
          severity: "medium",
          uri: "incidents/gemini-resolved",
          most_recent_update: { status: "AVAILABLE" }
        },
        {
          id: "gmail-active",
          service_name: "Gmail",
          begin: "2026-07-13T00:00:00Z",
          end: null,
          modified: "2026-07-13T00:10:00Z",
          external_desc: "**Title**\nGmail outage",
          severity: "high",
          uri: "incidents/gmail-active",
          most_recent_update: { status: "SERVICE_OUTAGE" }
        }
      ],
      context
    );

    expect(snapshot.overallStatus).toBe("major");
    expect(snapshot.components).toMatchObject([
      { externalId: "gemini", name: "Gemini", status: "partial_outage" }
    ]);
    expect(snapshot.incidents).toMatchObject([
      {
        externalId: "gemini-active",
        title: "Gemini prompts are failing",
        status: "SERVICE_DISRUPTION",
        impact: "major",
        url: "https://www.google.com/appsstatus/dashboard/incidents/gemini-active",
        startedAt: new Date("2026-07-13T00:00:00Z"),
        updatedAt: new Date("2026-07-13T00:10:00Z"),
        resolvedAt: null,
        isMaintenance: false,
        shouldNotify: true
      }
    ]);
  });

  it("reports unknown instead of healthy for an unrecognized active severity", () => {
    const snapshot = parseGoogleWorkspaceStatus(
      [
        {
          id: "gemini-unknown",
          service_name: "Gemini",
          end: null,
          severity: "unexpected",
          most_recent_update: { status: "SERVICE_INFORMATION" }
        }
      ],
      context
    );

    expect(snapshot.overallStatus).toBe("unknown");
    expect(snapshot.components[0].status).toBe("unknown");
    expect(snapshot.incidents[0].impact).toBeNull();
  });

  it("rejects a non-array response with the provider name", () => {
    expect(() => parseGoogleWorkspaceStatus({}, context)).toThrow(
      "Invalid Google Workspace response for Gemini: expected an array"
    );
  });
});
~~~

- [ ] **Step 2: Run the test and verify module failure**

Run:

~~~sh
pnpm test -- tests/google-workspace.test.ts
~~~

Expected: FAIL because src/lib/status/adapters/google-workspace.ts does not exist.

- [ ] **Step 3: Create the adapter entry points and active-record selection**

Create src/lib/status/adapters/google-workspace.ts with these public interfaces and parser flow:

~~~ts
import type {
  NormalizedIncident,
  OverallStatus,
  ProviderId,
  ProviderSnapshot
} from "../types";

export interface GoogleWorkspaceContext {
  provider: ProviderId;
  serviceName: string;
  sourceServiceName: string;
  endpoint: string;
}

export function parseGoogleWorkspaceStatus(
  payload: unknown,
  context: GoogleWorkspaceContext
): ProviderSnapshot {
  if (!Array.isArray(payload)) {
    throw new Error(
      "Invalid Google Workspace response for " + context.serviceName + ": expected an array"
    );
  }

  const activeRecords = payload
    .filter(isRecord)
    .filter((incident) => stringValue(incident.service_name) === context.sourceServiceName)
    .filter(isActiveIncident);
  const incidents = activeRecords.map((incident) => normalizeIncident(incident, context));
  const overallStatus = activeRecords
    .map((incident) => severityState(incident.severity).overallStatus)
    .reduce(moreSevereStatus, "none");
  const componentStatus = overallToComponentStatus(overallStatus);

  return {
    service: {
      provider: context.provider,
      name: context.serviceName,
      endpoint: context.endpoint
    },
    overallStatus,
    checkedAt: new Date(),
    components: [
      {
        externalId: context.provider,
        name: context.serviceName,
        status: componentStatus,
        updatedAt: latestDate(incidents.map((incident) => incident.updatedAt))
      }
    ],
    incidents
  };
}

export async function fetchGoogleWorkspaceStatus(
  endpoint: string,
  context: GoogleWorkspaceContext,
  fetchImpl: typeof fetch = fetch
): Promise<ProviderSnapshot> {
  const response = await fetchImpl(endpoint, {
    headers: { accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(
      "Google Workspace request failed for " +
        context.serviceName +
        ": " +
        response.status +
        " " +
        response.statusText
    );
  }

  return parseGoogleWorkspaceStatus(await response.json(), context);
}
~~~

- [ ] **Step 4: Add normalization and severity helpers**

Complete src/lib/status/adapters/google-workspace.ts with these private helpers:

~~~ts
function isActiveIncident(incident: Record<string, unknown>) {
  return !stringValue(incident.end) && latestStatus(incident) !== "AVAILABLE";
}

function normalizeIncident(
  incident: Record<string, unknown>,
  context: GoogleWorkspaceContext
): NormalizedIncident {
  const externalId = requiredString(incident.id, "incident.id", context.serviceName);
  const severity = severityState(incident.severity);
  const uri = stringValue(incident.uri);

  return {
    externalId,
    title: extractTitle(
      stringValue(incident.external_desc),
      context.serviceName + " incident"
    ),
    status: latestStatus(incident),
    impact: severity.impact,
    url: uri
      ? new URL(uri, "https://www.google.com/appsstatus/dashboard/").toString()
      : "https://www.google.com/appsstatus/dashboard/",
    startedAt: parseOptionalDate(incident.begin),
    updatedAt: parseOptionalDate(incident.modified),
    resolvedAt: null,
    isMaintenance: false,
    shouldNotify: true,
    raw: incident
  };
}

function latestStatus(incident: Record<string, unknown>) {
  const update = isRecord(incident.most_recent_update) ? incident.most_recent_update : null;
  return stringValue(update?.status) ?? "unknown";
}

function severityState(value: unknown): {
  impact: string | null;
  overallStatus: OverallStatus;
} {
  const severity = stringValue(value)?.toLowerCase();

  if (severity === "low") {
    return { impact: "minor", overallStatus: "minor" };
  }
  if (severity === "medium") {
    return { impact: "major", overallStatus: "major" };
  }
  if (severity === "high" || severity === "critical") {
    return { impact: "critical", overallStatus: "critical" };
  }

  return { impact: null, overallStatus: "unknown" };
}

function overallToComponentStatus(status: OverallStatus) {
  const statuses: Record<OverallStatus, string> = {
    none: "operational",
    minor: "degraded_performance",
    major: "partial_outage",
    critical: "major_outage",
    unknown: "unknown"
  };
  return statuses[status];
}

function extractTitle(description: string | null, fallback: string) {
  if (!description) {
    return fallback;
  }

  const lines = description
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const titleMarker = lines.findIndex(
    (line) => line.replaceAll("*", "").trim().toLowerCase() === "title"
  );
  const candidate = titleMarker >= 0 ? lines[titleMarker + 1] : lines[0];
  return candidate?.replace(/^\*\*|\*\*$/g, "").trim() || fallback;
}

function latestDate(values: Array<Date | null>) {
  const timestamps = values
    .filter((value): value is Date => Boolean(value))
    .map((value) => value.getTime());
  return timestamps.length > 0 ? new Date(Math.max(...timestamps)) : null;
}

function parseOptionalDate(value: unknown) {
  const source = stringValue(value);
  if (!source) {
    return null;
  }
  const date = new Date(source);
  return Number.isNaN(date.getTime()) ? null : date;
}

function moreSevereStatus(left: OverallStatus, right: OverallStatus): OverallStatus {
  const rank: Record<OverallStatus, number> = {
    none: 0,
    unknown: 1,
    minor: 2,
    major: 3,
    critical: 4
  };
  return rank[right] > rank[left] ? right : left;
}

function requiredString(value: unknown, field: string, serviceName: string) {
  const result = stringValue(value);
  if (!result) {
    throw new Error("Missing Google Workspace field for " + serviceName + ": " + field);
  }
  return result;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
~~~

- [ ] **Step 5: Run adapter tests and type checking**

Run:

~~~sh
pnpm test -- tests/google-workspace.test.ts
pnpm typecheck
~~~

Expected: 3 Gemini tests PASS and TypeScript reports no errors.

- [ ] **Step 6: Commit the Gemini adapter**

~~~sh
git add src/lib/status/adapters/google-workspace.ts tests/google-workspace.test.ts
git commit -m "Add Gemini status adapter"
~~~

---

### Task 4: Provider Dispatch and Recovery Integration

**Files:**
- Create: tests/fetch-provider.test.ts
- Modify: src/lib/status/fetch-provider.ts
- Modify: tests/worker-resolution.test.ts

**Interfaces:**
- Consumes: fetchGoogleWorkspaceStatus from Task 3.
- Consumes: excludedComponentNames and sourceServiceName from Task 1.
- Preserves: fetchProviderSnapshot runtime service override for name and endpoint.
- Preserves: buildResolvedMissingIncidents behavior for every provider except AWS.

- [ ] **Step 1: Write failing dispatcher tests**

Create tests/fetch-provider.test.ts:

~~~ts
import { describe, expect, it, vi } from "vitest";
import { fetchProviderSnapshot } from "@/lib/status/fetch-provider";

describe("fetchProviderSnapshot", () => {
  it("carries the OpenAI exclusion config through the runtime service record", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          components: [{ id: "fedramp", name: "FedRAMP", status: "major_outage" }],
          incidents: [],
          status: { indicator: "critical" }
        }),
        { status: 200 }
      )
    );

    const snapshot = await fetchProviderSnapshot(
      {
        name: "OpenAI",
        provider: "openai",
        endpoint: "https://status.openai.com/api/v2/summary.json"
      },
      fetchImpl
    );

    expect(snapshot.components).toEqual([]);
    expect(snapshot.overallStatus).toBe("none");
  });

  it("dispatches Gemini to the Google Workspace adapter", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }));

    const snapshot = await fetchProviderSnapshot(
      {
        name: "Gemini",
        provider: "gemini",
        endpoint: "https://www.google.com/appsstatus/dashboard/incidents.json"
      },
      fetchImpl
    );

    expect(snapshot.service.provider).toBe("gemini");
    expect(snapshot.components).toMatchObject([
      { externalId: "gemini", status: "operational" }
    ]);
  });
});
~~~

- [ ] **Step 2: Add a Gemini recovery regression test**

In tests/worker-resolution.test.ts, add a case that reuses the existing stored-incident shape:

~~~ts
  it("resolves a Gemini incident when it leaves the active Workspace feed", () => {
    const geminiSnapshot: ProviderSnapshot = {
      ...snapshot,
      service: {
        provider: "gemini",
        name: "Gemini",
        endpoint: "https://www.google.com/appsstatus/dashboard/incidents.json"
      }
    };
    const resolved = buildResolvedMissingIncidents(geminiSnapshot, [
      {
        externalId: "gemini-active",
        title: "Gemini outage",
        status: "SERVICE_DISRUPTION",
        impact: "major",
        url: "https://www.google.com/appsstatus/dashboard/incidents/gemini-active",
        startedAt: new Date("2026-07-13T00:00:00Z"),
        updatedAt: new Date("2026-07-13T00:10:00Z"),
        resolvedAt: null,
        isMaintenance: false,
        shouldNotify: true,
        rawPayload: "{}"
      }
    ]);

    expect(resolved).toMatchObject([
      {
        externalId: "gemini-active",
        status: "resolved",
        resolvedAt: checkedAt
      }
    ]);
  });
~~~

- [ ] **Step 3: Run both tests and verify dispatch failure**

Run:

~~~sh
pnpm test -- tests/fetch-provider.test.ts tests/worker-resolution.test.ts
~~~

Expected: fetch-provider tests FAIL because filters are not forwarded and google-workspace is not dispatched; the Gemini recovery test already PASSes.

- [ ] **Step 4: Wire filters and explicit provider-kind dispatch**

Update src/lib/status/fetch-provider.ts:

~~~ts
import { fetchGoogleWorkspaceStatus } from "./adapters/google-workspace";

export async function fetchDefaultProviderSnapshot(
  service: MonitoredServiceConfig,
  fetchImpl: typeof fetch = fetch
): Promise<ProviderSnapshot> {
  if (service.providerKind === "statuspage") {
    return fetchStatuspageSummary(
      service.endpoint,
      {
        provider: service.provider,
        serviceName: service.name,
        endpoint: service.endpoint,
        excludedComponentNames: service.excludedComponentNames
      },
      fetchImpl
    );
  }

  if (service.providerKind === "slack-status") {
    return fetchSlackCurrentStatus(service.endpoint, fetchImpl);
  }

  if (service.providerKind === "google-workspace") {
    if (!service.sourceServiceName) {
      throw new Error("Missing Google Workspace service filter for " + service.name);
    }

    return fetchGoogleWorkspaceStatus(
      service.endpoint,
      {
        provider: service.provider,
        serviceName: service.name,
        sourceServiceName: service.sourceServiceName,
        endpoint: service.endpoint
      },
      fetchImpl
    );
  }

  return fetchAwsRss(service.endpoint, awsNotificationRegions, fetchImpl);
}
~~~

Remove the no-longer-needed ProviderId type assertion/import if TypeScript marks it unused.

- [ ] **Step 5: Run dispatch, adapter, Statuspage, and recovery tests**

Run:

~~~sh
pnpm test -- tests/fetch-provider.test.ts tests/google-workspace.test.ts tests/statuspage.test.ts tests/worker-resolution.test.ts
pnpm typecheck
~~~

Expected: all focused tests PASS and TypeScript reports no errors.

- [ ] **Step 6: Commit provider dispatch**

~~~sh
git add src/lib/status/fetch-provider.ts tests/fetch-provider.test.ts tests/worker-resolution.test.ts
git commit -m "Wire AI provider status sources"
~~~

---

### Task 5: First-Observation Notification Classification

**Files:**
- Modify: src/lib/status/notifications.ts
- Modify: src/lib/worker/check-services.ts
- Modify: tests/notifications.test.ts
- Modify: tests/worker-resolution.test.ts
- Modify: docs/superpowers/specs/2026-07-10-ai-provider-monitoring-design.md

**Interfaces:**
- Produces: NotificationClassificationOptions with isFirstObservation.
- Produces: shouldSendSlackNotification(incident, eventType).
- Produces: getFirstObservedIncidentIds(incidents, existingIncidentIds).
- Preserves: intermediate incident updates are stored but not Slack-sent.

- [ ] **Step 1: Write failing first-observation tests**

Extend tests/notifications.test.ts:

~~~ts
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
~~~

Extend tests/worker-resolution.test.ts imports:

~~~ts
import {
  buildResolvedMissingIncidents,
  getFirstObservedIncidentIds
} from "@/lib/worker/check-services";
import type { NormalizedIncident, ProviderSnapshot } from "@/lib/status/types";
~~~

Add a complete local fixture and test:

~~~ts
const activeIncident: NormalizedIncident = {
  externalId: "base",
  title: "Provider outage",
  status: "investigating",
  impact: "major",
  url: null,
  startedAt: new Date("2026-07-13T00:00:00Z"),
  updatedAt: new Date("2026-07-13T00:10:00Z"),
  resolvedAt: null,
  isMaintenance: false,
  shouldNotify: true,
  raw: {}
};

  it("finds incident IDs that are new to the local database", () => {
    expect(
      getFirstObservedIncidentIds(
        [
          { ...activeIncident, externalId: "existing" },
          { ...activeIncident, externalId: "new" }
        ],
        ["existing"]
      )
    ).toEqual(new Set(["new"]));
  });
~~~

- [ ] **Step 2: Run the focused tests and verify signature failures**

Run:

~~~sh
pnpm test -- tests/notifications.test.ts tests/worker-resolution.test.ts
~~~

Expected: FAIL because the notification options, eventType argument, and getFirstObservedIncidentIds do not exist.

- [ ] **Step 3: Extend pure notification classification**

Update src/lib/status/notifications.ts:

~~~ts
interface NotificationClassificationOptions {
  isFirstObservation?: boolean;
}

export function getNotificationEventType(
  incident: NormalizedIncident,
  options: NotificationClassificationOptions = {}
): NotificationEventType {
  const status = incident.status.toLowerCase();

  if (status.includes("resolved") || status.includes("complete")) {
    return "incident_resolved";
  }

  if (options.isFirstObservation) {
    return "incident_started";
  }

  if (
    incident.startedAt &&
    incident.updatedAt &&
    Math.abs(incident.startedAt.getTime() - incident.updatedAt.getTime()) < 1000
  ) {
    return "incident_started";
  }

  return "incident_update";
}

export function shouldSendSlackNotification(
  incident: NormalizedIncident,
  eventType = getNotificationEventType(incident)
) {
  return (
    incident.shouldNotify &&
    !incident.isMaintenance &&
    isMajorOrCriticalImpact(incident.impact) &&
    eventType !== "incident_update"
  );
}
~~~

- [ ] **Step 4: Identify first observations before persistence**

In src/lib/worker/check-services.ts, export the pure helper:

~~~ts
export function getFirstObservedIncidentIds(
  incidents: NormalizedIncident[],
  existingIncidentIds: Iterable<string>
) {
  const existing = new Set(existingIncidentIds);
  return new Set(
    incidents
      .filter((incident) => !incident.isMaintenance && incident.shouldNotify)
      .filter((incident) => !existing.has(incident.externalId))
      .map((incident) => incident.externalId)
  );
}
~~~

Before persistProviderSnapshot in runServiceChecks, load existing IDs and calculate the set:

~~~ts
      const existingIncidents = await options.prisma.incident.findMany({
        where: {
          serviceId: service.id,
          externalId: {
            in: snapshot.incidents.map((incident) => incident.externalId)
          }
        },
        select: {
          externalId: true
        }
      });
      const firstObservedIncidentIds = getFirstObservedIncidentIds(
        snapshot.incidents,
        existingIncidents.map((incident) => incident.externalId)
      );
      await persistProviderSnapshot(options.prisma, service.id, snapshot);
~~~

Pass firstObservedIncidentIds to createNotifications and extend that function with a final ReadonlySet<string> argument. Replace the top of its incident loop with this order so sent events are skipped and failed or skipped start events retain their original classification for retry:

~~~ts
    if (!service.slackEnabled) {
      continue;
    }

    const dedupeKey = buildNotificationDedupeKey(snapshot.service.provider, incident);
    const existing = await prisma.notificationEvent.findUnique({
      where: {
        dedupeKey
      }
    });

    if (existing?.slackStatus === "sent") {
      continue;
    }

    const eventType = getNotificationEventType(incident, {
      isFirstObservation:
        firstObservedIncidentIds.has(incident.externalId) ||
        existing?.eventType === "incident_started"
    });

    if (!shouldSendSlackNotification(incident, eventType)) {
      continue;
    }
~~~

Retain the existing persisted-incident lookup and notification upsert after this block. Remove the later duplicate dedupeKey, existing-event, sent-event, and eventType declarations. Resolved incidents created by buildResolvedMissingIncidents are not in the first-observation set and continue to classify as incident_resolved.

- [ ] **Step 5: Run notification and worker regression tests**

Run:

~~~sh
pnpm test -- tests/notifications.test.ts tests/worker-resolution.test.ts
pnpm typecheck
~~~

Expected: focused tests PASS and TypeScript reports no errors.

- [ ] **Step 6: Commit the first-observation behavior and spec clarification**

~~~sh
git add src/lib/status/notifications.ts src/lib/worker/check-services.ts tests/notifications.test.ts tests/worker-resolution.test.ts docs/superpowers/specs/2026-07-10-ai-provider-monitoring-design.md
git commit -m "Notify on first incident observation"
~~~

---

### Task 6: Full Verification and Safe Live Smoke Test

**Files:**
- No production file changes expected.

**Interfaces:**
- Verifies the complete provider fetch to normalized snapshot path.
- Verifies a worker run against a disposable SQLite database with Slack disabled.

- [ ] **Step 1: Run the complete automated suite**

Run:

~~~sh
pnpm test
pnpm typecheck
pnpm lint
pnpm build
~~~

Expected:

- Vitest reports all test files and tests passing.
- tsc exits 0.
- ESLint exits 0.
- Next.js completes its production build and route generation.

- [ ] **Step 2: Smoke-test the three public sources without persistence**

Run this through Node 22 and the project tsx binary:

~~~sh
pnpm exec tsx -e 'import { defaultMonitoredServices } from "./src/lib/status/default-services.ts"; import { fetchDefaultProviderSnapshot } from "./src/lib/status/fetch-provider.ts"; const selected = defaultMonitoredServices.filter((service) => ["openai", "claude", "gemini"].includes(service.provider)); Promise.all(selected.map((service) => fetchDefaultProviderSnapshot(service))).then((results) => console.log(results.map((snapshot) => ({ provider: snapshot.service.provider, status: snapshot.overallStatus, components: snapshot.components.length, incidents: snapshot.incidents.length }))));'
~~~

Expected: three result objects. OpenAI contains no FedRAMP, Ads Manager, or Ads API component; Claude contains no Claude for Government component; Gemini returns exactly one component.

- [ ] **Step 3: Create a disposable database**

Run:

~~~sh
DATABASE_URL="file:/private/tmp/service-alert-ai-provider-smoke.db" pnpm db:push
~~~

Expected: Prisma reports the SQLite database is in sync.

- [ ] **Step 4: Run the worker with Slack explicitly disabled**

Run:

~~~sh
DATABASE_URL="file:/private/tmp/service-alert-ai-provider-smoke.db" SLACK_WEBHOOK_URL="" pnpm worker:check
~~~

Expected when all public endpoints respond: service-alert worker SUCCESS: checked=10 failed=0. A transient provider outage may produce PARTIAL_FAILURE; inspect WorkerRun.errorMessage and distinguish an external HTTP failure from parser failure.

- [ ] **Step 5: Inspect the disposable database**

Run:

~~~sh
sqlite3 -header -column /private/tmp/service-alert-ai-provider-smoke.db 'SELECT name, provider, enabled, slackEnabled FROM MonitoredService ORDER BY name;'
~~~

Expected: ten rows including OpenAI/openai, Claude/claude, and Gemini/gemini, all enabled with Slack configuration enabled in service metadata. No real Slack request was made because SLACK_WEBHOOK_URL was an explicitly empty environment value.

- [ ] **Step 6: Confirm repository state**

Run:

~~~sh
git status --short
git log -6 --oneline
~~~

Expected: no uncommitted implementation changes and one focused commit for each implementation task.
