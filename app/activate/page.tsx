import type { Metadata } from "next";
import { ActivationPortal } from "./ActivationPortal";

export const metadata: Metadata = {
  title: "학생 QR",
  referrer: "no-referrer",
};

export default function ActivatePage() {
  return <ActivationPortal />;
}
