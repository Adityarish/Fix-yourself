import { describe, expect, it } from "vitest";
import { retryDelay } from "@/lib/db/repositories/outbox";

describe("outbox retry", () => {
  it("uses capped exponential backoff with jitter", () => {
    expect(retryDelay(0, 0.5)).toBe(750);
    expect(retryDelay(4, 0.5)).toBe(12000);
    expect(retryDelay(20, 0.5)).toBe(60000);
  });
});
