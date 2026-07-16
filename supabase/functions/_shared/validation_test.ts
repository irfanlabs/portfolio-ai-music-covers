import { stringField, uuidField } from "./validation.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
}

function assertThrows(callback: () => unknown): void {
  try {
    callback();
  } catch {
    return;
  }
  throw new Error("Expected callback to throw");
}

Deno.test("stringField trims and bounds input", () => {
  assertEquals(stringField({ prompt: "  album cover  " }, "prompt", 3, 20), "album cover");
  assertThrows(() => stringField({ prompt: "x" }, "prompt", 3, 20));
  assertThrows(() => stringField({ prompt: 42 }, "prompt", 3, 20));
});

Deno.test("uuidField accepts canonical UUIDs only", () => {
  const id = "2f8d3a9c-dc8d-4de8-a5b5-bc3f80d10227";
  assertEquals(uuidField({ id }, "id"), id);
  assertThrows(() => uuidField({ id: "../not-a-uuid" }, "id"));
});
