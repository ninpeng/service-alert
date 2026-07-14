import { ArrowRight, RadioTower } from "lucide-react";

export function AppSidebar({ activePage }: { activePage: "dashboard" | "incidents" }) {
  return (
    <aside className="sidebar">
      <a className="brand" href="/">
        <RadioTower aria-hidden="true" size={24} />
        <span>서비스 알림</span>
      </a>
      <nav className="nav-list" aria-label="주요 화면">
        <a className={activePage === "dashboard" ? "active" : undefined} href="/" aria-current={activePage === "dashboard" ? "page" : undefined}>대시보드</a>
        <a href="/#services">서비스</a>
        <a className={activePage === "incidents" ? "active" : undefined} href="/incidents" aria-current={activePage === "incidents" ? "page" : undefined}>장애 이력</a>
        <a href="/#worker">수집 실행</a>
      </nav>
    </aside>
  );
}

export function IncidentHistoryLink() {
  return (
    <a className="section-action" href="/incidents">
      전체 이력
      <ArrowRight aria-hidden="true" size={15} />
    </a>
  );
}
