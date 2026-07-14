import { ArrowRight, RadioTower } from "lucide-react";
import Link from "next/link";

export function AppSidebar({ activePage }: { activePage: "dashboard" | "incidents" }) {
  return (
    <aside className="sidebar">
      <Link className="brand" href="/">
        <RadioTower aria-hidden="true" size={24} />
        <span>서비스 알림</span>
      </Link>
      <nav className="nav-list" aria-label="주요 화면">
        <Link className={activePage === "dashboard" ? "active" : undefined} href="/" aria-current={activePage === "dashboard" ? "page" : undefined}>대시보드</Link>
        <Link href="/#services">서비스</Link>
        <Link className={activePage === "incidents" ? "active" : undefined} href="/incidents" aria-current={activePage === "incidents" ? "page" : undefined}>장애 이력</Link>
        <Link href="/#worker">수집 실행</Link>
      </nav>
    </aside>
  );
}

export function IncidentHistoryLink() {
  return (
    <Link className="section-action" href="/incidents">
      전체 이력
      <ArrowRight aria-hidden="true" size={15} />
    </Link>
  );
}
