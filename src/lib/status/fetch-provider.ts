import { awsNotificationRegions, findDefaultService } from "./default-services";
import { fetchAwsRss } from "./adapters/aws";
import { fetchGoogleWorkspaceStatus } from "./adapters/google-workspace";
import { fetchSlackCurrentStatus } from "./adapters/slack";
import { fetchStatuspageSummary } from "./adapters/statuspage";
import type { MonitoredServiceConfig, ProviderSnapshot } from "./types";

export interface RuntimeServiceConfig {
  name: string;
  provider: string;
  endpoint: string;
}

export async function fetchProviderSnapshot(
  service: RuntimeServiceConfig,
  fetchImpl: typeof fetch = fetch
): Promise<ProviderSnapshot> {
  const defaultService = findDefaultService(service.provider);

  if (!defaultService) {
    throw new Error(`Unsupported provider: ${service.provider}`);
  }

  return fetchDefaultProviderSnapshot(
    {
      ...defaultService,
      name: service.name,
      endpoint: service.endpoint
    },
    fetchImpl
  );
}

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
