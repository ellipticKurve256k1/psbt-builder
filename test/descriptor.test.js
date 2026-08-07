import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { checksum } from "@bitcoinerlab/descriptors-core";
import { BIP32Factory } from "bip32";
import { ECPairFactory } from "ecpair";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "@bitcoin-js/tiny-secp256k1-asmjs";
import {
  MAX_DERIVATION_COUNT,
  MAX_UNHARDENED_INDEX,
  assertPublicMultipathDescriptor,
  calculateEsploraBalance,
  containsPrivateKeyMaterial,
  deriveDescriptorAddressPairs,
  fetchDescriptorAddressBalances,
  fetchEsploraAddressBalance,
  formatAddressBalance,
  getEsploraAddressApiUrl,
  parseDescriptorRange,
} from "../descriptor.js";
import { change, input, loadApp } from "./helpers.js";

const MAINNET = bitcoin.networks.bitcoin;
const TESTNET = bitcoin.networks.testnet;
const BIP32 = BIP32Factory(ecc);
const ECPair = ECPairFactory(ecc);
const rootA = BIP32.fromSeed(Uint8Array.from({ length: 32 }, (_, index) => index + 1), MAINNET);
const rootB = BIP32.fromSeed(Uint8Array.from({ length: 32 }, (_, index) => 255 - index), MAINNET);
const xpubA = rootA.neutered().toBase58();
const xpubB = rootB.neutered().toBase58();
const wpkhDescriptor = `wpkh(${xpubA}/<0;1>/*)`;
const taprootDescriptor = `tr(${xpubA}/<0;1>/*)`;
const multisigDescriptor = `wsh(sortedmulti(2,${xpubA}/<0;1>/*,${xpubB}/<0;1>/*))`;

function esploraData(balance = 1000) {
  return {
    chain_stats: {
      tx_count: balance > 0 ? 1 : 0,
      funded_txo_count: balance > 0 ? 1 : 0,
      funded_txo_sum: Math.max(0, balance),
      spent_txo_count: 0,
      spent_txo_sum: 0,
    },
    mempool_stats: {
      tx_count: 0,
      funded_txo_count: 0,
      funded_txo_sum: 0,
      spent_txo_count: 0,
      spent_txo_sum: 0,
    },
  };
}

function mockEsploraFetch(balanceForUrl = () => 1000) {
  globalThis.fetch = vi.fn(async (url) => ({
    ok: true,
    status: 200,
    json: async () => esploraData(balanceForUrl(String(url))),
  }));
  return globalThis.fetch;
}

function expectedWpkh(root, branch, index, network = MAINNET) {
  return bitcoin.payments.p2wpkh({
    pubkey: root.derive(branch).derive(index).publicKey,
    network,
  }).address;
}

function expectedTaproot(root, branch, index, network = MAINNET) {
  return bitcoin.payments.p2tr({
    internalPubkey: root.derive(branch).derive(index).publicKey.slice(1),
    network,
  }).address;
}

describe("descriptor derivation core", () => {
  it("derives deterministic receiving and change P2WPKH address pairs", () => {
    const rows = deriveDescriptorAddressPairs({
      descriptor: wpkhDescriptor,
      network: MAINNET,
      startIndex: 3,
      count: 2,
    });

    expect(rows).toEqual([
      {
        index: 3,
        receiveAddress: expectedWpkh(rootA, 0, 3),
        changeAddress: expectedWpkh(rootA, 1, 3),
      },
      {
        index: 4,
        receiveAddress: expectedWpkh(rootA, 0, 4),
        changeAddress: expectedWpkh(rootA, 1, 4),
      },
    ]);
  });

  it("supports checksummed Taproot and multisig descriptors", () => {
    const withChecksum = `${taprootDescriptor}#${checksum(taprootDescriptor)}`;
    expect(
      deriveDescriptorAddressPairs({
        descriptor: withChecksum,
        network: MAINNET,
        startIndex: "1",
        count: "1",
      })
    ).toEqual([
      {
        index: 1,
        receiveAddress: expectedTaproot(rootA, 0, 1),
        changeAddress: expectedTaproot(rootA, 1, 1),
      },
    ]);

    const row = deriveDescriptorAddressPairs({
      descriptor: multisigDescriptor,
      network: MAINNET,
      startIndex: 0,
      count: 1,
    })[0];
    const paymentFor = (branch) =>
      bitcoin.payments.p2wsh({
        redeem: bitcoin.payments.p2ms({
          m: 2,
          pubkeys: [rootA, rootB]
            .map((root) => root.derive(branch).derive(0).publicKey)
            .sort(Buffer.compare),
          network: MAINNET,
        }),
        network: MAINNET,
      }).address;
    expect(row).toEqual({ index: 0, receiveAddress: paymentFor(0), changeAddress: paymentFor(1) });
  });

  it("uses the selected network and rejects network-mismatched extended keys", () => {
    const testRoot = BIP32.fromSeed(Uint8Array.from({ length: 32 }, (_, index) => index + 1), TESTNET);
    const descriptor = `wpkh(${testRoot.neutered().toBase58()}/<0;1>/*)`;
    const row = deriveDescriptorAddressPairs({
      descriptor,
      network: TESTNET,
      startIndex: 0,
      count: 1,
    })[0];
    expect(row.receiveAddress).toBe(expectedWpkh(testRoot, 0, 0, TESTNET));
    expect(() =>
      deriveDescriptorAddressPairs({
        descriptor: wpkhDescriptor,
        network: TESTNET,
        startIndex: 0,
        count: 1,
      })
    ).toThrow("selected network");
  });

  it("validates the derivation range", () => {
    expect(parseDescriptorRange("0", String(MAX_DERIVATION_COUNT))).toEqual({
      startIndex: 0,
      count: MAX_DERIVATION_COUNT,
    });
    expect(parseDescriptorRange(MAX_UNHARDENED_INDEX, 1)).toEqual({
      startIndex: MAX_UNHARDENED_INDEX,
      count: 1,
    });
    expect(() => parseDescriptorRange("", 1)).toThrow("whole number");
    expect(() => parseDescriptorRange("1.5", 1)).toThrow("whole number");
    expect(() => parseDescriptorRange(-1, 1)).toThrow("whole number");
    expect(() => parseDescriptorRange(Number.MAX_SAFE_INTEGER + 1, 1)).toThrow("too large");
    expect(() => parseDescriptorRange(MAX_UNHARDENED_INDEX + 1, 1)).toThrow("must not exceed");
    expect(() => parseDescriptorRange(0, 0)).toThrow("between 1 and 100");
    expect(() => parseDescriptorRange(0, MAX_DERIVATION_COUNT + 1)).toThrow("between 1 and 100");
    expect(() => parseDescriptorRange(MAX_UNHARDENED_INDEX, 2)).toThrow("exceeds");
  });

  it("rejects missing multipath, invalid checksums, unsupported outputs, and missing networks", () => {
    expect(() => assertPublicMultipathDescriptor("", MAINNET)).toThrow("required");
    expect(() => assertPublicMultipathDescriptor(`wpkh(${xpubA}/0/*)`, MAINNET)).toThrow("/<0;1>/*");
    expect(() =>
      assertPublicMultipathDescriptor(`${wpkhDescriptor}#deadbeef`, MAINNET)
    ).toThrow("invalid");
    expect(() =>
      deriveDescriptorAddressPairs({
        descriptor: `pk(${xpubA}/<0;1>/*)`,
        network: MAINNET,
        startIndex: 0,
        count: 1,
      })
    ).toThrow("does not produce one address");
    expect(() =>
      deriveDescriptorAddressPairs({ descriptor: wpkhDescriptor, startIndex: 0, count: 1 })
    ).toThrow("network is required");
  });

  it("rejects extended and WIF private key material", () => {
    const xprvDescriptor = `wpkh(${rootA.toBase58()}/<0;1>/*)`;
    const wif = ECPair.fromPrivateKey(Uint8Array.from({ length: 32 }, () => 1), {
      network: MAINNET,
    }).toWIF();
    expect(containsPrivateKeyMaterial(xprvDescriptor)).toBe(true);
    expect(containsPrivateKeyMaterial(`wpkh(${wif})`)).toBe(true);
    expect(containsPrivateKeyMaterial(wpkhDescriptor)).toBe(false);
    expect(() => assertPublicMultipathDescriptor(xprvDescriptor, MAINNET)).toThrow("Private keys");
    expect(() => assertPublicMultipathDescriptor(`wpkh(${wif}/<0;1>/*)`, MAINNET)).toThrow(
      "Private keys"
    );
  });
});

describe("Esplora descriptor balances", () => {
  it("builds selected-network URLs and calculates confirmed plus mempool balance", () => {
    expect(getEsploraAddressApiUrl("mainnet", "bc1qtest"))
      .toBe("https://blockstream.info/api/address/bc1qtest");
    expect(getEsploraAddressApiUrl("testnet", "tb1qtest"))
      .toBe("https://blockstream.info/testnet/api/address/tb1qtest");
    expect(getEsploraAddressApiUrl("signet", "tb1qtest"))
      .toBe("https://blockstream.info/signet/api/address/tb1qtest");
    expect(() => getEsploraAddressApiUrl("unknown", "bc1qtest")).toThrow("Unsupported network");

    expect(calculateEsploraBalance({
      chain_stats: { funded_txo_sum: 10_000, spent_txo_sum: 2_000 },
      mempool_stats: { funded_txo_sum: 500, spent_txo_sum: 250 },
    })).toBe(8250n);
    expect(formatAddressBalance(8250n)).toBe("0.00008250 BTC (8,250 sats)");
  });

  it("fetches every address in the exact range and preserves pair ordering", async () => {
    const rows = deriveDescriptorAddressPairs({
      descriptor: wpkhDescriptor,
      network: MAINNET,
      startIndex: 4,
      count: 2,
    });
    const fetchSpy = mockEsploraFetch((url) => url.includes(rows[0].receiveAddress) ? 5000 : 0);
    const balanced = await fetchDescriptorAddressBalances(rows, "mainnet", { concurrency: 2 });

    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(balanced).toEqual([
      { ...rows[0], receiveBalanceSats: 5000n, changeBalanceSats: 0n },
      { ...rows[1], receiveBalanceSats: 0n, changeBalanceSats: 0n },
    ]);
  });

  it("rejects failed and malformed API responses", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 429 });
    await expect(fetchEsploraAddressBalance("bc1qtest", "mainnet"))
      .rejects.toThrow("status 429");

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ chain_stats: {}, mempool_stats: {} }),
    });
    await expect(fetchEsploraAddressBalance("bc1qtest", "mainnet"))
      .rejects.toThrow("invalid chain funded total");
  });
});

describe("descriptor address page", () => {
  beforeAll(async () => {
    await loadApp();
  });

  beforeEach(() => {
    document.getElementById("clearDescriptorButton").click();
    change(document.getElementById("network"), "mainnet");
    navigator.clipboard.writeText.mockResolvedValue(undefined);
    mockEsploraFetch();
  });

  it("navigates to a separate descriptor page", () => {
    document.getElementById("openDescriptorPage").click();
    expect(document.getElementById("builderPage").classList.contains("hidden")).toBe(true);
    expect(document.getElementById("decoderPage").classList.contains("hidden")).toBe(true);
    expect(document.getElementById("descriptorPage").classList.contains("hidden")).toBe(false);
    expect(document.getElementById("openDescriptorPage").getAttribute("aria-pressed")).toBe("true");
  });

  it("derives, renders, copies, and clears address pairs", async () => {
    input(document.getElementById("descriptorInput"), wpkhDescriptor);
    input(document.getElementById("descriptorStartIndex"), "2");
    input(document.getElementById("descriptorCount"), "2");
    document.getElementById("deriveDescriptorButton").click();

    expect(document.getElementById("descriptorLoading").hidden).toBe(false);
    expect(document.getElementById("deriveDescriptorButton").disabled).toBe(true);
    expect(document.getElementById("deriveDescriptorButton").textContent).toBe("Deriving…");
    expect(document.getElementById("descriptorDerivationPanel").getAttribute("aria-busy")).toBe(
      "true"
    );
    await vi.waitFor(() => expect(document.getElementById("descriptorLoading").hidden).toBe(true));

    const receivingRows = document.querySelectorAll("#receivingAddressList .descriptor-address-row");
    const changeRows = document.querySelectorAll("#changeAddressList .descriptor-address-row");
    expect(receivingRows).toHaveLength(2);
    expect(changeRows).toHaveLength(2);
    expect(receivingRows[0].textContent).toContain(expectedWpkh(rootA, 0, 2));
    expect(changeRows[0].textContent).toContain(expectedWpkh(rootA, 1, 2));
    expect(receivingRows[0].textContent).toContain("0.00001000 BTC (1,000 sats)");
    expect(document.getElementById("descriptorStatus").textContent).toContain("Derived 2 address pairs locally");
    expect(document.getElementById("deriveDescriptorButton").disabled).toBe(false);
    expect(document.getElementById("descriptorDerivationPanel").getAttribute("aria-busy")).toBe(
      "false"
    );

    receivingRows[0].querySelector(".descriptor-copy-button").click();
    await vi.waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expectedWpkh(rootA, 0, 2))
    );

    document.getElementById("clearDescriptorButton").click();
    expect(document.getElementById("descriptorInput").value).toBe("");
    expect(document.getElementById("descriptorStartIndex").value).toBe("0");
    expect(document.getElementById("descriptorCount").value).toBe("20");
    expect(document.getElementById("descriptorResults").hidden).toBe(true);
  });

  it("shows only positive balances and reports empty branches", async () => {
    const fundedReceive = expectedWpkh(rootA, 0, 1);
    mockEsploraFetch((url) => url.includes(fundedReceive) ? 25_000 : 0);
    input(document.getElementById("descriptorInput"), wpkhDescriptor);
    input(document.getElementById("descriptorCount"), "2");
    document.getElementById("deriveDescriptorButton").click();

    await vi.waitFor(() =>
      expect(document.querySelectorAll("#receivingAddressList .descriptor-address-row")).toHaveLength(1)
    );
    expect(document.getElementById("receivingAddressList").textContent).toContain(fundedReceive);
    expect(document.getElementById("receivingAddressList").textContent)
      .not.toContain(expectedWpkh(rootA, 0, 0));
    expect(document.querySelectorAll("#changeAddressList .descriptor-address-row")).toHaveLength(0);
    expect(document.getElementById("changeAddressList").textContent).toContain(
      "No change addresses with available balance"
    );
  });

  it("uses a funded address as a blank Builder output without replacing populated rows", async () => {
    const address = expectedWpkh(rootA, 0, 0);
    input(document.getElementById("descriptorInput"), wpkhDescriptor);
    input(document.getElementById("descriptorCount"), "1");
    document.getElementById("openDescriptorPage").click();
    document.getElementById("deriveDescriptorButton").click();
    await vi.waitFor(() => expect(document.querySelector(".descriptor-use-output-button")).not.toBeNull());

    document.querySelector(".descriptor-use-output-button").click();
    const firstOutput = document.querySelector("[data-output]");
    expect(firstOutput.querySelector(".output-address").value).toBe(address);
    expect(firstOutput.querySelectorAll("input")[1].value).toBe("");
    expect(firstOutput.querySelector(".output-address").style.borderColor).toBe("rgb(247, 147, 26)");
    expect(document.getElementById("builderPage").classList.contains("hidden")).toBe(false);

    input(firstOutput.querySelectorAll("input")[1], "0.1");
    document.getElementById("openDescriptorPage").click();
    document.querySelector(".descriptor-use-output-button").click();
    const outputs = document.querySelectorAll("[data-output]");
    expect(outputs).toHaveLength(2);
    expect(outputs[0].querySelector(".output-address").value).toBe(address);
    expect(outputs[0].querySelectorAll("input")[1].value).toBe("0.1");
    expect(outputs[1].querySelector(".output-address").value).toBe(address);
    expect(outputs[1].querySelectorAll("input")[1].value).toBe("");

    outputs[1].querySelector(".remove").click();
    input(firstOutput.querySelector(".output-address"), "");
    input(firstOutput.querySelectorAll("input")[1], "");
  });

  it("stacks receiving above change in independently scrollable components and collapses results", async () => {
    input(document.getElementById("descriptorInput"), wpkhDescriptor);
    input(document.getElementById("descriptorCount"), "2");
    document.getElementById("deriveDescriptorButton").click();
    await vi.waitFor(() =>
      expect(document.querySelectorAll("#receivingAddressList .descriptor-address-row")).toHaveLength(2)
    );

    const receivingList = document.getElementById("receivingAddressList");
    const changeList = document.getElementById("changeAddressList");
    const content = document.getElementById("descriptorResultsContent");
    const toggle = document.getElementById("descriptorResultsToggle");
    expect(receivingList.classList.contains("descriptor-address-scroll")).toBe(true);
    expect(changeList.classList.contains("descriptor-address-scroll")).toBe(true);
    expect(
      receivingList.compareDocumentPosition(changeList) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(content.hidden).toBe(false);

    toggle.click();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(content.hidden).toBe(true);
    toggle.click();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(content.hidden).toBe(false);
  });

  it("shows inline errors and handles clipboard failure", async () => {
    document.getElementById("deriveDescriptorButton").click();
    await vi.waitFor(() =>
      expect(document.getElementById("descriptorStatus").classList.contains("error")).toBe(true)
    );

    input(document.getElementById("descriptorInput"), wpkhDescriptor);
    input(document.getElementById("descriptorCount"), "1");
    document.getElementById("deriveDescriptorButton").click();
    await vi.waitFor(() => expect(document.querySelector(".descriptor-copy-button")).not.toBeNull());
    navigator.clipboard.writeText.mockRejectedValueOnce(new Error("denied"));
    document.querySelector(".descriptor-copy-button").click();
    await vi.waitFor(() =>
      expect(document.getElementById("descriptorStatus").textContent).toContain("Failed to copy")
    );
  });

  it("shows no partial results when a balance lookup fails", async () => {
    let requestCount = 0;
    globalThis.fetch = vi.fn(async () => {
      requestCount += 1;
      if (requestCount === 2) return { ok: false, status: 429 };
      return { ok: true, status: 200, json: async () => esploraData(1000) };
    });
    input(document.getElementById("descriptorInput"), wpkhDescriptor);
    input(document.getElementById("descriptorCount"), "2");
    document.getElementById("deriveDescriptorButton").click();

    await vi.waitFor(() =>
      expect(document.getElementById("descriptorStatus").textContent).toContain("status 429")
    );
    expect(document.getElementById("descriptorStatus").classList.contains("error")).toBe(true);
    expect(document.getElementById("descriptorResults").hidden).toBe(true);
    expect(document.querySelectorAll(".descriptor-address-row")).toHaveLength(0);
  });

  it("aborts and clears an in-flight balance scan", async () => {
    let requestSignal;
    globalThis.fetch = vi.fn((_, options) => {
      requestSignal = options.signal;
      return new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    });
    input(document.getElementById("descriptorInput"), wpkhDescriptor);
    input(document.getElementById("descriptorCount"), "1");
    document.getElementById("deriveDescriptorButton").click();
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());

    document.getElementById("clearDescriptorButton").click();
    expect(requestSignal.aborted).toBe(true);
    expect(document.getElementById("descriptorLoading").hidden).toBe(true);
    expect(document.getElementById("descriptorStatus").textContent).toBe("");
    expect(document.getElementById("descriptorResults").hidden).toBe(true);
  });

  it("re-derives on network changes and sends only derived addresses externally", async () => {
    const fetchSpy = mockEsploraFetch();
    const xhrSpy = vi.spyOn(XMLHttpRequest.prototype, "open");
    const storageSpy = vi.spyOn(Storage.prototype, "setItem");
    const beaconSpy = vi.fn();
    Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: beaconSpy });
    const webSocketSpy = vi.fn();
    globalThis.WebSocket = webSocketSpy;
    const originalUrl = window.location.href;

    input(document.getElementById("descriptorInput"), wpkhDescriptor);
    input(document.getElementById("descriptorCount"), "1");
    document.getElementById("deriveDescriptorButton").click();
    await vi.waitFor(() =>
      expect(document.querySelectorAll("#receivingAddressList .descriptor-address-row")).toHaveLength(1)
    );

    change(document.getElementById("network"), "testnet");
    await vi.waitFor(() =>
      expect(document.getElementById("descriptorStatus").textContent).toContain("selected network")
    );
    expect(document.getElementById("descriptorResults").hidden).toBe(true);
    change(document.getElementById("network"), "mainnet");
    await vi.waitFor(() =>
      expect(document.querySelectorAll("#receivingAddressList .descriptor-address-row")).toHaveLength(1)
    );
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    fetchSpy.mock.calls.forEach(([url, options]) => {
      expect(url).toMatch(/^https:\/\/blockstream\.info\/api\/address\/bc1/);
      expect(url).not.toContain(wpkhDescriptor);
      expect(options.headers).toEqual({ Accept: "application/json" });
    });
    expect(xhrSpy).not.toHaveBeenCalled();
    expect(beaconSpy).not.toHaveBeenCalled();
    expect(webSocketSpy).not.toHaveBeenCalled();
    expect(storageSpy).not.toHaveBeenCalled();
    expect(window.location.href).toBe(originalUrl);
  });
});
