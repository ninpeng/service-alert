export function summarizeDashboardStatus(input: {
  components: Array<{ status: string }>;
  incidents: Array<{ status: string; isMaintenance: boolean; shouldNotify?: boolean }>;
}) {
  const hasActiveIncident = input.incidents.some(isActionableActiveIncident);

  if (hasActiveIncident) {
    return "active_incident";
  }

  const hasDegradedComponent = input.components.some((component) => component.status !== "operational");

  if (hasDegradedComponent) {
    return "degraded";
  }

  return "operational";
}

export function isActionableActiveIncident(incident: {
  status: string;
  isMaintenance: boolean;
  shouldNotify?: boolean;
}) {
  const status = incident.status.toLowerCase();

  return (
    !incident.isMaintenance &&
    incident.shouldNotify !== false &&
    !status.includes("resolved") &&
    !status.includes("complete")
  );
}

export function getLatestDataUpdatedAt(input: {
  services: Array<{
    components: Array<{ checkedAt: Date }>;
    incidents: Array<{ lastSeenAt: Date }>;
  }>;
  workerRuns: Array<{ status: string; finishedAt: Date | null }>;
}) {
  const completedWorkerDates = input.workerRuns
    .filter((run) => run.finishedAt && run.status !== "RUNNING")
    .map((run) => run.finishedAt as Date);

  if (completedWorkerDates.length > 0) {
    return maxDate(completedWorkerDates);
  }

  return maxDate([
    ...input.services.flatMap((service) => service.components.map((component) => component.checkedAt)),
    ...input.services.flatMap((service) => service.incidents.map((incident) => incident.lastSeenAt))
  ]);
}

function maxDate(dates: Date[]) {
  if (dates.length === 0) {
    return null;
  }

  return dates.reduce((latest, date) => (date.getTime() > latest.getTime() ? date : latest), dates[0]);
}
