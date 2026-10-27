import { Connections } from "@/components/connections";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ github?: string; message?: string }>;
}) {
  const query = await searchParams;
  return (
    <Connections
      message={
        query.github === "error"
          ? query.message?.slice(0, 400) || "Connection failed. Start again."
          : undefined
      }
    />
  );
}
