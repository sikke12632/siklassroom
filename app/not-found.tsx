import { SearchX } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="global-state-page">
      <section className="global-state-card">
        <span className="global-state-icon" aria-hidden="true"><SearchX /></span>
        <h1>찾을 수 없는 화면이에요</h1>
        <p>주소가 바뀌었거나 사용할 수 없는 링크일 수 있어요.</p>
        <div className="global-state-actions">
          <Link className="button button-primary" href="/">첫 화면으로</Link>
          <Link className="button button-light" href="/teacher">교사 화면으로</Link>
        </div>
      </section>
    </main>
  );
}
