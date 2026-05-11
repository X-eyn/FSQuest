import { DashboardClient } from "@/components/dashboard-client";
import { getDashboardData } from "@/lib/dashboard";
import { ensureSeedData } from "@/lib/seed";

export const dynamic = "force-dynamic";

export default async function Home() {
  await ensureSeedData();
  const data = await getDashboardData();

  return (
    <main className="flex-1 overflow-hidden">
      <DashboardClient initialData={data} />
    </main>
  );
}
