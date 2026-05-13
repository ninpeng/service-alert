import { prisma } from "../src/lib/db/prisma";
import { defaultMonitoredServices } from "../src/lib/status/default-services";

async function main() {
  for (const service of defaultMonitoredServices) {
    await prisma.monitoredService.upsert({
      where: { name: service.name },
      update: {
        provider: service.provider,
        endpoint: service.endpoint,
        enabled: service.enabled,
        slackEnabled: service.slackEnabled
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

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
