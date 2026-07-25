import type { Metadata } from "next";
import { StudentPortal } from "./StudentPortal";

export const metadata: Metadata = { title: "학생으로 들어가기" };

export default function StudentPage() {
  return <StudentPortal />;
}
