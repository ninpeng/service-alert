import type { PrismaClient } from "../../generated/prisma/client";
import { ensureDefaultServices } from "../db/seed-defaults";
import { buildSlackMessage, sendSlackWebhook } from "../slack/webhook";
import { fetchProviderSnapshot } from "../status/fetch-provider";
import {
  buildNotificationDedupeKey,
  getNotificationEventType,
  shouldSendSlackNotification
} from "../status/notifications";
import type { NormalizedIncident, ProviderSnapshot, SlackDeliveryStatus } from "../status/types";

interface RunServiceChecksOptions {
  prisma: PrismaClient;
  fetchImpl?: typeof fetch;
  slackWebhookUrl?: string;
}

interface ProviderFailure {
  service: string;
  message: string;
}

export async function runServiceChecks(options: RunServiceChecksOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const workerRun = await options.prisma.workerRun.create({
    data: {
      status: "RUNNING"
    }
  });
  const failures: ProviderFailure[] = [];
  let providersChecked = 0;

  await ensureDefaultServices(options.prisma);

  const services = await options.prisma.monitoredService.findMany({
    where: {
      enabled: true
    },
    orderBy: {
      name: "asc"
    }
  });

  for (const service of services) {
    try {
      const snapshot = await fetchProviderSnapshot(service, fetchImpl);
      await persistProviderSnapshot(options.prisma, service.id, snapshot);
      await createNotifications(options.prisma, service, snapshot, options.slackWebhookUrl);
      providersChecked += 1;
    } catch (error) {
      failures.push({
        service: service.name,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const status = failures.length === 0 ? "SUCCESS" : providersChecked === 0 ? "FAILED" : "PARTIAL_FAILURE";

  return options.prisma.workerRun.update({
    where: {
      id: workerRun.id
    },
    data: {
      status,
      finishedAt: new Date(),
      providersChecked,
      providersFailed: failures.length,
      errorMessage: failures.length > 0 ? JSON.stringify(failures) : null
    }
  });
}

async function persistProviderSnapshot(prisma: PrismaClient, serviceId: string, snapshot: ProviderSnapshot) {
  for (const component of snapshot.components) {
    await prisma.serviceComponent.upsert({
      where: {
        serviceId_externalId: {
          serviceId,
          externalId: component.externalId
        }
      },
      update: {
        name: component.name,
        status: component.status,
        updatedAt: component.updatedAt,
        checkedAt: snapshot.checkedAt
      },
      create: {
        serviceId,
        externalId: component.externalId,
        name: component.name,
        status: component.status,
        updatedAt: component.updatedAt,
        checkedAt: snapshot.checkedAt
      }
    });
  }

  for (const incident of snapshot.incidents) {
    await upsertIncident(prisma, serviceId, incident);
  }
}

async function upsertIncident(prisma: PrismaClient, serviceId: string, incident: NormalizedIncident) {
  return prisma.incident.upsert({
    where: {
      serviceId_externalId: {
        serviceId,
        externalId: incident.externalId
      }
    },
    update: {
      title: incident.title,
      status: incident.status,
      impact: incident.impact,
      url: incident.url,
      startedAt: incident.startedAt,
      updatedAt: incident.updatedAt,
      resolvedAt: incident.resolvedAt,
      isMaintenance: incident.isMaintenance,
      shouldNotify: incident.shouldNotify,
      rawPayload: JSON.stringify(incident.raw)
    },
    create: {
      serviceId,
      externalId: incident.externalId,
      title: incident.title,
      status: incident.status,
      impact: incident.impact,
      url: incident.url,
      startedAt: incident.startedAt,
      updatedAt: incident.updatedAt,
      resolvedAt: incident.resolvedAt,
      isMaintenance: incident.isMaintenance,
      shouldNotify: incident.shouldNotify,
      rawPayload: JSON.stringify(incident.raw)
    }
  });
}

async function createNotifications(
  prisma: PrismaClient,
  service: { id: string; name: string; provider: string; slackEnabled: boolean },
  snapshot: ProviderSnapshot,
  slackWebhookUrl: string | undefined
) {
  for (const incident of snapshot.incidents) {
    if (!service.slackEnabled || !shouldSendSlackNotification(incident)) {
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

    const persistedIncident = await prisma.incident.findUnique({
      where: {
        serviceId_externalId: {
          serviceId: service.id,
          externalId: incident.externalId
        }
      }
    });
    const eventType = getNotificationEventType(incident);
    const delivery = await deliverSlackNotification({
      webhookUrl: slackWebhookUrl,
      serviceName: service.name,
      provider: service.provider,
      incident,
      eventType
    });

    if (existing) {
      await prisma.notificationEvent.update({
        where: {
          id: existing.id
        },
        data: {
          incidentId: persistedIncident?.id,
          eventType,
          slackStatus: delivery.status,
          errorMessage: delivery.errorMessage
        }
      });
    } else {
      await prisma.notificationEvent.create({
        data: {
          serviceId: service.id,
          incidentId: persistedIncident?.id,
          dedupeKey,
          eventType,
          slackStatus: delivery.status,
          errorMessage: delivery.errorMessage
        }
      });
    }
  }
}

async function deliverSlackNotification(input: {
  webhookUrl: string | undefined;
  serviceName: string;
  provider: string;
  incident: NormalizedIncident;
  eventType: ReturnType<typeof getNotificationEventType>;
}): Promise<{ status: SlackDeliveryStatus; errorMessage: string | null }> {
  if (!input.webhookUrl) {
    return {
      status: "skipped",
      errorMessage: "SLACK_WEBHOOK_URL is not configured"
    };
  }

  try {
    await sendSlackWebhook(
      input.webhookUrl,
      buildSlackMessage({
        serviceName: input.serviceName,
        provider: input.provider,
        incident: input.incident,
        eventType: input.eventType
      })
    );

    return {
      status: "sent",
      errorMessage: null
    };
  } catch (error) {
    return {
      status: "failed",
      errorMessage: error instanceof Error ? error.message : String(error)
    };
  }
}
