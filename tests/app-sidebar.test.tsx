import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppSidebar, IncidentHistoryLink } from "@/app/AppSidebar";

describe("incident history navigation", () => {
  it("links the shared sidebar to the dashboard and incident history", () => {
    const html = renderToStaticMarkup(<AppSidebar activePage="incidents" />);
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/incidents"');
    expect(html).toContain('aria-current="page"');
  });

  it("renders the compact dashboard entry link", () => {
    const html = renderToStaticMarkup(<IncidentHistoryLink />);
    expect(html).toContain('href="/incidents"');
    expect(html).toContain("전체 이력");
  });
});
