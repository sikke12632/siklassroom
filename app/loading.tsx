import { School } from "lucide-react";

export default function Loading() {
  return (
    <main className="student-loading portal-loading" role="status" aria-live="polite">
      <span aria-hidden="true"><School /></span>
      <p>우리반운영센터를 준비하고 있어요</p>
    </main>
  );
}
