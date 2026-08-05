import type { Metadata } from "next";
import { LifeCheckPortal } from "./LifeCheckPortal";

export const metadata: Metadata = {
  title: "생활확인",
  description: "양치·우유·급식 담당 학생이 스스로 기록하는 생활확인 공간",
};

export default function LifeChecksPage() {
  return <LifeCheckPortal />;
}
