import test from "node:test";
import assert from "node:assert/strict";
import { ApiError, MAX_JSON_BODY_BYTES, readJson } from "../lib/responses";

const encoder = new TextEncoder();

type StreamingRequestInit = RequestInit & { duplex: "half" };

function requestWithBody(body: BodyInit | null, headers?: HeadersInit) {
  return new Request("https://job-classroom.example/api/test", {
    method: "POST",
    body,
    headers,
  });
}

function requestWithChunks(chunks: Uint8Array[], extraHeaders?: HeadersInit) {
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index];
      if (!chunk) {
        controller.close();
        return;
      }
      index += 1;
      controller.enqueue(chunk);
    },
  });
  const headers = new Headers(extraHeaders);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  return new Request("https://job-classroom.example/api/test", {
    method: "POST",
    body,
    headers,
    duplex: "half",
  } as StreamingRequestInit);
}

async function expectApiError(
  promise: Promise<unknown>,
  expected: { status: number; code: string; message?: string },
) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, expected.status);
    assert.equal(error.code, expected.code);
    if (expected.message) assert.equal(error.message, expected.message);
    return true;
  });
}

test("readJson accepts JSON media types and consumes the request body once", async () => {
  const request = requestWithChunks(
    [encoder.encode('{"value":'), encoder.encode("42}")],
    { "content-type": "application/problem+json; charset=UTF-8" },
  );

  assert.deepEqual(await readJson<{ value: number }>(request), { value: 42 });
  assert.equal(request.bodyUsed, true);
  await assert.rejects(request.text(), TypeError);
});

test("readJson rejects a missing or non-JSON Content-Type", async () => {
  await expectApiError(
    readJson(requestWithBody("{}")),
    { status: 415, code: "UNSUPPORTED_MEDIA_TYPE" },
  );
  await expectApiError(
    readJson(requestWithBody("{}", { "content-type": "text/plain" })),
    { status: 415, code: "UNSUPPORTED_MEDIA_TYPE" },
  );
});

test("readJson preserves the INVALID_JSON contract for empty and malformed JSON", async () => {
  const expected = {
    status: 400,
    code: "INVALID_JSON",
    message: "입력 내용을 다시 확인해 주세요.",
  };
  await expectApiError(readJson(requestWithBody(null)), expected);
  await expectApiError(
    readJson(requestWithBody("", { "content-type": "application/json" })),
    expected,
  );
  await expectApiError(
    readJson(requestWithBody('{"broken":', { "content-type": "application/json" })),
    expected,
  );
});

test("readJson rejects an oversized declared Content-Length before consuming the body", async () => {
  const request = requestWithBody("{}", {
    "content-type": "application/json",
    "content-length": String(MAX_JSON_BODY_BYTES + 1),
  });

  await expectApiError(
    readJson(request),
    { status: 413, code: "REQUEST_BODY_TOO_LARGE" },
  );
  assert.equal(request.bodyUsed, false);
});

test("readJson measures an oversized stream when Content-Length is missing", async () => {
  const oversized = encoder.encode(`{"value":"${"x".repeat(MAX_JSON_BODY_BYTES)}"}`);
  const request = requestWithChunks([
    oversized.subarray(0, 16_384),
    oversized.subarray(16_384, 49_152),
    oversized.subarray(49_152),
  ]);

  await expectApiError(
    readJson(request),
    { status: 413, code: "REQUEST_BODY_TOO_LARGE" },
  );
  assert.equal(request.bodyUsed, true);
});

test("readJson does not trust a falsely shortened Content-Length", async () => {
  const oversized = encoder.encode(`{"value":"${"x".repeat(MAX_JSON_BODY_BYTES)}"}`);
  const request = requestWithChunks([oversized], { "content-length": "2" });

  await expectApiError(
    readJson(request),
    { status: 413, code: "REQUEST_BODY_TOO_LARGE" },
  );
});

test("readJson accepts a chunked JSON body exactly at the byte limit", async () => {
  const prefix = '{"value":"';
  const suffix = '"}';
  const padding = "x".repeat(MAX_JSON_BODY_BYTES - encoder.encode(prefix + suffix).byteLength);
  const body = encoder.encode(prefix + padding + suffix);
  assert.equal(body.byteLength, MAX_JSON_BODY_BYTES);

  const request = requestWithChunks([
    body.subarray(0, 8192),
    body.subarray(8192, 32_768),
    body.subarray(32_768),
  ]);
  const parsed = await readJson<{ value: string }>(request);
  assert.equal(parsed.value.length, padding.length);
});
