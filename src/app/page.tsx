import { DashboardClient } from "@/components/dashboard-client";
import { getDashboardData } from "@/lib/dashboard";
import { ensureSeedData } from "@/lib/seed";

export const dynamic = "force-dynamic";

export default async function Home() {
  await ensureSeedData();
  const data = await getDashboardData();

  return (
    <main className="paper-grid flex-1">
      <DashboardClient initialData={data} />
    </main>
  );
}
