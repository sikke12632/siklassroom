"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

const themeStorageKey = "job_classroom_theme_v1";

type Theme = "light" | "dark";

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function subscribe(callback: () => void) {
  window.addEventListener("job-classroom-theme-change", callback);
  return () => window.removeEventListener("job-classroom-theme-change", callback);
}

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => "light");

  function choose(next: Theme) {
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next;
    localStorage.setItem(themeStorageKey, next);
    window.dispatchEvent(new Event("job-classroom-theme-change"));
  }

  return (
    <div className={`theme-toggle ${compact ? "theme-toggle-compact" : ""}`} role="group" aria-label="화면 모드">
      <button className={theme === "light" ? "active" : ""} type="button" aria-label="라이트 모드" aria-pressed={theme === "light"} onClick={() => choose("light")}>
        <Sun aria-hidden="true" />
      </button>
      <button className={theme === "dark" ? "active" : ""} type="button" aria-label="다크 모드" aria-pressed={theme === "dark"} onClick={() => choose("dark")}>
        <Moon aria-hidden="true" />
      </button>
    </div>
  );
}
