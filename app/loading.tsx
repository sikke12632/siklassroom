import { BookOpen } from "lucide-react";

export default function Loading() {
  return (
    <main className="student-loading" role="status" aria-live="polite">
      <span aria-hidden="true"><BookOpen /></span>
      <p>직업교실을 준비하고 있어요</p>
    </main>
  );
}
