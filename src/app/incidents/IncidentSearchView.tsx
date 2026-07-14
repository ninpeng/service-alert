import { ExternalLink, RotateCcw, Search } from "lucide-react";
import Link from "next/link";
import { AppSidebar } from "../AppSidebar";
import { formatDashboardDateTime } from "../../lib/dashboard/date-format";
import type { IncidentSearchData, IncidentSearchRow } from "../../lib/incidents/data";
import { getIncidentImpactLabel } from "../../lib/incidents/impact";
import { isResolvedIncident } from "../../lib/incidents/query";
import { buildIncidentSearchHref } from "../../lib/incidents/search-params";

const stateOptions = [["all", "전체"], ["active", "진행 중"], ["resolved", "해결됨"]] as const;
const impactOptions = [["all", "전체"], ["critical", "심각"], ["major", "주요"], ["minor", "일부"], ["none", "영향 없음"], ["unknown", "알 수 없음"]] as const;
const periodOptions = [["24h", "24시간"], ["7d", "7일"], ["30d", "30일"], ["all", "전체"]] as const;
const typeOptions = [["incident", "장애"], ["maintenance", "예정 점검"], ["all", "전체"]] as const;

export function IncidentSearchView({ data }: { data: IncidentSearchData }) {
  const { filters } = data;
  const serviceOptions: Array<readonly [string, string]> = [["all", "전체 서비스"], ...data.services.map((service) => [service.provider, service.name] as const)];

  return <main className="app-shell">
    <AppSidebar activePage="incidents" />
    <section className="content incident-history-content">
      <header className="topbar incident-history-header"><div><h1>장애 이력</h1><p>과거 장애를 서비스, 상태, 영향도와 기간으로 조회합니다.</p></div></header>
      <section className="incident-filter-band" aria-label="장애 이력 필터">
        <nav className="segmented-control" aria-label="진행 상태">
          {stateOptions.map(([value, label]) => <Link key={value} className={filters.state === value ? "active" : undefined} href={buildIncidentSearchHref(filters, { state: value, page: 1 })} aria-current={filters.state === value ? "page" : undefined}>{label}</Link>)}
        </nav>
        <form key={buildIncidentSearchHref(filters)} className="incident-filter-form" method="get" action="/incidents">
          <input type="hidden" name="state" value={filters.state} />
          <label className="incident-filter-search"><span>검색</span><input name="q" type="search" maxLength={100} defaultValue={filters.q} placeholder="장애 제목 또는 서비스" /></label>
          <FilterSelect label="서비스" name="service" value={filters.service} options={serviceOptions} />
          <FilterSelect label="영향도" name="impact" value={filters.impact} options={impactOptions} />
          <FilterSelect label="기간" name="period" value={filters.period} options={periodOptions} />
          <FilterSelect label="유형" name="type" value={filters.type} options={typeOptions} />
          <div className="incident-filter-actions"><button className="command-button" type="submit"><Search aria-hidden="true" size={16} />조회</button><Link className="secondary-command" href="/incidents"><RotateCcw aria-hidden="true" size={16} />초기화</Link></div>
        </form>
      </section>
      <section className="panel incident-results">
        <div className="section-heading"><div><h2>검색 결과</h2><p>{periodText(filters.period)} · 총 {data.totalCount}건</p></div></div>
        {data.incidents.length > 0 ? <IncidentTable incidents={data.incidents} /> : <div className="empty-state incident-empty"><strong>조건에 맞는 장애 이력이 없습니다.</strong><Link href="/incidents">기본 조건으로 돌아가기</Link></div>}
        <Pagination data={data} />
      </section>
    </section>
  </main>;
}

function FilterSelect({ label, name, value, options }: { label: string; name: string; value: string; options: readonly (readonly [string, string])[] }) {
  return <label><span>{label}</span><select name={name} defaultValue={value}>{options.map(([optionValue, text]) => <option key={optionValue} value={optionValue}>{text}</option>)}</select></label>;
}

function IncidentTable({ incidents }: { incidents: IncidentSearchRow[] }) {
  return <div className="incident-table-wrap"><table className="incident-history-table"><thead><tr><th scope="col">서비스</th><th scope="col">장애</th><th scope="col">상태 / 영향도</th><th scope="col">발생 / 해결</th><th scope="col">마지막 수집</th><th scope="col"><span className="sr-only">원문</span></th></tr></thead><tbody>{incidents.map((incident) => {
    const resolved = isResolvedIncident(incident);
    const sourceUrl = resolveIncidentSourceUrl(incident.url, incident.service.endpoint);
    return <tr key={incident.id}><td data-label="서비스"><strong>{incident.service.name}</strong><small>{incident.service.provider}</small></td><td data-label="장애"><strong>{incident.title}</strong>{incident.isMaintenance ? <small>예정 점검</small> : null}</td><td data-label="상태 / 영향도"><span className={`status-pill ${resolved ? "success" : "danger"}`}><span aria-hidden="true" />{resolved ? "해결됨" : "진행 중"}</span><small>{impactText(incident.impact)}</small></td><td data-label="발생 / 해결"><time>{formatDate(incident.startedAt)}</time><small>{incident.resolvedAt ? `해결 ${formatDate(incident.resolvedAt)}` : "해결 기록 없음"}</small></td><td data-label="마지막 수집"><time>{formatDate(incident.lastSeenAt)}</time></td><td data-label="원문">{sourceUrl ? <a className="icon-button incident-source-button" href={sourceUrl} target="_blank" rel="noreferrer" aria-label={`${incident.service.name} 장애 원문 열기`} title="원문 열기"><ExternalLink aria-hidden="true" size={16} /></a> : <span className="incident-source-unavailable">원문 없음</span>}</td></tr>;
  })}</tbody></table></div>;
}

function Pagination({ data }: { data: IncidentSearchData }) {
  if (data.totalCount === 0) return null;
  return <nav className="incident-pagination" aria-label="장애 이력 페이지"><span>{data.filters.page > 1 ? <Link href={buildIncidentSearchHref(data.filters, { page: data.filters.page - 1 })}>이전</Link> : <span aria-disabled="true">이전</span>}</span><strong>{data.filters.page} / {data.totalPages}</strong><span>{data.filters.page < data.totalPages ? <Link href={buildIncidentSearchHref(data.filters, { page: data.filters.page + 1 })}>다음</Link> : <span aria-disabled="true">다음</span>}</span></nav>;
}

export function resolveIncidentSourceUrl(...candidates: Array<string | null | undefined>) {
  for (const candidate of candidates) {
    const sourceUrl = parseSafeHttpsUrl(candidate);
    if (sourceUrl) return sourceUrl;
  }
  return null;
}

function parseSafeHttpsUrl(value: string | null | undefined) {
  const candidate = value?.trim();
  if (!candidate) return null;

  try {
    const url = new URL(candidate);
    return url.protocol === "https:" && url.hostname ? url.toString() : null;
  } catch {
    return null;
  }
}

function formatDate(value: Date | null) { return formatDashboardDateTime(value?.toISOString() ?? null, "기록 없음"); }
function impactText(value: string | null) { return getIncidentImpactLabel(value); }
function periodText(value: string) { return ({ "24h": "최근 24시간", "7d": "최근 7일", "30d": "최근 30일", all: "전체 기간" } as Record<string, string>)[value] ?? "최근 30일"; }
