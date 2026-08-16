import Link from "next/link";
import { School } from "lucide-react";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      href="/"
      className={`brand portal-brand ${compact ? "brand-compact portal-brand--compact" : ""}`}
      aria-label="우리반운영센터 첫 화면"
    >
      <span className="brand-mark portal-brand__mark" aria-hidden="true">
        <School />
      </span>
      <span className="portal-brand__copy">
        <strong>우리반운영센터</strong>
        {!compact && <small>우리 반의 하루를 한곳에서</small>}
      </span>
    </Link>
  );
}
