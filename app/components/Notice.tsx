export function Notice({ message, tone = "info" }: { message?: string; tone?: "info" | "error" | "success" }) {
  if (!message) return null;
  return <div className={`notice notice-${tone}`} role={tone === "error" ? "alert" : "status"}>{message}</div>;
}
