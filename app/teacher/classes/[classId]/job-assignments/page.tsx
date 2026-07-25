import type { Metadata } from "next";
import { InitialJobAssignmentPortal } from "./InitialJobAssignmentPortal";

export const metadata: Metadata = { title: "첫 직업 배정" };

export default async function InitialJobAssignmentPage({
  params,
}: {
  params: Promise<{ classId: string }>;
}) {
  const { classId } = await params;
  return <InitialJobAssignmentPortal classId={classId} />;
}
