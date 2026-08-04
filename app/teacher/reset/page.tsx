import type { Metadata } from "next";
import { TeacherReset } from "./TeacherReset";

export const metadata: Metadata = { title: "교사 비밀번호 재설정", referrer: "no-referrer" };

export default function TeacherResetPage() {
  return <TeacherReset />;
}
