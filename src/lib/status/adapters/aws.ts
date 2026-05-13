import { XMLParser } from "fast-xml-parser";
import type { NormalizedIncident, ProviderSnapshot } from "../types";

const awsRegionAliases: Record<string, string[]> = {
  "ap-northeast-2": ["ap-northeast-2", "seoul", "asia pacific (seoul)"],
  "us-east-1": ["us-east-1", "us east (n. virginia)", "n. virginia", "northern virginia"],
  "us-east-2": ["us-east-2", "us east (ohio)", "ohio"],
  "us-west-1": ["us-west-1", "us west (n. california)", "n. california", "northern california"],
  "us-west-2": ["us-west-2", "us west (oregon)", "oregon"]
};

interface AwsRssDocument {
  rss?: {
    channel?: {
      lastBuildDate?: string;
      item?: AwsRssItem | AwsRssItem[];
    };
  };
}

interface AwsRssItem {
  title?: unknown;
  link?: unknown;
  pubDate?: unknown;
  guid?: unknown;
  description?: unknown;
}

export function parseAwsRss(
  xml: string,
  notificationRegions: string[] = ["ap-northeast-2", "us-east-1", "us-east-2", "us-west-1", "us-west-2"]
): ProviderSnapshot {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: ""
  });
  const document = parser.parse(xml) as AwsRssDocument;
  const rawItems = document.rss?.channel?.item;
  const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];
  const incidents = items.map((item) => parseAwsItem(item, notificationRegions));

  return {
    service: {
      provider: "aws",
      name: "AWS",
      endpoint: "https://status.aws.amazon.com/rss/all.rss"
    },
    overallStatus: incidents.some((incident) => incident.shouldNotify) ? "major" : incidents.length > 0 ? "minor" : "none",
    checkedAt: new Date(),
    components: [
      {
        externalId: "aws-public-status",
        name: "AWS public status RSS",
        status: incidents.some((incident) => incident.shouldNotify) ? "degraded_performance" : "operational",
        updatedAt: parseOptionalDate(document.rss?.channel?.lastBuildDate)
      }
    ],
    incidents
  };
}

export async function fetchAwsRss(
  endpoint: string,
  notificationRegions: string[],
  fetchImpl: typeof fetch = fetch
): Promise<ProviderSnapshot> {
  const response = await fetchImpl(endpoint, {
    headers: {
      accept: "application/rss+xml, application/xml, text/xml"
    }
  });

  if (!response.ok) {
    throw new Error(`AWS RSS request failed: ${response.status} ${response.statusText}`);
  }

  return parseAwsRss(await response.text(), notificationRegions);
}

export function shouldIncludeAwsIncident(text: string, notificationRegions: string[]) {
  const haystack = text.toLowerCase();

  return notificationRegions.some((region) => {
    const aliases = awsRegionAliases[region] ?? [region];
    return aliases.some((alias) => haystack.includes(alias.toLowerCase()));
  });
}

function parseAwsItem(item: AwsRssItem, notificationRegions: string[]): NormalizedIncident {
  const title = textValue(item.title) ?? "AWS service event";
  const description = textValue(item.description) ?? "";
  const guid = textValue(item.guid) ?? `${title}:${textValue(item.pubDate) ?? ""}`;
  const searchable = [title, description, guid].join(" ");

  return {
    externalId: guid,
    title,
    status: "update",
    impact: parseAwsImpact(title),
    url: textValue(item.link) ?? "https://status.aws.amazon.com/",
    startedAt: parseOptionalDate(item.pubDate),
    updatedAt: parseOptionalDate(item.pubDate),
    resolvedAt: null,
    isMaintenance: false,
    shouldNotify: shouldIncludeAwsIncident(searchable, notificationRegions),
    raw: item
  };
}

function parseAwsImpact(title: string) {
  const normalized = title.toLowerCase();

  if (normalized.includes("disruption") || normalized.includes("outage")) {
    return "major";
  }

  if (normalized.includes("degradation") || normalized.includes("impact")) {
    return "minor";
  }

  return "none";
}

function parseOptionalDate(value: unknown): Date | null {
  const text = textValue(value);

  if (!text) {
    return null;
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function textValue(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (value && typeof value === "object" && "#text" in value && typeof value["#text"] === "string") {
    return value["#text"];
  }

  return null;
}
