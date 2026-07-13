import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import type {
  NormalizedIncident,
  NotificationEventType,
  ProviderSnapshot,
  SlackDeliveryStatus
} from "@/lib/status/types";
import { buildNotificationDedupeKey } from "@/lib/status/notifications";
import { runServiceChecks } from "@/lib/worker/check-services";

const moduleMocks = vi.hoisted(() => ({
  fetchProviderSnapshot: vi.fn(),
  buildSlackMessage: vi.fn((input: unknown) => ({ input })),
  sendSlackWebhook: vi.fn(async (webhookUrl: string) => {
    if (webhookUrl !== "mock://slack-webhook") {
      throw new Error(`Unexpected Slack webhook URL: ${webhookUrl}`);
    }
  })
}));

vi.mock("@/lib/status/fetch-provider", () => ({
  fetchProviderSnapshot: moduleMocks.fetchProviderSnapshot
}));

vi.mock("@/lib/slack/webhook", () => ({
  buildSlackMessage: moduleMocks.buildSlackMessage,
  sendSlackWebhook: moduleMocks.sendSlackWebhook
}));

const service = {
  id: "service-1",
  name: "Test Provider",
  provider: "figma",
  endpoint: "https://status.invalid/api/v2/summary.json",
  enabled: true,
  slackEnabled: true
};

const diditService = {
  ...service,
  id: "didit-service",
  name: "Didit",
  provider: "didit",
  endpoint: "https://status.didit.me/feed.rss"
};

const activeIncident: NormalizedIncident = {
  externalId: "incident-1",
  title: "Provider outage",
  status: "investigating",
  impact: "major",
  url: "https://status.invalid/incidents/incident-1",
  startedAt: new Date("2026-07-13T00:00:00Z"),
  updatedAt: new Date("2026-07-13T00:10:00Z"),
  resolvedAt: null,
  isMaintenance: false,
  shouldNotify: true,
  raw: {}
};

const snapshot: ProviderSnapshot = {
  service: {
    provider: "figma",
    name: service.name,
    endpoint: service.endpoint
  },
  overallStatus: "major",
  checkedAt: new Date("2026-07-13T00:15:00Z"),
  components: [],
  incidents: [activeIncident]
};
const activeIncidentDedupeKey = buildNotificationDedupeKey(
  snapshot.service.provider,
  activeIncident
);

const forbiddenFetch = vi.fn(() => {
  throw new Error("Unexpected network request");
}) as unknown as typeof fetch;

interface ExistingNotification {
  id: string;
  dedupeKey: string;
  eventType: NotificationEventType;
  slackStatus: SlackDeliveryStatus;
}

interface IncidentFindManyArgs {
  where: {
    serviceId: string;
    externalId?: { in: string[] };
    isMaintenance?: boolean;
    resolvedAt?: null;
  };
  select?: { externalId: true };
}

interface IncidentPersistenceData {
  title: string;
  status: string;
  impact: string | null;
  url: string | null;
  startedAt: Date | null;
  updatedAt: Date | null;
  resolvedAt: Date | null;
  isMaintenance: boolean;
  shouldNotify: boolean;
  rawPayload: string;
}

interface IncidentUpsertArgs {
  where: {
    serviceId_externalId: {
      serviceId: string;
      externalId: string;
    };
  };
  update: IncidentPersistenceData;
  create: IncidentPersistenceData & {
    serviceId: string;
    externalId: string;
  };
}

interface IncidentFindUniqueArgs {
  where: {
    serviceId_externalId: {
      serviceId: string;
      externalId: string;
    };
  };
}

interface NotificationFindUniqueArgs {
  where: { dedupeKey: string };
}

interface NotificationFindFirstArgs {
  where: {
    serviceId: string;
    incidentId: string;
    eventType: "incident_started";
    slackStatus: { in: SlackDeliveryStatus[] };
  };
  orderBy?: { createdAt: "asc" };
}

interface NotificationCreateArgs {
  data: {
    serviceId: string;
    incidentId?: string;
    dedupeKey: string;
    eventType: NotificationEventType;
    slackStatus: SlackDeliveryStatus;
    errorMessage: string | null;
  };
}

interface NotificationUpdateArgs {
  where: { id: string };
  data: {
    incidentId?: string;
    eventType: NotificationEventType;
    slackStatus: SlackDeliveryStatus;
    errorMessage: string | null;
  };
}

interface StoredIncident extends IncidentPersistenceData {
  id: string;
  serviceId: string;
  externalId: string;
}

interface StoredNotification extends ExistingNotification {
  serviceId: string;
  incidentId?: string;
  errorMessage: string | null;
  createdAt: Date;
}

function createPrismaDouble(options: {
  existingIncidentIds?: string[];
  existingNotification?: ExistingNotification | null;
  monitoredService?: typeof service;
} = {}) {
  const monitoredService = options.monitoredService ?? service;
  const operations: string[] = [];
  const incidentIds = new Map<string, string>();
  const persistedIncidents = new Map<string, StoredIncident>();
  let nextIncidentId = 1;

  for (const externalId of options.existingIncidentIds ?? []) {
    incidentIds.set(
      incidentIdentityKey({ serviceId: monitoredService.id, externalId }),
      `persisted-incident-${nextIncidentId++}`
    );
  }

  const incidentFindMany = vi.fn(async (args: IncidentFindManyArgs) => {
    if (args.select?.externalId) {
      operations.push("query-existing-incident-ids");
      return (args.where.externalId?.in ?? [])
        .filter((externalId) =>
          incidentIds.has(
            incidentIdentityKey({ serviceId: args.where.serviceId, externalId })
          )
        )
        .map((externalId) => ({ externalId }));
    }

    operations.push("query-active-incidents");
    return [...persistedIncidents.values()].filter(
      (incident) =>
        incident.serviceId === args.where.serviceId &&
        incident.isMaintenance === args.where.isMaintenance &&
        incident.resolvedAt === args.where.resolvedAt
    );
  });
  const incidentUpsert = vi.fn(async (args: IncidentUpsertArgs) => {
    const identity = args.where.serviceId_externalId;
    if (
      args.create.serviceId !== identity.serviceId ||
      args.create.externalId !== identity.externalId
    ) {
      throw new Error("Incident upsert identity does not match its create payload");
    }

    const key = incidentIdentityKey(identity);
    const id = incidentIds.get(key) ?? `persisted-incident-${nextIncidentId++}`;
    incidentIds.set(key, id);
    const persisted = {
      ...(persistedIncidents.has(key) ? args.update : args.create),
      id,
      serviceId: identity.serviceId,
      externalId: identity.externalId
    };
    persistedIncidents.set(key, persisted);
    operations.push(`persist-incident:${identity.externalId}`);
    return persisted;
  });
  const incidentFindUnique = vi.fn(async (args: IncidentFindUniqueArgs) =>
    persistedIncidents.get(incidentIdentityKey(args.where.serviceId_externalId)) ?? null
  );

  const notificationEvents = new Map<string, StoredNotification>();
  let nextNotificationId = 1;
  if (options.existingNotification) {
    notificationEvents.set(options.existingNotification.dedupeKey, {
      ...options.existingNotification,
      serviceId: monitoredService.id,
      incidentId: incidentIds.get(
        incidentIdentityKey({
          serviceId: monitoredService.id,
          externalId: activeIncident.externalId
        })
      ),
      errorMessage: null,
      createdAt: new Date("2026-07-13T00:00:00Z")
    });
    nextNotificationId += 1;
  }

  const notificationFindUnique = vi.fn(async (args: NotificationFindUniqueArgs) => {
    return notificationEvents.get(args.where.dedupeKey) ?? null;
  });
  const notificationFindFirst = vi.fn(async (args: NotificationFindFirstArgs) => {
    return (
      [...notificationEvents.values()]
        .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
        .find(
          (event) =>
            event.serviceId === args.where.serviceId &&
            event.incidentId === args.where.incidentId &&
            event.eventType === args.where.eventType &&
            args.where.slackStatus.in.includes(event.slackStatus)
        ) ?? null
    );
  });
  const notificationCreate = vi.fn(async (args: NotificationCreateArgs) => {
    operations.push("create-notification");
    const event = {
      id: `notification-${nextNotificationId++}`,
      ...args.data,
      createdAt: new Date(`2026-07-13T00:00:0${nextNotificationId}Z`)
    };
    notificationEvents.set(event.dedupeKey, event);
    return event;
  });
  const notificationUpdate = vi.fn(async (args: NotificationUpdateArgs) => {
    operations.push("update-notification");
    const existing = [...notificationEvents.values()].find(
      (event) => event.id === args.where.id
    );
    if (!existing) {
      throw new Error(`Unknown notification event: ${args.where.id}`);
    }

    const updated = { ...existing, ...args.data };
    notificationEvents.set(updated.dedupeKey, updated);
    return updated;
  });
  const workerRunUpdate = vi.fn(async (args: { data: Record<string, unknown> }) => ({
    id: "worker-run-1",
    ...args.data
  }));

  const prisma = {
    workerRun: {
      create: vi.fn(async () => ({ id: "worker-run-1" })),
      update: workerRunUpdate
    },
    monitoredService: {
      upsert: vi.fn(async () => monitoredService),
      findMany: vi.fn(async () => [monitoredService])
    },
    serviceComponent: {
      upsert: vi.fn()
    },
    incident: {
      findMany: incidentFindMany,
      upsert: incidentUpsert,
      findUnique: incidentFindUnique
    },
    notificationEvent: {
      findUnique: notificationFindUnique,
      findFirst: notificationFindFirst,
      create: notificationCreate,
      update: notificationUpdate
    }
  } as unknown as PrismaClient;

  return {
    prisma,
    operations,
    incidentFindMany,
    incidentUpsert,
    incidentFindUnique,
    notificationFindUnique,
    notificationFindFirst,
    notificationCreate,
    notificationUpdate,
    workerRunUpdate,
    getNotificationEvents: () => [...notificationEvents.values()]
  };
}

function incidentIdentityKey(identity: { serviceId: string; externalId: string }) {
  return `${identity.serviceId}:${identity.externalId}`;
}

async function runCheck(
  prisma: PrismaClient,
  providerSnapshot: ProviderSnapshot = snapshot,
  slackDeliveryEnabled = true
) {
  moduleMocks.fetchProviderSnapshot.mockResolvedValue(providerSnapshot);

  return runServiceChecks({
    prisma,
    fetchImpl: forbiddenFetch,
    slackWebhookUrl: slackDeliveryEnabled ? "mock://slack-webhook" : undefined
  });
}

describe("runServiceChecks notification orchestration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", forbiddenFetch);
  });

  afterEach(() => {
    expect(forbiddenFetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("classifies and persists an already-updated first observation as started", async () => {
    const db = createPrismaDouble();

    const result = await runCheck(db.prisma);

    expect(result).toMatchObject({
      status: "SUCCESS",
      providersChecked: 1,
      providersFailed: 0
    });
    expect(db.incidentFindMany).toHaveBeenNthCalledWith(1, {
      where: {
        serviceId: service.id,
        externalId: { in: [activeIncident.externalId] }
      },
      select: { externalId: true }
    });
    expect(db.operations.indexOf("query-existing-incident-ids")).toBeLessThan(
      db.operations.indexOf(`persist-incident:${activeIncident.externalId}`)
    );
    expect(moduleMocks.buildSlackMessage).toHaveBeenCalledWith({
      serviceName: service.name,
      provider: service.provider,
      incident: activeIncident,
      eventType: "incident_started"
    });
    expect(moduleMocks.sendSlackWebhook).toHaveBeenCalledWith(
      "mock://slack-webhook",
      expect.anything()
    );
    expect(db.incidentFindUnique).toHaveBeenCalledWith({
      where: {
        serviceId_externalId: {
          serviceId: service.id,
          externalId: activeIncident.externalId
        }
      }
    });
    expect(db.notificationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        serviceId: service.id,
        incidentId: "persisted-incident-1",
        eventType: "incident_started",
        slackStatus: "sent"
      })
    });
  });

  it.each(["failed", "skipped"] as const)(
    "retries an existing %s incident_started event without reclassifying it",
    async (slackStatus) => {
      const db = createPrismaDouble({
        existingIncidentIds: [activeIncident.externalId],
        existingNotification: {
          id: "existing-notification-1",
          dedupeKey: activeIncidentDedupeKey,
          eventType: "incident_started",
          slackStatus
        }
      });

      await runCheck(db.prisma);

      expect(moduleMocks.buildSlackMessage).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: "incident_started" })
      );
      expect(moduleMocks.sendSlackWebhook).toHaveBeenCalledWith(
        "mock://slack-webhook",
        expect.anything()
      );
      expect(db.notificationFindUnique).toHaveBeenCalledWith({
        where: { dedupeKey: activeIncidentDedupeKey }
      });
      expect(db.incidentFindUnique).toHaveBeenCalledWith({
        where: {
          serviceId_externalId: {
            serviceId: service.id,
            externalId: activeIncident.externalId
          }
        }
      });
      expect(db.notificationUpdate).toHaveBeenCalledWith({
        where: { id: "existing-notification-1" },
        data: expect.objectContaining({
          incidentId: "persisted-incident-1",
          eventType: "incident_started",
          slackStatus: "sent"
        })
      });
      expect(db.notificationCreate).not.toHaveBeenCalled();
    }
  );

  it("retries a pending start after the provider changes the payload dedupe key", async () => {
    const db = createPrismaDouble();

    await runCheck(db.prisma, snapshot, false);

    expect(db.getNotificationEvents()).toMatchObject([
      {
        id: "notification-1",
        dedupeKey: activeIncidentDedupeKey,
        eventType: "incident_started",
        slackStatus: "skipped"
      }
    ]);

    const updatedIncident: NormalizedIncident = {
      ...activeIncident,
      status: "monitoring",
      updatedAt: new Date("2026-07-13T00:20:00Z")
    };
    const updatedSnapshot: ProviderSnapshot = {
      ...snapshot,
      checkedAt: new Date("2026-07-13T00:25:00Z"),
      incidents: [updatedIncident]
    };
    const updatedDedupeKey = buildNotificationDedupeKey(
      updatedSnapshot.service.provider,
      updatedIncident
    );
    expect(updatedDedupeKey).not.toBe(activeIncidentDedupeKey);

    db.notificationFindUnique.mockClear();
    db.notificationFindFirst.mockClear();
    db.notificationCreate.mockClear();
    db.notificationUpdate.mockClear();
    moduleMocks.buildSlackMessage.mockClear();
    moduleMocks.sendSlackWebhook.mockClear();

    await runCheck(db.prisma, updatedSnapshot);

    expect(db.notificationFindUnique).toHaveBeenCalledWith({
      where: { dedupeKey: updatedDedupeKey }
    });
    expect(db.notificationFindFirst).toHaveBeenCalledWith({
      where: {
        serviceId: service.id,
        incidentId: "persisted-incident-1",
        eventType: "incident_started",
        slackStatus: { in: ["failed", "skipped"] }
      },
      orderBy: { createdAt: "asc" }
    });
    expect(moduleMocks.buildSlackMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        incident: updatedIncident,
        eventType: "incident_started"
      })
    );
    expect(db.notificationUpdate).toHaveBeenCalledWith({
      where: { id: "notification-1" },
      data: expect.objectContaining({
        incidentId: "persisted-incident-1",
        eventType: "incident_started",
        slackStatus: "sent"
      })
    });
    expect(db.notificationCreate).not.toHaveBeenCalled();
    expect(db.getNotificationEvents()).toMatchObject([
      {
        id: "notification-1",
        dedupeKey: activeIncidentDedupeKey,
        eventType: "incident_started",
        slackStatus: "sent"
      }
    ]);
  });

  it("persists resolution separately without consuming a pending start", async () => {
    const db = createPrismaDouble();

    await runCheck(db.prisma, snapshot, false);

    const resolvedIncident: NormalizedIncident = {
      ...activeIncident,
      status: "resolved",
      updatedAt: new Date("2026-07-13T00:30:00Z"),
      resolvedAt: new Date("2026-07-13T00:30:00Z")
    };
    const resolvedSnapshot: ProviderSnapshot = {
      ...snapshot,
      overallStatus: "none",
      checkedAt: new Date("2026-07-13T00:30:00Z"),
      incidents: [resolvedIncident]
    };
    const resolvedDedupeKey = buildNotificationDedupeKey(
      resolvedSnapshot.service.provider,
      resolvedIncident
    );
    expect(resolvedDedupeKey).not.toBe(activeIncidentDedupeKey);

    db.notificationFindUnique.mockClear();
    db.notificationFindFirst.mockClear();
    db.notificationCreate.mockClear();
    db.notificationUpdate.mockClear();
    moduleMocks.buildSlackMessage.mockClear();
    moduleMocks.sendSlackWebhook.mockClear();

    await runCheck(db.prisma, resolvedSnapshot);

    expect(db.notificationFindUnique).toHaveBeenCalledWith({
      where: { dedupeKey: resolvedDedupeKey }
    });
    expect(db.notificationFindFirst).not.toHaveBeenCalled();
    expect(moduleMocks.buildSlackMessage).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "incident_resolved" })
    );
    expect(db.notificationUpdate).not.toHaveBeenCalled();
    expect(db.notificationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        incidentId: "persisted-incident-1",
        dedupeKey: resolvedDedupeKey,
        eventType: "incident_resolved",
        slackStatus: "sent"
      })
    });
    expect(db.getNotificationEvents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "notification-1",
          dedupeKey: activeIncidentDedupeKey,
          eventType: "incident_started",
          slackStatus: "skipped"
        }),
        expect.objectContaining({
          dedupeKey: resolvedDedupeKey,
          eventType: "incident_resolved",
          slackStatus: "sent"
        })
      ])
    );
  });

  it("suppresses delivery and duplicate writes for an existing sent event", async () => {
    const db = createPrismaDouble({
      existingIncidentIds: [activeIncident.externalId],
      existingNotification: {
        id: "existing-notification-1",
        dedupeKey: activeIncidentDedupeKey,
        eventType: "incident_started",
        slackStatus: "sent"
      }
    });

    await runCheck(db.prisma);

    expect(db.incidentUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ externalId: activeIncident.externalId })
      })
    );
    expect(db.notificationFindUnique).toHaveBeenCalledWith({
      where: { dedupeKey: activeIncidentDedupeKey }
    });
    expect(moduleMocks.buildSlackMessage).not.toHaveBeenCalled();
    expect(moduleMocks.sendSlackWebhook).not.toHaveBeenCalled();
    expect(db.incidentFindUnique).not.toHaveBeenCalled();
    expect(db.notificationCreate).not.toHaveBeenCalled();
    expect(db.notificationUpdate).not.toHaveBeenCalled();
  });

  it("persists an ordinary existing update without Slack delivery or notification writes", async () => {
    const db = createPrismaDouble({
      existingIncidentIds: [activeIncident.externalId]
    });

    await runCheck(db.prisma);

    expect(db.incidentUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          updatedAt: activeIncident.updatedAt
        })
      })
    );
    expect(moduleMocks.buildSlackMessage).not.toHaveBeenCalled();
    expect(moduleMocks.sendSlackWebhook).not.toHaveBeenCalled();
    expect(db.notificationCreate).not.toHaveBeenCalled();
    expect(db.notificationUpdate).not.toHaveBeenCalled();
  });

  it("does not deliver a second start when a persisted Didit incident changes status and pubDate", async () => {
    const firstPubDate = new Date("2026-07-13T00:00:00Z");
    const diditIncident: NormalizedIncident = {
      ...activeIncident,
      externalId: "didit-guid-1",
      startedAt: firstPubDate,
      updatedAt: firstPubDate
    };
    const diditSnapshot: ProviderSnapshot = {
      ...snapshot,
      service: {
        provider: "didit",
        name: diditService.name,
        endpoint: diditService.endpoint
      },
      incidents: [diditIncident]
    };
    const db = createPrismaDouble({ monitoredService: diditService });

    await runCheck(db.prisma, diditSnapshot);

    expect(moduleMocks.sendSlackWebhook).toHaveBeenCalledTimes(1);
    expect(db.getNotificationEvents()).toMatchObject([
      { eventType: "incident_started", slackStatus: "sent" }
    ]);

    const nextPubDate = new Date("2026-07-13T00:20:00Z");
    const updatedIncident: NormalizedIncident = {
      ...diditIncident,
      status: "monitoring",
      startedAt: nextPubDate,
      updatedAt: nextPubDate
    };
    const updatedSnapshot: ProviderSnapshot = {
      ...diditSnapshot,
      checkedAt: new Date("2026-07-13T00:25:00Z"),
      incidents: [updatedIncident]
    };

    expect(
      buildNotificationDedupeKey("didit", updatedIncident)
    ).not.toBe(buildNotificationDedupeKey("didit", diditIncident));

    db.notificationCreate.mockClear();
    db.notificationUpdate.mockClear();
    moduleMocks.buildSlackMessage.mockClear();
    moduleMocks.sendSlackWebhook.mockClear();

    await runCheck(db.prisma, updatedSnapshot);

    expect(moduleMocks.buildSlackMessage).not.toHaveBeenCalled();
    expect(moduleMocks.sendSlackWebhook).not.toHaveBeenCalled();
    expect(db.notificationCreate).not.toHaveBeenCalled();
    expect(db.notificationUpdate).not.toHaveBeenCalled();
    expect(db.getNotificationEvents()).toHaveLength(1);
  });

  it("handles an empty snapshot without persistence or notification delivery", async () => {
    const db = createPrismaDouble();

    const result = await runCheck(db.prisma, {
      ...snapshot,
      overallStatus: "none",
      incidents: []
    });

    expect(result).toMatchObject({ status: "SUCCESS", providersChecked: 1 });
    expect(db.incidentFindMany).toHaveBeenNthCalledWith(1, {
      where: {
        serviceId: service.id,
        externalId: { in: [] }
      },
      select: { externalId: true }
    });
    expect(db.incidentUpsert).not.toHaveBeenCalled();
    expect(moduleMocks.sendSlackWebhook).not.toHaveBeenCalled();
    expect(db.notificationCreate).not.toHaveBeenCalled();
    expect(db.notificationUpdate).not.toHaveBeenCalled();
  });
});
