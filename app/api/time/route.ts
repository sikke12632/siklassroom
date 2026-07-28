import { json } from "@/lib/responses";
import { seoulServerTime } from "@/lib/seoul-time";

export async function GET() {
  return json(
    { serverTime: seoulServerTime() },
    200,
    { "Cache-Control": "no-store" },
  );
}
