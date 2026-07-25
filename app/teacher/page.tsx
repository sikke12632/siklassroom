import type { Metadata } from "next";
import { TeacherPortal } from "./TeacherPortal";

export const metadata: Metadata = { title: "선생님으로 들어가기" };

export default function TeacherPage() {
  return <TeacherPortal />;
}
