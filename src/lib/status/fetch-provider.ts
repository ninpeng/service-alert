import { awsNotificationRegions, findDefaultService } from "./default-services";
import { fetchAwsRss } from "./adapters/aws";
import { fetchSlackCurrentStatus } from "./adapters/slack";
import { fetchStatuspageSummary } from "./adapters/statuspage";
import type { MonitoredServiceConfig, ProviderId, ProviderSnapshot } from "./types";

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
        provider: service.provider as ProviderId,
        serviceName: service.name,
        endpoint: service.endpoint
      },
      fetchImpl
    );
  }

  if (service.providerKind === "slack-status") {
    return fetchSlackCurrentStatus(service.endpoint, fetchImpl);
  }

  return fetchAwsRss(service.endpoint, awsNotificationRegions, fetchImpl);
}
