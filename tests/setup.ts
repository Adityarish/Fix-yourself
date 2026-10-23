import "fake-indexeddb/auto";
import "@testing-library/jest-dom/vitest";

Object.defineProperty(globalThis, "crypto", {
  value: crypto,
  configurable: true,
});

const localValues = new Map<string, string>();
const testLocalStorage: Storage = {
  get length() {
    return localValues.size;
  },
  clear() {
    localValues.clear();
  },
  getItem(key) {
    return localValues.get(key) ?? null;
  },
  key(index) {
    return [...localValues.keys()][index] ?? null;
  },
  removeItem(key) {
    localValues.delete(key);
  },
  setItem(key, value) {
    localValues.set(key, String(value));
  },
};

Object.defineProperty(globalThis, "localStorage", {
  value: testLocalStorage,
  configurable: true,
});
