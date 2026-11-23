export default async function DashboardPage() {
  const res = await fetch("https://example.invalid/api/stats");
  const stats = (await res.json()) as { visits: number };
  return <p>{stats.visits} visits</p>;
}
