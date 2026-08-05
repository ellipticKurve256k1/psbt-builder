import { beforeAll, describe, expect, it, vi } from "vitest";
import { Buffer } from "buffer";
import * as bitcoin from "bitcoinjs-lib";
import {
  MAINNET_PAYMENT,
  P2WPKH_HASH,
  TESTNET_PAYMENT,
  TXID,
  loadApp,
  makeRawTransaction,
} from "./helpers.js";

let app;

beforeAll(async () => {
  app = await loadApp();
});

describe("core validation and formatting", () => {
  it("maps supported networks and rejects unknown networks", () => {
    expect(app.getNetworkConfig("mainnet").bitcoinNetwork).toBe(bitcoin.networks.bitcoin);
    expect(app.getNetworkConfig("testnet").bitcoinNetwork).toBe(bitcoin.networks.testnet);
    expect(app.getNetworkConfig("signet").mempoolPath).toBe("/signet");
    expect(() => app.getNetworkConfig("regtest")).toThrow("Unsupported network");
  });

  it("validates addresses and P2WPKH scripts by network", () => {
    expect(app.validateBitcoinAddress(MAINNET_PAYMENT.address, bitcoin.networks.bitcoin)).toBe(true);
    expect(app.validateBitcoinAddress(MAINNET_PAYMENT.address, bitcoin.networks.testnet)).toBe(false);
    expect(app.validateBitcoinAddress(TESTNET_PAYMENT.address, bitcoin.networks.testnet)).toBe(true);
    const scriptHex = Buffer.from(MAINNET_PAYMENT.output).toString("hex");
    expect(app.isP2wpkhScript(app.hexToBytes(scriptHex))).toBe(true);
    expect(app.decodeP2wpkhAddressFromScript(scriptHex, bitcoin.networks.bitcoin)).toBe(MAINNET_PAYMENT.address);
    expect(app.decodeP2wpkhAddressFromScript("6a", bitcoin.networks.bitcoin)).toBeNull();

    const p2pkh = bitcoin.payments.p2pkh({ hash: P2WPKH_HASH, network: bitcoin.networks.bitcoin });
    const p2sh = bitcoin.payments.p2sh({ redeem: MAINNET_PAYMENT, network: bitcoin.networks.bitcoin });
    expect(app.validateBitcoinAddress(p2pkh.address, bitcoin.networks.bitcoin)).toBe(true);
    expect(app.validateBitcoinAddress(p2sh.address, bitcoin.networks.bitcoin)).toBe(true);
    expect(app.validateBitcoinAddress(p2pkh.address, bitcoin.networks.testnet)).toBe(false);
    expect(app.hexToBytes(null)).toHaveLength(0);
    expect(app.decodeP2wpkhAddressFromScript("zz", bitcoin.networks.bitcoin)).toBeNull();
  });

  it("parses strict hexadecimal and uint32 fields", () => {
    expect(Array.from(app.hexToBytes("00aAff"))).toEqual([0, 170, 255]);
    expect(app.hexToBytes("")).toHaveLength(0);
    expect(() => app.hexToBytes("abc")).toThrow("Invalid hex string");
    expect(() => app.hexToBytes("zz")).toThrow("Invalid hex string");
    expect(app.parseUint32Hex("0Xffffffff", "Locktime")).toBe(0xffffffff);
    expect(app.formatUint32Hex(1)).toBe("00000001");
    expect(app.isValidUint32Hex("1234abcd")).toBe(true);
    expect(app.isValidUint32Hex("")).toBe(false);
    expect(() => app.parseUint32Hex("100000000", "Locktime")).toThrow("1-8 hex digits");
    expect(() => app.parseUint32Hex("", "Locktime")).toThrow("required");
  });

  it("parses transaction versions, vouts, and exact BTC values", () => {
    expect(app.parseTxVersion("2")).toBe(2);
    expect(app.isValidTxVersion("4294967295")).toBe(true);
    expect(app.isValidTxVersion("-1")).toBe(false);
    expect(() => app.parseTxVersion("2.0")).toThrow("decimal integer");
    expect(() => app.parseTxVersion("")).toThrow("required");
    expect(() => app.parseTxVersion("4294967296")).toThrow("out of range");
    expect(app.parseVout("4294967295", "vout")).toBe(0xffffffff);
    expect(() => app.parseVout("-1", "vout")).toThrow("unsigned decimal");
    expect(app.parseBtcToSafeSats(".00000001", "amount")).toBe(1);
    expect(app.parseBtcToSafeSats("1.23456789", "amount")).toBe(123456789);
    expect(() => app.parseBtcToSafeSats("1.000000001", "amount")).toThrow("up to 8 decimals");
    expect(() => app.parseBtcToSafeSats("NaN", "amount")).toThrow("non-negative");
    expect(() => app.parseBtcToSafeSats("90071993", "amount")).toThrow("too large");
    expect(() => app.parseVout("4294967296", "vout")).toThrow("out of range");
  });

  it("maps every supported sighash option in both directions", () => {
    const names = [
      "ALL", "NONE", "SINGLE", "ALL_ANYONECANPAY",
      "NONE_ANYONECANPAY", "SINGLE_ANYONECANPAY",
    ];
    for (const name of names) {
      expect(app.sighashTypeToOption(app.optionToSighashType(name))).toBe(name);
    }
    expect(app.optionToSighashType("DEFAULT")).toBeUndefined();
    expect(app.optionToSighashType("INHERIT", true)).toBeNull();
    expect(() => app.optionToSighashType("BAD")).toThrow("Invalid sighash");
    expect(app.sighashTypeToOption(7)).toBeNull();
    expect(app.sighashTypeToOption(undefined)).toBe("DEFAULT");
  });

  it("handles OP_RETURN byte state, extraction, and display conversion", () => {
    expect(app.getOpReturnByteState("hello")).toEqual({ bytes: 5, error: "" });
    expect(app.getOpReturnByteState("한").bytes).toBe(3);
    expect(app.getOpReturnByteState("0X00ff")).toEqual({ bytes: 2, error: "" });
    expect(app.getOpReturnByteState("0x")).toEqual({ bytes: 0, error: "" });
    expect(app.getOpReturnByteState("0x0").error).toContain("even");
    expect(app.getOpReturnByteState("0xgg").error).toContain("Invalid");

    const data = Buffer.from("hello");
    const script = bitcoin.script.compile([bitcoin.opcodes.OP_RETURN, data]);
    expect(Buffer.from(app.extractOpReturnData(script)).toString()).toBe("hello");
    expect(app.extractOpReturnData(MAINNET_PAYMENT.output)).toBeNull();
    expect(app.opReturnDataToMessage(data)).toBe("hello");
    expect(app.opReturnDataToMessage(Uint8Array.from([0xff]))).toBe("0xff");
    expect(app.opReturnDataToMessage(Uint8Array.from([0]))).toBe("0x00");
    expect(app.opReturnDataToMessage(new Uint8Array())).toBe("");
    const nonDataOpReturn = bitcoin.script.compile([bitcoin.opcodes.OP_RETURN, bitcoin.opcodes.OP_1]);
    expect(app.extractOpReturnData(nonDataOpReturn)).toBeNull();
  });

  it("builds PSBT edge cases and parses unusual output scripts", () => {
    const baseInput = {
      txid: TXID,
      vout: 0,
      value: 1000,
      scriptPubKey: Buffer.from(MAINNET_PAYMENT.output).toString("hex"),
    };
    const outputs = [{ address: MAINNET_PAYMENT.address, value: 1000 }];
    const psbt = app.createPsbtFromInputs([baseInput], outputs, 0, "", null);
    expect(psbt.txInputs[0].sequence).toBe(0xfffffffd);
    expect(psbt.data.inputs[0].sighashType).toBeUndefined();
    expect(() => app.createPsbtFromInputs(
      [{ ...baseInput, scriptPubKey: "6a" }], outputs, 0, "", null
    )).toThrow("Only P2WPKH");

    const noPositiveChange = app.createPsbtFromInputs(
      [baseInput], outputs, 1, MAINNET_PAYMENT.address, null
    );
    expect(noPositiveChange.txOutputs).toHaveLength(1);

    const opOne = bitcoin.script.compile([bitcoin.opcodes.OP_RETURN, Buffer.from("one")]);
    const opTwo = bitcoin.script.compile([bitcoin.opcodes.OP_RETURN, Buffer.from("two")]);
    const warnings = [];
    const parsed = app.parseOutputsFromScripts([
      { script: opOne, value: 0n },
      { script: opTwo, value: 0n },
      { script: Uint8Array.from([0xff]), value: 10n },
      { script: MAINNET_PAYMENT.output, address: MAINNET_PAYMENT.address, value: 20n },
    ], bitcoin.networks.bitcoin, warnings);
    expect(parsed.opReturnMessage).toBe("one");
    expect(parsed.outputs).toHaveLength(2);
    expect(warnings).toEqual(expect.arrayContaining([
      expect.stringContaining("Multiple OP_RETURN"),
      expect.stringContaining("could not be converted"),
    ]));
  });

  it("formats amounts and derives global/per-input sighash choices", () => {
    expect(app.satoshiToBtcString(123456789n)).toBe("1.23456789");
    expect(app.bytesToHex(Uint8Array.from([0, 255]))).toBe("00ff");
    expect(app.inputHashToTxid(Uint8Array.from([1, 2, 3]))).toBe("030201");
    expect(app.deriveGlobalAndPerInputSighash([])).toEqual({
      globalSighashOption: "DEFAULT", perInputSighashOptions: [],
    });
    expect(app.deriveGlobalAndPerInputSighash(["ALL", "ALL"])).toEqual({
      globalSighashOption: "ALL", perInputSighashOptions: ["INHERIT", "INHERIT"],
    });
    expect(app.deriveGlobalAndPerInputSighash(["ALL", "NONE"]).globalSighashOption).toBe("DEFAULT");
  });
});

describe("raw transaction primitives", () => {
  it("reads fixed fields and every CompactSize width", () => {
    expect(app.readFixedHex("001122", 1, 2, "field")).toEqual({ segment: "1122", nextOffsetBytes: 3 });
    expect(() => app.readFixedHex("00", 0, 2, "field")).toThrow("Unexpected end");
    expect(app.readVarIntHex("fc", 0, "count").value).toBe(252);
    expect(app.readVarIntHex("fdfd00", 0, "count").value).toBe(253);
    expect(app.readVarIntHex("fe00000100", 0, "count").value).toBe(65536);
    expect(app.readVarIntHex("ff0100000000000000", 0, "count").value).toBe(1n);
    expect(app.toSafeCount(2n, "count")).toBe(2);
    expect(() => app.toSafeCount(BigInt(Number.MAX_SAFE_INTEGER) + 1n, "count")).toThrow("too large");
  });

  it("segments legacy and SegWit transactions and rejects malformed data", () => {
    const legacy = makeRawTransaction().toHex();
    const segwit = makeRawTransaction({ segwit: true }).toHex();
    expect(app.parseRawTxHexSegments(legacy).at(-1).label).toContain("locktime");
    expect(app.parseRawTxHexSegments(segwit).some((segment) => segment.label.includes("witness item"))).toBe(true);
    expect(app.parseRawTxHexSegments("  ")).toEqual([]);
    expect(() => app.parseRawTxHexSegments("abc")).toThrow("Invalid hex");
    expect(() => app.parseRawTxHexSegments(`${legacy}00`)).toThrow("trailing bytes");
  });

  it("normalizes payloads and formats inferred sighashes", () => {
    expect(app.normalizeHexInput(" AA\nBB ")).toBe("aabb");
    expect(app.isValidTxid("ab".repeat(32))).toBe(true);
    expect(app.isValidTxid("ab")).toBe(false);
    expect(app.isValidHexPayload("00ff")).toBe(true);
    expect(app.isValidHexPayload("0")).toBe(false);
    expect(app.tryDecodeSighashType(Buffer.alloc(64, 1))).toBe(bitcoin.Transaction.SIGHASH_DEFAULT);
    const taprootWithHashType = Buffer.alloc(65, 1);
    taprootWithHashType[64] = bitcoin.Transaction.SIGHASH_SINGLE;
    expect(app.tryDecodeSighashType(taprootWithHashType)).toBe(bitcoin.Transaction.SIGHASH_SINGLE);
    expect(app.tryDecodeSighashType(new Uint8Array())).toBeNull();
    expect(app.tryDecodeSighashType("signature")).toBeNull();
    expect(app.inferInputSighashType({ witness: [taprootWithHashType], script: new Uint8Array() }))
      .toBe(bitcoin.Transaction.SIGHASH_SINGLE);
    expect(app.inferInputSighashType({ witness: [], script: bitcoin.script.compile([Buffer.alloc(64, 1)]) }))
      .toBe(bitcoin.Transaction.SIGHASH_DEFAULT);
    expect(app.inferInputSighashType({})).toBeNull();
    expect(app.formatSighashLabel(null)).toBe("Unknown");
    expect(app.formatSighashLabel(bitcoin.Transaction.SIGHASH_DEFAULT)).toContain("DEFAULT");
    expect(app.formatSighashLabel(bitcoin.Transaction.SIGHASH_ALL)).toContain("SIGHASH_ALL");
    expect(app.formatSighashLabel(0x81)).toContain("ANYONECANPAY");
    expect(app.formatSighashLabel(7)).toContain("Unknown");
  });
});

describe("fee primitives and mempool client", () => {
  it("parses and formats calculator BTC and fee-rate values", () => {
    expect(app.parseCalculatorBtc("1.2", "fee")).toBe(120000000n);
    expect(app.formatCalculatorBtc(-1n)).toBe("-0.00000001");
    expect(() => app.parseCalculatorBtc("-1", "fee")).toThrow("non-negative");
    expect(() => app.parseCalculatorBtc("90071993", "fee")).toThrow("too large");
    expect(app.parseCalculatorFeeRate("1.25")).toBe(125000000n);
    expect(app.formatCalculatorFeeRate(125000000n)).toBe("1.25");
    expect(app.formatCalculatorFeeRate(200000000n)).toBe("2");
    expect(() => app.parseCalculatorFeeRate("")).toThrow("required");
    expect(app.compactSizeLength(252)).toBe(1);
    expect(app.compactSizeLength(253)).toBe(3);
    expect(app.compactSizeLength(65536)).toBe(5);
    expect(app.compactSizeLength(0x100000000)).toBe(9);
  });

  it("builds network-specific mempool URLs", () => {
    expect(app.getMempoolTxApiBase("mainnet", "aa")).toBe("https://mempool.space/api/tx/aa");
    expect(app.getMempoolTxApiBase("testnet", "aa")).toContain("/testnet/api/tx/aa");
    expect(app.getMempoolTxApiBase("signet", "aa")).toContain("/signet/api/tx/aa");
  });

  it("loads /hex, falls back to JSON, and reports bad responses", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, text: async () => " AA BB " });
    await expect(app.fetchRawTxHexFromMempool("AB", "mainnet")).resolves.toBe("aabb");

    fetch.mockReset()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ hex: "00ff" }) });
    await expect(app.fetchRawTxHexFromMempool("ab", "testnet")).resolves.toBe("00ff");

    fetch.mockReset().mockResolvedValueOnce({ ok: true, text: async () => "not-hex" });
    await expect(app.fetchRawTxHexFromMempool("ab")).rejects.toThrow("invalid hex");

    fetch.mockReset()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: false, status: 503 });
    await expect(app.fetchRawTxHexFromMempool("ab")).rejects.toThrow("status 503");

    fetch.mockReset()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ hex: "xyz" }) });
    await expect(app.fetchRawTxHexFromMempool("ab")).rejects.toThrow("invalid hex");

    fetch.mockReset()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    await expect(app.fetchRawTxHexFromMempool("ab")).rejects.toThrow("Raw hex not found");
  });
});
