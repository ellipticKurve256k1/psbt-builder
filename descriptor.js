import { Buffer } from "buffer";
import { DescriptorsFactory } from "@bitcoinerlab/descriptors-core";
import { createBitcoinjsLib } from "@bitcoinerlab/descriptors-core/bitcoinjs";
import * as ecc from "@bitcoin-js/tiny-secp256k1-asmjs";

// The BitcoinJS descriptor adapter initializes ECPair synchronously and its ECC
// self-test expects Buffer to exist globally. Set the browser polyfill before
// creating the adapter; main.js executes too late because imports run first.
globalThis.Buffer = Buffer;

const { Output, expand } = DescriptorsFactory(createBitcoinjsLib(ecc));

const MAX_UNHARDENED_INDEX = 0x7fffffff;
const MAX_DERIVATION_COUNT = 100;
const MAX_DESCRIPTOR_SCAN_PAIRS = 200;
const DESCRIPTOR_SCAN_BATCH_SIZE = 20;
const ESPLORA_REQUEST_CONCURRENCY = 4;
const ESPLORA_API_BASES = Object.freeze({
  mainnet: "https://blockstream.info/api",
  testnet: "https://blockstream.info/testnet/api",
  signet: "https://blockstream.info/signet/api",
});
const PRIVATE_EXTENDED_KEY_PATTERN = /\b(?:[xt]prv|[yzuvYZUV]prv)[1-9A-HJ-NP-Za-km-z]+\b/;
const BASE58_TOKEN_PATTERN = /[1-9A-HJ-NP-Za-km-z]{51,52}/g;

function containsPrivateKeyMaterial(descriptor) {
  if (PRIVATE_EXTENDED_KEY_PATTERN.test(descriptor)) return true;

  return Array.from(descriptor.matchAll(BASE58_TOKEN_PATTERN), ([token]) => token).some(
    (token) =>
      (token.length === 51 && (token.startsWith("5") || token.startsWith("9"))) ||
      (token.length === 52 && /^[KLc]/.test(token))
  );
}

function parseUnsignedInteger(rawValue, fieldName) {
  const value = String(rawValue ?? "").trim();
  if (!/^\d+$/.test(value)) {
    throw new Error(`${fieldName} must be a whole number.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${fieldName} is too large.`);
  }
  return parsed;
}

function parseDescriptorRange(startValue, countValue) {
  const startIndex = parseUnsignedInteger(startValue, "Start index");
  const count = parseUnsignedInteger(countValue, "Count");

  if (startIndex > MAX_UNHARDENED_INDEX) {
    throw new Error(`Start index must not exceed ${MAX_UNHARDENED_INDEX}.`);
  }
  if (count < 1 || count > MAX_DERIVATION_COUNT) {
    throw new Error(`Count must be between 1 and ${MAX_DERIVATION_COUNT}.`);
  }
  if (startIndex + count - 1 > MAX_UNHARDENED_INDEX) {
    throw new Error("The requested range exceeds the unhardened BIP32 index limit.");
  }

  return { startIndex, count };
}

function assertPublicMultipathDescriptor(descriptor, network) {
  const normalized = String(descriptor ?? "").trim();
  if (!normalized) throw new Error("Descriptor is required.");
  if (containsPrivateKeyMaterial(normalized)) {
    throw new Error("Private keys are not allowed. Enter a public, watch-only descriptor.");
  }
  if (!normalized.includes("/<0;1>/*")) {
    throw new Error("Descriptor must contain the receiving/change path /<0;1>/*.");
  }

  let receiveExpansion;
  let changeExpansion;
  try {
    receiveExpansion = expand({ descriptor: normalized, index: 0, change: 0, network });
    changeExpansion = expand({ descriptor: normalized, index: 0, change: 1, network });
  } catch {
    throw new Error("Descriptor is invalid, unsupported, or does not match the selected network.");
  }

  const keyInfo = [
    ...Object.values(receiveExpansion.expansionMap || {}),
    ...Object.values(changeExpansion.expansionMap || {}),
  ];
  if (keyInfo.some((key) => key.xPrv || key.privkey || key.bip32?.privateKey)) {
    throw new Error("Private keys are not allowed. Enter a public, watch-only descriptor.");
  }

  return normalized;
}

function deriveAddress(descriptor, network, index, change) {
  try {
    const address = new Output({ descriptor, network, index, change }).getAddress();
    if (typeof address !== "string" || !address) throw new Error("No address");
    return address;
  } catch {
    throw new Error(
      `Descriptor does not produce one address for ${change === 0 ? "receiving" : "change"} index ${index}.`
    );
  }
}

function deriveDescriptorAddressPairs({ descriptor, network, startIndex, count }) {
  if (!network) throw new Error("A Bitcoin network is required.");
  const normalized = assertPublicMultipathDescriptor(descriptor, network);
  const range = parseDescriptorRange(startIndex, count);

  return Array.from({ length: range.count }, (_, offset) => {
    const index = range.startIndex + offset;
    return {
      index,
      receiveAddress: deriveAddress(normalized, network, index, 0),
      changeAddress: deriveAddress(normalized, network, index, 1),
    };
  });
}

function getEsploraAddressApiUrl(networkValue, address) {
  const apiBase = ESPLORA_API_BASES[networkValue];
  if (!apiBase) throw new Error(`Unsupported network: ${networkValue}`);
  const normalizedAddress = String(address ?? "").trim();
  if (!normalizedAddress) throw new Error("Address is required for balance lookup.");
  return `${apiBase}/address/${encodeURIComponent(normalizedAddress)}`;
}

function parseEsploraStatValue(value, fieldName) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Esplora returned an invalid ${fieldName}.`);
  }
  return BigInt(value);
}

function calculateEsploraBalance(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Esplora returned an invalid address response.");
  }

  const readStats = (stats, label) => {
    if (!stats || typeof stats !== "object") {
      throw new Error(`Esplora response is missing ${label}_stats.`);
    }
    const funded = parseEsploraStatValue(stats.funded_txo_sum, `${label} funded total`);
    const spent = parseEsploraStatValue(stats.spent_txo_sum, `${label} spent total`);
    return funded - spent;
  };

  return readStats(data.chain_stats, "chain") + readStats(data.mempool_stats, "mempool");
}

function parseEsploraAddressActivity(data) {
  const balanceSats = calculateEsploraBalance(data);
  const chainTxCount = Number(parseEsploraStatValue(data.chain_stats.tx_count, "chain tx count"));
  const mempoolTxCount = Number(
    parseEsploraStatValue(data.mempool_stats.tx_count, "mempool tx count")
  );
  const txCount = chainTxCount + mempoolTxCount;
  if (!Number.isSafeInteger(txCount)) {
    throw new Error("Esplora returned an invalid total tx count.");
  }
  return { balanceSats, txCount };
}

function classifyAddressActivity({ balanceSats, txCount }) {
  if (balanceSats > 0n) return "funded";
  if (balanceSats === 0n && txCount === 0) return "unused";
  return "used-empty";
}

async function fetchEsploraAddressActivity(address, networkValue, { signal } = {}) {
  const response = await fetch(getEsploraAddressApiUrl(networkValue, address), {
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) {
    throw new Error(`Blockstream Esplora request failed (status ${response.status}).`);
  }
  return parseEsploraAddressActivity(await response.json());
}

async function fetchEsploraAddressBalance(address, networkValue, options = {}) {
  return (await fetchEsploraAddressActivity(address, networkValue, options)).balanceSats;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  let firstError;

  const worker = async () => {
    while (nextIndex < items.length && !firstError) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await mapper(items[index], index);
      } catch (error) {
        firstError = error;
      }
    }
  };

  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  if (firstError) throw firstError;
  return results;
}

async function fetchDescriptorAddressBalances(
  rows,
  networkValue,
  { signal, concurrency = ESPLORA_REQUEST_CONCURRENCY } = {}
) {
  const addresses = rows.flatMap((row) => [row.receiveAddress, row.changeAddress]);
  const activities = await mapWithConcurrency(addresses, concurrency, (address) =>
    fetchEsploraAddressActivity(address, networkValue, { signal })
  );

  return rows.map((row, index) => ({
    ...row,
    receiveBalanceSats: activities[index * 2].balanceSats,
    receiveTxCount: activities[index * 2].txCount,
    changeBalanceSats: activities[index * 2 + 1].balanceSats,
    changeTxCount: activities[index * 2 + 1].txCount,
  }));
}

async function discoverDescriptorAddresses({
  descriptor,
  network,
  networkValue,
  startIndex,
  targetUnusedCount,
  signal,
  maxPairs = MAX_DESCRIPTOR_SCAN_PAIRS,
  batchSize = DESCRIPTOR_SCAN_BATCH_SIZE,
  onProgress,
}) {
  if (!network) throw new Error("A Bitcoin network is required.");
  if (!Number.isSafeInteger(maxPairs) || maxPairs < 1) {
    throw new Error("Scan limit must be a positive whole number.");
  }
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > MAX_DERIVATION_COUNT) {
    throw new Error(`Scan batch size must be between 1 and ${MAX_DERIVATION_COUNT}.`);
  }
  const normalized = assertPublicMultipathDescriptor(descriptor, network);
  const range = parseDescriptorRange(startIndex, targetUnusedCount);
  const scanLimit = Math.min(
    maxPairs,
    MAX_DESCRIPTOR_SCAN_PAIRS,
    MAX_UNHARDENED_INDEX - range.startIndex + 1
  );
  const rows = [];
  let receivingUnusedCount = 0;
  let changeUnusedCount = 0;
  let scannedPairs = 0;

  while (
    scannedPairs < scanLimit
    && (receivingUnusedCount < range.count || changeUnusedCount < range.count)
  ) {
    const count = Math.min(batchSize, scanLimit - scannedPairs);
    const batch = deriveDescriptorAddressPairs({
      descriptor: normalized,
      network,
      startIndex: range.startIndex + scannedPairs,
      count,
    });
    const balancedBatch = await fetchDescriptorAddressBalances(batch, networkValue, { signal });
    rows.push(...balancedBatch);
    scannedPairs += balancedBatch.length;
    receivingUnusedCount += balancedBatch.filter((row) =>
      classifyAddressActivity({
        balanceSats: row.receiveBalanceSats,
        txCount: row.receiveTxCount,
      }) === "unused"
    ).length;
    changeUnusedCount += balancedBatch.filter((row) =>
      classifyAddressActivity({
        balanceSats: row.changeBalanceSats,
        txCount: row.changeTxCount,
      }) === "unused"
    ).length;
    onProgress?.({ scannedPairs, maxPairs: scanLimit });
  }

  return {
    rows,
    scannedPairs,
    targetUnusedCount: range.count,
    receivingUnusedCount: Math.min(receivingUnusedCount, range.count),
    changeUnusedCount: Math.min(changeUnusedCount, range.count),
    reachedLimit:
      receivingUnusedCount < range.count || changeUnusedCount < range.count,
  };
}

function formatAddressBalance(sats) {
  const value = BigInt(sats);
  const whole = value / 100_000_000n;
  const fraction = (value % 100_000_000n).toString().padStart(8, "0");
  return `${whole}.${fraction} BTC (${value.toLocaleString("en-US")} sats)`;
}

function initDescriptorPage({
  getNetwork,
  getNetworkValue,
  networkSelect,
  onUseAsOutput,
  onCancelPrivacyWarning,
}) {
  const descriptorInput = document.getElementById("descriptorInput");
  const startInput = document.getElementById("descriptorStartIndex");
  const countInput = document.getElementById("descriptorCount");
  const deriveButton = document.getElementById("deriveDescriptorButton");
  const clearButton = document.getElementById("clearDescriptorButton");
  const derivationPanel = document.getElementById("descriptorDerivationPanel");
  const loading = document.getElementById("descriptorLoading");
  const loadingText = document.getElementById("descriptorLoadingText");
  const status = document.getElementById("descriptorStatus");
  const results = document.getElementById("descriptorResults");
  const resultsToggle = document.getElementById("descriptorResultsToggle");
  const resultsContent = document.getElementById("descriptorResultsContent");
  const receivingList = document.getElementById("receivingAddressList");
  const changeList = document.getElementById("changeAddressList");
  const privacyDialog = document.getElementById("descriptorPrivacyDialog");
  const privacyOkButton = document.getElementById("descriptorPrivacyOk");
  const privacyCancelButton = document.getElementById("descriptorPrivacyCancel");

  if (
    !descriptorInput ||
    !startInput ||
    !countInput ||
    !deriveButton ||
    !clearButton ||
    !derivationPanel ||
    !loading ||
    !loadingText ||
    !status ||
    !results ||
    !resultsToggle ||
    !resultsContent ||
    !receivingList ||
    !changeList ||
    !privacyDialog ||
    !privacyOkButton ||
    !privacyCancelButton ||
    !networkSelect
  ) {
    return;
  }

  let hasDerivationRequest = false;
  let derivationRequestId = 0;
  let activeAbortController = null;

  const setStatus = (message = "", isError = false, isWarning = false) => {
    status.textContent = message;
    status.classList.toggle("error", isError);
    status.classList.toggle("warning", isWarning);
  };

  const setLoading = (isLoading, message = "Deriving locally and fetching address activity…") => {
    loading.hidden = !isLoading;
    if (isLoading) loadingText.textContent = message;
    deriveButton.disabled = isLoading;
    deriveButton.textContent = isLoading ? "Scanning…" : "Derive Addresses";
    derivationPanel.setAttribute("aria-busy", String(isLoading));
  };

  const waitForBrowserPaint = () =>
    new Promise((resolve) => {
      if (typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(() => window.setTimeout(resolve, 0));
      } else {
        window.setTimeout(resolve, 0);
      }
    });

  const setResultsExpanded = (expanded) => {
    resultsToggle.setAttribute("aria-expanded", String(expanded));
    resultsContent.hidden = !expanded;
  };

  const createAddressRow = (index, address, balanceSats, label, classification) => {
    const row = document.createElement("div");
    row.className = "descriptor-address-row";

    const indexLabel = document.createElement("span");
    indexLabel.className = "descriptor-address-index";
    indexLabel.textContent = `#${index}`;

    const value = document.createElement("code");
    value.textContent = address;

    const balance = document.createElement("span");
    balance.className = "descriptor-address-balance";
    balance.textContent = formatAddressBalance(balanceSats);

    const badge = document.createElement("span");
    badge.className = `descriptor-address-badge ${classification}`;
    badge.textContent = classification === "funded" ? "Funded" : "Unused";

    const actions = document.createElement("div");
    actions.className = "descriptor-address-actions";

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "descriptor-copy-button";
    copyButton.dataset.address = address;
    copyButton.textContent = "Copy";
    copyButton.setAttribute("aria-label", `Copy ${label} address at index ${index}`);

    const useButton = document.createElement("button");
    useButton.type = "button";
    useButton.className = "descriptor-use-output-button";
    useButton.dataset.address = address;
    useButton.textContent = "Use as Output";
    useButton.setAttribute("aria-label", `Use ${label} address at index ${index} as PSBT output`);

    actions.append(copyButton, useButton);
    const details = document.createElement("div");
    details.className = "descriptor-address-details";
    details.append(badge, balance);

    row.append(indexLabel, value, details, actions);
    return row;
  };

  const createEmptyState = (label) => {
    const empty = document.createElement("div");
    empty.className = "descriptor-empty-state";
    empty.textContent = `No funded or unused ${label} addresses were found during this scan.`;
    return empty;
  };

  const clearResults = () => {
    receivingList.replaceChildren();
    changeList.replaceChildren();
  };

  const renderRows = (rows, targetUnusedCount) => {
    clearResults();
    let receivingFundedCount = 0;
    let changeFundedCount = 0;
    let receivingUnusedCount = 0;
    let changeUnusedCount = 0;
    rows.forEach((row) => {
      const receiveClassification = classifyAddressActivity({
        balanceSats: row.receiveBalanceSats,
        txCount: row.receiveTxCount,
      });
      const changeClassification = classifyAddressActivity({
        balanceSats: row.changeBalanceSats,
        txCount: row.changeTxCount,
      });

      if (receiveClassification === "funded") {
        receivingList.appendChild(
          createAddressRow(
            row.index,
            row.receiveAddress,
            row.receiveBalanceSats,
            "receiving",
            "funded"
          )
        );
        receivingFundedCount += 1;
      } else if (receiveClassification === "unused" && receivingUnusedCount < targetUnusedCount) {
        receivingList.appendChild(
          createAddressRow(row.index, row.receiveAddress, 0n, "receiving", "unused")
        );
        receivingUnusedCount += 1;
      }
      if (changeClassification === "funded") {
        changeList.appendChild(
          createAddressRow(
            row.index,
            row.changeAddress,
            row.changeBalanceSats,
            "change",
            "funded"
          )
        );
        changeFundedCount += 1;
      } else if (changeClassification === "unused" && changeUnusedCount < targetUnusedCount) {
        changeList.appendChild(
          createAddressRow(row.index, row.changeAddress, 0n, "change", "unused")
        );
        changeUnusedCount += 1;
      }
    });
    if (receivingFundedCount + receivingUnusedCount === 0) {
      receivingList.appendChild(createEmptyState("receiving"));
    }
    if (changeFundedCount + changeUnusedCount === 0) {
      changeList.appendChild(createEmptyState("change"));
    }
    results.hidden = false;
    setResultsExpanded(true);
    return {
      receivingFundedCount,
      changeFundedCount,
      receivingUnusedCount,
      changeUnusedCount,
    };
  };

  const derive = async () => {
    hasDerivationRequest = true;
    derivationRequestId += 1;
    const currentRequestId = derivationRequestId;
    activeAbortController?.abort();
    activeAbortController = new AbortController();
    setStatus();
    clearResults();
    results.hidden = true;
    setLoading(true);
    await waitForBrowserPaint();
    if (currentRequestId !== derivationRequestId) return;

    try {
      const discovery = await discoverDescriptorAddresses({
        descriptor: descriptorInput.value,
        network: getNetwork(),
        networkValue: getNetworkValue(),
        startIndex: startInput.value,
        targetUnusedCount: countInput.value,
        signal: activeAbortController.signal,
        onProgress: ({ scannedPairs, maxPairs }) => {
          if (currentRequestId === derivationRequestId) {
            loadingText.textContent = `Scanning address activity… ${scannedPairs} / ${maxPairs} pairs checked`;
          }
        },
      });
      if (currentRequestId !== derivationRequestId) return;
      const counts = renderRows(discovery.rows, discovery.targetUnusedCount);
      const summary =
        `Scanned ${discovery.scannedPairs} address pairs locally. `
        + `Receiving: ${counts.receivingFundedCount} funded, ${counts.receivingUnusedCount} unused. `
        + `Change: ${counts.changeFundedCount} funded, ${counts.changeUnusedCount} unused.`;
      const warning = discovery.reachedLimit
        ? ` Scan limit reached before finding ${discovery.targetUnusedCount} unused addresses for each branch.`
        : "";
      setStatus(summary + warning, false, discovery.reachedLimit);
    } catch (error) {
      if (currentRequestId !== derivationRequestId) return;
      clearResults();
      results.hidden = true;
      setStatus(
        error?.name === "AbortError" ? "Balance lookup was cancelled." : error.message,
        true
      );
    } finally {
      if (currentRequestId === derivationRequestId) setLoading(false);
    }
  };

  deriveButton.addEventListener("click", () => {
    privacyDialog.showModal();
  });
  privacyOkButton.addEventListener("click", () => {
    privacyDialog.close("ok");
    void derive();
  });
  privacyCancelButton.addEventListener("click", () => {
    privacyDialog.close("cancel");
    onCancelPrivacyWarning?.();
  });
  privacyDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
  });
  clearButton.addEventListener("click", () => {
    derivationRequestId += 1;
    activeAbortController?.abort();
    activeAbortController = null;
    descriptorInput.value = "";
    startInput.value = "0";
    countInput.value = "20";
    clearResults();
    results.hidden = true;
    setResultsExpanded(true);
    hasDerivationRequest = false;
    setLoading(false);
    setStatus();
  });
  resultsToggle.addEventListener("click", () => {
    setResultsExpanded(resultsToggle.getAttribute("aria-expanded") !== "true");
  });
  networkSelect.addEventListener("change", () => {
    if (!hasDerivationRequest) return;
    derivationRequestId += 1;
    activeAbortController?.abort();
    activeAbortController = null;
    clearResults();
    results.hidden = true;
    setResultsExpanded(true);
    hasDerivationRequest = false;
    setLoading(false);
    setStatus("Network changed. Click Derive Addresses and confirm the privacy warning to scan again.");
  });
  resultsContent.addEventListener("click", async (event) => {
    const useButton = event.target.closest?.(".descriptor-use-output-button");
    if (useButton) {
      onUseAsOutput?.(useButton.dataset.address);
      return;
    }
    const button = event.target.closest?.(".descriptor-copy-button");
    if (!button) return;
    try {
      await navigator.clipboard.writeText(button.dataset.address);
      button.textContent = "Copied!";
      window.setTimeout(() => {
        button.textContent = "Copy";
      }, 2000);
    } catch {
      setStatus("Failed to copy the address.", true);
    }
  });
}

export {
  MAX_UNHARDENED_INDEX,
  MAX_DERIVATION_COUNT,
  MAX_DESCRIPTOR_SCAN_PAIRS,
  DESCRIPTOR_SCAN_BATCH_SIZE,
  ESPLORA_REQUEST_CONCURRENCY,
  ESPLORA_API_BASES,
  containsPrivateKeyMaterial,
  parseDescriptorRange,
  assertPublicMultipathDescriptor,
  deriveDescriptorAddressPairs,
  getEsploraAddressApiUrl,
  calculateEsploraBalance,
  parseEsploraAddressActivity,
  classifyAddressActivity,
  fetchEsploraAddressActivity,
  fetchEsploraAddressBalance,
  mapWithConcurrency,
  fetchDescriptorAddressBalances,
  discoverDescriptorAddresses,
  formatAddressBalance,
  initDescriptorPage,
};
