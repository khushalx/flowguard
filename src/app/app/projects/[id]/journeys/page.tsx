import { ProjectDetail } from "@/components/project-detail";
export const metadata = { title: "Test journeys" };
export default async function JourneysPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProjectDetail id={id} journeysOnly />;
}
