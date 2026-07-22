import type { Metadata } from "next";
import { StudentPortal } from "./StudentPortal";

export const metadata: Metadata = { title: "학생 로그인" };

export default function StudentPage() {
  return <StudentPortal />;
}
