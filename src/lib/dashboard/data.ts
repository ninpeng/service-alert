import { prisma } from "../db/prisma";
import { ensureDefaultServices } from "../db/seed-defaults";
import { getLatestDataUpdatedAt, summarizeDashboardStatus } from "./summary";

export async function getDashboardData() {
  await ensureDefaultServices(prisma);

  const [services, workerRuns, notifications] = await Promise.all([
    prisma.monitoredService.findMany({
      include: {
        components: {
          orderBy: {
            name: "asc"
          }
        },
        incidents: {
          orderBy: [
            {
              updatedAt: "desc"
            },
            {
              firstSeenAt: "desc"
            }
          ],
          take: 6
        }
      },
      orderBy: {
        name: "asc"
      }
    }),
    prisma.workerRun.findMany({
      orderBy: {
        startedAt: "desc"
      },
      take: 5
    }),
    prisma.notificationEvent.findMany({
      include: {
        service: true,
        incident: true
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 8
    })
  ]);

  return {
    generatedAt: new Date().toISOString(),
    dataUpdatedAt: getLatestDataUpdatedAt({ services, workerRuns })?.toISOString() ?? null,
    services: services.map((service) => ({
      id: service.id,
      name: service.name,
      provider: service.provider,
      endpoint: service.endpoint,
      enabled: service.enabled,
      slackEnabled: service.slackEnabled,
      status: summarizeDashboardStatus({
        components: service.components,
        incidents: service.incidents
      }),
      components: service.components.map((component) => ({
        id: component.id,
        name: component.name,
        status: component.status,
        updatedAt: component.updatedAt?.toISOString() ?? null,
        checkedAt: component.checkedAt.toISOString()
      })),
      incidents: service.incidents.map((incident) => ({
        id: incident.id,
        externalId: incident.externalId,
        title: incident.title,
        status: incident.status,
        impact: incident.impact,
        url: incident.url,
        startedAt: incident.startedAt?.toISOString() ?? null,
        updatedAt: incident.updatedAt?.toISOString() ?? null,
        lastSeenAt: incident.lastSeenAt.toISOString(),
        resolvedAt: incident.resolvedAt?.toISOString() ?? null,
        isMaintenance: incident.isMaintenance,
        shouldNotify: incident.shouldNotify
      }))
    })),
    workerRuns: workerRuns.map((run) => ({
      id: run.id,
      status: run.status,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
      providersChecked: run.providersChecked,
      providersFailed: run.providersFailed,
      errorMessage: run.errorMessage
    })),
    notifications: notifications.map((notification) => ({
      id: notification.id,
      serviceName: notification.service.name,
      eventType: notification.eventType,
      slackStatus: notification.slackStatus,
      incidentTitle: notification.incident?.title ?? null,
      errorMessage: notification.errorMessage,
      createdAt: notification.createdAt.toISOString()
    }))
  };
}

export type DashboardData = Awaited<ReturnType<typeof getDashboardData>>;
