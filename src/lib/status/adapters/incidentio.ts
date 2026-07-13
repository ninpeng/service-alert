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
  const overallStatus = activeItems
    .filter((item) => !item.isMaintenance && item.isInScope)
    .map((item) => overallFromImpact(item.impact))
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
  monitoredComponents: ParsedAffectedComponent[];
  isInScope: boolean;
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
  const monitoredComponents = details.components.filter((component) =>
    context.sourceComponentNames.includes(component.name)
  );
  const isInScope = details.components.length === 0 || monitoredComponents.length > 0;

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
    impact: isInScope ? impactFromComponents(monitoredComponents) : null,
    url,
    occurredAt: parseOptionalDate(item.pubDate),
    isMaintenance:
      Boolean(url?.includes("/maintenance/")) || status.startsWith("maintenance_"),
    components: details.components,
    monitoredComponents,
    isInScope
  };
}

function parseDescription(description: string, serviceName: string) {
  const fragment = `<root>${escapeBareAmpersands(description)}</root>`;
  validateXml(fragment, `Invalid incident.io RSS for ${serviceName}`);

  const document = new XMLParser({ preserveOrder: true }).parse(fragment) as unknown;
  const siblings = orderedChildren(document, "root");
  const statusNode = siblings.find(
    (node) =>
      orderedTagName(node) === "b" && /^status\s*:/i.test(orderedText(node).trim())
  );
  const statusLabel = statusNode ? orderedText(statusNode).trim() : null;

  if (!statusLabel) {
    throw new Error(
      `Invalid incident.io RSS for ${serviceName}: missing item lifecycle status`
    );
  }

  const affectedComponentsLabel = siblings.findIndex(
    (node) =>
      orderedTagName(node) === "b" &&
      orderedText(node).trim().toLowerCase() === "affected components"
  );
  const affectedComponentsList = findFollowingAffectedComponentsList(
    siblings,
    affectedComponentsLabel
  );
  const components = (affectedComponentsList
    ? orderedChildren(affectedComponentsList, "ul").filter(
      (node) => orderedTagName(node) === "li"
    )
    : [])
    .map(orderedText)
    .filter(isString)
    .map(parseAffectedComponent)
    .filter((component): component is ParsedAffectedComponent => component !== null);

  return {
    status: statusLabel.slice(statusLabel.indexOf(":") + 1).trim(),
    components
  };
}

function findFollowingAffectedComponentsList(siblings: unknown[], labelIndex: number) {
  if (labelIndex < 0) {
    return null;
  }

  for (const sibling of siblings.slice(labelIndex + 1)) {
    const tagName = orderedTagName(sibling);

    if (tagName === "ul") {
      return sibling;
    }

    if (tagName !== "br" && tagName !== null) {
      return null;
    }
  }

  return null;
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
    for (const component of item.monitoredComponents) {
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
    shouldNotify: !item.isMaintenance && item.isInScope,
    raw: {
      ...item.source,
      parsedStatus: item.status,
      parsedComponents: item.components,
      parsedMonitoredComponents: item.monitoredComponents,
      isInScope: item.isInScope
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

function escapeBareAmpersands(value: string) {
  return value.replace(
    /&(?!#\d+;|#x[0-9a-fA-F]+;|[a-zA-Z][a-zA-Z0-9]*;)/g,
    "&amp;"
  );
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

function orderedChildren(value: unknown, tagName: string): unknown[] {
  const record = recordValue(value);
  const children = record?.[tagName];

  if (Array.isArray(children)) {
    return children;
  }

  if (!Array.isArray(value)) {
    return [];
  }

  for (const node of value) {
    const nodeRecord = recordValue(node);
    const nodeChildren = nodeRecord?.[tagName];

    if (Array.isArray(nodeChildren)) {
      return nodeChildren;
    }
  }

  return [];
}

function orderedTagName(value: unknown): string | null {
  const record = recordValue(value);

  if (!record) {
    return null;
  }

  return Object.keys(record).find((key) => key !== "#text") ?? null;
}

function orderedText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(orderedText).join("");
  }

  const record = recordValue(value);
  return record ? Object.values(record).map(orderedText).join("") : "";
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isString(value: string | null): value is string {
  return value !== null;
}
