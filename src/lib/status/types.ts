export type ProviderId = "jira" | "bitbucket" | "slack" | "vercel" | "aws" | "notion" | "figma";

export type ProviderKind = "statuspage" | "slack-status" | "aws-rss";

export type OverallStatus = "none" | "minor" | "major" | "critical" | "unknown";

export type NotificationEventType = "incident_started" | "incident_update" | "incident_resolved";

export type SlackDeliveryStatus = "sent" | "skipped" | "failed";

export interface MonitoredServiceConfig {
  name: string;
  provider: ProviderId;
  providerKind: ProviderKind;
  endpoint: string;
  enabled: boolean;
  slackEnabled: boolean;
}

export interface NormalizedComponent {
  externalId: string;
  name: string;
  status: string;
  updatedAt: Date | null;
}

export interface NormalizedIncident {
  externalId: string;
  title: string;
  status: string;
  impact: string | null;
  url: string | null;
  startedAt: Date | null;
  updatedAt: Date | null;
  resolvedAt: Date | null;
  isMaintenance: boolean;
  shouldNotify: boolean;
  raw: unknown;
}

export interface ProviderSnapshot {
  service: {
    provider: ProviderId;
    name: string;
    endpoint: string;
  };
  overallStatus: OverallStatus;
  checkedAt: Date;
  components: NormalizedComponent[];
  incidents: NormalizedIncident[];
}
