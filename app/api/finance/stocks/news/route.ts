import {
  createFinanceStockNews,
  closeFinanceStockNews,
} from "@/lib/finance-stocks";
import { apiFailure, json, readJson } from "@/lib/responses";

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };

export async function POST(request: Request) {
  try {
    const body = await readJson<Record<string, unknown>>(request);
    return json(await createFinanceStockNews(request, body), 201, PRIVATE_NO_STORE);
  } catch (error) {
    const response = apiFailure(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await readJson<Record<string, unknown>>(request);
    return json(await closeFinanceStockNews(request, body), 200, PRIVATE_NO_STORE);
  } catch (error) {
    const response = apiFailure(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
