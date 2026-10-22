import "fake-indexeddb/auto";
import "@testing-library/jest-dom/vitest";

Object.defineProperty(globalThis, "crypto", {
  value: crypto,
  configurable: true,
});
