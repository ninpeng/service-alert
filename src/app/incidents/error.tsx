"use client";

import { RefreshCw, TriangleAlert } from "lucide-react";
import Link from "next/link";

export default function IncidentsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="route-error"><TriangleAlert aria-hidden="true" size={22} /><h1>장애 이력을 불러오지 못했습니다.</h1><p>데이터베이스 연결과 로그를 확인한 뒤 다시 시도해 주세요.</p><button className="command-button" type="button" onClick={reset}><RefreshCw aria-hidden="true" size={16} />다시 시도</button><Link href="/">대시보드로 돌아가기</Link></main>;
}
