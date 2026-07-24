import Link from "next/link";
import { BookOpen } from "lucide-react";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className={`brand ${compact ? "brand-compact" : ""}`} aria-label="직업교실 첫 화면">
      <span className="brand-mark" aria-hidden="true"><BookOpen /></span>
      <span><strong>직업교실</strong>{!compact && <small>우리 반 운영을 한곳에서</small>}</span>
    </Link>
  );
}
