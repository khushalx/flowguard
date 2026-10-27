import { ProjectDetail } from "@/components/project-detail";
export const metadata = { title: "Project overview" };
export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ settings?: string }>;
}) {
  const { id } = await params;
  return (
    <ProjectDetail
      id={id}
      initialSettings={(await searchParams).settings === "repository"}
    />
  );
}
