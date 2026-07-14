import { redirect } from "next/navigation";
import { IncidentSearchView } from "./IncidentSearchView";
import { loadIncidentSearchData } from "../../lib/incidents/data";
import { buildIncidentSearchHref, parseIncidentSearchParams, type RawIncidentSearchParams } from "../../lib/incidents/search-params";

export const dynamic = "force-dynamic";

export default async function IncidentsPage({ searchParams }: { searchParams: Promise<RawIncidentSearchParams> }) {
  const filters = parseIncidentSearchParams(await searchParams);
  const data = await loadIncidentSearchData(filters);

  if (data.isPageOutOfRange) {
    redirect(buildIncidentSearchHref(filters, { page: data.totalPages }));
  }

  return <IncidentSearchView data={data} />;
}
