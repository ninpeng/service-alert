"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { formatDashboardDateTime } from "../lib/dashboard/date-format";

const refreshIntervalMs = 60_000;
const manualRefreshIndicatorMs = 500;
const manualRefreshStartDelayMs = 80;

export function RefreshControls({ dataUpdatedAt }: { dataUpdatedAt: string | null }) {
  const router = useRouter();
  const loadingTimeoutRef = useRef<number | null>(null);
  const refreshDelayTimeoutRef = useRef<number | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isPending, startTransition] = useTransition();

  const refresh = useCallback((showIndicator = false) => {
    const runRefresh = () => {
      startTransition(() => {
        router.refresh();
      });
    };

    if (showIndicator) {
      setIsRefreshing(true);

      if (loadingTimeoutRef.current) {
        window.clearTimeout(loadingTimeoutRef.current);
      }

      loadingTimeoutRef.current = window.setTimeout(() => {
        setIsRefreshing(false);
        loadingTimeoutRef.current = null;
      }, manualRefreshIndicatorMs);

      if (refreshDelayTimeoutRef.current) {
        window.clearTimeout(refreshDelayTimeoutRef.current);
      }

      refreshDelayTimeoutRef.current = window.setTimeout(() => {
        runRefresh();
        refreshDelayTimeoutRef.current = null;
      }, manualRefreshStartDelayMs);

      return;
    }

    runRefresh();
  }, [router]);

  useEffect(() => {
    const intervalId = window.setInterval(refresh, refreshIntervalMs);
    return () => window.clearInterval(intervalId);
  }, [refresh]);

  useEffect(() => {
    return () => {
      if (loadingTimeoutRef.current) {
        window.clearTimeout(loadingTimeoutRef.current);
      }

      if (refreshDelayTimeoutRef.current) {
        window.clearTimeout(refreshDelayTimeoutRef.current);
      }
    };
  }, []);

  const isLoading = isRefreshing || isPending;

  return (
    <div className="refresh-controls">
      <span className="timestamp">데이터 갱신 {formatDashboardDateTime(dataUpdatedAt, "없음")}</span>
      <button
        aria-busy={isLoading}
        aria-label="대시보드 데이터 새로고침"
        className="icon-button"
        disabled={isRefreshing}
        onClick={() => refresh(true)}
        type="button"
      >
        <RefreshCw aria-hidden="true" className={isLoading ? "spin" : undefined} size={18} />
      </button>
    </div>
  );
}
