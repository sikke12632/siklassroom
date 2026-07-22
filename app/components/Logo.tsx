import Link from "next/link";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className={`brand ${compact ? "brand-compact" : ""}`} aria-label="오구학급 첫 화면">
      <span className="brand-mark" aria-hidden="true">59</span>
      <span><strong>오구학급</strong>{!compact && <small>선생님은 쉽게, 학생들은 재밌게</small>}</span>
    </Link>
  );
}
