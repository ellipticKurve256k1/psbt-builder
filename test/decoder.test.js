import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TESTNET_PAYMENT,
  TXID,
  change,
  input,
  loadApp,
  makeRawTransaction,
} from "./helpers.js";

let app;

beforeAll(async () => {
  app = await loadApp();
});

beforeEach(() => {
  vi.clearAllMocks();
  document.getElementById("clearRawTxButton").click();
  change(document.getElementById("network"), "mainnet");
});

describe("raw transaction decoder UI", () => {
  it("switches between builder and decoder pages", () => {
    document.getElementById("openDecoderPage").click();
    expect(document.getElementById("builderPage").classList.contains("hidden")).toBe(true);
    expect(document.getElementById("decoderPage").classList.contains("hidden")).toBe(false);
    expect(document.getElementById("openDecoderPage").classList.contains("active")).toBe(true);
    document.getElementById("openBuilderPage").click();
    expect(document.getElementById("builderPage").classList.contains("hidden")).toBe(false);
  });

  it("renders colored segments and transaction summaries", () => {
    const tx = makeRawTransaction({ segwit: true });
    input(document.getElementById("rawTxHexInput"), tx.toHex());
    const spans = document.querySelectorAll("#rawTxDecodedOutput span");
    expect(spans.length).toBeGreaterThan(8);
    expect(Array.from(spans).some((span) => span.title.includes("witness item"))).toBe(true);
    expect(document.getElementById("rawTxInputSummary").textContent).toContain("Input #0");
    expect(document.getElementById("rawTxInputSummary").textContent).toContain("0xfffffffd");
    expect(document.getElementById("rawTxInputSummary").textContent).toContain("SIGHASH_DEFAULT");
    expect(document.getElementById("rawTxOutputSummary").textContent).toContain("0.00050000 BTC");
  });

  it("updates decoded output addresses when network changes", () => {
    input(document.getElementById("rawTxHexInput"), makeRawTransaction().toHex());
    change(document.getElementById("network"), "testnet");
    expect(document.getElementById("rawTxOutputSummary").textContent).toContain(TESTNET_PAYMENT.address);
  });

  it("falls back gracefully for malformed transaction hex and clears", () => {
    input(document.getElementById("rawTxHexInput"), "aabb");
    expect(document.querySelector("#rawTxDecodedOutput span").title).toBe("unparsed raw hex");
    expect(document.getElementById("rawTxInputSummary").textContent).toContain("Could not parse");
    document.getElementById("clearRawTxButton").click();
    expect(document.getElementById("rawTxHexInput").value).toBe("");
    expect(document.getElementById("rawTxDecodedOutput").textContent).toBe("");
    expect(document.getElementById("rawTxInputSummary").textContent).toBe("");
  });
});

describe("mempool loading UI", () => {
  it("rejects invalid txids before issuing HTTP", async () => {
    globalThis.fetch = vi.fn();
    input(document.getElementById("rawTxIdInput"), "bad");
    document.getElementById("fetchRawTxButton").click();
    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled();
    expect(document.getElementById("rawTxFetchStatus").textContent).toContain("valid 64-character");
    expect(document.getElementById("rawTxFetchStatus").classList.contains("error")).toBe(true);
  });

  it("loads a transaction by button and uses the selected network endpoint", async () => {
    const rawHex = makeRawTransaction({ network: undefined }).toHex();
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => rawHex });
    change(document.getElementById("network"), "signet");
    input(document.getElementById("rawTxIdInput"), TXID.toUpperCase());
    document.getElementById("fetchRawTxButton").click();
    expect(document.getElementById("fetchRawTxButton").disabled).toBe(true);
    expect(document.getElementById("rawTxFetchStatus").textContent).toContain("Loading");
    await vi.waitFor(() => expect(document.getElementById("rawTxFetchStatus").textContent).toBe("Loaded."));
    expect(fetch).toHaveBeenCalledWith(
      `https://mempool.space/signet/api/tx/${TXID}/hex`,
      expect.objectContaining({ headers: { Accept: "text/plain" } })
    );
    expect(document.getElementById("rawTxHexInput").value).toBe(rawHex);
    expect(document.getElementById("fetchRawTxButton").disabled).toBe(false);
  });

  it("supports Enter/change triggers and displays request failures", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    input(document.getElementById("rawTxIdInput"), TXID);
    document.getElementById("rawTxIdInput").dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
    );
    await vi.waitFor(() => expect(document.getElementById("rawTxFetchStatus").textContent).toContain("Failed to load"));
    expect(document.getElementById("rawTxFetchStatus").textContent).toContain("status 404");

    fetch.mockClear();
    document.getElementById("rawTxIdInput").dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
  });

  it("ignores a stale response after Clear", async () => {
    let resolveResponse;
    globalThis.fetch = vi.fn(() => new Promise((resolve) => { resolveResponse = resolve; }));
    input(document.getElementById("rawTxIdInput"), TXID);
    document.getElementById("fetchRawTxButton").click();
    document.getElementById("clearRawTxButton").click();
    resolveResponse({ ok: true, text: async () => makeRawTransaction().toHex() });
    await Promise.resolve();
    await Promise.resolve();
    expect(document.getElementById("rawTxHexInput").value).toBe("");
    expect(document.getElementById("rawTxFetchStatus").textContent).toBe("");
  });
});
