import { NextResponse } from "next/server";
import { getDashboardData } from "../../../lib/dashboard/data";

export const dynamic = "force-dynamic";

export async function GET() {
  const dashboard = await getDashboardData();
  return NextResponse.json(dashboard);
}
