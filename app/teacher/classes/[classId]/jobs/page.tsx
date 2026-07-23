import type { Metadata } from "next";
import { JobSetupPortal } from "./JobSetupPortal";

export const metadata: Metadata = { title: "우리 반 직업 설정" };

export default async function JobSetupPage({ params }: { params: Promise<{ classId: string }> }) {
  const { classId } = await params;
  return <JobSetupPortal classId={classId} />;
}
