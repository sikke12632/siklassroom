"use client";

import { AlertTriangle } from "lucide-react";
import Link from "next/link";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="global-state-page">
      <section className="global-state-card" role="alert">
        <span className="global-state-icon" aria-hidden="true"><AlertTriangle /></span>
        <h1>화면을 불러오지 못했어요</h1>
        <p>입력한 내용은 그대로 두고 다시 시도해 보세요. 계속 안 되면 첫 화면으로 돌아갈 수 있어요.</p>
        <div className="global-state-actions">
          <button className="button button-primary" type="button" onClick={reset}>다시 시도</button>
          <Link className="button button-light" href="/">첫 화면으로</Link>
        </div>
      </section>
    </main>
  );
}
