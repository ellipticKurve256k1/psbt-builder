import { Buffer } from "buffer";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "@bitcoin-js/tiny-secp256k1-asmjs";

window.Buffer = Buffer;
bitcoin.initEccLib(ecc);

function getSelectedNetwork() {
  const net = document.getElementById("network").value;
  if (net === "mainnet") return bitcoin.networks.bitcoin;
  if (net === "testnet") return bitcoin.networks.testnet;
  return bitcoin.networks.testnet;
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
  el.style.borderColor = empty ? "#ccc" : isValid ? "green" : "red";
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

function addInput(_, txid = "", vout = "", value = "", scriptPubKey = "", inputSighash = "INHERIT") {
  const div = document.createElement("div");
  div.setAttribute("data-utxo", "");
  div.style.marginBottom = "1rem";

  div.innerHTML = `
    <div class="row">
      <input class="grow" placeholder="txid" value="${txid}">
      <button type="button" class="remove">✕</button>
    </div>

    <div class="row" style="margin-top:0.4rem;">
      <input placeholder="vout" value="${vout}" style="width:80px;">
      <input placeholder="value (BTC)" value="${value}" style="width:170px;">
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

  scriptInput.addEventListener("input", updateLabel);
  div.querySelector(".input-sighash").addEventListener("change", updateFeeCalc);
  updateLabel();
  div.querySelectorAll("input")[2].addEventListener("input", updateFeeCalc);
}

function addOutput(_, address = "", value = "") {
  const div = document.createElement("div");
  div.setAttribute("data-output", "");
  div.style.marginBottom = "1rem";

  div.innerHTML = `
    <div class="row">
      <input class="grow output-address" placeholder="address" value="${address}">
      <input placeholder="value (BTC)" value="${value}" style="width:170px;">
      <button type="button" class="remove" onclick="this.closest('[data-output]').remove(); updateFeeCalc();">✕</button>
    </div>
  `;

  document.getElementById("outputContainer").appendChild(div);

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
  sighashType = undefined
) {
  const network = getSelectedNetwork();
  const psbt = new bitcoin.Psbt({ network });

  let totalInput = 0;
  for (const utxo of utxos) {
    const scriptBytes = hexToBytes(utxo.scriptPubKey);
    if (!isP2wpkhScript(scriptBytes)) {
      throw new Error("Only P2WPKH input scriptPubKey is supported.");
    }
    const resolvedSighashType =
      utxo.inputSighashOption === "INHERIT" || utxo.inputSighashOption === undefined
        ? sighashType
        : utxo.sighashType;

    const inputData = {
      hash: utxo.txid,
      index: utxo.vout,
      sequence: 0xfffffffd,
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

    const utxos = Array.from(document.getElementById("utxoContainer").children).map(
      (row) => {
        const [txidInput, voutInput, valueInput, scriptInput] = row.querySelectorAll("input");
        const inputSighashOption = row.querySelector(".input-sighash").value;
        const maybeInputSighash = optionToSighashType(inputSighashOption, true);
        return {
          txid: txidInput.value.trim(),
          vout: parseInt(voutInput.value, 10),
          value: Math.round(parseFloat(valueInput.value) * 1e8),
          scriptPubKey: scriptInput.value.trim(),
          inputSighashOption,
          sighashType: maybeInputSighash === null ? undefined : maybeInputSighash,
        };
      }
    );

    const outputs = Array.from(document.getElementById("outputContainer").children).map(
      (row) => {
        const [addressInput, valueInput] = row.querySelectorAll("input");
        return {
          address: addressInput.value.trim(),
          value: Math.round(parseFloat(valueInput.value) * 1e8),
        };
      }
    );

    const includeChange = includeChangeCheckbox.checked;
    const feeRate = parseFloat(document.getElementById("feeRate").value);
    const changeAddress = document.getElementById("changeAddress").value.trim();
    const sighashType = getSelectedSighashType();

    let opReturnData = null;
    if (document.getElementById("includeOpReturn").checked) {
      const message = document.getElementById("opReturnMessage").value.trim();
      if (!message) return alert("Enter an OP_RETURN message.");

      if (message.startsWith("0x")) {
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
        sighashType
      );
      const vsize = estimateVirtualSize(temp);
      fee = Math.ceil(feeRate * vsize);
      psbt = createPsbtFromInputs(utxos, outputs, fee, changeAddress, opReturnData, sighashType);
    } else {
      const totalIn = utxos.reduce((sum, utxo) => sum + utxo.value, 0);
      const totalOut = outputs.reduce((sum, output) => sum + output.value, 0);
      fee = totalIn - totalOut;
      psbt = createPsbtFromInputs(utxos, outputs, 0, "", opReturnData, sighashType);
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

changeAddrInput.addEventListener("input", validateChangeAddr);
validateChangeAddr();

document.getElementById("network").addEventListener("change", refreshAllScriptLabels);

function updateFeeCalc() {
  const useChange = includeChangeCheckbox.checked;
  const feeRate = parseFloat(document.getElementById("feeRate").value) || 0;

  const utxos = Array.from(document.querySelectorAll("[data-utxo]")).map((row) => {
    const [txidInput, voutInput, valueInput, scriptInput] = row.querySelectorAll("input");
    const inputSighashOption = row.querySelector(".input-sighash").value;
    const maybeInputSighash = optionToSighashType(inputSighashOption, true);
    return {
      txid: txidInput.value,
      vout: +voutInput.value,
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
        const temp = createPsbtFromInputs(utxos, outputs, 0, changeAddress, null, sighashType);
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

document.getElementById("utxoContainer").addEventListener("input", updateFeeCalc);
document.getElementById("outputContainer").addEventListener("input", updateFeeCalc);
document.getElementById("feeRate").addEventListener("input", updateFeeCalc);
document.getElementById("changeAddress").addEventListener("input", updateFeeCalc);
document.getElementById("sighashType").addEventListener("change", updateFeeCalc);

addInput();
addOutput();
