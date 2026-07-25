import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isSystemAdminPath } from "@/lib/system-admin-auth";
import { AdminPortal } from "./AdminPortal";

export const metadata: Metadata = {
  title: "서비스 운영",
  robots: { index: false, follow: false, nocache: true },
};

export default async function SystemAdminPage({ params }: { params: Promise<{ operatorPath: string }> }) {
  const { operatorPath } = await params;
  if (!(await isSystemAdminPath(operatorPath))) notFound();
  return <AdminPortal />;
}
