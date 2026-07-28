import type { Metadata } from "next";
import { MonthlyJobChoicePortal } from "./MonthlyJobChoicePortal";

export const metadata: Metadata = { title: "다음 달 직업 선정" };

export default async function MonthlyJobChoicePage({
  params,
}: {
  params: Promise<{ classId: string }>;
}) {
  const { classId } = await params;
  return <MonthlyJobChoicePortal classId={classId} />;
}
