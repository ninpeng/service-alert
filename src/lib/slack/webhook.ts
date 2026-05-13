import type { NormalizedIncident, NotificationEventType } from "../status/types";

interface SlackMessageInput {
  serviceName: string;
  provider: string;
  incident: NormalizedIncident;
  eventType: NotificationEventType;
}

export function buildSlackMessage(input: SlackMessageInput) {
  const emoji = input.eventType === "incident_resolved" ? ":white_check_mark:" : ":rotating_light:";
  const eventLabel = notificationEventLabel(input.eventType);

  const fields = [
    `*서비스:* ${input.serviceName}`,
    `*상태:* ${statusLabel(input.incident.status)}`,
    input.incident.impact ? `*영향도:* ${statusLabel(input.incident.impact)}` : null,
    input.incident.url ? `*원문:* ${input.incident.url}` : null
  ].filter(Boolean);

  return {
    text: `${emoji} [${input.serviceName}] ${eventLabel}: ${input.incident.title}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${emoji} *[${input.serviceName}] ${eventLabel}*\n${input.incident.title}`
        }
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: fields.join("\n")
        }
      }
    ]
  };
}

function notificationEventLabel(eventType: NotificationEventType) {
  const labels: Record<NotificationEventType, string> = {
    incident_started: "장애 시작",
    incident_update: "장애 업데이트",
    incident_resolved: "복구"
  };

  return labels[eventType];
}

function statusLabel(status: string) {
  const normalized = status.toLowerCase().replaceAll(" ", "_");
  const labels: Record<string, string> = {
    complete: "완료",
    completed: "완료",
    critical: "심각한 장애",
    degraded: "성능 저하",
    degraded_performance: "성능 저하",
    failed: "실패",
    identified: "원인 파악 중",
    investigating: "조사 중",
    major: "주요 장애",
    minor: "일부 장애",
    monitoring: "모니터링",
    resolved: "복구됨",
    scheduled: "예정됨",
    under_maintenance: "점검 중",
    unknown: "알 수 없음",
    verifying: "확인 중"
  };

  return labels[normalized] ?? status.replaceAll("_", " ");
}

export async function sendSlackWebhook(webhookUrl: string, message: ReturnType<typeof buildSlackMessage>) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(message)
  });

  if (!response.ok) {
    throw new Error(`Slack webhook failed: ${response.status} ${response.statusText}`);
  }
}
