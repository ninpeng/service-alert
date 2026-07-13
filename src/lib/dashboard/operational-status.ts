import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface WorkerRunSummary {
  id: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  providersChecked: number;
  providersFailed: number;
  errorMessage: string | null;
}

export interface LogSummary {
  exists: boolean;
  hasRecentEntries: boolean;
  lastLines: string[];
  errorMessage?: string;
}

export interface OperationalStatus {
  webServerStatus: "running";
  lastWorkerRun: WorkerRunSummary | null;
  nextWorkerRunAt: string | null;
  slackWebhookConfigured: boolean;
  logs: {
    web: LogSummary;
    worker: LogSummary;
  };
}

const DEFAULT_WORKER_INTERVAL_MINUTES = 5;
const DEFAULT_LOG_LINE_LIMIT = 4;

export function buildOperationalStatus(input: {
  generatedAt: Date;
  workerRuns: Array<{
    id: string;
    status: string;
    startedAt: Date;
    finishedAt: Date | null;
    providersChecked: number;
    providersFailed: number;
    errorMessage: string | null;
  }>;
  slackWebhookUrl?: string;
  logs: {
    web: LogSummary;
    worker: LogSummary;
  };
  workerIntervalMinutes?: number;
}): OperationalStatus {
  const lastRun = input.workerRuns[0] ?? null;
  const lastWorkerRun = lastRun ? serializeWorkerRun(lastRun) : null;

  return {
    webServerStatus: "running",
    lastWorkerRun,
    nextWorkerRunAt: getNextWorkerRunAt(lastRun, input.workerIntervalMinutes ?? DEFAULT_WORKER_INTERVAL_MINUTES),
    slackWebhookConfigured: Boolean(input.slackWebhookUrl?.trim()),
    logs: input.logs
  };
}

export async function readRecentLogSummary(fileName: "web.err.log" | "worker.err.log"): Promise<LogSummary> {
  const filePath = join(process.cwd(), "logs", fileName);

  try {
    const content = await readFile(filePath, "utf8");
    return summarizeRecentLogContent(content);
  } catch (error) {
    if (isMissingFileError(error)) {
      return {
        exists: false,
        hasRecentEntries: false,
        lastLines: []
      };
    }

    return {
      exists: false,
      hasRecentEntries: false,
      lastLines: [],
      errorMessage: error instanceof Error ? error.message : String(error)
    };
  }
}

export function summarizeRecentLogContent(content: string, lineLimit = DEFAULT_LOG_LINE_LIMIT): LogSummary {
  const lastLines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-lineLimit);

  return {
    exists: true,
    hasRecentEntries: lastLines.length > 0,
    lastLines
  };
}

function serializeWorkerRun(run: {
  id: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  providersChecked: number;
  providersFailed: number;
  errorMessage: string | null;
}): WorkerRunSummary {
  return {
    id: run.id,
    status: run.status,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    providersChecked: run.providersChecked,
    providersFailed: run.providersFailed,
    errorMessage: run.errorMessage
  };
}

function getNextWorkerRunAt(
  run: { finishedAt: Date | null } | null,
  workerIntervalMinutes: number
) {
  if (!run?.finishedAt) {
    return null;
  }

  return new Date(run.finishedAt.getTime() + workerIntervalMinutes * 60_000).toISOString();
}

function isMissingFileError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
