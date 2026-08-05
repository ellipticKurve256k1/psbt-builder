import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Buffer } from "buffer";
import * as bitcoin from "bitcoinjs-lib";
import {
  MAINNET_PAYMENT,
  TESTNET_PAYMENT,
  TXID,
  change,
  fillValidBuilder,
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
  document.getElementById("clearButton").click();
  change(document.getElementById("network"), "mainnet");
});

describe("builder rows, validation, and balance", () => {
  it("starts/reset with one blank input and output and hidden result", () => {
    expect(document.querySelectorAll("[data-utxo]")).toHaveLength(1);
    expect(document.querySelectorAll("[data-output]")).toHaveLength(1);
    expect(document.querySelector(".sequence-input").value).toBe("fffffffd");
    expect(document.getElementById("txVersion").value).toBe("2");
    expect(document.getElementById("txLocktime").value).toBe("00000000");
    expect(document.getElementById("psbtDisplay").style.display).toBe("none");
    expect(window.currentPsbt).toBeNull();
  });

  it("adds and removes rows while refreshing totals", () => {
    document.getElementById("addInputButton").click();
    document.getElementById("addOutputButton").click();
    expect(document.querySelectorAll("[data-utxo]")).toHaveLength(2);
    expect(document.querySelectorAll("[data-output]")).toHaveLength(2);
    input(document.querySelector(".value-input"), "1.25");
    input(document.querySelector("[data-output] input:nth-of-type(2)"), "1");
    expect(document.getElementById("totalInputs").textContent).toBe("1.25000000 BTC");
    expect(document.getElementById("feeAmount").textContent).toBe("0.25000000 BTC");
    document.querySelectorAll("[data-utxo] .remove")[1].click();
    document.querySelectorAll("[data-output] .remove")[1].click();
    expect(document.querySelectorAll("[data-utxo]")).toHaveLength(1);
    expect(document.querySelectorAll("[data-output]")).toHaveLength(1);
  });

  it("revalidates scripts and addresses when the network changes", () => {
    const { inputRow, outputRow } = fillValidBuilder();
    expect(inputRow.querySelector(".script-label span").textContent).toBe(MAINNET_PAYMENT.address);
    expect(inputRow.querySelector(".script-input").style.borderColor).toBe("rgb(247, 147, 26)");
    expect(outputRow.querySelector(".output-address").style.borderColor).toBe("rgb(247, 147, 26)");

    change(document.getElementById("network"), "testnet");
    expect(inputRow.querySelector(".script-label span").textContent).toBe(TESTNET_PAYMENT.address);
    expect(outputRow.querySelector(".output-address").style.borderColor).toBe("rgb(200, 72, 56)");
    input(outputRow.querySelector(".output-address"), TESTNET_PAYMENT.address);
    expect(outputRow.querySelector(".output-address").style.borderColor).toBe("rgb(247, 147, 26)");
  });

  it("marks sequence, version, and locktime fields valid or invalid", () => {
    const sequence = document.querySelector(".sequence-input");
    input(sequence, "xyz");
    expect(sequence.style.borderColor).toBe("rgb(200, 72, 56)");
    input(sequence, "0");
    expect(sequence.style.borderColor).toBe("rgb(247, 147, 26)");
    input(document.getElementById("txVersion"), "-1");
    expect(document.getElementById("txVersion").style.borderColor).toBe("rgb(200, 72, 56)");
    input(document.getElementById("txLocktime"), "ffffffff");
    expect(document.getElementById("txLocktime").style.borderColor).toBe("rgb(247, 147, 26)");
  });
});

describe("PSBT creation", () => {
  it("creates an unsigned PSBT with transaction metadata and per-input data", () => {
    const { inputRow } = fillValidBuilder();
    input(inputRow.querySelector(".sequence-input"), "fffffffc");
    change(document.getElementById("sighashType"), "ALL");
    input(document.getElementById("txLocktime"), "0000000a");
    document.getElementById("createPsbt").click();

    expect(window.alert).not.toHaveBeenCalled();
    expect(document.getElementById("psbtDisplay").style.display).toBe("block");
    const parsed = bitcoin.Psbt.fromBase64(document.getElementById("psbtBase64").value);
    expect(parsed.version).toBe(2);
    expect(parsed.locktime).toBe(10);
    expect(parsed.txInputs[0].sequence).toBe(0xfffffffc);
    expect(parsed.data.inputs[0].witnessUtxo.value).toBe(100000000n);
    expect(parsed.data.inputs[0].sighashType).toBe(bitcoin.Transaction.SIGHASH_ALL);
    expect(parsed.txOutputs[0].value).toBe(90000000n);
    expect(document.getElementById("feeAmount").textContent).toBe("0.10000000 BTC");
  });

  it("uses per-input sighash overrides and can explicitly unset one", () => {
    const { inputRow } = fillValidBuilder();
    change(document.getElementById("sighashType"), "ALL");
    change(inputRow.querySelector(".input-sighash"), "NONE_ANYONECANPAY");
    document.getElementById("createPsbt").click();
    expect(window.currentPsbt.data.inputs[0].sighashType).toBe(
      bitcoin.Transaction.SIGHASH_NONE | bitcoin.Transaction.SIGHASH_ANYONECANPAY
    );

    document.getElementById("clearButton").click();
    const next = fillValidBuilder().inputRow;
    change(document.getElementById("sighashType"), "ALL");
    change(next.querySelector(".input-sighash"), "DEFAULT");
    document.getElementById("createPsbt").click();
    expect(window.currentPsbt.data.inputs[0].sighashType).toBeUndefined();
  });

  it("encodes UTF-8 and uppercase-prefixed hexadecimal OP_RETURN outputs", () => {
    fillValidBuilder();
    const enabled = document.getElementById("includeOpReturn");
    enabled.checked = true;
    change(enabled);
    input(document.getElementById("opReturnMessage"), "한");
    expect(document.getElementById("opReturnByteStatus").textContent).toBe("3 / 83 bytes");
    document.getElementById("createPsbt").click();
    expect(Buffer.from(app.extractOpReturnData(window.currentPsbt.txOutputs[1].script)).toString()).toBe("한");

    document.getElementById("clearButton").click();
    fillValidBuilder();
    enabled.checked = true;
    change(enabled);
    input(document.getElementById("opReturnMessage"), "0X00ff");
    document.getElementById("createPsbt").click();
    expect(Buffer.from(app.extractOpReturnData(window.currentPsbt.txOutputs[1].script)).toString("hex")).toBe("00ff");
  });

  it("enforces OP_RETURN input errors and the exact byte boundary", () => {
    const enabled = document.getElementById("includeOpReturn");
    enabled.checked = true;
    change(enabled);
    const message = document.getElementById("opReturnMessage");
    input(message, "x".repeat(83));
    expect(document.getElementById("createPsbt").disabled).toBe(false);
    input(message, "x".repeat(84));
    expect(document.getElementById("createPsbt").disabled).toBe(true);
    expect(document.getElementById("opReturnByteStatus").classList.contains("error")).toBe(true);
    input(message, "0x0");
    expect(document.getElementById("opReturnByteStatus").textContent).toContain("even");
    enabled.checked = false;
    change(enabled);
    expect(document.getElementById("opReturnByteStatus").textContent).toBe("0 / 83 bytes");
    expect(document.getElementById("createPsbt").disabled).toBe(false);
  });

  it.each([
    ["bad txid", (row) => input(row.querySelector(".txid-input"), "bad"), "txid"],
    ["bad vout", (row) => input(row.querySelector(".vout-input"), "-1"), "vout"],
    ["bad amount", (row) => input(row.querySelector(".value-input"), "NaN"), "value"],
    ["too precise", (row) => input(row.querySelector(".value-input"), "1.000000001"), "8 decimals"],
    ["bad sequence", (row) => input(row.querySelector(".sequence-input"), "xyz"), "nSequence"],
  ])("rejects %s", (_name, mutate, expected) => {
    const { inputRow } = fillValidBuilder();
    mutate(inputRow);
    document.getElementById("createPsbt").click();
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining(expected));
    expect(window.currentPsbt).toBeNull();
  });

  it("rejects invalid scripts, wrong-network outputs, and overspending", () => {
    let rows = fillValidBuilder();
    input(rows.inputRow.querySelector(".script-input"), "6a");
    document.getElementById("createPsbt").click();
    expect(window.alert).toHaveBeenLastCalledWith("Only P2WPKH input scriptPubKey is allowed.");

    document.getElementById("clearButton").click();
    rows = fillValidBuilder();
    input(rows.outputRow.querySelector(".output-address"), TESTNET_PAYMENT.address);
    document.getElementById("createPsbt").click();
    expect(window.alert).toHaveBeenLastCalledWith(expect.stringContaining("invalid address"));

    document.getElementById("clearButton").click();
    fillValidBuilder({ inputBtc: "1", outputBtc: "1.1" });
    document.getElementById("createPsbt").click();
    expect(window.alert).toHaveBeenLastCalledWith("Outputs exceed inputs!");
  });
});

describe("import, copy, download, and clear", () => {
  it("round-trips PSBT Base64 and PSBT hex into the form", () => {
    fillValidBuilder();
    change(document.getElementById("sighashType"), "ALL");
    document.getElementById("createPsbt").click();
    const psbt = window.currentPsbt;

    document.getElementById("clearButton").click();
    input(document.getElementById("importData"), ` \n${psbt.toBase64()} `);
    document.getElementById("importDataButton").click();
    expect(document.querySelector(".txid-input").value).toBe(TXID);
    expect(document.querySelector(".value-input").value).toBe("1.00000000");
    expect(document.getElementById("sighashType").value).toBe("ALL");

    input(document.getElementById("importData"), psbt.toHex());
    document.getElementById("importDataButton").click();
    expect(document.querySelector(".vout-input").value).toBe("1");
  });

  it("imports raw transactions and warns that prevout metadata is absent", () => {
    const tx = makeRawTransaction();
    input(document.getElementById("importData"), tx.toHex());
    document.getElementById("importDataButton").click();
    expect(document.querySelector(".txid-input").value).toBe("33".repeat(32));
    expect(document.querySelector(".value-input").value).toBe("");
    expect(document.getElementById("txLocktime").value).toBe("0000000c");
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining("prevout value/scriptPubKey"));
  });

  it("reports empty and unsupported imports without replacing the form", () => {
    document.getElementById("importDataButton").click();
    expect(window.alert).toHaveBeenLastCalledWith(expect.stringContaining("Paste PSBT"));
    input(document.getElementById("importData"), "not a transaction");
    document.getElementById("importDataButton").click();
    expect(window.alert).toHaveBeenLastCalledWith(expect.stringContaining("Unsupported format"));
    expect(document.querySelectorAll("[data-utxo]")).toHaveLength(1);
  });

  it("copies Base64 and reports clipboard failures", async () => {
    vi.useFakeTimers();
    fillValidBuilder();
    document.getElementById("createPsbt").click();
    document.getElementById("copyPsbtButton").click();
    await vi.runAllTicks();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(document.getElementById("psbtBase64").value);
    expect(document.getElementById("copyPsbtButton").textContent).toBe("Copied!");
    vi.advanceTimersByTime(2000);
    expect(document.getElementById("copyPsbtButton").textContent).toBe("Copy to Clipboard");
    vi.useRealTimers();

    navigator.clipboard.writeText.mockRejectedValueOnce(new Error("denied"));
    document.getElementById("copyPsbtButton").click();
    await Promise.resolve();
    await Promise.resolve();
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining("Failed to copy"));
  });

  it("downloads the current PSBT as unsigned.psbt", () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    fillValidBuilder();
    document.getElementById("createPsbt").click();
    document.getElementById("downloadPsbtButton").click();
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(clickSpy).toHaveBeenCalled();
    const anchor = clickSpy.mock.instances[0];
    expect(anchor.download).toBe("unsigned.psbt");
  });

  it("clears all optional and generated state", () => {
    fillValidBuilder();
    input(document.getElementById("importData"), "anything");
    document.getElementById("includeOpReturn").checked = true;
    change(document.getElementById("includeOpReturn"));
    input(document.getElementById("opReturnMessage"), "hello");
    document.getElementById("createPsbt").click();
    document.getElementById("clearButton").click();
    expect(document.getElementById("importData").value).toBe("");
    expect(document.getElementById("includeOpReturn").checked).toBe(false);
    expect(document.getElementById("opReturnMessage").value).toBe("");
    expect(document.getElementById("psbtBase64").value).toBe("");
    expect(window.currentPsbt).toBeNull();
  });
});
