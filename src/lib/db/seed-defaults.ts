import type { PrismaClient } from "../../generated/prisma/client";
import { defaultMonitoredServices } from "../status/default-services";

export async function ensureDefaultServices(prisma: PrismaClient) {
  for (const service of defaultMonitoredServices) {
    await prisma.monitoredService.upsert({
      where: { name: service.name },
      update: {
        provider: service.provider,
        endpoint: service.endpoint
      },
      create: {
        name: service.name,
        provider: service.provider,
        endpoint: service.endpoint,
        enabled: service.enabled,
        slackEnabled: service.slackEnabled
      }
    });
  }
}
