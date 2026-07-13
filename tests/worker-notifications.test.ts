import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import type {
  NormalizedIncident,
  NotificationEventType,
  ProviderSnapshot,
  SlackDeliveryStatus
} from "@/lib/status/types";
import { runServiceChecks } from "@/lib/worker/check-services";

const moduleMocks = vi.hoisted(() => ({
  fetchProviderSnapshot: vi.fn(),
  buildSlackMessage: vi.fn((input: unknown) => ({ input })),
  sendSlackWebhook: vi.fn(async (webhookUrl: string, _message: unknown) => {
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

const forbiddenFetch = vi.fn(() => {
  throw new Error("Unexpected network request");
}) as unknown as typeof fetch;

interface ExistingNotification {
  id: string;
  eventType: NotificationEventType;
  slackStatus: SlackDeliveryStatus;
}

interface IncidentFindManyArgs {
  where: {
    serviceId: string;
    externalId?: { in: string[] };
  };
  select?: { externalId: true };
}

interface IncidentUpsertArgs {
  create: {
    externalId: string;
    [key: string]: unknown;
  };
}

interface NotificationWriteArgs {
  where?: { id: string };
  data: {
    incidentId?: string;
    eventType: NotificationEventType;
    slackStatus: SlackDeliveryStatus;
    [key: string]: unknown;
  };
}

function createPrismaDouble(options: {
  existingIncidentIds?: string[];
  existingNotification?: ExistingNotification | null;
} = {}) {
  const operations: string[] = [];
  const incidentFindMany = vi.fn(async (args: IncidentFindManyArgs) => {
    if (args.select?.externalId) {
      operations.push("query-existing-incident-ids");
      return (options.existingIncidentIds ?? []).map((externalId) => ({ externalId }));
    }

    operations.push("query-active-incidents");
    return [];
  });
  const incidentUpsert = vi.fn(async (args: IncidentUpsertArgs) => {
    operations.push(`persist-incident:${args.create.externalId}`);
    return {
      id: "persisted-incident-1",
      ...args.create
    };
  });
  const incidentFindUnique = vi.fn(async () => ({ id: "persisted-incident-1" }));
  const notificationFindUnique = vi.fn(async () => options.existingNotification ?? null);
  const notificationCreate = vi.fn(async (args: NotificationWriteArgs) => {
    operations.push("create-notification");
    return { id: "notification-1", ...args.data };
  });
  const notificationUpdate = vi.fn(async (args: NotificationWriteArgs) => {
    operations.push("update-notification");
    return { id: args.where?.id, ...args.data };
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
      upsert: vi.fn(async () => service),
      findMany: vi.fn(async () => [service])
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
    notificationCreate,
    notificationUpdate,
    workerRunUpdate
  };
}

async function runCheck(prisma: PrismaClient, providerSnapshot: ProviderSnapshot = snapshot) {
  moduleMocks.fetchProviderSnapshot.mockResolvedValue(providerSnapshot);

  return runServiceChecks({
    prisma,
    fetchImpl: forbiddenFetch,
    slackWebhookUrl: "mock://slack-webhook"
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

  it("suppresses delivery and duplicate writes for an existing sent event", async () => {
    const db = createPrismaDouble({
      existingIncidentIds: [activeIncident.externalId],
      existingNotification: {
        id: "existing-notification-1",
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
