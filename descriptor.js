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

function initDescriptorPage({ getNetwork, networkSelect }) {
  const descriptorInput = document.getElementById("descriptorInput");
  const startInput = document.getElementById("descriptorStartIndex");
  const countInput = document.getElementById("descriptorCount");
  const deriveButton = document.getElementById("deriveDescriptorButton");
  const clearButton = document.getElementById("clearDescriptorButton");
  const status = document.getElementById("descriptorStatus");
  const results = document.getElementById("descriptorResults");
  const resultBody = document.getElementById("descriptorResultBody");

  if (
    !descriptorInput ||
    !startInput ||
    !countInput ||
    !deriveButton ||
    !clearButton ||
    !status ||
    !results ||
    !resultBody ||
    !networkSelect
  ) {
    return;
  }

  let hasDerivationRequest = false;

  const setStatus = (message = "", isError = false) => {
    status.textContent = message;
    status.classList.toggle("error", isError);
  };

  const renderRows = (rows) => {
    resultBody.replaceChildren();
    rows.forEach((row) => {
      const tableRow = document.createElement("tr");
      const indexCell = document.createElement("td");
      indexCell.textContent = String(row.index);

      const createAddressCell = (address, label) => {
        const cell = document.createElement("td");
        const value = document.createElement("code");
        value.textContent = address;
        const copyButton = document.createElement("button");
        copyButton.type = "button";
        copyButton.className = "descriptor-copy-button";
        copyButton.dataset.address = address;
        copyButton.textContent = "Copy";
        copyButton.setAttribute("aria-label", `Copy ${label} address at index ${row.index}`);
        cell.append(value, copyButton);
        return cell;
      };

      tableRow.append(
        indexCell,
        createAddressCell(row.receiveAddress, "receiving"),
        createAddressCell(row.changeAddress, "change")
      );
      resultBody.appendChild(tableRow);
    });
    results.hidden = false;
  };

  const derive = () => {
    hasDerivationRequest = true;
    try {
      const rows = deriveDescriptorAddressPairs({
        descriptor: descriptorInput.value,
        network: getNetwork(),
        startIndex: startInput.value,
        count: countInput.value,
      });
      renderRows(rows);
      setStatus(
        `Derived ${rows.length} receiving and ${rows.length} change addresses locally in your browser.`
      );
    } catch (error) {
      resultBody.replaceChildren();
      results.hidden = true;
      setStatus(error.message, true);
    }
  };

  deriveButton.addEventListener("click", derive);
  clearButton.addEventListener("click", () => {
    descriptorInput.value = "";
    startInput.value = "0";
    countInput.value = "20";
    resultBody.replaceChildren();
    results.hidden = true;
    hasDerivationRequest = false;
    setStatus();
  });
  networkSelect.addEventListener("change", () => {
    if (hasDerivationRequest) derive();
  });
  resultBody.addEventListener("click", async (event) => {
    const button = event.target.closest(".descriptor-copy-button");
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
  containsPrivateKeyMaterial,
  parseDescriptorRange,
  assertPublicMultipathDescriptor,
  deriveDescriptorAddressPairs,
  initDescriptorPage,
};
