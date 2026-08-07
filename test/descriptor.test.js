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
  classifyAddressActivity,
  containsPrivateKeyMaterial,
  deriveDescriptorAddressPairs,
  discoverDescriptorAddresses,
  fetchDescriptorAddressBalances,
  fetchEsploraAddressBalance,
  fetchEsploraAddressUtxos,
  formatAddressBalance,
  getEsploraAddressApiUrl,
  getEsploraAddressUtxoUrl,
  parseEsploraAddressActivity,
  parseEsploraAddressUtxos,
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

function esploraData(balance = 0, { chainTxCount = balance > 0 ? 1 : 0, mempoolTxCount = 0 } = {}) {
  return {
    chain_stats: {
      tx_count: chainTxCount,
      funded_txo_count: balance > 0 ? 1 : 0,
      funded_txo_sum: Math.max(0, balance),
      spent_txo_count: 0,
      spent_txo_sum: 0,
    },
    mempool_stats: {
      tx_count: mempoolTxCount,
      funded_txo_count: 0,
      funded_txo_sum: 0,
      spent_txo_count: 0,
      spent_txo_sum: 0,
    },
  };
}

function mockEsploraFetch(activityForUrl = () => ({ balance: 0 })) {
  globalThis.fetch = vi.fn(async (url) => ({
    ok: true,
    status: 200,
    json: async () => {
      const activity = activityForUrl(String(url));
      if (typeof activity === "number") return esploraData(activity);
      return esploraData(activity.balance, activity);
    },
  }));
  return globalThis.fetch;
}

function mockFundedAddressWithUtxos(address, utxos) {
  globalThis.fetch = vi.fn(async (url) => ({
    ok: true,
    status: 200,
    json: async () => String(url).endsWith("/utxo")
      ? utxos
      : esploraData(String(url).includes(address) ? 200_000 : 0),
  }));
  return globalThis.fetch;
}

function confirmDescriptorDerivation() {
  document.getElementById("deriveDescriptorButton").click();
  expect(document.getElementById("descriptorPrivacyDialog").open).toBe(true);
  document.getElementById("descriptorPrivacyOk").click();
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

    expect(rows.map(({ index, receiveAddress, changeAddress }) => ({
      index,
      receiveAddress,
      changeAddress,
    }))).toEqual([
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
    expect(rows[0].receiveInputMetadata).toMatchObject({
      address: expectedWpkh(rootA, 0, 3),
      inputType: "p2wpkh",
      tapInternalKey: "",
    });
    expect(rows[0].receiveInputMetadata.scriptPubKey).toMatch(/^0014[0-9a-f]{40}$/);
  });

  it("supports checksummed Taproot and multisig descriptors", () => {
    const withChecksum = `${taprootDescriptor}#${checksum(taprootDescriptor)}`;
    const taprootRow = deriveDescriptorAddressPairs({
        descriptor: withChecksum,
        network: MAINNET,
        startIndex: "1",
        count: "1",
      })[0];
    expect(taprootRow).toMatchObject({
      index: 1,
      receiveAddress: expectedTaproot(rootA, 0, 1),
      changeAddress: expectedTaproot(rootA, 1, 1),
    });
    expect(taprootRow.receiveInputMetadata).toMatchObject({
      inputType: "p2tr",
      tapInternalKey: Buffer.from(rootA.derive(0).derive(1).publicKey.slice(1)).toString("hex"),
    });
    expect(taprootRow.receiveInputMetadata.scriptPubKey).toMatch(/^5120[0-9a-f]{64}$/);

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
    expect(row).toMatchObject({ index: 0, receiveAddress: paymentFor(0), changeAddress: paymentFor(1) });
    expect(row.receiveInputMetadata.inputType).toBeNull();
    expect(row.receiveInputMetadata.inputUnsupportedReason).toContain("Only P2WPKH");
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

    expect(classifyAddressActivity({ balanceSats: 1n, txCount: 1 })).toBe("funded");
    expect(classifyAddressActivity({ balanceSats: 0n, txCount: 0 })).toBe("unused");
    expect(classifyAddressActivity({ balanceSats: 0n, txCount: 2 })).toBe("used-empty");
    expect(parseEsploraAddressActivity(esploraData(0, { chainTxCount: 2 }))).toEqual({
      balanceSats: 0n,
      txCount: 2,
    });
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
      {
        ...rows[0],
        receiveBalanceSats: 5000n,
        receiveTxCount: 1,
        changeBalanceSats: 0n,
        changeTxCount: 0,
      },
      {
        ...rows[1],
        receiveBalanceSats: 0n,
        receiveTxCount: 0,
        changeBalanceSats: 0n,
        changeTxCount: 0,
      },
    ]);
  });

  it("builds UTXO URLs and validates Esplora outpoints", async () => {
    expect(getEsploraAddressUtxoUrl("mainnet", "bc1qtest"))
      .toBe("https://blockstream.info/api/address/bc1qtest/utxo");
    expect(getEsploraAddressUtxoUrl("testnet", "tb1qtest"))
      .toBe("https://blockstream.info/testnet/api/address/tb1qtest/utxo");
    expect(getEsploraAddressUtxoUrl("signet", "tb1qtest"))
      .toBe("https://blockstream.info/signet/api/address/tb1qtest/utxo");

    const payload = [
      {
        txid: "AA".repeat(32),
        vout: 2,
        value: 125_000,
        status: { confirmed: true, block_height: 800_000 },
      },
      {
        txid: "bb".repeat(32),
        vout: 0,
        value: 75_000,
        status: { confirmed: false },
      },
    ];
    expect(parseEsploraAddressUtxos(payload)).toEqual([
      {
        txid: "aa".repeat(32),
        vout: 2,
        valueSats: 125_000n,
        confirmed: true,
        blockHeight: 800_000,
      },
      {
        txid: "bb".repeat(32),
        vout: 0,
        valueSats: 75_000n,
        confirmed: false,
        blockHeight: null,
      },
    ]);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => payload,
    });
    await expect(fetchEsploraAddressUtxos("bc1qtest", "mainnet"))
      .resolves.toHaveLength(2);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://blockstream.info/api/address/bc1qtest/utxo",
      expect.objectContaining({ headers: { Accept: "application/json" } })
    );
  });

  it("rejects malformed and failed UTXO responses", async () => {
    expect(() => parseEsploraAddressUtxos({})).toThrow("invalid UTXO response");
    expect(() => parseEsploraAddressUtxos([
      { txid: "bad", vout: 0, value: 1, status: { confirmed: true } },
    ])).toThrow("invalid txid");
    expect(() => parseEsploraAddressUtxos([
      { txid: "aa".repeat(32), vout: -1, value: 1, status: { confirmed: true } },
    ])).toThrow("invalid vout");
    expect(() => parseEsploraAddressUtxos([
      { txid: "aa".repeat(32), vout: 0, value: -1, status: { confirmed: true } },
    ])).toThrow("invalid value");
    expect(() => parseEsploraAddressUtxos([
      { txid: "aa".repeat(32), vout: 0, value: 1, status: {} },
    ])).toThrow("confirmation status");
    expect(() => parseEsploraAddressUtxos([
      { txid: "aa".repeat(32), vout: 0, value: 1, status: { confirmed: true } },
      { txid: "aa".repeat(32), vout: 0, value: 1, status: { confirmed: true } },
    ])).toThrow("duplicate outpoint");

    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    await expect(fetchEsploraAddressUtxos("bc1qtest", "mainnet"))
      .rejects.toThrow("status 503");
  });

  it("scans beyond used addresses until each branch has the requested unused count", async () => {
    const firstReceive = expectedWpkh(rootA, 0, 0);
    const secondChange = expectedWpkh(rootA, 1, 1);
    mockEsploraFetch((url) => {
      if (url.includes(firstReceive)) return { balance: 5000 };
      if (url.includes(secondChange)) return { balance: 0, chainTxCount: 1 };
      return { balance: 0 };
    });

    const result = await discoverDescriptorAddresses({
      descriptor: wpkhDescriptor,
      network: MAINNET,
      networkValue: "mainnet",
      startIndex: 0,
      targetUnusedCount: 2,
      maxPairs: 5,
      batchSize: 1,
    });

    expect(result.scannedPairs).toBe(3);
    expect(result.receivingUnusedCount).toBe(2);
    expect(result.changeUnusedCount).toBe(2);
    expect(result.reachedLimit).toBe(false);
    expect(result.rows[0].receiveBalanceSats).toBe(5000n);
    expect(result.rows[1].changeTxCount).toBe(1);
  });

  it("returns partial unused discovery when the scan cap is reached", async () => {
    mockEsploraFetch(() => ({ balance: 0, chainTxCount: 1 }));
    const progress = vi.fn();
    const result = await discoverDescriptorAddresses({
      descriptor: wpkhDescriptor,
      network: MAINNET,
      networkValue: "mainnet",
      startIndex: 0,
      targetUnusedCount: 2,
      maxPairs: 3,
      batchSize: 2,
      onProgress: progress,
    });

    expect(result.scannedPairs).toBe(3);
    expect(result.receivingUnusedCount).toBe(0);
    expect(result.changeUnusedCount).toBe(0);
    expect(result.reachedLimit).toBe(true);
    expect(progress).toHaveBeenLastCalledWith({ scannedPairs: 3, maxPairs: 3 });
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
    const privacyDialog = document.getElementById("descriptorPrivacyDialog");
    if (privacyDialog.open) privacyDialog.close("test-reset");
    const utxoDialog = document.getElementById("descriptorUtxoDialog");
    if (utxoDialog.open) utxoDialog.close("test-reset");
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

  it("requires an explicit privacy choice before every scan", async () => {
    const fetchSpy = globalThis.fetch;
    const descriptorInput = document.getElementById("descriptorInput");
    const startInput = document.getElementById("descriptorStartIndex");
    const countInput = document.getElementById("descriptorCount");
    const dialog = document.getElementById("descriptorPrivacyDialog");
    input(descriptorInput, wpkhDescriptor);
    input(startInput, "3");
    input(countInput, "1");
    document.getElementById("openDescriptorPage").click();

    document.getElementById("deriveDescriptorButton").click();
    expect(dialog.open).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(document.getElementById("descriptorLoading").hidden).toBe(true);
    expect(document.getElementById("descriptorDerivationPanel").getAttribute("aria-busy"))
      .toBe("false");
    expect(dialog.textContent).toContain("Blockstream can observe your IP address");
    expect(dialog.textContent).toContain("200 receiving and 200 change addresses");
    expect(dialog.textContent).toContain("descriptor, xpub, and private keys remain in this browser");

    const escapeEvent = new Event("cancel", { cancelable: true });
    dialog.dispatchEvent(escapeEvent);
    expect(escapeEvent.defaultPrevented).toBe(true);
    expect(dialog.open).toBe(true);
    dialog.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(dialog.open).toBe(true);

    document.getElementById("descriptorPrivacyCancel").click();
    expect(dialog.open).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(document.getElementById("builderPage").classList.contains("hidden")).toBe(false);
    expect(descriptorInput.value).toBe(wpkhDescriptor);
    expect(startInput.value).toBe("3");
    expect(countInput.value).toBe("1");

    document.getElementById("openDescriptorPage").click();
    confirmDescriptorDerivation();
    await vi.waitFor(() => expect(document.getElementById("descriptorLoading").hidden).toBe(true));
    const completedRequestCount = fetchSpy.mock.calls.length;
    document.getElementById("deriveDescriptorButton").click();
    expect(dialog.open).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(completedRequestCount);
    document.getElementById("descriptorPrivacyCancel").click();
  });

  it("derives, renders, copies, and clears address pairs", async () => {
    input(document.getElementById("descriptorInput"), wpkhDescriptor);
    input(document.getElementById("descriptorStartIndex"), "2");
    input(document.getElementById("descriptorCount"), "2");
    confirmDescriptorDerivation();

    expect(document.getElementById("descriptorLoading").hidden).toBe(false);
    expect(document.getElementById("deriveDescriptorButton").disabled).toBe(true);
    expect(document.getElementById("deriveDescriptorButton").textContent).toBe("Scanning…");
    expect(document.getElementById("descriptorDerivationPanel").getAttribute("aria-busy")).toBe(
      "true"
    );
    await vi.waitFor(() => expect(document.getElementById("descriptorLoading").hidden).toBe(true));

    const receivingRows = document.querySelectorAll("#receivingAddressList .descriptor-address-row");
    const changeRows = document.querySelectorAll("#changeAddressList .descriptor-address-row");
    const fundedRows = document.querySelectorAll("#fundedAddressList .descriptor-address-row");
    expect(receivingRows).toHaveLength(2);
    expect(changeRows).toHaveLength(2);
    expect(fundedRows).toHaveLength(0);
    expect(receivingRows[0].textContent).toContain(expectedWpkh(rootA, 0, 2));
    expect(changeRows[0].textContent).toContain(expectedWpkh(rootA, 1, 2));
    expect(receivingRows[0].textContent).toContain("Unused");
    expect(receivingRows[0].textContent).toContain("0.00000000 BTC (0 sats)");
    expect(document.getElementById("descriptorStatus").textContent).toContain(
      "Scanned 20 address pairs locally"
    );
    expect(document.getElementById("descriptorLoadingText").textContent).toContain(
      "20 / 200 pairs checked"
    );
    expect(document.getElementById("deriveDescriptorButton").disabled).toBe(false);
    expect(document.getElementById("descriptorDerivationPanel").getAttribute("aria-busy")).toBe(
      "false"
    );
    expect(document.getElementById("receivingAddressCount").textContent).toBe("2 unused");
    expect(document.getElementById("changeAddressCount").textContent).toBe("2 unused");
    expect(document.getElementById("fundedAddressCount").textContent).toBe("0 funded");

    receivingRows[0].querySelector(".descriptor-copy-button").click();
    await vi.waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expectedWpkh(rootA, 0, 2))
    );

    document.getElementById("clearDescriptorButton").click();
    expect(document.getElementById("descriptorInput").value).toBe("");
    expect(document.getElementById("descriptorStartIndex").value).toBe("0");
    expect(document.getElementById("descriptorCount").value).toBe("20");
    expect(document.getElementById("descriptorResults").hidden).toBe(true);
    expect(document.querySelectorAll("#fundedAddressList .descriptor-address-row")).toHaveLength(0);
    expect(document.getElementById("fundedAddressCount").textContent).toBe("0 funded");
  });

  it("separates funded addresses from unused receiving and change addresses", async () => {
    const usedEmptyReceive = expectedWpkh(rootA, 0, 0);
    const fundedReceive = expectedWpkh(rootA, 0, 1);
    const fundedChange = expectedWpkh(rootA, 1, 0);
    mockEsploraFetch((url) => {
      if (url.includes(usedEmptyReceive)) return { balance: 0, chainTxCount: 1 };
      if (url.includes(fundedReceive)) return { balance: 25_000 };
      if (url.includes(fundedChange)) return { balance: 15_000 };
      return { balance: 0 };
    });
    input(document.getElementById("descriptorInput"), wpkhDescriptor);
    input(document.getElementById("descriptorCount"), "2");
    confirmDescriptorDerivation();

    await vi.waitFor(() =>
      expect(document.querySelectorAll("#fundedAddressList .descriptor-address-row")).toHaveLength(2)
    );
    expect(document.getElementById("receivingAddressList").textContent).not.toContain(fundedReceive);
    expect(document.getElementById("receivingAddressList").textContent)
      .not.toContain(usedEmptyReceive);
    expect(document.getElementById("changeAddressList").textContent).not.toContain(fundedChange);
    expect(document.querySelectorAll("#receivingAddressList .descriptor-address-badge.unused"))
      .toHaveLength(2);
    expect(document.querySelectorAll("#changeAddressList .descriptor-address-row")).toHaveLength(2);
    expect(document.querySelectorAll("#changeAddressList .descriptor-address-badge.unused"))
      .toHaveLength(2);
    const fundedRows = document.querySelectorAll("#fundedAddressList .descriptor-address-row");
    expect(fundedRows[0].textContent).toContain(fundedChange);
    expect(fundedRows[0].querySelector(".descriptor-address-branch").textContent).toBe("Change");
    expect(fundedRows[1].textContent).toContain(fundedReceive);
    expect(fundedRows[1].querySelector(".descriptor-address-branch").textContent).toBe("Receiving");
    expect(document.querySelectorAll("#fundedAddressList .descriptor-address-badge.funded"))
      .toHaveLength(2);
    expect(document.getElementById("receivingAddressCount").textContent).toBe("2 unused");
    expect(document.getElementById("changeAddressCount").textContent).toBe("2 unused");
    expect(document.getElementById("fundedAddressCount").textContent).toBe("2 funded");
  });

  it("selects confirmed and opt-in unconfirmed UTXOs and imports them as Builder inputs", async () => {
    const address = expectedWpkh(rootA, 0, 0);
    const utxos = [
      {
        txid: "aa".repeat(32),
        vout: 1,
        value: 125_000,
        status: { confirmed: true, block_height: 800_000 },
      },
      {
        txid: "bb".repeat(32),
        vout: 2,
        value: 75_000,
        status: { confirmed: false },
      },
    ];
    const fetchSpy = mockFundedAddressWithUtxos(address, utxos);
    input(document.getElementById("descriptorInput"), wpkhDescriptor);
    input(document.getElementById("descriptorCount"), "1");
    confirmDescriptorDerivation();
    await vi.waitFor(() =>
      expect(document.querySelector("#fundedAddressList .descriptor-use-input-button"))
        .not.toBeNull()
    );

    const inputButton = document.querySelector("#fundedAddressList .descriptor-use-input-button");
    expect(inputButton.disabled).toBe(false);
    inputButton.click();
    await vi.waitFor(() => expect(document.getElementById("descriptorUtxoDialog").open).toBe(true));
    expect(fetchSpy.mock.calls.at(-1)[0]).toBe(
      `https://blockstream.info/api/address/${address}/utxo`
    );

    const checkboxes = document.querySelectorAll(".utxo-selection-checkbox");
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0].checked).toBe(true);
    expect(checkboxes[1].checked).toBe(false);
    expect(document.querySelectorAll(".utxo-status-badge.confirmed")).toHaveLength(1);
    expect(document.querySelectorAll(".utxo-status-badge.unconfirmed")).toHaveLength(1);
    expect(document.getElementById("descriptorUtxoSummary").textContent)
      .toContain("1 input selected · 0.00125000 BTC");

    checkboxes[0].checked = false;
    change(checkboxes[0]);
    expect(document.getElementById("descriptorUtxoApply").disabled).toBe(true);
    checkboxes[0].checked = true;
    change(checkboxes[0]);
    checkboxes[1].checked = true;
    change(checkboxes[1]);
    expect(document.getElementById("descriptorUtxoSummary").textContent)
      .toContain("2 inputs selected · 0.00200000 BTC");
    document.getElementById("descriptorUtxoApply").click();

    const inputRows = document.querySelectorAll("[data-utxo]");
    expect(inputRows).toHaveLength(2);
    expect(inputRows[0].querySelector(".txid-input").value).toBe("aa".repeat(32));
    expect(inputRows[0].querySelector(".vout-input").value).toBe("1");
    expect(inputRows[0].querySelector(".value-input").value).toBe("0.00125000");
    expect(inputRows[0].querySelector(".script-input").value).toMatch(/^0014[0-9a-f]{40}$/);
    expect(inputRows[1].querySelector(".txid-input").value).toBe("bb".repeat(32));
    expect(document.getElementById("builderPage").classList.contains("hidden")).toBe(false);

    document.getElementById("openDescriptorPage").click();
    inputButton.click();
    await vi.waitFor(() => expect(document.getElementById("descriptorUtxoDialog").open).toBe(true));
    const duplicateCheckboxes = document.querySelectorAll(".utxo-selection-checkbox");
    duplicateCheckboxes[1].checked = true;
    change(duplicateCheckboxes[1]);
    document.getElementById("descriptorUtxoApply").click();
    expect(document.getElementById("descriptorUtxoError").textContent).toContain(
      "already present"
    );
    expect(document.getElementById("descriptorUtxoDialog").open).toBe(true);
    const utxoDialog = document.getElementById("descriptorUtxoDialog");
    const cancelEvent = new Event("cancel", { cancelable: true });
    utxoDialog.dispatchEvent(cancelEvent);
    expect(cancelEvent.defaultPrevented).toBe(true);
    expect(utxoDialog.open).toBe(false);

    inputButton.click();
    await vi.waitFor(() => expect(utxoDialog.open).toBe(true));
    vi.spyOn(utxoDialog, "getBoundingClientRect").mockReturnValue({
      left: 10,
      right: 100,
      top: 10,
      bottom: 100,
    });
    utxoDialog.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 0, clientY: 0 }));
    expect(utxoDialog.open).toBe(false);
    document.getElementById("clearButton").click();
  });

  it("disables UTXO input import for funded descriptor scripts the Builder cannot spend", async () => {
    const fundedAddress = deriveDescriptorAddressPairs({
      descriptor: multisigDescriptor,
      network: MAINNET,
      startIndex: 0,
      count: 1,
    })[0].receiveAddress;
    mockEsploraFetch((url) => url.includes(fundedAddress) ? { balance: 50_000 } : { balance: 0 });
    input(document.getElementById("descriptorInput"), multisigDescriptor);
    input(document.getElementById("descriptorCount"), "1");
    confirmDescriptorDerivation();

    await vi.waitFor(() =>
      expect(document.querySelector("#fundedAddressList .descriptor-use-input-button"))
        .not.toBeNull()
    );
    const button = document.querySelector("#fundedAddressList .descriptor-use-input-button");
    expect(button.disabled).toBe(true);
    expect(button.title).toContain("Only P2WPKH");
    expect(document.querySelector("#fundedAddressList .descriptor-input-support-reason").textContent)
      .toContain("Only P2WPKH");
  });

  it("handles empty, failed, and cancelled UTXO lookups without changing Builder inputs", async () => {
    const address = expectedWpkh(rootA, 0, 0);
    mockFundedAddressWithUtxos(address, []);
    input(document.getElementById("descriptorInput"), wpkhDescriptor);
    input(document.getElementById("descriptorCount"), "1");
    confirmDescriptorDerivation();
    await vi.waitFor(() =>
      expect(document.querySelector("#fundedAddressList .descriptor-use-input-button"))
        .not.toBeNull()
    );
    const button = document.querySelector("#fundedAddressList .descriptor-use-input-button");
    button.click();
    await vi.waitFor(() =>
      expect(document.getElementById("descriptorStatus").textContent).toContain("No current UTXOs")
    );
    expect(document.querySelectorAll("[data-utxo]")).toHaveLength(1);
    expect(document.querySelector(".txid-input").value).toBe("");

    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    button.click();
    await vi.waitFor(() =>
      expect(document.getElementById("descriptorStatus").textContent).toContain("status 503")
    );
    expect(document.querySelector(".txid-input").value).toBe("");

    let requestSignal;
    globalThis.fetch = vi.fn((_, options) => {
      requestSignal = options.signal;
      return new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError"))
        );
      });
    });
    button.click();
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    change(document.getElementById("network"), "testnet");
    expect(requestSignal.aborted).toBe(true);
    expect(document.getElementById("descriptorUtxoDialog").open).toBe(false);
    expect(document.querySelector(".txid-input").value).toBe("");
  });

  it("uses funded and unused addresses as Builder outputs without replacing populated rows", async () => {
    const address = expectedWpkh(rootA, 0, 0);
    const unusedAddress = expectedWpkh(rootA, 0, 1);
    mockEsploraFetch((url) => url.includes(address) ? { balance: 1000 } : { balance: 0 });
    input(document.getElementById("descriptorInput"), wpkhDescriptor);
    input(document.getElementById("descriptorCount"), "1");
    document.getElementById("openDescriptorPage").click();
    confirmDescriptorDerivation();
    await vi.waitFor(() => expect(document.querySelector(".descriptor-use-output-button")).not.toBeNull());
    const unusedUseButton = document
      .querySelector("#receivingAddressList .descriptor-address-badge.unused")
      .closest(".descriptor-address-row")
      .querySelector(".descriptor-use-output-button");

    document.querySelector("#fundedAddressList .descriptor-use-output-button").click();
    const firstOutput = document.querySelector("[data-output]");
    expect(firstOutput.querySelector(".output-address").value).toBe(address);
    expect(firstOutput.querySelectorAll("input")[1].value).toBe("");
    expect(firstOutput.querySelector(".output-address").style.borderColor).toBe("rgb(247, 147, 26)");
    expect(document.getElementById("builderPage").classList.contains("hidden")).toBe(false);

    input(firstOutput.querySelectorAll("input")[1], "0.1");
    document.getElementById("openDescriptorPage").click();
    unusedUseButton.click();
    const outputs = document.querySelectorAll("[data-output]");
    expect(outputs).toHaveLength(2);
    expect(outputs[0].querySelector(".output-address").value).toBe(address);
    expect(outputs[0].querySelectorAll("input")[1].value).toBe("0.1");
    expect(outputs[1].querySelector(".output-address").value).toBe(unusedAddress);
    expect(outputs[1].querySelectorAll("input")[1].value).toBe("");

    outputs[1].querySelector(".remove").click();
    input(firstOutput.querySelector(".output-address"), "");
    input(firstOutput.querySelectorAll("input")[1], "");
  });

  it("shows partial results and a warning when the scan boundary is reached", async () => {
    mockEsploraFetch(() => ({ balance: 0, chainTxCount: 1 }));
    input(document.getElementById("descriptorInput"), wpkhDescriptor);
    input(document.getElementById("descriptorStartIndex"), String(MAX_UNHARDENED_INDEX));
    input(document.getElementById("descriptorCount"), "1");
    confirmDescriptorDerivation();

    await vi.waitFor(() =>
      expect(document.getElementById("descriptorStatus").textContent).toContain("Scan limit reached")
    );
    expect(document.getElementById("descriptorStatus").classList.contains("warning")).toBe(true);
    expect(document.getElementById("receivingAddressList").textContent).toContain(
      "No unused receiving addresses"
    );
    expect(document.getElementById("changeAddressList").textContent).toContain(
      "No unused change addresses"
    );
    expect(document.getElementById("fundedAddressList").textContent).toContain(
      "No funded addresses"
    );
  });

  it("shows three independently scrollable result components and collapses them together", async () => {
    input(document.getElementById("descriptorInput"), wpkhDescriptor);
    input(document.getElementById("descriptorCount"), "2");
    confirmDescriptorDerivation();
    await vi.waitFor(() =>
      expect(document.querySelectorAll("#receivingAddressList .descriptor-address-row")).toHaveLength(2)
    );

    const receivingList = document.getElementById("receivingAddressList");
    const changeList = document.getElementById("changeAddressList");
    const fundedList = document.getElementById("fundedAddressList");
    const content = document.getElementById("descriptorResultsContent");
    const toggle = document.getElementById("descriptorResultsToggle");
    expect(receivingList.classList.contains("descriptor-address-scroll")).toBe(true);
    expect(changeList.classList.contains("descriptor-address-scroll")).toBe(true);
    expect(fundedList.classList.contains("descriptor-address-scroll")).toBe(true);
    expect(
      receivingList.compareDocumentPosition(changeList) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      changeList.compareDocumentPosition(fundedList) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(content.querySelectorAll(".descriptor-address-component")).toHaveLength(3);
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
    confirmDescriptorDerivation();
    await vi.waitFor(() =>
      expect(document.getElementById("descriptorStatus").classList.contains("error")).toBe(true)
    );

    input(document.getElementById("descriptorInput"), wpkhDescriptor);
    input(document.getElementById("descriptorCount"), "1");
    confirmDescriptorDerivation();
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
    confirmDescriptorDerivation();

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
    confirmDescriptorDerivation();
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());

    document.getElementById("clearDescriptorButton").click();
    expect(requestSignal.aborted).toBe(true);
    expect(document.getElementById("descriptorLoading").hidden).toBe(true);
    expect(document.getElementById("descriptorStatus").textContent).toBe("");
    expect(document.getElementById("descriptorResults").hidden).toBe(true);
  });

  it("cancels an in-flight scan on network change without opening or reusing consent", async () => {
    const requestSignals = [];
    globalThis.fetch = vi.fn((_, options) => {
      requestSignals.push(options.signal);
      return new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    });
    input(document.getElementById("descriptorInput"), wpkhDescriptor);
    input(document.getElementById("descriptorCount"), "1");
    confirmDescriptorDerivation();
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());

    change(document.getElementById("network"), "testnet");
    expect(requestSignals.every((signal) => signal.aborted)).toBe(true);
    expect(document.getElementById("descriptorLoading").hidden).toBe(true);
    expect(document.getElementById("descriptorResults").hidden).toBe(true);
    expect(document.getElementById("descriptorPrivacyDialog").open).toBe(false);
    expect(document.getElementById("descriptorStatus").textContent).toContain(
      "confirm the privacy warning"
    );
  });

  it("clears on network changes and requires fresh confirmation before another request", async () => {
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
    confirmDescriptorDerivation();
    await vi.waitFor(() =>
      expect(document.querySelectorAll("#receivingAddressList .descriptor-address-row")).toHaveLength(1)
    );
    const initialRequestCount = fetchSpy.mock.calls.length;

    change(document.getElementById("network"), "testnet");
    expect(document.getElementById("descriptorStatus").textContent).toContain(
      "confirm the privacy warning"
    );
    expect(document.getElementById("descriptorResults").hidden).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(initialRequestCount);
    change(document.getElementById("network"), "mainnet");
    expect(fetchSpy).toHaveBeenCalledTimes(initialRequestCount);
    document.getElementById("deriveDescriptorButton").click();
    expect(document.getElementById("descriptorPrivacyDialog").open).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(initialRequestCount);
    document.getElementById("descriptorPrivacyOk").click();
    await vi.waitFor(() =>
      expect(document.querySelectorAll("#receivingAddressList .descriptor-address-row")).toHaveLength(1)
    );
    expect(fetchSpy).toHaveBeenCalledTimes(80);
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
