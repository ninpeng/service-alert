# Didit Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Didit as the eleventh monitored service, using its official incident.io RSS feed to track Core APIs, Business Console, and Hosted Verification Web App.

**Architecture:** Add a reusable `incidentio-rss` provider kind and adapter that parses the RSS document plus the structured HTML fragment in each item's CDATA description. Didit's three configured components start operational, active feed items overlay their published states, resolved history is omitted, and the existing worker owns persistence, notification deduplication, and missing-incident recovery.

**Tech Stack:** TypeScript, Next.js 16, Vitest, Prisma/SQLite, `fast-xml-parser`, Node.js 22.22.0, pnpm.

## Global Constraints

- Monitor exactly one Didit service with `Core APIs`, `Business Console`, and `Hosted Verification Web App`.
- Poll `https://status.didit.me/feed.rss`; do not scrape the rendered Next.js page.
- Add no dependency, database migration, UI-specific path, secret, or authenticated request.
- Maintenance must not degrade overall status or send Slack notifications.
- Resolved feed history must not become an active incident or first-run notification.
- Keep all existing ten provider behaviors unchanged.
- Use Node.js `v22.22.0` for every command.
- New commit subjects must be Korean conventional-commit messages without a `NO-JIRA` prefix.

## File Map

- Create `src/lib/status/adapters/incidentio.ts`: incident.io RSS fetch, validation, parsing, component overlay, and normalization.
- Create `tests/incidentio-rss.test.ts`: adapter fixtures and parser/fetch behavior.
- Modify `src/lib/status/types.ts`: `didit`, `incidentio-rss`, and `sourceComponentNames` configuration types.
- Modify `src/lib/status/default-services.ts`: Didit default service and its three canonical component names.
- Modify `src/lib/status/fetch-provider.ts`: explicit incident.io dispatch and explicit AWS fallback.
- Modify `tests/default-services.test.ts`: eleven-service configuration and seed assertions.
- Modify `tests/fetch-provider.test.ts`: Didit runtime dispatch and missing-component-config failure.
- Modify `tests/worker-resolution.test.ts`: Didit missing-incident recovery assertion.
- Modify `README.md`: document the Didit RSS source and component scope.

---

### Task 1: Didit Provider Configuration

**Files:**
- Modify: `src/lib/status/types.ts`
- Modify: `src/lib/status/default-services.ts`
- Test: `tests/default-services.test.ts`

**Interfaces:**
- Produces: `ProviderId` value `didit`.
- Produces: `ProviderKind` value `incidentio-rss`.
- Produces: `MonitoredServiceConfig.sourceComponentNames?: readonly string[]`.
- Produces: `findDefaultService("didit")` with the official RSS endpoint and three component names.

- [ ] **Step 1: Write the failing default-service assertions**

Update the first test and seeding count in `tests/default-services.test.ts`:

```ts
it("defines eleven services with the approved source filters", () => {
  expect(defaultMonitoredServices).toHaveLength(11);
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
  expect(findDefaultService("didit")).toMatchObject({
    name: "Didit",
    providerKind: "incidentio-rss",
    endpoint: "https://status.didit.me/feed.rss",
    sourceComponentNames: [
      "Core APIs",
      "Business Console",
      "Hosted Verification Web App"
    ]
  });
});

expect(upsert).toHaveBeenCalledTimes(11);
expect(upsert.mock.calls.map(([input]) => input.where.name)).toEqual(
  expect.arrayContaining(["OpenAI", "Claude", "Gemini", "Didit"])
);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```sh
pnpm test tests/default-services.test.ts
```

Expected: FAIL because only ten defaults exist and `didit` is not a valid provider.

- [ ] **Step 3: Add the provider and default configuration**

Extend `src/lib/status/types.ts`:

```ts
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
  | "gemini"
  | "didit";

export type ProviderKind =
  | "statuspage"
  | "slack-status"
  | "aws-rss"
  | "google-workspace"
  | "incidentio-rss";

export interface MonitoredServiceConfig {
  name: string;
  provider: ProviderId;
  providerKind: ProviderKind;
  endpoint: string;
  enabled: boolean;
  slackEnabled: boolean;
  excludedComponentNames?: readonly string[];
  sourceServiceName?: string;
  sourceComponentNames?: readonly string[];
}
```

Append this object to `defaultMonitoredServices` in `src/lib/status/default-services.ts`:

```ts
{
  name: "Didit",
  provider: "didit",
  providerKind: "incidentio-rss",
  endpoint: "https://status.didit.me/feed.rss",
  enabled: true,
  slackEnabled: true,
  sourceComponentNames: [
    "Core APIs",
    "Business Console",
    "Hosted Verification Web App"
  ]
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `pnpm test tests/default-services.test.ts`

Expected: 2 tests pass and the upsert mock is called 11 times.

- [ ] **Step 5: Commit the configuration**

```sh
git add src/lib/status/types.ts src/lib/status/default-services.ts tests/default-services.test.ts
git commit -m "feat: Didit 기본 서비스 설정 추가"
```

---

### Task 2: incident.io RSS Adapter

**Files:**
- Create: `src/lib/status/adapters/incidentio.ts`
- Create: `tests/incidentio-rss.test.ts`

**Interfaces:**
- Consumes: `ProviderId`, `ProviderSnapshot`, and the three component names from Task 1.
- Produces: `parseIncidentIoRss(xml: string, context: IncidentIoRssContext): ProviderSnapshot`.
- Produces: `fetchIncidentIoRss(endpoint: string, context: IncidentIoRssContext, fetchImpl?: typeof fetch): Promise<ProviderSnapshot>`.

- [ ] **Step 1: Create failing RSS parser and fetch tests**

Create `tests/incidentio-rss.test.ts` with a context and RSS fixture builder:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  fetchIncidentIoRss,
  parseIncidentIoRss
} from "@/lib/status/adapters/incidentio";

const context = {
  provider: "didit" as const,
  serviceName: "Didit",
  endpoint: "https://status.didit.me/feed.rss",
  sourceComponentNames: [
    "Core APIs",
    "Business Console",
    "Hosted Verification Web App"
  ]
};

function item(input: {
  guid: string;
  link?: string;
  title: string;
  status: string;
  components?: string[];
  pubDate?: string;
}) {
  const components = input.components?.length
    ? `<br/><br/><b>Affected components</b><ul>${input.components
        .map((component) => `<li>${component}</li>`)
        .join("")}</ul>`
    : "";

  return `<item>
    <title><![CDATA[${input.title}]]></title>
    <link>${input.link ?? `https://status.didit.me/incidents/${input.guid}`}</link>
    <guid>${input.guid}</guid>
    <pubDate>${input.pubDate ?? "Mon, 13 Jul 2026 09:30:00 GMT"}</pubDate>
    <description><![CDATA[<b>Status: ${input.status}</b>${components}]]></description>
  </item>`;
}

function feed(items: string) {
  return `<?xml version="1.0" encoding="utf-8"?>
    <rss version="2.0"><channel>
      <title>Didit status</title>
      <link>https://status.didit.me/</link>
      <lastBuildDate>Mon, 13 Jul 2026 09:35:00 GMT</lastBuildDate>
      ${items}
    </channel></rss>`;
}
```

Add tests that assert these complete behaviors:

```ts
it("keeps all three components healthy and excludes resolved history", () => {
  const snapshot = parseIncidentIoRss(
    feed(item({
      guid: "resolved-1",
      title: "Previous incident",
      status: "Resolved",
      components: [
        "Core APIs (Operational)",
        "Business Console (Operational)",
        "Hosted Verification Web App (Operational)"
      ]
    })),
    context
  );

  expect(snapshot.overallStatus).toBe("none");
  expect(snapshot.incidents).toEqual([]);
  expect(snapshot.components).toMatchObject([
    { externalId: "didit:core-apis", name: "Core APIs", status: "operational" },
    { externalId: "didit:business-console", name: "Business Console", status: "operational" },
    {
      externalId: "didit:hosted-verification-web-app",
      name: "Hosted Verification Web App",
      status: "operational"
    }
  ]);
});

it("normalizes active incidents and applies the most severe component state", () => {
  const snapshot = parseIncidentIoRss(
    feed(
      item({
        guid: "active-1",
        title: "API degradation",
        status: "Investigating",
        components: ["Core APIs (Partial outage)"]
      }) +
      item({
        guid: "active-2",
        title: "API outage",
        status: "Monitoring",
        components: [
          "Core APIs (Full outage)",
          "Business Console (Degraded performance)"
        ]
      })
    ),
    context
  );

  expect(snapshot.overallStatus).toBe("critical");
  expect(snapshot.components).toMatchObject([
    { name: "Core APIs", status: "major_outage" },
    { name: "Business Console", status: "degraded_performance" },
    { name: "Hosted Verification Web App", status: "operational" }
  ]);
  expect(snapshot.incidents).toMatchObject([
    {
      externalId: "active-1",
      title: "API degradation",
      status: "investigating",
      impact: "major",
      url: "https://status.didit.me/incidents/active-1",
      startedAt: new Date("2026-07-13T09:30:00.000Z"),
      updatedAt: new Date("2026-07-13T09:30:00.000Z"),
      resolvedAt: null,
      isMaintenance: false,
      shouldNotify: true
    },
    {
      externalId: "active-2",
      status: "monitoring",
      impact: "critical"
    }
  ]);
});

it("reports unknown active impact honestly and suppresses maintenance notifications", () => {
  const snapshot = parseIncidentIoRss(
    feed(
      item({
        guid: "unknown-1",
        title: "Provider investigation",
        status: "Investigating",
        components: ["Hosted Verification Web App (Delayed)"]
      }) +
      item({
        guid: "maintenance-1",
        link: "https://status.didit.me/maintenance/maintenance-1",
        title: "Database maintenance",
        status: "Maintenance in progress",
        components: ["Business Console (Partial outage)"]
      })
    ),
    context
  );

  expect(snapshot.overallStatus).toBe("unknown");
  expect(snapshot.components).toContainEqual(
    expect.objectContaining({
      name: "Hosted Verification Web App",
      status: "unknown"
    })
  );
  expect(snapshot.incidents).toMatchObject([
    { externalId: "unknown-1", impact: null, isMaintenance: false, shouldNotify: true },
    { externalId: "maintenance-1", isMaintenance: true, shouldNotify: false }
  ]);
});

it("rejects invalid RSS and non-success responses", async () => {
  expect(() => parseIncidentIoRss("<rss>", context)).toThrow(
    "Invalid incident.io RSS for Didit"
  );

  const fetchImpl = vi.fn().mockResolvedValue(
    new Response("unavailable", { status: 503, statusText: "Service Unavailable" })
  );

  await expect(
    fetchIncidentIoRss(context.endpoint, context, fetchImpl)
  ).rejects.toThrow(
    "incident.io RSS request failed for Didit: 503 Service Unavailable"
  );
});
```

- [ ] **Step 2: Run the adapter tests and verify RED**

Run: `pnpm test tests/incidentio-rss.test.ts`

Expected: FAIL because `@/lib/status/adapters/incidentio` does not exist.

- [ ] **Step 3: Implement the adapter**

Create `src/lib/status/adapters/incidentio.ts` with this implementation:

```ts
import { XMLParser, XMLValidator } from "fast-xml-parser";
import type {
  NormalizedComponent,
  NormalizedIncident,
  OverallStatus,
  ProviderId,
  ProviderSnapshot
} from "../types";

export interface IncidentIoRssContext {
  provider: ProviderId;
  serviceName: string;
  endpoint: string;
  sourceComponentNames: readonly string[];
}

export function parseIncidentIoRss(
  xml: string,
  context: IncidentIoRssContext
): ProviderSnapshot;

export async function fetchIncidentIoRss(
  endpoint: string,
  context: IncidentIoRssContext,
  fetchImpl: typeof fetch = fetch
): Promise<ProviderSnapshot> {
  const response = await fetchImpl(endpoint, {
    headers: {
      accept: "application/rss+xml, application/xml, text/xml"
    }
  });

  if (!response.ok) {
    throw new Error(
      `incident.io RSS request failed for ${context.serviceName}: ${response.status} ${response.statusText}`
    );
  }

  return parseIncidentIoRss(await response.text(), context);
}

interface IncidentIoRssDocument {
  rss?: {
    channel?: IncidentIoRssChannel;
  };
}

interface IncidentIoRssChannel {
  item?: IncidentIoRssItem | IncidentIoRssItem[];
}

interface IncidentIoRssItem {
  title?: unknown;
  link?: unknown;
  guid?: unknown;
  pubDate?: unknown;
  description?: unknown;
  "content:encoded"?: unknown;
}

interface ParsedAffectedComponent {
  name: string;
  sourceStatus: string;
  status: string;
}

interface ParsedFeedItem {
  source: IncidentIoRssItem;
  externalId: string;
  title: string;
  status: string;
  impact: string | null;
  url: string | null;
  occurredAt: Date | null;
  isMaintenance: boolean;
  components: ParsedAffectedComponent[];
}

const terminalStatuses = new Set([
  "resolved",
  "completed",
  "complete",
  "maintenance_complete"
]);

const componentRanks: Record<string, number> = {
  operational: 0,
  unknown: 1,
  degraded_performance: 2,
  partial_outage: 3,
  major_outage: 4
};

const overallRanks: Record<OverallStatus, number> = {
  none: 0,
  unknown: 1,
  minor: 2,
  major: 3,
  critical: 4
};

export function parseIncidentIoRss(
  xml: string,
  context: IncidentIoRssContext
): ProviderSnapshot {
  validateXml(xml, `Invalid incident.io RSS for ${context.serviceName}`);

  const document = new XMLParser().parse(xml) as IncidentIoRssDocument;
  const channel = document.rss?.channel;

  if (!channel) {
    throw new Error(`Invalid incident.io RSS for ${context.serviceName}: missing rss.channel`);
  }

  const sourceItems = Array.isArray(channel.item)
    ? channel.item
    : channel.item
      ? [channel.item]
      : [];
  const activeItems = sourceItems
    .map((item) => parseFeedItem(item, context))
    .filter((item) => !terminalStatuses.has(item.status));
  const components = buildComponents(activeItems, context);
  const incidents = activeItems.map(normalizeIncident);
  const overallStatus = incidents
    .filter((incident) => !incident.isMaintenance)
    .map((incident) => overallFromImpact(incident.impact))
    .reduce(moreSevereOverall, "none");

  return {
    service: {
      provider: context.provider,
      name: context.serviceName,
      endpoint: context.endpoint
    },
    overallStatus,
    checkedAt: new Date(),
    components,
    incidents
  };
}

function parseFeedItem(
  item: IncidentIoRssItem,
  context: IncidentIoRssContext
): ParsedFeedItem {
  const url = textValue(item.link);
  const externalId = textValue(item.guid) ?? url;

  if (!externalId) {
    throw new Error(
      `Invalid incident.io RSS for ${context.serviceName}: missing item guid and link`
    );
  }

  const description = textValue(item.description) ?? textValue(item["content:encoded"]);

  if (!description) {
    throw new Error(
      `Invalid incident.io RSS for ${context.serviceName}: missing item description`
    );
  }

  const details = parseDescription(description, context.serviceName);
  const status = normalizeToken(details.status);

  if (!status) {
    throw new Error(
      `Invalid incident.io RSS for ${context.serviceName}: missing item lifecycle status`
    );
  }

  return {
    source: item,
    externalId,
    title: textValue(item.title) ?? `${context.serviceName} status event`,
    status,
    impact: impactFromComponents(details.components),
    url,
    occurredAt: parseOptionalDate(item.pubDate),
    isMaintenance:
      Boolean(url?.includes("/maintenance/")) || status.startsWith("maintenance_"),
    components: details.components
  };
}

function parseDescription(description: string, serviceName: string) {
  const fragment = `<root>${description}</root>`;
  validateXml(fragment, `Invalid incident.io RSS for ${serviceName}`);

  const document = new XMLParser({
    isArray: (_tagName, jPath) => jPath === "root.b" || jPath === "root.ul.li"
  }).parse(fragment) as { root?: unknown };
  const root = recordValue(document.root);
  const labels = arrayValue(root?.b).map(textValue).filter(isString);
  const statusLabel = labels.find((label) => label.toLowerCase().startsWith("status:"));

  if (!statusLabel) {
    throw new Error(
      `Invalid incident.io RSS for ${serviceName}: missing item lifecycle status`
    );
  }

  const list = recordValue(root?.ul);
  const components = arrayValue(list?.li)
    .map(textValue)
    .filter(isString)
    .map(parseAffectedComponent)
    .filter((component): component is ParsedAffectedComponent => component !== null);

  return {
    status: statusLabel.slice(statusLabel.indexOf(":") + 1).trim(),
    components
  };
}

function parseAffectedComponent(value: string): ParsedAffectedComponent | null {
  const match = /^(.*)\s+\(([^()]*)\)$/.exec(value.trim());

  if (!match) {
    return null;
  }

  const name = match[1].trim();
  const sourceStatus = match[2].trim();

  return {
    name,
    sourceStatus,
    status: normalizeComponentStatus(sourceStatus)
  };
}

function buildComponents(
  items: ParsedFeedItem[],
  context: IncidentIoRssContext
): NormalizedComponent[] {
  const states = new Map(
    context.sourceComponentNames.map((name) => [
      name,
      { status: "operational", updatedAt: null as Date | null }
    ])
  );

  for (const item of items) {
    for (const component of item.components) {
      const current = states.get(component.name);

      if (!current) {
        continue;
      }

      const nextRank = componentRanks[component.status] ?? componentRanks.unknown;
      const currentRank = componentRanks[current.status] ?? componentRanks.unknown;

      if (nextRank > currentRank) {
        states.set(component.name, {
          status: component.status,
          updatedAt: item.occurredAt
        });
      } else if (nextRank === currentRank && isLater(item.occurredAt, current.updatedAt)) {
        current.updatedAt = item.occurredAt;
      }
    }
  }

  return context.sourceComponentNames.map((name) => {
    const state = states.get(name) ?? { status: "unknown", updatedAt: null };

    return {
      externalId: `${context.provider}:${slugify(name)}`,
      name,
      status: state.status,
      updatedAt: state.updatedAt
    };
  });
}

function normalizeIncident(item: ParsedFeedItem): NormalizedIncident {
  return {
    externalId: item.externalId,
    title: item.title,
    status: item.status,
    impact: item.impact,
    url: item.url,
    startedAt: item.occurredAt,
    updatedAt: item.occurredAt,
    resolvedAt: null,
    isMaintenance: item.isMaintenance,
    shouldNotify: !item.isMaintenance,
    raw: {
      ...item.source,
      parsedStatus: item.status,
      parsedComponents: item.components
    }
  };
}

function normalizeComponentStatus(value: string) {
  const statuses: Record<string, string> = {
    operational: "operational",
    degraded_performance: "degraded_performance",
    partial_outage: "partial_outage",
    full_outage: "major_outage",
    major_outage: "major_outage"
  };

  return statuses[normalizeToken(value)] ?? "unknown";
}

function impactFromComponents(components: ParsedAffectedComponent[]) {
  if (components.length === 0) {
    return null;
  }

  const overall = components
    .map((component) => overallFromComponent(component.status))
    .reduce(moreSevereOverall, "none");

  return overall === "unknown" ? null : overall;
}

function overallFromComponent(status: string): OverallStatus {
  const statuses: Record<string, OverallStatus> = {
    operational: "none",
    degraded_performance: "minor",
    partial_outage: "major",
    major_outage: "critical"
  };

  return statuses[status] ?? "unknown";
}

function overallFromImpact(impact: string | null): OverallStatus {
  if (impact === "none" || impact === "minor" || impact === "major" || impact === "critical") {
    return impact;
  }

  return "unknown";
}

function moreSevereOverall(left: OverallStatus, right: OverallStatus): OverallStatus {
  return overallRanks[right] > overallRanks[left] ? right : left;
}

function normalizeToken(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function validateXml(xml: string, prefix: string) {
  const result = XMLValidator.validate(xml);

  if (result !== true) {
    throw new Error(`${prefix}: ${result.err.msg}`);
  }
}

function parseOptionalDate(value: unknown) {
  const text = textValue(value);

  if (!text) {
    return null;
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isLater(candidate: Date | null, current: Date | null) {
  return Boolean(candidate && (!current || candidate.getTime() > current.getTime()));
}

function textValue(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    return String(value);
  }

  const record = recordValue(value);
  return typeof record?.["#text"] === "string" ? record["#text"] : null;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
}

function isString(value: string | null): value is string {
  return value !== null;
}
```

- [ ] **Step 4: Run adapter tests and type checking**

Run:

```sh
pnpm test tests/incidentio-rss.test.ts
pnpm typecheck
```

Expected: 4 adapter tests pass and TypeScript exits with status 0.

- [ ] **Step 5: Commit the adapter**

```sh
git add src/lib/status/adapters/incidentio.ts tests/incidentio-rss.test.ts
git commit -m "feat: incident.io RSS 어댑터 추가"
```

---

### Task 3: Provider Dispatch And Recovery

**Files:**
- Modify: `src/lib/status/fetch-provider.ts`
- Test: `tests/fetch-provider.test.ts`
- Test: `tests/worker-resolution.test.ts`

**Interfaces:**
- Consumes: `fetchIncidentIoRss` and `MonitoredServiceConfig.sourceComponentNames`.
- Produces: runtime dispatch from persisted provider `didit` to `incidentio-rss`.
- Preserves: `buildResolvedMissingIncidents` resolves Didit because only AWS RSS is exempt.

- [ ] **Step 1: Write failing dispatch and recovery tests**

Add to `tests/fetch-provider.test.ts`:

```ts
it("dispatches Didit to the incident.io RSS adapter", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(
    new Response(
      `<?xml version="1.0"?><rss><channel><title>Didit status</title></channel></rss>`,
      { status: 200 }
    )
  );

  const snapshot = await fetchProviderSnapshot(
    {
      name: "Didit",
      provider: "didit",
      endpoint: "https://status.didit.me/feed.rss"
    },
    fetchImpl
  );

  expect(snapshot.service.provider).toBe("didit");
  expect(snapshot.components).toMatchObject([
    { externalId: "didit:core-apis", status: "operational" },
    { externalId: "didit:business-console", status: "operational" },
    { externalId: "didit:hosted-verification-web-app", status: "operational" }
  ]);
});

it("rejects incident.io RSS config without source components", async () => {
  await expect(
    fetchDefaultProviderSnapshot({
      name: "Didit",
      provider: "didit",
      providerKind: "incidentio-rss",
      endpoint: "https://status.didit.me/feed.rss",
      enabled: true,
      slackEnabled: true
    })
  ).rejects.toThrow("Missing incident.io component config for Didit");
});
```

Add a Didit case to `tests/worker-resolution.test.ts` using the existing stored-incident shape:

```ts
it("resolves a Didit incident when the RSS feed no longer returns it", () => {
  const diditSnapshot: ProviderSnapshot = {
    ...snapshot,
    service: {
      provider: "didit",
      name: "Didit",
      endpoint: "https://status.didit.me/feed.rss"
    }
  };
  const resolved = buildResolvedMissingIncidents(diditSnapshot, [
    {
      externalId: "didit-active",
      title: "Didit outage",
      status: "investigating",
      impact: "major",
      url: "https://status.didit.me/incidents/didit-active",
      startedAt: new Date("2026-07-13T00:00:00Z"),
      updatedAt: new Date("2026-07-13T00:10:00Z"),
      resolvedAt: null,
      isMaintenance: false,
      shouldNotify: true,
      rawPayload: "{}"
    }
  ]);

  expect(resolved).toMatchObject([
    { externalId: "didit-active", status: "resolved", resolvedAt: checkedAt }
  ]);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```sh
pnpm test tests/fetch-provider.test.ts tests/worker-resolution.test.ts
```

Expected: the Didit dispatch tests fail because `fetch-provider.ts` has no `incidentio-rss` branch.

- [ ] **Step 3: Add explicit dispatch**

Import `fetchIncidentIoRss` in `src/lib/status/fetch-provider.ts`, then add this branch before AWS:

```ts
if (service.providerKind === "incidentio-rss") {
  if (!service.sourceComponentNames?.length) {
    throw new Error("Missing incident.io component config for " + service.name);
  }

  return fetchIncidentIoRss(
    service.endpoint,
    {
      provider: service.provider,
      serviceName: service.name,
      endpoint: service.endpoint,
      sourceComponentNames: service.sourceComponentNames
    },
    fetchImpl
  );
}

if (service.providerKind === "aws-rss") {
  return fetchAwsRss(service.endpoint, awsNotificationRegions, fetchImpl);
}

throw new Error(`Unsupported provider kind: ${service.providerKind}`);
```

Replace the current unconditional final AWS return with the explicit AWS branch and final error shown above.

- [ ] **Step 4: Run focused and full tests**

Run:

```sh
pnpm test tests/fetch-provider.test.ts tests/worker-resolution.test.ts
pnpm test
```

Expected: focused tests pass; the full suite reports 13 passing files and at least 53 passing tests.

- [ ] **Step 5: Commit dispatch and recovery coverage**

```sh
git add src/lib/status/fetch-provider.ts tests/fetch-provider.test.ts tests/worker-resolution.test.ts
git commit -m "feat: Didit RSS 수집 연결"
```

---

### Task 4: Documentation And End-to-End Verification

**Files:**
- Modify: `README.md`

**Interfaces:**
- Documents: the live Didit source and exact monitored component scope.
- Verifies: all eleven defaults seed and collect without Slack delivery in a disposable database.

- [ ] **Step 1: Document the source**

Add this item after Gemini in the README status-source list:

```md
- Didit: `https://status.didit.me/feed.rss` (`Core APIs`, `Business Console`, `Hosted Verification Web App` 포함)
```

- [ ] **Step 2: Commit documentation**

```sh
git add README.md
git commit -m "docs: Didit 상태 소스 문서화"
```

- [ ] **Step 3: Run the complete repository checks with Node 22**

Run:

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm build
git diff --check
git status --short --branch
```

Expected:

- 13 test files pass with no failed test.
- TypeScript exits with status 0.
- ESLint exits with no warning or error.
- Next.js production build succeeds.
- `git diff --check` prints nothing.
- The branch is clean.

- [ ] **Step 4: Verify the live RSS source**

Run:

```sh
pnpm tsx -e 'import { fetchIncidentIoRss } from "./src/lib/status/adapters/incidentio.ts"; void (async () => { const endpoint="https://status.didit.me/feed.rss"; const snapshot=await fetchIncidentIoRss(endpoint,{provider:"didit",serviceName:"Didit",endpoint,sourceComponentNames:["Core APIs","Business Console","Hosted Verification Web App"]}); console.log(JSON.stringify({provider:snapshot.service.provider,overallStatus:snapshot.overallStatus,components:snapshot.components.map(({name,status})=>({name,status})),activeIncidents:snapshot.incidents.length},null,2)); })();'
```

Expected: provider `didit`, exactly three named components, and a valid normalized overall status.

- [ ] **Step 5: Verify a disposable worker run with Slack disabled**

Run with a unique temporary database path:

```sh
env DATABASE_URL=file:/private/tmp/service-alert-didit-smoke.db pnpm prisma db push --skip-generate
env DATABASE_URL=file:/private/tmp/service-alert-didit-smoke.db SLACK_WEBHOOK_URL= pnpm worker:check
```

Expected: `SUCCESS: checked=11 failed=0`. No production database or Slack webhook is used.

- [ ] **Step 6: Review branch scope**

Run:

```sh
git log --oneline main..HEAD
git diff --stat main...HEAD
```

Expected: one design commit plus focused Didit configuration, adapter, dispatch/tests, and documentation commits; no unrelated file changes.
