import { Buffer } from "buffer";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "@bitcoin-js/tiny-secp256k1-asmjs";

window.Buffer = Buffer;
bitcoin.initEccLib(ecc);

const NETWORK_CONFIG = Object.freeze({
  mainnet: {
    bitcoinNetwork: bitcoin.networks.bitcoin,
    mempoolPath: "",
  },
  testnet: {
    bitcoinNetwork: bitcoin.networks.testnet,
    mempoolPath: "/testnet",
  },
  signet: {
    // Signet and testnet use the same address and key encodings.
    bitcoinNetwork: bitcoin.networks.testnet,
    mempoolPath: "/signet",
  },
});

function getNetworkConfig(networkValue) {
  const config = NETWORK_CONFIG[networkValue];
  if (!config) throw new Error(`Unsupported network: ${networkValue}`);
  return config;
}

function getSelectedNetwork() {
  const net = document.getElementById("network").value;
  return getNetworkConfig(net).bitcoinNetwork;
}

function validateBitcoinAddress(address, network) {
  try {
    const decoded = bitcoin.address.fromBase58Check(address);
    if (
      decoded.version === network.pubKeyHash ||
      decoded.version === network.scriptHash
    ) {
      return true;
    }
  } catch {}

  try {
    const { prefix, version } = bitcoin.address.fromBech32(address);
    if (prefix === network.bech32 && (version === 0 || version === 1)) {
      return true;
    }
  } catch {}

  return false;
}

function colourField(el, isValid) {
  const empty = el.value.trim() === "";
  el.style.borderColor = empty ? "#3a3c40" : isValid ? "#f7931a" : "#c84838";
}

function hexToBytes(hex) {
  if (!hex || typeof hex !== "string") return new Uint8Array();
  if (!/^[0-9a-fA-F]+$/.test(hex)) throw new Error("Invalid hex string");
  if (hex.length % 2 !== 0) throw new Error("Invalid hex string");

  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function isP2wpkhScript(script) {
  return script.length === 22 && script[0] === 0x00 && script[1] === 0x14;
}

function decodeP2wpkhAddressFromScript(hex, network) {
  try {
    const script = hexToBytes(hex);
    if (!isP2wpkhScript(script)) return null;
    return bitcoin.address.fromOutputScript(script, network);
  } catch {}

  return null;
}

function formatUint32Hex(value) {
  return Number(value >>> 0).toString(16).padStart(8, "0");
}

function parseUint32Hex(rawValue, fieldName) {
  const trimmed = String(rawValue || "").trim();
  const withoutPrefix = trimmed.startsWith("0x") || trimmed.startsWith("0X")
    ? trimmed.slice(2)
    : trimmed;

  if (!withoutPrefix) {
    throw new Error(`${fieldName} is required.`);
  }
  if (!/^[0-9a-fA-F]{1,8}$/.test(withoutPrefix)) {
    throw new Error(`${fieldName} must be 1-8 hex digits.`);
  }

  const parsed = Number.parseInt(withoutPrefix, 16);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 0xffffffff) {
    throw new Error(`${fieldName} out of range.`);
  }
  return parsed >>> 0;
}

function isValidUint32Hex(rawValue) {
  try {
    parseUint32Hex(rawValue, "value");
    return true;
  } catch {
    return false;
  }
}

function parseTxVersion(rawValue) {
  const trimmed = String(rawValue || "").trim();
  if (!trimmed) {
    throw new Error("Version is required.");
  }
  if (!/^\d+$/.test(trimmed)) {
    throw new Error("Version must be a decimal integer.");
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 0xffffffff) {
    throw new Error("Version out of range.");
  }
  return parsed >>> 0;
}

function isValidTxVersion(rawValue) {
  try {
    parseTxVersion(rawValue);
    return true;
  } catch {
    return false;
  }
}

function parseBtcToSafeSats(rawValue, fieldName) {
  const value = String(rawValue ?? "").trim();
  if (!/^(?:\d+(?:\.\d{0,8})?|\.\d{1,8})$/.test(value)) {
    throw new Error(`${fieldName} must be a non-negative BTC amount with up to 8 decimals.`);
  }
  const [wholePart = "0", fractionPart = ""] = value.split(".");
  const satoshis = BigInt(wholePart || "0") * 100000000n
    + BigInt(fractionPart.padEnd(8, "0") || "0");
  if (satoshis > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${fieldName} is too large.`);
  }
  return Number(satoshis);
}

function parseVout(rawValue, fieldName) {
  const value = String(rawValue ?? "").trim();
  if (!/^\d+$/.test(value)) {
    throw new Error(`${fieldName} must be an unsigned decimal integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > 0xffffffff) {
    throw new Error(`${fieldName} out of range.`);
  }
  return parsed;
}

function optionToSighashType(optionValue, allowInherit = false) {
  if (allowInherit && optionValue === "INHERIT") return null;
  switch (optionValue) {
    case "DEFAULT":
      return undefined;
    case "ALL":
      return bitcoin.Transaction.SIGHASH_ALL;
    case "NONE":
      return bitcoin.Transaction.SIGHASH_NONE;
    case "SINGLE":
      return bitcoin.Transaction.SIGHASH_SINGLE;
    case "ALL_ANYONECANPAY":
      return bitcoin.Transaction.SIGHASH_ALL | bitcoin.Transaction.SIGHASH_ANYONECANPAY;
    case "NONE_ANYONECANPAY":
      return bitcoin.Transaction.SIGHASH_NONE | bitcoin.Transaction.SIGHASH_ANYONECANPAY;
    case "SINGLE_ANYONECANPAY":
      return bitcoin.Transaction.SIGHASH_SINGLE | bitcoin.Transaction.SIGHASH_ANYONECANPAY;
    default:
      throw new Error("Invalid sighash type");
  }
}

function sighashTypeToOption(sighashType) {
  if (sighashType === undefined) return "DEFAULT";
  switch (sighashType) {
    case bitcoin.Transaction.SIGHASH_ALL:
      return "ALL";
    case bitcoin.Transaction.SIGHASH_NONE:
      return "NONE";
    case bitcoin.Transaction.SIGHASH_SINGLE:
      return "SINGLE";
    case bitcoin.Transaction.SIGHASH_ALL | bitcoin.Transaction.SIGHASH_ANYONECANPAY:
      return "ALL_ANYONECANPAY";
    case bitcoin.Transaction.SIGHASH_NONE | bitcoin.Transaction.SIGHASH_ANYONECANPAY:
      return "NONE_ANYONECANPAY";
    case bitcoin.Transaction.SIGHASH_SINGLE | bitcoin.Transaction.SIGHASH_ANYONECANPAY:
      return "SINGLE_ANYONECANPAY";
    default:
      return null;
  }
}

function getSelectedSighashType() {
  return optionToSighashType(document.getElementById("sighashType").value);
}

function addInput(
  _,
  txid = "",
  vout = "",
  sequenceHex = "fffffffd",
  value = "",
  scriptPubKey = "",
  inputSighash = "INHERIT"
) {
  const div = document.createElement("div");
  div.setAttribute("data-utxo", "");
  div.style.marginBottom = "1rem";

  div.innerHTML = `
    <div class="row">
      <input class="grow txid-input" placeholder="txid" value="${txid}">
      <button type="button" class="remove">✕</button>
    </div>

    <div class="row" style="margin-top:0.4rem;">
      <input class="vout-input" placeholder="vout" value="${vout}" style="width:80px;">
      <input class="sequence-input" placeholder="nSequence (hex)" value="${sequenceHex}" style="width:150px;">
      <input class="value-input" placeholder="value (BTC)" value="${value}" style="width:170px;">
    </div>

    <div class="row" style="margin-top:0.4rem;">
      <input class="grow script-input" placeholder="scriptPubKey (hex, p2wpkh only)" value="${scriptPubKey}">
    </div>
    <div class="row" style="margin-top:0.4rem;">
      <select class="input-sighash">
        <option value="INHERIT">Use global sighash</option>
        <option value="DEFAULT">Unset on this input</option>
        <option value="ALL">SIGHASH_ALL</option>
        <option value="NONE">SIGHASH_NONE</option>
        <option value="SINGLE">SIGHASH_SINGLE</option>
        <option value="ALL_ANYONECANPAY">SIGHASH_ALL | ANYONECANPAY</option>
        <option value="NONE_ANYONECANPAY">SIGHASH_NONE | ANYONECANPAY</option>
        <option value="SINGLE_ANYONECANPAY">SIGHASH_SINGLE | ANYONECANPAY</option>
      </select>
    </div>
    <div class="script-label" style="font-size:0.85rem;color:#555;margin-top:0.2rem;">
      P2WPKH Address: <span>-</span>
    </div>
  `;

  document.getElementById("utxoContainer").appendChild(div);
  div.querySelector(".input-sighash").value = inputSighash;

  div.querySelector(".remove").addEventListener("click", () => {
    div.remove();
    updateFeeCalc();
  });

  const scriptInput = div.querySelector(".script-input");
  const sequenceInput = div.querySelector(".sequence-input");
  const labelSpan = div.querySelector(".script-label span");
  const updateLabel = () => {
    const scriptHex = scriptInput.value.trim();
    if (!scriptHex) {
      labelSpan.textContent = "-";
      colourField(scriptInput, false);
      updateFeeCalc();
      return;
    }

    const network = getSelectedNetwork();
    const address = decodeP2wpkhAddressFromScript(scriptHex, network);
    labelSpan.textContent = address || "Invalid scriptPubKey (p2wpkh only)";
    colourField(scriptInput, !!address);
    updateFeeCalc();
  };

  const updateSequenceLabel = () => {
    colourField(sequenceInput, isValidUint32Hex(sequenceInput.value.trim()));
    updateFeeCalc();
  };

  scriptInput.addEventListener("input", updateLabel);
  sequenceInput.addEventListener("input", updateSequenceLabel);
  div.querySelector(".input-sighash").addEventListener("change", updateFeeCalc);
  updateLabel();
  updateSequenceLabel();
  div.querySelector(".value-input").addEventListener("input", updateFeeCalc);
}

function addOutput(_, address = "", value = "") {
  const div = document.createElement("div");
  div.setAttribute("data-output", "");
  div.style.marginBottom = "1rem";

  div.innerHTML = `
    <div class="row">
      <input class="grow output-address" placeholder="address" value="${address}">
      <input placeholder="value (BTC)" value="${value}" style="width:170px;">
      <button type="button" class="remove">✕</button>
    </div>
  `;

  document.getElementById("outputContainer").appendChild(div);

  div.querySelector(".remove").addEventListener("click", () => {
    div.remove();
    updateFeeCalc();
  });

  const addressInput = div.querySelector(".output-address");
  addressInput.addEventListener("input", () => {
    const network = getSelectedNetwork();
    const isValid = validateBitcoinAddress(addressInput.value.trim(), network);
    colourField(addressInput, isValid);
  });

  div.querySelectorAll("input")[1].addEventListener("input", updateFeeCalc);
  updateFeeCalc();
}

function refreshAllScriptLabels() {
  document
    .querySelectorAll(".script-input")
    .forEach((input) => input.dispatchEvent(new Event("input")));
  document
    .querySelectorAll(".output-address")
    .forEach((input) => input.dispatchEvent(new Event("input")));
  validateChangeAddr();
}

function estimateVirtualSize(psbt) {
  const inputCount = psbt.data.inputs.length;
  const outputCount = psbt.data.outputs.length;
  const baseSize = 10 + inputCount * 41 + outputCount * 34;
  const witnessSize = inputCount * 107;
  return Math.ceil((3 * baseSize + witnessSize) / 4);
}

function createPsbtFromInputs(
  utxos,
  outputs,
  fee,
  changeAddress,
  opReturnData,
  sighashType = undefined,
  locktime = 0,
  txVersion = 2
) {
  const network = getSelectedNetwork();
  const psbt = new bitcoin.Psbt({ network });
  psbt.setVersion(txVersion);
  psbt.setLocktime(locktime);

  let totalInput = 0;
  for (const [inputIndex, utxo] of utxos.entries()) {
    const scriptBytes = hexToBytes(utxo.scriptPubKey);
    if (!isP2wpkhScript(scriptBytes)) {
      throw new Error("Only P2WPKH input scriptPubKey is supported.");
    }
    const resolvedSighashType =
      utxo.inputSighashOption === "INHERIT" || utxo.inputSighashOption === undefined
        ? sighashType
        : utxo.sighashType;
    const sequence = parseUint32Hex(
      utxo.sequenceHex === undefined ? "fffffffd" : utxo.sequenceHex,
      `Input #${inputIndex} nSequence`
    );

    const inputData = {
      hash: utxo.txid,
      index: utxo.vout,
      sequence,
      witnessUtxo: {
        script: scriptBytes,
        value: BigInt(utxo.value),
      },
    };
    if (resolvedSighashType !== undefined) {
      inputData.sighashType = resolvedSighashType;
    }
    psbt.addInput(inputData);
    totalInput += utxo.value;
  }

  let totalOutput = 0;
  for (const output of outputs) {
    psbt.addOutput({
      address: output.address,
      value: BigInt(output.value),
    });
    totalOutput += output.value;
  }

  if (changeAddress && changeAddress.trim() !== "") {
    const changeValue = totalInput - totalOutput - fee;
    if (changeValue > 0) {
      psbt.addOutput({ address: changeAddress, value: BigInt(changeValue) });
    }
  }

  if (opReturnData) {
    const opReturnScript = bitcoin.script.compile([
      bitcoin.opcodes.OP_RETURN,
      opReturnData,
    ]);
    psbt.addOutput({ script: opReturnScript, value: BigInt(0) });
  }

  return psbt;
}

function downloadPsbt(psbt) {
  const blob = new Blob([psbt.toBuffer()], { type: "application/octet-stream" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "unsigned.psbt";
  link.click();
}

function satoshiToBtcString(satoshi) {
  return (Number(satoshi) / 1e8).toFixed(8);
}

function inputHashToTxid(hash) {
  return Buffer.from(Uint8Array.from(hash)).reverse().toString("hex");
}

function bytesToHex(bytes) {
  return Buffer.from(bytes).toString("hex");
}

function extractOpReturnData(script) {
  const chunks = bitcoin.script.decompile(script);
  if (!chunks || chunks.length === 0 || chunks[0] !== bitcoin.opcodes.OP_RETURN) return null;

  const dataChunks = [];
  for (const chunk of chunks.slice(1)) {
    if (!(chunk instanceof Uint8Array)) return null;
    dataChunks.push(chunk);
  }

  const totalLength = dataChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of dataChunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function opReturnDataToMessage(data) {
  if (!data || data.length === 0) return "";
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(data);
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
      return `0x${bytesToHex(data)}`;
    }
    return text;
  } catch {
    return `0x${bytesToHex(data)}`;
  }
}

function deriveGlobalAndPerInputSighash(inputSighashOptions) {
  if (inputSighashOptions.length === 0) {
    return { globalSighashOption: "DEFAULT", perInputSighashOptions: [] };
  }

  const unique = Array.from(new Set(inputSighashOptions));
  if (unique.length === 1) {
    return {
      globalSighashOption: unique[0],
      perInputSighashOptions: inputSighashOptions.map(() => "INHERIT"),
    };
  }

  return {
    globalSighashOption: "DEFAULT",
    perInputSighashOptions: inputSighashOptions,
  };
}

function parseOutputsFromScripts(txOutputs, network, warnings) {
  const outputs = [];
  let opReturnMessage = null;
  let opReturnCount = 0;

  for (let i = 0; i < txOutputs.length; i += 1) {
    const output = txOutputs[i];
    const opReturnData = extractOpReturnData(output.script);
    if (opReturnData !== null) {
      opReturnCount += 1;
      if (opReturnMessage === null) {
        opReturnMessage = opReturnDataToMessage(opReturnData);
      }
      continue;
    }

    let address = output.address;
    if (!address) {
      try {
        address = bitcoin.address.fromOutputScript(output.script, network);
      } catch {
        address = "";
        warnings.push(`Output #${i} script could not be converted to address. Fill manually.`);
      }
    }

    outputs.push({
      address,
      value: satoshiToBtcString(output.value),
    });
  }

  if (opReturnCount > 1) {
    warnings.push("Multiple OP_RETURN outputs detected. Only the first one was imported.");
  }

  return { outputs, opReturnMessage };
}

function parsePsbtToFormData(psbt) {
  const network = getSelectedNetwork();
  const warnings = [];
  const parsedInputs = [];
  const inputSighashOptions = [];

  for (let i = 0; i < psbt.txInputs.length; i += 1) {
    const txInput = psbt.txInputs[i];
    const inputMeta = psbt.data.inputs[i] || {};
    let scriptPubKey = "";
    let value = "";

    if (inputMeta.witnessUtxo) {
      scriptPubKey = bytesToHex(inputMeta.witnessUtxo.script);
      value = satoshiToBtcString(inputMeta.witnessUtxo.value);
    } else if (inputMeta.nonWitnessUtxo) {
      try {
        const prevTx = bitcoin.Transaction.fromBuffer(inputMeta.nonWitnessUtxo);
        const prevOut = prevTx.outs[txInput.index];
        if (prevOut) {
          scriptPubKey = bytesToHex(prevOut.script);
          value = satoshiToBtcString(prevOut.value);
        }
      } catch {
        warnings.push(`Input #${i} nonWitnessUtxo parse failed.`);
      }
    }

    let inputSighashOption = "DEFAULT";
    if (inputMeta.sighashType !== undefined) {
      const mapped = sighashTypeToOption(inputMeta.sighashType);
      if (mapped) {
        inputSighashOption = mapped;
      } else {
        warnings.push(
          `Input #${i} uses unsupported sighashType (${inputMeta.sighashType}). Imported as unset.`
        );
      }
    }
    inputSighashOptions.push(inputSighashOption);

    parsedInputs.push({
      txid: inputHashToTxid(txInput.hash),
      vout: String(txInput.index),
      sequenceHex: formatUint32Hex(txInput.sequence),
      value,
      scriptPubKey,
      inputSighashOption,
    });
  }

  const { globalSighashOption, perInputSighashOptions } =
    deriveGlobalAndPerInputSighash(inputSighashOptions);
  parsedInputs.forEach((input, index) => {
    input.inputSighashOption = perInputSighashOptions[index] || "INHERIT";
  });

  const { outputs, opReturnMessage } = parseOutputsFromScripts(psbt.txOutputs, network, warnings);

  return {
    inputs: parsedInputs,
    outputs,
    opReturnMessage,
    txVersion: String(psbt.version),
    locktimeHex: formatUint32Hex(psbt.locktime),
    globalSighashOption,
    warnings,
  };
}

function parseRawTransactionToFormData(tx) {
  const network = getSelectedNetwork();
  const warnings = [
    "Raw transaction hex does not include prevout value/scriptPubKey. Fill input value/scriptPubKey manually.",
  ];

  const inputs = tx.ins.map((input) => ({
    txid: inputHashToTxid(input.hash),
    vout: String(input.index),
    sequenceHex: formatUint32Hex(input.sequence),
    value: "",
    scriptPubKey: "",
    inputSighashOption: "INHERIT",
  }));

  const txOutputs = tx.outs.map((out) => ({
    script: out.script,
    value: out.value,
  }));
  const { outputs, opReturnMessage } = parseOutputsFromScripts(txOutputs, network, warnings);

  return {
    inputs,
    outputs,
    opReturnMessage,
    txVersion: String(tx.version >>> 0),
    locktimeHex: formatUint32Hex(tx.locktime),
    globalSighashOption: "DEFAULT",
    warnings,
  };
}

function populateFormWithParsedData(parsed) {
  document.getElementById("utxoContainer").innerHTML = "";
  document.getElementById("outputContainer").innerHTML = "";

  if (parsed.inputs.length === 0) {
    addInput();
  } else {
    parsed.inputs.forEach((input) => {
      addInput(
        null,
        input.txid,
        input.vout,
        input.sequenceHex || "fffffffd",
        input.value,
        input.scriptPubKey,
        input.inputSighashOption || "INHERIT"
      );
    });
  }

  if (parsed.outputs.length === 0) {
    addOutput();
  } else {
    parsed.outputs.forEach((output) => {
      addOutput(null, output.address, output.value);
    });
  }

  document.getElementById("sighashType").value = parsed.globalSighashOption || "DEFAULT";
  document.getElementById("txVersion").value = parsed.txVersion || "2";
  document.getElementById("txVersion").dispatchEvent(new Event("input"));
  document.getElementById("txLocktime").value = parsed.locktimeHex || "00000000";
  document.getElementById("txLocktime").dispatchEvent(new Event("input"));

  const includeOpReturn = document.getElementById("includeOpReturn");
  const opReturnMessage = document.getElementById("opReturnMessage");
  includeOpReturn.checked = parsed.opReturnMessage !== null;
  opReturnMessage.value = parsed.opReturnMessage || "";
  includeOpReturn.dispatchEvent(new Event("change"));
  opReturnMessage.dispatchEvent(new Event("input"));

  document.getElementById("psbtDisplay").style.display = "none";
  document.getElementById("psbtBase64").value = "";
  window.currentPsbt = null;
  updateFeeCalc();

  if (parsed.warnings.length > 0) {
    alert(parsed.warnings.join("\n"));
  }
}

function parsePastedTransactionData(rawValue) {
  const compact = rawValue.trim().replace(/\s+/g, "");
  if (!compact) {
    throw new Error("Paste PSBT or raw transaction data first.");
  }

  const network = getSelectedNetwork();
  try {
    return { type: "psbt", data: bitcoin.Psbt.fromBase64(compact, { network }) };
  } catch {}

  if (/^[0-9a-fA-F]+$/.test(compact)) {
    if (compact.toLowerCase().startsWith("70736274ff")) {
      try {
        return { type: "psbt", data: bitcoin.Psbt.fromHex(compact, { network }) };
      } catch {}
    }

    try {
      return { type: "rawtx", data: bitcoin.Transaction.fromHex(compact) };
    } catch {}

    try {
      return { type: "psbt", data: bitcoin.Psbt.fromHex(compact, { network }) };
    } catch {}
  }

  throw new Error("Unsupported format. Paste PSBT base64/hex or raw transaction hex.");
}

function normalizeHexInput(rawValue) {
  return String(rawValue || "").replace(/\s+/g, "").toLowerCase();
}

function readFixedHex(hex, offsetBytes, lengthBytes, label) {
  const start = offsetBytes * 2;
  const end = start + lengthBytes * 2;
  if (end > hex.length) {
    throw new Error(`Unexpected end while reading ${label}`);
  }
  return {
    segment: hex.slice(start, end),
    nextOffsetBytes: offsetBytes + lengthBytes,
  };
}

function readVarIntHex(hex, offsetBytes, label) {
  const first = readFixedHex(hex, offsetBytes, 1, label);
  const prefix = Number.parseInt(first.segment, 16);

  if (prefix < 0xfd) {
    return {
      segment: first.segment,
      value: prefix,
      nextOffsetBytes: first.nextOffsetBytes,
    };
  }

  const extraBytes = prefix === 0xfd ? 2 : prefix === 0xfe ? 4 : 8;
  const extra = readFixedHex(hex, first.nextOffsetBytes, extraBytes, label);
  const fullSegment = first.segment + extra.segment;

  if (extraBytes < 8) {
    const littleEndian = Buffer.from(extra.segment, "hex");
    let value = 0;
    for (let i = 0; i < littleEndian.length; i += 1) {
      value += littleEndian[i] * 2 ** (8 * i);
    }
    return {
      segment: fullSegment,
      value,
      nextOffsetBytes: extra.nextOffsetBytes,
    };
  }

  const littleEndian = Buffer.from(extra.segment, "hex");
  let value = 0n;
  for (let i = 0; i < littleEndian.length; i += 1) {
    value += BigInt(littleEndian[i]) << BigInt(8 * i);
  }
  return {
    segment: fullSegment,
    value,
    nextOffsetBytes: extra.nextOffsetBytes,
  };
}

function toSafeCount(value, label) {
  if (typeof value === "bigint") {
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(`${label} is too large`);
    }
    return Number(value);
  }
  return value;
}

function parseRawTxHexSegments(rawHex) {
  const hex = normalizeHexInput(rawHex);
  if (!hex) return [];
  if (!/^[0-9a-f]+$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error("Invalid hex");
  }

  const segments = [];
  let offset = 0;
  const totalBytes = hex.length / 2;
  const pushSegment = (segmentHex, label) => {
    if (segmentHex) {
      segments.push({ hex: segmentHex, label });
    }
  };

  const version = readFixedHex(hex, offset, 4, "version");
  pushSegment(version.segment, "version (4 bytes)");
  offset = version.nextOffsetBytes;

  let isSegwit = false;
  if (offset + 2 <= totalBytes) {
    const marker = hex.slice(offset * 2, offset * 2 + 2);
    const flag = hex.slice(offset * 2 + 2, offset * 2 + 4);
    if (marker === "00" && flag !== "00") {
      const segwitMarker = readFixedHex(hex, offset, 1, "segwit marker");
      pushSegment(segwitMarker.segment, "segwit marker (1 byte)");
      offset = segwitMarker.nextOffsetBytes;

      const segwitFlag = readFixedHex(hex, offset, 1, "segwit flag");
      pushSegment(segwitFlag.segment, "segwit flag (1 byte)");
      offset = segwitFlag.nextOffsetBytes;
      isSegwit = true;
    }
  }

  const inputCountVarInt = readVarIntHex(hex, offset, "input count");
  pushSegment(inputCountVarInt.segment, "input count (varint)");
  offset = inputCountVarInt.nextOffsetBytes;
  const inputCount = toSafeCount(inputCountVarInt.value, "Input count");

  for (let i = 0; i < inputCount; i += 1) {
    const prevTxid = readFixedHex(hex, offset, 32, `input #${i} outpoint txid`);
    pushSegment(prevTxid.segment, `input #${i} outpoint txid (32 bytes)`);
    offset = prevTxid.nextOffsetBytes;

    const vout = readFixedHex(hex, offset, 4, `input #${i} outpoint index`);
    pushSegment(vout.segment, `input #${i} outpoint index (4 bytes)`);
    offset = vout.nextOffsetBytes;

    const scriptLength = readVarIntHex(hex, offset, `input #${i} scriptSig length`);
    pushSegment(scriptLength.segment, `input #${i} scriptSig length (varint)`);
    offset = scriptLength.nextOffsetBytes;

    const scriptBytes = toSafeCount(scriptLength.value, `Input ${i} script length`);
    if (scriptBytes > 0) {
      const scriptSig = readFixedHex(hex, offset, scriptBytes, `input #${i} scriptSig`);
      pushSegment(scriptSig.segment, `input #${i} scriptSig (${scriptBytes} bytes)`);
      offset = scriptSig.nextOffsetBytes;
    }

    const sequence = readFixedHex(hex, offset, 4, `input #${i} sequence`);
    pushSegment(sequence.segment, `input #${i} sequence (4 bytes)`);
    offset = sequence.nextOffsetBytes;
  }

  const outputCountVarInt = readVarIntHex(hex, offset, "output count");
  pushSegment(outputCountVarInt.segment, "output count (varint)");
  offset = outputCountVarInt.nextOffsetBytes;
  const outputCount = toSafeCount(outputCountVarInt.value, "Output count");

  for (let i = 0; i < outputCount; i += 1) {
    const value = readFixedHex(hex, offset, 8, `output #${i} value`);
    pushSegment(value.segment, `output #${i} value (8 bytes)`);
    offset = value.nextOffsetBytes;

    const scriptLength = readVarIntHex(hex, offset, `output #${i} scriptPubKey length`);
    pushSegment(scriptLength.segment, `output #${i} scriptPubKey length (varint)`);
    offset = scriptLength.nextOffsetBytes;

    const scriptBytes = toSafeCount(scriptLength.value, `Output ${i} script length`);
    if (scriptBytes > 0) {
      const script = readFixedHex(hex, offset, scriptBytes, `output #${i} scriptPubKey`);
      pushSegment(script.segment, `output #${i} scriptPubKey (${scriptBytes} bytes)`);
      offset = script.nextOffsetBytes;
    }
  }

  if (isSegwit) {
    for (let i = 0; i < inputCount; i += 1) {
      const itemCount = readVarIntHex(hex, offset, `input #${i} witness item count`);
      pushSegment(itemCount.segment, `input #${i} witness item count (varint)`);
      offset = itemCount.nextOffsetBytes;
      const witnessItemCount = toSafeCount(itemCount.value, `Witness count for input ${i}`);

      for (let j = 0; j < witnessItemCount; j += 1) {
        const itemLength = readVarIntHex(hex, offset, `input #${i} witness item #${j} length`);
        pushSegment(itemLength.segment, `input #${i} witness item #${j} length (varint)`);
        offset = itemLength.nextOffsetBytes;

        const witnessLength = toSafeCount(itemLength.value, `Witness item length for input ${i}`);
        if (witnessLength > 0) {
          const witnessItem = readFixedHex(
            hex,
            offset,
            witnessLength,
            `input #${i} witness item #${j}`
          );
          pushSegment(witnessItem.segment, `input #${i} witness item #${j} (${witnessLength} bytes)`);
          offset = witnessItem.nextOffsetBytes;
        }
      }
    }
  }

  const locktime = readFixedHex(hex, offset, 4, "locktime");
  pushSegment(locktime.segment, "locktime (4 bytes)");
  offset = locktime.nextOffsetBytes;

  if (offset !== totalBytes) {
    throw new Error("Unexpected trailing bytes");
  }

  return segments;
}

function renderRawTxSegments(rawValue) {
  const output = document.getElementById("rawTxDecodedOutput");
  if (!output) return;

  const compact = normalizeHexInput(rawValue);
  if (!compact) {
    output.textContent = "";
    return;
  }

  try {
    const segments = parseRawTxHexSegments(compact);
    const fragment = document.createDocumentFragment();
    segments.forEach((segment, index) => {
      const span = document.createElement("span");
      span.className = `tx-seg-${index % 8}`;
      span.title = segment.label;
      span.textContent = segment.hex;
      fragment.appendChild(span);
    });
    output.textContent = "";
    output.appendChild(fragment);
  } catch {
    const span = document.createElement("span");
    span.className = "tx-seg-0";
    span.title = "unparsed raw hex";
    span.textContent = compact;
    output.textContent = "";
    output.appendChild(span);
  }
}

function tryDecodeSighashType(signatureBytes) {
  if (!(signatureBytes instanceof Uint8Array) || signatureBytes.length === 0) {
    return null;
  }

  const candidate = Buffer.from(signatureBytes);
  try {
    const decoded = bitcoin.script.signature.decode(candidate);
    return decoded.hashType >>> 0;
  } catch {}

  if (candidate.length === 64) {
    return bitcoin.Transaction.SIGHASH_DEFAULT;
  }
  if (candidate.length === 65 && candidate[0] !== 0x04) {
    return candidate[64] >>> 0;
  }
  return null;
}

function inferInputSighashType(input) {
  const candidates = [];

  if (Array.isArray(input.witness)) {
    for (const item of input.witness) {
      if (item instanceof Uint8Array) {
        candidates.push(item);
      }
    }
  }

  if (input.script && input.script.length > 0) {
    const chunks = bitcoin.script.decompile(input.script) || [];
    for (const chunk of chunks) {
      if (chunk instanceof Uint8Array) {
        candidates.push(chunk);
      }
    }
  }

  for (const candidate of candidates) {
    const sighashType = tryDecodeSighashType(candidate);
    if (sighashType !== null) {
      return sighashType;
    }
  }
  return null;
}

function formatSighashLabel(sighashType) {
  if (sighashType === null) return "Unknown";
  if (sighashType === bitcoin.Transaction.SIGHASH_DEFAULT) return "SIGHASH_DEFAULT (0x00)";

  const base = sighashType & 0x1f;
  const hasAnyoneCanPay = (sighashType & bitcoin.Transaction.SIGHASH_ANYONECANPAY) !== 0;
  let baseLabel = null;

  if (base === bitcoin.Transaction.SIGHASH_ALL) baseLabel = "SIGHASH_ALL";
  else if (base === bitcoin.Transaction.SIGHASH_NONE) baseLabel = "SIGHASH_NONE";
  else if (base === bitcoin.Transaction.SIGHASH_SINGLE) baseLabel = "SIGHASH_SINGLE";

  if (!baseLabel) return `Unknown (0x${(sighashType & 0xff).toString(16).padStart(2, "0")})`;
  const label = hasAnyoneCanPay ? `${baseLabel} | ANYONECANPAY` : baseLabel;
  return `${label} (0x${(sighashType & 0xff).toString(16).padStart(2, "0")})`;
}

function createRawTxSummaryRow(label, value, useMono = false) {
  const row = document.createElement("div");
  row.className = "rawtx-summary-row";

  const key = document.createElement("span");
  key.className = "rawtx-summary-key";
  key.textContent = label;

  const rawValue = document.createElement("span");
  rawValue.className = useMono ? "rawtx-summary-value mono" : "rawtx-summary-value";
  rawValue.textContent = value;

  row.append(key, rawValue);
  return row;
}

function createRawTxSummaryItem(title, rows) {
  const item = document.createElement("article");
  item.className = "rawtx-summary-item";

  const heading = document.createElement("div");
  heading.className = "rawtx-summary-head";
  heading.textContent = title;
  item.appendChild(heading);

  rows.forEach((row) => {
    item.appendChild(createRawTxSummaryRow(row.label, row.value, row.mono));
  });
  return item;
}

function renderRawTxSummary(rawValue) {
  const inputSummary = document.getElementById("rawTxInputSummary");
  const outputSummary = document.getElementById("rawTxOutputSummary");
  if (!inputSummary || !outputSummary) return;

  inputSummary.textContent = "";
  outputSummary.textContent = "";

  const compact = normalizeHexInput(rawValue);
  if (!compact) return;

  try {
    const tx = bitcoin.Transaction.fromHex(compact);
    const network = getSelectedNetwork();

    const inputDetails = tx.ins.map((input, index) => ({
      index,
      outpoint: `${inputHashToTxid(input.hash)}:${input.index}`,
      sighash: formatSighashLabel(inferInputSighashType(input)),
      sequenceHex: formatUint32Hex(input.sequence >>> 0),
    }));

    inputDetails.forEach((input) => {
      inputSummary.appendChild(
        createRawTxSummaryItem(`Input #${input.index}`, [
          { label: "Outpoint", value: input.outpoint, mono: true },
          { label: "nSequence", value: `0x${input.sequenceHex}`, mono: true },
          { label: "Sighash", value: input.sighash, mono: false },
        ])
      );
    });

    tx.outs.forEach((output, index) => {
      const scriptPubKey = bytesToHex(output.script);
      let address = "-";
      try {
        address = bitcoin.address.fromOutputScript(output.script, network);
      } catch {}

      const valueSats = typeof output.value === "bigint" ? output.value : BigInt(output.value);
      const amount = `${satoshiToBtcString(valueSats)} BTC (${valueSats.toString()} sats)`;

      outputSummary.appendChild(
        createRawTxSummaryItem(`Output #${index}`, [
          { label: "Script", value: scriptPubKey, mono: true },
          { label: "Address", value: address, mono: true },
          { label: "Amount", value: amount, mono: false },
        ])
      );
    });
  } catch {
    inputSummary.appendChild(
      createRawTxSummaryItem("Input Summary", [
        { label: "Status", value: "Could not parse this transaction.", mono: false },
      ])
    );
  }
}

function isValidTxid(txid) {
  return /^[0-9a-fA-F]{64}$/.test(String(txid || "").trim());
}

function isValidHexPayload(value) {
  return /^[0-9a-f]+$/.test(value) && value.length % 2 === 0;
}

function getMempoolTxApiBase(networkValue, txid) {
  const { mempoolPath } = getNetworkConfig(networkValue);
  return `https://mempool.space${mempoolPath}/api/tx/${txid}`;
}

async function fetchRawTxHexFromMempool(txid, networkValue = "mainnet") {
  const normalizedTxid = String(txid || "").trim().toLowerCase();
  const apiBase = getMempoolTxApiBase(networkValue, normalizedTxid);
  let lastStatus = null;

  const hexResponse = await fetch(`${apiBase}/hex`, {
    headers: { Accept: "text/plain" },
  });
  if (hexResponse.ok) {
    const payload = normalizeHexInput(await hexResponse.text());
    if (!isValidHexPayload(payload)) {
      throw new Error("API returned invalid hex payload.");
    }
    return payload;
  }
  lastStatus = hexResponse.status;

  const txResponse = await fetch(apiBase, {
    headers: { Accept: "application/json" },
  });
  if (txResponse.ok) {
    const data = await txResponse.json();
    if (typeof data?.hex === "string") {
      const payload = normalizeHexInput(data.hex);
      if (!isValidHexPayload(payload)) {
        throw new Error("API returned invalid hex payload.");
      }
      return payload;
    }
    throw new Error("Raw hex not found in API response.");
  }
  lastStatus = txResponse.status;

  throw new Error(`mempool.space request failed (status ${lastStatus}).`);
}

function initPageMenu() {
  const builderPage = document.getElementById("builderPage");
  const decoderPage = document.getElementById("decoderPage");
  const openBuilderPageButton = document.getElementById("openBuilderPage");
  const openDecoderPageButton = document.getElementById("openDecoderPage");
  const rawTxIdInput = document.getElementById("rawTxIdInput");
  const fetchRawTxButton = document.getElementById("fetchRawTxButton");
  const clearRawTxButton = document.getElementById("clearRawTxButton");
  const rawTxFetchStatus = document.getElementById("rawTxFetchStatus");
  const rawTxHexInput = document.getElementById("rawTxHexInput");
  const networkSelect = document.getElementById("network");

  if (
    !builderPage ||
    !decoderPage ||
    !openBuilderPageButton ||
    !openDecoderPageButton ||
    !rawTxIdInput ||
    !fetchRawTxButton ||
    !clearRawTxButton ||
    !rawTxFetchStatus ||
    !rawTxHexInput ||
    !networkSelect
  ) {
    return;
  }

  const renderRawTxDecoderView = (value) => {
    renderRawTxSegments(value);
    renderRawTxSummary(value);
  };

  const setPage = (page) => {
    const showBuilder = page === "builder";
    builderPage.classList.toggle("hidden", !showBuilder);
    decoderPage.classList.toggle("hidden", showBuilder);
    openBuilderPageButton.classList.toggle("active", showBuilder);
    openDecoderPageButton.classList.toggle("active", !showBuilder);
  };

  const setFetchStatus = (message, hasError = false) => {
    rawTxFetchStatus.textContent = message;
    rawTxFetchStatus.classList.toggle("error", hasError);
  };

  let requestCounter = 0;
  const loadRawTxFromTxid = async () => {
    const txid = rawTxIdInput.value.trim();
    if (!isValidTxid(txid)) {
      setFetchStatus("Enter a valid 64-character txid.", true);
      return;
    }

    const selectedNetworkValue = networkSelect.value;

    requestCounter += 1;
    const currentRequest = requestCounter;
    fetchRawTxButton.disabled = true;
    setFetchStatus(`Loading from mempool.space ${selectedNetworkValue} API...`, false);

    try {
      const rawTxHex = await fetchRawTxHexFromMempool(txid, selectedNetworkValue);
      if (currentRequest !== requestCounter) return;
      rawTxHexInput.value = rawTxHex;
      renderRawTxDecoderView(rawTxHex);
      setFetchStatus("Loaded.", false);
    } catch (error) {
      if (currentRequest !== requestCounter) return;
      setFetchStatus(`Failed to load: ${error.message}`, true);
    } finally {
      if (currentRequest === requestCounter) {
        fetchRawTxButton.disabled = false;
      }
    }
  };

  openBuilderPageButton.addEventListener("click", () => setPage("builder"));
  openDecoderPageButton.addEventListener("click", () => setPage("decoder"));
  networkSelect.addEventListener("change", () => {
    renderRawTxSummary(rawTxHexInput.value);
  });
  rawTxHexInput.addEventListener("input", (event) => {
    renderRawTxDecoderView(event.target.value);
  });
  rawTxIdInput.addEventListener("input", () => {
    setFetchStatus("", false);
  });
  rawTxIdInput.addEventListener("change", () => {
    if (isValidTxid(rawTxIdInput.value.trim())) {
      void loadRawTxFromTxid();
    }
  });
  rawTxIdInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void loadRawTxFromTxid();
    }
  });
  fetchRawTxButton.addEventListener("click", () => {
    void loadRawTxFromTxid();
  });
  clearRawTxButton.addEventListener("click", () => {
    requestCounter += 1;
    fetchRawTxButton.disabled = false;
    rawTxIdInput.value = "";
    rawTxHexInput.value = "";
    setFetchStatus("", false);
    renderRawTxDecoderView("");
  });

  renderRawTxDecoderView(rawTxHexInput.value);
  setPage("builder");
}

document.getElementById("createPsbt").onclick = () => {
  try {
    const network = getSelectedNetwork();
    refreshAllScriptLabels();
    const hasInvalidInputScript = Array.from(document.querySelectorAll(".script-input")).some(
      (input) => !decodeP2wpkhAddressFromScript(input.value.trim(), network)
    );
    if (hasInvalidInputScript) {
      return alert("Only P2WPKH input scriptPubKey is allowed.");
    }

    const inputRows = Array.from(document.getElementById("utxoContainer").children);
    if (inputRows.length === 0) throw new Error("Add at least one input.");
    const utxos = inputRows.map(
      (row, index) => {
        const txidInput = row.querySelector(".txid-input");
        const voutInput = row.querySelector(".vout-input");
        const sequenceInput = row.querySelector(".sequence-input");
        const valueInput = row.querySelector(".value-input");
        const scriptInput = row.querySelector(".script-input");
        const inputSighashOption = row.querySelector(".input-sighash").value;
        const maybeInputSighash = optionToSighashType(inputSighashOption, true);
        const txid = txidInput.value.trim();
        if (!isValidTxid(txid)) throw new Error(`Input #${index + 1} txid must be 64 hex characters.`);
        return {
          txid,
          vout: parseVout(voutInput.value, `Input #${index + 1} vout`),
          sequenceHex: sequenceInput.value.trim(),
          value: parseBtcToSafeSats(valueInput.value, `Input #${index + 1} value`),
          scriptPubKey: scriptInput.value.trim(),
          inputSighashOption,
          sighashType: maybeInputSighash === null ? undefined : maybeInputSighash,
        };
      }
    );

    const outputRows = Array.from(document.getElementById("outputContainer").children);
    if (outputRows.length === 0) throw new Error("Add at least one output.");
    const outputs = outputRows.map(
      (row, index) => {
        const [addressInput, valueInput] = row.querySelectorAll("input");
        const address = addressInput.value.trim();
        if (!validateBitcoinAddress(address, network)) {
          throw new Error(`Output #${index + 1} has an invalid address for the selected network.`);
        }
        return {
          address,
          value: parseBtcToSafeSats(valueInput.value, `Output #${index + 1} value`),
        };
      }
    );

    const includeChange = includeChangeCheckbox.checked;
    const feeRate = parseFloat(document.getElementById("feeRate").value);
    const changeAddress = document.getElementById("changeAddress").value.trim();
    const sighashType = getSelectedSighashType();
    const txVersion = parseTxVersion(document.getElementById("txVersion").value);
    const txLocktime = parseUint32Hex(document.getElementById("txLocktime").value, "Locktime");

    let opReturnData = null;
    if (document.getElementById("includeOpReturn").checked) {
      const message = document.getElementById("opReturnMessage").value.trim();
      if (!message) return alert("Enter an OP_RETURN message.");

      if (/^0x/i.test(message)) {
        const hexData = message.slice(2);
        if (!/^[0-9a-fA-F]*$/.test(hexData)) return alert("Invalid hex data.");
        opReturnData = Buffer.from(hexData, "hex");
      } else {
        opReturnData = Buffer.from(message, "utf8");
      }

      if (opReturnData.length > 83) return alert("OP_RETURN data exceeds 83 bytes.");
    }

    if (includeChange) {
      if (!feeRate || feeRate <= 0) return alert("Enter a fee‑rate.");
      if (!validateBitcoinAddress(changeAddress, network)) {
        return alert("Invalid change address.");
      }
    }

    let psbt;
    let fee;
    if (includeChange) {
      const temp = createPsbtFromInputs(
        utxos,
        outputs,
        0,
        changeAddress,
        opReturnData,
        sighashType,
        txLocktime,
        txVersion
      );
      const vsize = estimateVirtualSize(temp);
      fee = Math.ceil(feeRate * vsize);
      psbt = createPsbtFromInputs(
        utxos,
        outputs,
        fee,
        changeAddress,
        opReturnData,
        sighashType,
        txLocktime,
        txVersion
      );
    } else {
      const totalIn = utxos.reduce((sum, utxo) => sum + utxo.value, 0);
      const totalOut = outputs.reduce((sum, output) => sum + output.value, 0);
      fee = totalIn - totalOut;
      if (fee < 0) return alert("Outputs exceed inputs!");
      psbt = createPsbtFromInputs(
        utxos,
        outputs,
        0,
        "",
        opReturnData,
        sighashType,
        txLocktime,
        txVersion
      );
      feeCalc.textContent = `Transaction fee: ${(fee / 1e8).toFixed(8)} BTC`;
    }

    const psbtBase64 = psbt.toBase64();
    document.getElementById("psbtBase64").value = psbtBase64;
    document.getElementById("psbtDisplay").style.display = "block";
    window.currentPsbt = psbt;
  } catch (error) {
    alert("Error creating PSBT: " + error.message);
  }
};

document.getElementById("addInputButton").addEventListener("click", addInput);
document.getElementById("addOutputButton").addEventListener("click", addOutput);

document.getElementById("copyPsbtButton").onclick = () => {
  const psbtText = document.getElementById("psbtBase64");
  psbtText.select();
  navigator.clipboard
    .writeText(psbtText.value)
    .then(() => {
      const button = document.getElementById("copyPsbtButton");
      const originalText = button.textContent;
      button.textContent = "Copied!";
      setTimeout(() => {
        button.textContent = originalText;
      }, 2000);
    })
    .catch((error) => alert("Failed to copy: " + error));
};

document.getElementById("downloadPsbtButton").onclick = () => {
  if (window.currentPsbt) downloadPsbt(window.currentPsbt);
};

document.getElementById("importDataButton").onclick = () => {
  try {
    const raw = document.getElementById("importData").value;
    const parsed = parsePastedTransactionData(raw);
    if (parsed.type === "psbt") {
      populateFormWithParsedData(parsePsbtToFormData(parsed.data));
    } else {
      populateFormWithParsedData(parseRawTransactionToFormData(parsed.data));
    }
  } catch (error) {
    alert("Import failed: " + error.message);
  }
};

document.getElementById("clearButton").onclick = () => {
  document.getElementById("utxoContainer").innerHTML = "";
  document.getElementById("outputContainer").innerHTML = "";
  document.getElementById("importData").value = "";
  document.getElementById("feeRate").value = "";
  document.getElementById("changeAddress").value = "";
  document.getElementById("txVersion").value = "2";
  document.getElementById("txVersion").dispatchEvent(new Event("input"));
  document.getElementById("txLocktime").value = "00000000";
  document.getElementById("txLocktime").dispatchEvent(new Event("input"));
  document.getElementById("includeOpReturn").checked = false;
  document.getElementById("opReturnMessage").value = "";
  document.getElementById("sighashType").value = "DEFAULT";
  document.getElementById("opReturnGroup").style.display = "none";
  document.getElementById("psbtDisplay").style.display = "none";
  document.getElementById("psbtBase64").value = "";
  window.currentPsbt = null;
  addInput();
  addOutput();
  updateFeeCalc();
};

const changeAddrInput = document.getElementById("changeAddress");
function validateChangeAddr() {
  const network = getSelectedNetwork();
  const isValid = validateBitcoinAddress(changeAddrInput.value.trim(), network);
  colourField(changeAddrInput, isValid);
}

const txLocktimeInput = document.getElementById("txLocktime");
function validateTxLocktime() {
  colourField(txLocktimeInput, isValidUint32Hex(txLocktimeInput.value.trim()));
}

const txVersionInput = document.getElementById("txVersion");
function validateTxVersion() {
  colourField(txVersionInput, isValidTxVersion(txVersionInput.value.trim()));
}

changeAddrInput.addEventListener("input", validateChangeAddr);
txLocktimeInput.addEventListener("input", validateTxLocktime);
txVersionInput.addEventListener("input", validateTxVersion);
validateChangeAddr();
validateTxLocktime();
validateTxVersion();

document.getElementById("network").addEventListener("change", refreshAllScriptLabels);

function updateFeeCalc() {
  const useChange = includeChangeCheckbox.checked;
  const feeRate = parseFloat(document.getElementById("feeRate").value) || 0;

  const utxos = Array.from(document.querySelectorAll("[data-utxo]")).map((row) => {
    const txidInput = row.querySelector(".txid-input");
    const voutInput = row.querySelector(".vout-input");
    const sequenceInput = row.querySelector(".sequence-input");
    const valueInput = row.querySelector(".value-input");
    const scriptInput = row.querySelector(".script-input");
    const inputSighashOption = row.querySelector(".input-sighash").value;
    const maybeInputSighash = optionToSighashType(inputSighashOption, true);
    return {
      txid: txidInput.value,
      vout: +voutInput.value,
      sequenceHex: sequenceInput.value,
      value: Math.round(parseFloat(valueInput.value || 0) * 1e8),
      scriptPubKey: scriptInput.value,
      inputSighashOption,
      sighashType: maybeInputSighash === null ? undefined : maybeInputSighash,
    };
  });

  const outputs = Array.from(document.querySelectorAll("[data-output]")).map((row) => {
    const [addressInput, valueInput] = row.querySelectorAll("input");
    return {
      address: addressInput.value,
      value: Math.round(parseFloat(valueInput.value || 0) * 1e8),
    };
  });

  const totalIn = utxos.reduce((sum, utxo) => sum + (utxo.value || 0), 0);
  const totalOut = outputs.reduce((sum, output) => sum + (output.value || 0), 0);

  let fee = 0;
  let available = 0;
  let feeText = "";

  if (useChange) {
    if (!feeRate) {
      feeText = "(enter fee‑rate to estimate fee)";
      available = totalIn - totalOut;
    } else {
      try {
        const changeAddress = document.getElementById("changeAddress").value.trim();
        const sighashType = getSelectedSighashType();
        const txVersion = parseTxVersion(document.getElementById("txVersion").value);
        const txLocktime = parseUint32Hex(document.getElementById("txLocktime").value, "Locktime");
        const temp = createPsbtFromInputs(
          utxos,
          outputs,
          0,
          changeAddress,
          null,
          sighashType,
          txLocktime,
          txVersion
        );
        const vsize = estimateVirtualSize(temp);
        fee = Math.ceil(feeRate * vsize);
        available = totalIn - totalOut - fee;
        feeText = `Estimated fee: ${(fee / 1e8).toFixed(8)} BTC (${vsize} vB)`;
      } catch {
        feeText = "(unable to estimate – check values)";
        available = totalIn - totalOut;
      }
    }
  } else {
    fee = totalIn - totalOut;
    available = 0;
    feeText = `Transaction fee: ${(fee / 1e8).toFixed(8)} BTC`;
  }

  document.getElementById("totalInputs").textContent = `${(totalIn / 1e8).toFixed(8)} BTC`;
  document.getElementById("totalOutputs").textContent = `${(totalOut / 1e8).toFixed(8)} BTC`;
  document.getElementById("feeAmount").textContent = `${(fee / 1e8).toFixed(8)} BTC`;
  document.getElementById("availableBalance").textContent = `${(available / 1e8).toFixed(8)} BTC`;
  document.getElementById("availableBalance").style.color =
    available >= 0 ? "#2196F3" : "#f44336";

  feeCalc.textContent = feeText;
  feeCalc.style.display = feeText ? "" : "none";
}

window.updateFeeCalc = updateFeeCalc;

function toggleChangeMode() {
  const enabled = includeChangeCheckbox.checked;
  feeRateGroup.style.display = enabled ? "" : "none";
  changeAddrGroup.style.display = enabled ? "" : "none";
  feeCalc.style.display = enabled ? "none" : "";
  if (enabled) feeCalc.textContent = "";
  updateFeeCalc();
}

const includeChangeCheckbox = document.getElementById("includeChange");
const feeRateGroup = document.getElementById("feeRateGroup");
const changeAddrGroup = document.getElementById("changeAddrGroup");
const feeCalc = document.getElementById("feeCalc");

includeChangeCheckbox.addEventListener("change", toggleChangeMode);
toggleChangeMode();

document.getElementById("includeOpReturn").addEventListener("change", (event) => {
  document.getElementById("opReturnGroup").style.display = event.target.checked ? "" : "none";
});

const OP_RETURN_MAX_BYTES = 83;
const opReturnMessageInput = document.getElementById("opReturnMessage");
const opReturnByteStatus = document.getElementById("opReturnByteStatus");
const createPsbtButton = document.getElementById("createPsbt");

function getOpReturnByteState(value) {
  if (/^0x/i.test(value)) {
    const hexData = value.slice(2);
    if (!hexData) return { bytes: 0, error: "" };
    if (!/^[0-9a-fA-F]*$/.test(hexData)) return { bytes: 0, error: "Invalid hex data." };
    if (hexData.length % 2 !== 0) return { bytes: 0, error: "Hex length must be even." };
    return { bytes: hexData.length / 2, error: "" };
  }
  return { bytes: new TextEncoder().encode(value).length, error: "" };
}

function updateOpReturnState() {
  const includeOpReturn = document.getElementById("includeOpReturn");
  const enabled = includeOpReturn.checked;
  const state = getOpReturnByteState(opReturnMessageInput.value.trim());
  const tooLarge = state.bytes > OP_RETURN_MAX_BYTES;
  const hasError = enabled && (tooLarge || !!state.error);

  if (!enabled) {
    opReturnByteStatus.textContent = "0 / 83 bytes";
  } else if (state.error) {
    opReturnByteStatus.textContent = `${state.error} (0 / 83 bytes)`;
  } else if (tooLarge) {
    opReturnByteStatus.textContent = `${state.bytes} / 83 bytes (exceeds limit)`;
  } else {
    opReturnByteStatus.textContent = `${state.bytes} / 83 bytes`;
  }

  opReturnByteStatus.classList.toggle("error", hasError);
  opReturnMessageInput.classList.toggle("error", hasError);
  createPsbtButton.disabled = hasError;
}

document.getElementById("includeOpReturn").addEventListener("change", updateOpReturnState);
opReturnMessageInput.addEventListener("input", updateOpReturnState);
document.getElementById("clearButton").addEventListener("click", () => {
  setTimeout(updateOpReturnState, 0);
});
updateOpReturnState();

document.getElementById("utxoContainer").addEventListener("input", updateFeeCalc);
document.getElementById("outputContainer").addEventListener("input", updateFeeCalc);
document.getElementById("feeRate").addEventListener("input", updateFeeCalc);
document.getElementById("changeAddress").addEventListener("input", updateFeeCalc);
document.getElementById("txVersion").addEventListener("input", updateFeeCalc);
document.getElementById("txLocktime").addEventListener("input", updateFeeCalc);
document.getElementById("sighashType").addEventListener("change", updateFeeCalc);

const feeCalculatorDialog = document.getElementById("feeCalculatorDialog");
const calculatorOutputList = document.getElementById("calculatorOutputList");
const calculatorFeeInput = document.getElementById("calculatorFee");
const calculatorError = document.getElementById("feeCalculatorError");
const calculatorApplyButton = document.getElementById("applyFeeCalculator");
const calculatorTotalInputs = document.getElementById("calculatorTotalInputs");
const calculatorTotalOutputs = document.getElementById("calculatorTotalOutputs");
const calculatorFeePreview = document.getElementById("calculatorFeePreview");
const calculatorVsize = document.getElementById("calculatorVsize");
const calculatorAbsoluteMode = document.getElementById("calculatorAbsoluteMode");
const calculatorRateMode = document.getElementById("calculatorRateMode");
const calculatorRateField = document.getElementById("calculatorRateField");
const calculatorFeeRateInput = document.getElementById("calculatorFeeRate");
const calculatorFeeHint = document.getElementById("calculatorFeeHint");
const SATOSHIS_PER_BTC = 100000000n;
const FEE_RATE_SCALE = 100000000n;
const MAX_SAFE_SATOSHIS = BigInt(Number.MAX_SAFE_INTEGER);
let feeCalculatorState = null;

function parseCalculatorBtc(rawValue, fieldName) {
  const value = String(rawValue ?? "").trim();
  if (!value) throw new Error(`${fieldName} is required.`);
  if (!/^(?:\d+(?:\.\d{0,8})?|\.\d{1,8})$/.test(value)) {
    throw new Error(`${fieldName} must be a non-negative BTC amount with up to 8 decimals.`);
  }

  const [wholePart = "0", fractionPart = ""] = value.split(".");
  const whole = BigInt(wholePart || "0");
  const fraction = BigInt(fractionPart.padEnd(8, "0") || "0");
  const satoshis = whole * SATOSHIS_PER_BTC + fraction;
  if (satoshis > MAX_SAFE_SATOSHIS) throw new Error(`${fieldName} is too large.`);
  return satoshis;
}

function formatCalculatorBtc(satoshis) {
  const isNegative = satoshis < 0n;
  const absolute = isNegative ? -satoshis : satoshis;
  const whole = absolute / SATOSHIS_PER_BTC;
  const fraction = (absolute % SATOSHIS_PER_BTC).toString().padStart(8, "0");
  return `${isNegative ? "-" : ""}${whole.toString()}.${fraction}`;
}

function parseCalculatorFeeRate(rawValue) {
  const value = String(rawValue ?? "").trim();
  if (!value) throw new Error("Fee rate is required.");
  if (!/^(?:\d+(?:\.\d{0,8})?|\.\d{1,8})$/.test(value)) {
    throw new Error("Fee rate must be a non-negative sat/vB amount with up to 8 decimals.");
  }

  const [wholePart = "0", fractionPart = ""] = value.split(".");
  return BigInt(wholePart || "0") * FEE_RATE_SCALE
    + BigInt(fractionPart.padEnd(8, "0") || "0");
}

function formatCalculatorFeeRate(scaledRate) {
  const whole = scaledRate / FEE_RATE_SCALE;
  const fraction = (scaledRate % FEE_RATE_SCALE)
    .toString()
    .padStart(8, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole.toString()}.${fraction}` : whole.toString();
}

function compactSizeLength(value) {
  if (value < 0xfd) return 1;
  if (value <= 0xffff) return 3;
  if (value <= 0xffffffff) return 5;
  return 9;
}

function getCalculatorOpReturnScript() {
  if (!document.getElementById("includeOpReturn").checked) return null;

  const message = document.getElementById("opReturnMessage").value.trim();
  if (!message) throw new Error("Enter an OP_RETURN message before estimating vsize.");

  let data;
  if (/^0x/i.test(message)) {
    const hexData = message.slice(2);
    if (!hexData || !/^[0-9a-fA-F]+$/.test(hexData) || hexData.length % 2 !== 0) {
      throw new Error("OP_RETURN hex data must contain complete bytes.");
    }
    data = Buffer.from(hexData, "hex");
  } else {
    data = Buffer.from(message, "utf8");
  }
  if (data.length > 83) throw new Error("OP_RETURN data exceeds 83 bytes.");

  return bitcoin.script.compile([bitcoin.opcodes.OP_RETURN, data]);
}

function estimateCalculatorVirtualSize() {
  if (!feeCalculatorState) throw new Error("Fee calculator is not open.");

  const inputCount = document.querySelectorAll("[data-utxo]").length;
  if (inputCount === 0) throw new Error("Add at least one input before estimating vsize.");

  const network = getSelectedNetwork();
  const outputScripts = feeCalculatorState.outputRows.map((row, index) => {
    const address = row.querySelector(".output-address")?.value.trim();
    if (!address) throw new Error(`Output #${index + 1} address is required for fee-rate mode.`);
    try {
      return bitcoin.address.toOutputScript(address, network);
    } catch {
      throw new Error(`Output #${index + 1} has an invalid address for the selected network.`);
    }
  });

  const opReturnScript = getCalculatorOpReturnScript();
  if (opReturnScript) outputScripts.push(opReturnScript);

  const outputCount = outputScripts.length;
  const outputsSize = outputScripts.reduce(
    (sum, script) => sum + 8 + compactSizeLength(script.length) + script.length,
    0
  );
  const strippedSize =
    4
    + compactSizeLength(inputCount)
    + inputCount * 41
    + compactSizeLength(outputCount)
    + outputsSize
    + 4;

  // Marker/flag plus a conservative 109-byte signed P2WPKH witness per input.
  const witnessSize = 2 + inputCount * 109;
  return Math.ceil((strippedSize * 4 + witnessSize) / 4);
}

function setFeeCalculatorError(message = "") {
  calculatorError.textContent = message;
  calculatorApplyButton.disabled = !!message;
}

function setFeeCalculatorPreview(totalOutputSats = null, feeSats = null) {
  const totalInputSats = feeCalculatorState?.totalInputSats;
  calculatorTotalInputs.textContent = typeof totalInputSats === "bigint"
    ? `${formatCalculatorBtc(totalInputSats)} BTC`
    : "—";
  calculatorTotalOutputs.textContent = totalOutputSats === null
    ? "—"
    : `${formatCalculatorBtc(totalOutputSats)} BTC`;
  calculatorFeePreview.textContent = feeSats === null
    ? "—"
    : `${formatCalculatorBtc(feeSats)} BTC`;
  calculatorVsize.textContent = Number.isInteger(feeCalculatorState?.estimatedVsize)
    ? `${feeCalculatorState.estimatedVsize} vB`
    : "—";
}

function getCalculatorOutputFields() {
  return Array.from(calculatorOutputList.querySelectorAll(".calculator-output-value"));
}

function readAllCalculatorOutputs() {
  return getCalculatorOutputFields().map((field, index) =>
    parseCalculatorBtc(field.value, `Output #${index + 1}`)
  );
}

function updateFeeCalculatorModeUi() {
  const isRateMode = feeCalculatorState?.mode === "rate";
  calculatorAbsoluteMode.classList.toggle("active", !isRateMode);
  calculatorAbsoluteMode.setAttribute("aria-pressed", String(!isRateMode));
  calculatorRateMode.classList.toggle("active", isRateMode);
  calculatorRateMode.setAttribute("aria-pressed", String(isRateMode));
  calculatorRateField.hidden = !isRateMode;
  calculatorFeeInput.readOnly = isRateMode;
  calculatorFeeHint.textContent = isRateMode
    ? "Calculated from sat/vB and estimated vsize."
    : "Editing the fee adjusts the last output. Editing that output adjusts the fee.";

  getCalculatorOutputFields().forEach((field, index) => {
    field.readOnly = isRateMode && index === feeCalculatorState.balancingIndex;
  });
}

function validateCalculatorBalance(outputValues, feeSats) {
  const totalOutputSats = outputValues.reduce((sum, value) => sum + value, 0n);
  setFeeCalculatorPreview(totalOutputSats, feeSats);

  if (feeSats < 0n) {
    throw new Error("Outputs exceed total inputs. Reduce an output amount.");
  }
  if (outputValues.some((value) => value < 0n)) {
    throw new Error("The last output would be negative.");
  }
  if (totalOutputSats + feeSats !== feeCalculatorState.totalInputSats) {
    throw new Error("Outputs and fee do not balance with total inputs.");
  }
}

function recalculateRateMode() {
  if (!feeCalculatorState || feeCalculatorState.totalInputSats === null) {
    setFeeCalculatorPreview();
    setFeeCalculatorError(feeCalculatorState?.inputError || "Enter valid input values first.");
    return;
  }

  const outputFields = getCalculatorOutputFields();
  const balancingIndex = feeCalculatorState.balancingIndex;

  if (outputFields.length === 0) {
    setFeeCalculatorPreview();
    setFeeCalculatorError("Add at least one output first.");
    return;
  }

  try {
    feeCalculatorState.estimatedVsize = estimateCalculatorVirtualSize();
    const scaledRate = parseCalculatorFeeRate(calculatorFeeRateInput.value);
    const vsize = BigInt(feeCalculatorState.estimatedVsize);
    const feeSats = (scaledRate * vsize + FEE_RATE_SCALE - 1n) / FEE_RATE_SCALE;
    const outputValues = outputFields.map((field, index) =>
      index === balancingIndex
        ? 0n
        : parseCalculatorBtc(field.value, `Output #${index + 1}`)
    );
    const fixedOutputSats = outputValues.reduce((sum, value) => sum + value, 0n);
    const balancingValue = feeCalculatorState.totalInputSats - feeSats - fixedOutputSats;
    outputValues[balancingIndex] = balancingValue;
    outputFields[balancingIndex].value = formatCalculatorBtc(balancingValue);
    calculatorFeeInput.value = formatCalculatorBtc(feeSats);

    validateCalculatorBalance(outputValues, feeSats);
    setFeeCalculatorError();
  } catch (error) {
    setFeeCalculatorPreview();
    setFeeCalculatorError(error.message);
  }
}

function recalculateFeeCalculator(source) {
  if (!feeCalculatorState || feeCalculatorState.totalInputSats === null) {
    setFeeCalculatorPreview();
    setFeeCalculatorError(feeCalculatorState?.inputError || "Enter valid input values first.");
    return;
  }

  const outputFields = getCalculatorOutputFields();
  const balancingIndex = feeCalculatorState.balancingIndex;

  if (feeCalculatorState.mode === "rate") {
    recalculateRateMode();
    return;
  }

  try {
    let outputValues;
    let feeSats;

    if (source === "balancing-output") {
      outputValues = readAllCalculatorOutputs();
      const totalOutputSats = outputValues.reduce((sum, value) => sum + value, 0n);
      feeSats = feeCalculatorState.totalInputSats - totalOutputSats;
      calculatorFeeInput.value = formatCalculatorBtc(feeSats);
    } else {
      feeSats = parseCalculatorBtc(calculatorFeeInput.value, "Transaction fee");
      outputValues = outputFields.map((field, index) =>
        index === balancingIndex
          ? 0n
          : parseCalculatorBtc(field.value, `Output #${index + 1}`)
      );
      const fixedOutputSats = outputValues.reduce((sum, value) => sum + value, 0n);
      const balancingValue = feeCalculatorState.totalInputSats - feeSats - fixedOutputSats;
      outputValues[balancingIndex] = balancingValue;
      outputFields[balancingIndex].value = formatCalculatorBtc(balancingValue);
    }

    validateCalculatorBalance(outputValues, feeSats);
    setFeeCalculatorError();
  } catch (error) {
    setFeeCalculatorPreview();
    setFeeCalculatorError(error.message);
  }
}

function setFeeCalculatorMode(mode) {
  if (!feeCalculatorState || feeCalculatorState.mode === mode) return;

  if (mode === "rate") {
    feeCalculatorState.mode = "rate";
    updateFeeCalculatorModeUi();
    try {
      const feeSats = parseCalculatorBtc(calculatorFeeInput.value, "Transaction fee");
      feeCalculatorState.estimatedVsize = estimateCalculatorVirtualSize();
      const vsize = BigInt(feeCalculatorState.estimatedVsize);
      const scaledRate = (feeSats * FEE_RATE_SCALE + vsize - 1n) / vsize;
      calculatorFeeRateInput.value = formatCalculatorFeeRate(scaledRate);
      recalculateRateMode();
    } catch (error) {
      feeCalculatorState.estimatedVsize = null;
      setFeeCalculatorPreview();
      setFeeCalculatorError(error.message);
    }
    return;
  }

  feeCalculatorState.mode = "absolute";
  updateFeeCalculatorModeUi();
  recalculateFeeCalculator("balancing-output");
}

function renderFeeCalculatorOutputs(outputRows) {
  calculatorOutputList.textContent = "";

  outputRows.forEach((row, index) => {
    const addressInput = row.querySelector(".output-address");
    const valueInput = row.querySelectorAll("input")[1];
    const outputRow = document.createElement("div");
    outputRow.className = "fee-output-row";

    const description = document.createElement("div");
    const name = document.createElement("div");
    name.className = "fee-output-name";
    name.textContent = index === feeCalculatorState.balancingIndex
      ? `Output #${index + 1} (auto-adjusted)`
      : `Output #${index + 1}`;
    const address = document.createElement("span");
    address.className = "fee-output-address";
    address.textContent = addressInput?.value.trim() || "No address entered";
    description.append(name, address);

    const calculatorValue = document.createElement("input");
    calculatorValue.type = "text";
    calculatorValue.inputMode = "decimal";
    calculatorValue.autocomplete = "off";
    calculatorValue.className = "calculator-output-value";
    calculatorValue.value = valueInput?.value ?? "";
    calculatorValue.setAttribute("aria-label", `Output #${index + 1} value in BTC`);

    calculatorValue.addEventListener("input", () => {
      recalculateFeeCalculator(
        index === feeCalculatorState.balancingIndex ? "balancing-output" : "fixed-fee"
      );
    });

    outputRow.append(description, calculatorValue);
    calculatorOutputList.appendChild(outputRow);
  });
}

function openFeeCalculator() {
  const inputFields = Array.from(document.querySelectorAll("[data-utxo] .value-input"));
  const outputRows = Array.from(document.querySelectorAll("[data-output]"));
  let totalInputSats = null;
  let inputError = "";

  try {
    if (inputFields.length === 0) throw new Error("Add at least one input first.");
    totalInputSats = inputFields.reduce(
      (sum, field, index) => sum + parseCalculatorBtc(field.value, `Input #${index + 1}`),
      0n
    );
    if (totalInputSats > MAX_SAFE_SATOSHIS) throw new Error("Total inputs are too large.");
  } catch (error) {
    inputError = error.message;
  }

  feeCalculatorState = {
    totalInputSats,
    inputError,
    outputRows,
    balancingIndex: Math.max(0, outputRows.length - 1),
    mode: "absolute",
    estimatedVsize: null,
  };
  renderFeeCalculatorOutputs(outputRows);
  calculatorFeeRateInput.value = "";
  updateFeeCalculatorModeUi();

  if (outputRows.length > 0) {
    try {
      feeCalculatorState.estimatedVsize = estimateCalculatorVirtualSize();
    } catch {
      feeCalculatorState.estimatedVsize = null;
    }
  }

  if (outputRows.length === 0) {
    calculatorFeeInput.value = "";
    setFeeCalculatorPreview();
    setFeeCalculatorError("Add at least one output first.");
  } else if (totalInputSats === null) {
    calculatorFeeInput.value = "";
    recalculateFeeCalculator("balancing-output");
  } else {
    try {
      const outputValues = readAllCalculatorOutputs();
      const totalOutputSats = outputValues.reduce((sum, value) => sum + value, 0n);
      calculatorFeeInput.value = formatCalculatorBtc(totalInputSats - totalOutputSats);
      recalculateFeeCalculator("balancing-output");
    } catch (error) {
      calculatorFeeInput.value = "";
      setFeeCalculatorPreview();
      setFeeCalculatorError(error.message);
    }
  }

  feeCalculatorDialog.showModal();
  calculatorFeeInput.focus();
}

function applyFeeCalculator() {
  if (!feeCalculatorState) return;

  try {
    const outputValues = readAllCalculatorOutputs();
    const feeSats = parseCalculatorBtc(calculatorFeeInput.value, "Transaction fee");
    const totalOutputSats = outputValues.reduce((sum, value) => sum + value, 0n);
    if (totalOutputSats + feeSats !== feeCalculatorState.totalInputSats) {
      throw new Error("Outputs and fee do not balance with total inputs.");
    }

    const currentRows = Array.from(document.querySelectorAll("[data-output]"));
    if (currentRows.length !== feeCalculatorState.outputRows.length) {
      throw new Error("The output list changed. Reopen the calculator.");
    }

    currentRows.forEach((row, index) => {
      const valueInput = row.querySelectorAll("input")[1];
      valueInput.value = formatCalculatorBtc(outputValues[index]);
      valueInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    feeCalculatorDialog.close("apply");
  } catch (error) {
    setFeeCalculatorError(error.message);
  }
}

document.getElementById("openFeeCalculator").addEventListener("click", openFeeCalculator);
document.getElementById("cancelFeeCalculator").addEventListener("click", () => {
  feeCalculatorDialog.close("cancel");
});
calculatorFeeInput.addEventListener("input", () => recalculateFeeCalculator("fixed-fee"));
calculatorFeeRateInput.addEventListener("input", recalculateRateMode);
calculatorAbsoluteMode.addEventListener("click", () => setFeeCalculatorMode("absolute"));
calculatorRateMode.addEventListener("click", () => setFeeCalculatorMode("rate"));
calculatorApplyButton.addEventListener("click", applyFeeCalculator);
feeCalculatorDialog.addEventListener("click", (event) => {
  const bounds = feeCalculatorDialog.getBoundingClientRect();
  const outsideDialog =
    event.clientX < bounds.left ||
    event.clientX > bounds.right ||
    event.clientY < bounds.top ||
    event.clientY > bounds.bottom;
  if (outsideDialog) feeCalculatorDialog.close("cancel");
});
feeCalculatorDialog.addEventListener("close", () => {
  feeCalculatorState = null;
});

initPageMenu();
addInput();
addOutput();

export {
  NETWORK_CONFIG,
  getNetworkConfig,
  validateBitcoinAddress,
  hexToBytes,
  isP2wpkhScript,
  decodeP2wpkhAddressFromScript,
  formatUint32Hex,
  parseUint32Hex,
  isValidUint32Hex,
  parseTxVersion,
  isValidTxVersion,
  parseBtcToSafeSats,
  parseVout,
  optionToSighashType,
  sighashTypeToOption,
  estimateVirtualSize,
  createPsbtFromInputs,
  satoshiToBtcString,
  inputHashToTxid,
  bytesToHex,
  extractOpReturnData,
  opReturnDataToMessage,
  deriveGlobalAndPerInputSighash,
  parseOutputsFromScripts,
  parsePsbtToFormData,
  parseRawTransactionToFormData,
  parsePastedTransactionData,
  normalizeHexInput,
  readFixedHex,
  readVarIntHex,
  toSafeCount,
  parseRawTxHexSegments,
  tryDecodeSighashType,
  inferInputSighashType,
  formatSighashLabel,
  isValidTxid,
  isValidHexPayload,
  getMempoolTxApiBase,
  fetchRawTxHexFromMempool,
  parseCalculatorBtc,
  formatCalculatorBtc,
  parseCalculatorFeeRate,
  formatCalculatorFeeRate,
  compactSizeLength,
  getOpReturnByteState,
};
