import { vi } from "vitest";

// Keep Buffer and Uint8Array in the same realm for ECC libraries under jsdom.
// Browsers naturally use one realm; jsdom otherwise combines its Uint8Array
// constructor with Node's Buffer, which makes ECPair's ECC self-test fail.
globalThis.Uint8Array = Object.getPrototypeOf(Object.getPrototypeOf(Buffer.alloc(0))).constructor;

if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
}

if (!HTMLDialogElement.prototype.close) {
  HTMLDialogElement.prototype.close = function close(returnValue = "") {
    this.open = false;
    this.returnValue = returnValue;
    this.dispatchEvent(new Event("close"));
  };
}

Object.defineProperty(window, "alert", {
  configurable: true,
  value: vi.fn(),
});

Object.defineProperty(navigator, "clipboard", {
  configurable: true,
  value: { writeText: vi.fn(() => Promise.resolve()) },
});

Object.defineProperty(URL, "createObjectURL", {
  configurable: true,
  value: vi.fn(() => "blob:test"),
});

Object.defineProperty(URL, "revokeObjectURL", {
  configurable: true,
  value: vi.fn(),
});
