import type { Metadata } from "next";
import { TeacherReset } from "./TeacherReset";

export const metadata: Metadata = { title: "교사 비밀번호 재설정" };

export default async function TeacherResetPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  return <TeacherReset token={token} />;
}
