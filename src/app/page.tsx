import {
  Bell,
  CheckCircle2,
  ExternalLink,
  RadioTower,
  RefreshCw,
  Server,
  TriangleAlert
} from "lucide-react";
import { RefreshControls } from "./RefreshControls";
import { getDashboardData } from "../lib/dashboard/data";
import { isActionableActiveIncident } from "../lib/dashboard/summary";
import type { DashboardData } from "../lib/dashboard/data";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const dashboard = await getDashboardData();
  const activeIncidents = dashboard.services.flatMap((service) =>
    service.incidents
      .filter(isActionableActiveIncident)
      .map((incident) => ({
        ...incident,
        serviceName: service.name
      }))
  );
  const degradedServices = dashboard.services.filter((service) => service.status !== "operational");
  const lastRun = dashboard.workerRuns[0] ?? null;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <RadioTower aria-hidden="true" size={24} />
          <span>서비스 알림</span>
        </div>
        <nav className="nav-list" aria-label="대시보드 섹션">
          <a href="#services">서비스</a>
          <a href="#incidents">장애 이력</a>
          <a href="#worker">수집 실행</a>
        </nav>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <h1>플랫폼 서비스 알림</h1>
            <p>JIRA, Bitbucket, Slack, Vercel, AWS, Notion, Figma 상태를 공식 상태 소스로 추적합니다.</p>
          </div>
          <div className="topbar-actions">
            <RefreshControls dataUpdatedAt={dashboard.dataUpdatedAt} />
          </div>
        </header>

        <section className="summary-grid" aria-label="상태 요약">
          <SummaryMetric
            href="#services"
            icon={<Server aria-hidden="true" size={20} />}
            label="감시 서비스"
            value={`${dashboard.services.length}`}
            detail={`${degradedServices.length}개 주의 필요`}
          />
          <SummaryMetric
            href="#incidents"
            icon={<TriangleAlert aria-hidden="true" size={20} />}
            label="진행 중 장애"
            value={`${activeIncidents.length}`}
            detail="예정 점검 제외"
          />
          <SummaryMetric
            href="#notifications"
            icon={<Bell aria-hidden="true" size={20} />}
            label="Slack 알림"
            value={`${dashboard.notifications.length}`}
            detail="최근 기록"
          />
          <SummaryMetric
            href="#worker"
            icon={<RefreshCw aria-hidden="true" size={20} />}
            label="마지막 수집"
            value={lastRun ? statusLabel(lastRun.status) : "없음"}
            detail={lastRun ? relativeTime(lastRun.startedAt) : "pnpm worker:check 실행 필요"}
          />
        </section>

        <section className="panel" id="services">
          <div className="section-heading">
            <div>
              <h2>서비스 상태</h2>
              <p>컴포넌트 상태와 최근 장애를 기준으로 요약합니다.</p>
            </div>
            <span className="timestamp">60초마다 자동 갱신</span>
          </div>
          <div className="service-table" role="table" aria-label="감시 중인 서비스">
            <div className="table-row table-head" role="row">
              <span role="columnheader">서비스</span>
              <span role="columnheader">상태</span>
              <span role="columnheader">컴포넌트</span>
              <span role="columnheader">최근 장애</span>
              <span role="columnheader">알림</span>
            </div>
            {dashboard.services.map((service) => (
              <ServiceRow key={service.id} service={service} />
            ))}
          </div>
        </section>

        <section className="split-grid">
          <section className="panel" id="incidents">
            <div className="section-heading">
              <div>
                <h2>최근 장애</h2>
                <p>예정 점검은 저장하지만 Slack 알림에서는 제외합니다.</p>
              </div>
            </div>
            <div className="incident-list">
              {dashboard.services
                .flatMap((service) =>
                  service.incidents.map((incident) => ({
                    ...incident,
                    serviceName: service.name
                  }))
                )
                .slice(0, 12)
                .map((incident) => (
                  <article className="incident-row" key={`${incident.serviceName}-${incident.externalId}`}>
                    <div className="incident-main">
                      <span className="service-label">{incident.serviceName}</span>
                      <h3>{incident.title}</h3>
                      <p>{formatDateTime(incident.updatedAt ?? incident.startedAt)}</p>
                    </div>
                    <StatusPill status={incident.isMaintenance ? "maintenance" : incident.status} />
                  </article>
                ))}
              {dashboard.services.every((service) => service.incidents.length === 0) ? (
                <div className="empty-state">아직 수집된 장애가 없습니다.</div>
              ) : null}
            </div>
          </section>

          <section className="panel" id="worker">
            <div className="section-heading">
              <div>
                <h2>수집 실행</h2>
                <p>launchd가 실행한 CLI 수집 작업 결과입니다.</p>
              </div>
            </div>
            <div className="run-list">
              {dashboard.workerRuns.map((run) => (
                <article className="run-row" key={run.id}>
                  <div>
                    <strong>{statusLabel(run.status)}</strong>
                    <span>{formatDateTime(run.startedAt)}</span>
                  </div>
                  <span>
                    {run.providersChecked}개 확인 / {run.providersFailed}개 실패
                  </span>
                </article>
              ))}
              {dashboard.workerRuns.length === 0 ? (
                <div className="empty-state">`pnpm worker:check`를 실행하면 결과가 표시됩니다.</div>
              ) : null}
            </div>
          </section>
        </section>

        <section className="panel" id="notifications">
          <div className="section-heading">
            <div>
              <h2>Slack 발송 이력</h2>
              <p>중복 방지 키가 생성된 알림 이벤트만 기록합니다.</p>
            </div>
          </div>
          <div className="notification-list">
            {dashboard.notifications.map((notification) => (
              <article className="notification-row" key={notification.id}>
                <div>
                  <div className="service-label">{notification.serviceName}</div>
                  <strong>{notification.incidentTitle ?? eventTypeLabel(notification.eventType)}</strong>
                  <p>{notification.errorMessage ?? eventTypeLabel(notification.eventType)}</p>
                </div>
                <StatusPill status={notification.slackStatus} />
              </article>
            ))}
            {dashboard.notifications.length === 0 ? (
              <div className="empty-state">아직 Slack 알림 이력이 없습니다.</div>
            ) : null}
          </div>
        </section>
      </section>
    </main>
  );
}

function SummaryMetric({
  href,
  icon,
  label,
  value,
  detail
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  const content = (
    <>
      <div className="metric-icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <p>{detail}</p>
      </div>
    </>
  );

  return (
    <a className="metric-card" href={href}>
      {content}
    </a>
  );
}

function ServiceRow({ service }: { service: DashboardData["services"][number] }) {
  const latestIncident = service.incidents[0];

  return (
    <div className="table-row" role="row">
      <span role="cell">
        <strong>{service.name}</strong>
      </span>
      <span role="cell">
        <StatusPill status={service.status} />
      </span>
      <span role="cell">{componentSummary(service.components)}</span>
      <span role="cell">
        {latestIncident ? (
          <a className="source-link" href={latestIncident.url ?? service.endpoint} target="_blank" rel="noreferrer">
            {latestIncident.title}
            <ExternalLink aria-hidden="true" size={14} />
          </a>
        ) : (
          "장애 없음"
        )}
      </span>
      <span role="cell">
        {service.slackEnabled ? (
          <span className="inline-state">
            <CheckCircle2 aria-hidden="true" size={15} />
            Slack 알림
          </span>
        ) : (
          "알림 끔"
        )}
      </span>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone = statusTone(status);

  return (
    <span className={`status-pill ${tone}`}>
      <span aria-hidden="true" />
      {statusLabel(status)}
    </span>
  );
}

function componentSummary(components: DashboardData["services"][number]["components"]) {
  if (components.length === 0) {
    return "컴포넌트 없음";
  }

  const degraded = components.filter((component) => component.status !== "operational").length;
  return degraded === 0 ? `${components.length}개 정상` : `${degraded}/${components.length}개 주의`;
}

function statusTone(status: string) {
  const normalized = status.toLowerCase();

  if (
    normalized.includes("operational") ||
    normalized.includes("success") ||
    normalized.includes("sent") ||
    normalized.includes("resolved")
  ) {
    return "success";
  }

  if (
    normalized.includes("active") ||
    normalized.includes("degraded") ||
    normalized.includes("failed") ||
    normalized.includes("investigating") ||
    normalized.includes("identified") ||
    normalized.includes("incident")
  ) {
    return "danger";
  }

  if (
    normalized.includes("maintenance") ||
    normalized.includes("skipped") ||
    normalized.includes("partial") ||
    normalized.includes("monitoring") ||
    normalized.includes("verifying")
  ) {
    return "warning";
  }

  return "neutral";
}

function statusLabel(status: string) {
  const normalized = status.toLowerCase().replaceAll(" ", "_");
  const explicitLabels: Record<string, string> = {
    active_incident: "진행 중 장애",
    complete: "완료",
    completed: "완료",
    critical: "심각한 장애",
    degraded: "성능 저하",
    degraded_performance: "성능 저하",
    failed: "실패",
    identified: "원인 파악 중",
    incident: "장애",
    incident_started: "장애 시작",
    incident_update: "장애 업데이트",
    incident_resolved: "복구",
    investigating: "조사 중",
    in_progress: "진행 중",
    maintenance: "예정 점검",
    major: "주요 장애",
    minor: "일부 장애",
    monitoring: "모니터링",
    none: "정상",
    ok: "정상",
    operational: "정상",
    partial_failure: "일부 실패",
    postmortem: "사후 분석",
    resolved: "복구됨",
    scheduled: "예정됨",
    sent: "발송됨",
    skipped: "건너뜀",
    success: "성공",
    under_maintenance: "점검 중",
    unknown: "알 수 없음",
    verifying: "확인 중"
  };

  if (explicitLabels[normalized]) {
    return explicitLabels[normalized];
  }

  if (normalized.includes("operational") || normalized.includes("ok")) {
    return "정상";
  }

  if (normalized.includes("resolved")) {
    return "복구됨";
  }

  if (normalized.includes("maintenance") || normalized.includes("scheduled")) {
    return "예정 점검";
  }

  if (normalized.includes("degraded")) {
    return "성능 저하";
  }

  if (normalized.includes("failed")) {
    return "실패";
  }

  return status.replaceAll("_", " ");
}

function eventTypeLabel(eventType: string) {
  return statusLabel(eventType);
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "알 수 없음";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function relativeTime(value: string) {
  const diffMs = Date.now() - new Date(value).getTime();
  const diffMinutes = Math.max(0, Math.round(diffMs / 60000));

  if (diffMinutes < 1) {
    return "방금 전";
  }

  if (diffMinutes < 60) {
    return `${diffMinutes}분 전`;
  }

  return `${Math.round(diffMinutes / 60)}시간 전`;
}
