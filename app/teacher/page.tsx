import type { Metadata } from "next";
import { TeacherPortal } from "./TeacherPortal";

export const metadata: Metadata = { title: "교사 시작" };

export default function TeacherPage() {
  return <TeacherPortal />;
}
