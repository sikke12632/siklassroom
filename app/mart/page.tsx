import type { Metadata } from "next";
import { MartPortal } from "./MartPortal";

export const metadata: Metadata = {
  title: "마트센터",
  description: "현물 학급화폐로 판매와 재고를 운영하는 우리 반 마트센터",
};

export default function MartPage() {
  return <MartPortal />;
}
