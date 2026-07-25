"use client";

import { useEffect, useState } from "react";
import { Megaphone } from "lucide-react";

type Announcement = { id: string; title: string; body: string };

export function AnnouncementBanner() {
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  useEffect(() => {
    let active = true;
    fetch("/api/announcements", { credentials: "same-origin", cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data: { announcements?: Announcement[] } | null) => {
        if (active) setAnnouncement(data?.announcements?.[0] ?? null);
      })
      .catch(() => null);
    return () => { active = false; };
  }, []);
  if (!announcement) return null;
  return <aside className="announcement-banner" aria-label="전체 공지"><Megaphone aria-hidden="true" /><div><strong>{announcement.title}</strong><p>{announcement.body}</p></div></aside>;
}
