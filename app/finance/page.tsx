import type { Metadata } from "next";
import { FinancePortal } from "./FinancePortal";

export const metadata: Metadata = {
  title: "금융센터",
  description: "우리 반 학생 은행원이 운영하고 선생님이 필요할 때 돕는 금융센터",
};

export default function FinancePage() {
  return <FinancePortal />;
}
