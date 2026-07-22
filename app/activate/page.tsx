import type { Metadata } from "next";
import { ActivationPortal } from "./ActivationPortal";

export const metadata: Metadata = { title: "학생 처음 등록" };

export default async function ActivatePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  return <ActivationPortal token={token} />;
}
