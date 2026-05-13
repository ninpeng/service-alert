import type { MonitoredServiceConfig } from "./types";

export const awsNotificationRegions = ["ap-northeast-2", "us-east-1", "us-east-2", "us-west-1", "us-west-2"];

export const defaultMonitoredServices: MonitoredServiceConfig[] = [
  {
    name: "JIRA",
    provider: "jira",
    providerKind: "statuspage",
    endpoint: "https://jira-software.status.atlassian.com/api/v2/summary.json",
    enabled: true,
    slackEnabled: true
  },
  {
    name: "Bitbucket",
    provider: "bitbucket",
    providerKind: "statuspage",
    endpoint: "https://status.bitbucket.org/api/v2/summary.json",
    enabled: true,
    slackEnabled: true
  },
  {
    name: "Slack",
    provider: "slack",
    providerKind: "slack-status",
    endpoint: "https://slack-status.com/api/v2.0.0/current",
    enabled: true,
    slackEnabled: true
  },
  {
    name: "Vercel",
    provider: "vercel",
    providerKind: "statuspage",
    endpoint: "https://www.vercel-status.com/api/v2/summary.json",
    enabled: true,
    slackEnabled: true
  },
  {
    name: "AWS",
    provider: "aws",
    providerKind: "aws-rss",
    endpoint: "https://status.aws.amazon.com/rss/all.rss",
    enabled: true,
    slackEnabled: true
  },
  {
    name: "Notion",
    provider: "notion",
    providerKind: "statuspage",
    endpoint: "https://www.notion-status.com/api/v2/summary.json",
    enabled: true,
    slackEnabled: true
  },
  {
    name: "Figma",
    provider: "figma",
    providerKind: "statuspage",
    endpoint: "https://status.figma.com/api/v2/summary.json",
    enabled: true,
    slackEnabled: true
  }
];

export function findDefaultService(provider: string) {
  return defaultMonitoredServices.find((service) => service.provider === provider);
}
