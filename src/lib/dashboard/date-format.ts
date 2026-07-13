export function formatDashboardDateTime(value: string | null, fallback = "알 수 없음") {
  if (!value) {
    return fallback;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul"
  }).format(new Date(value));
}
