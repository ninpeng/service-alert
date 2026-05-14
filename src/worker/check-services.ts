import { prisma } from "../lib/db/prisma";
import { loadDotEnv } from "../lib/worker/env";
import { runServiceChecks } from "../lib/worker/check-services";

loadDotEnv();

runServiceChecks({
  prisma,
  slackWebhookUrl: process.env.SLACK_WEBHOOK_URL
})
  .then(async (run) => {
    console.log(
      `service-alert worker ${run.status}: checked=${run.providersChecked} failed=${run.providersFailed}`
    );
    await prisma.$disconnect();

    if (run.status === "FAILED") {
      process.exit(1);
    }
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
