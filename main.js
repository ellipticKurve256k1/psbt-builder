import { Buffer } from "buffer";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "@bitcoin-js/tiny-secp256k1-asmjs";

window.Buffer = Buffer;
bitcoin.initEccLib(ecc);

function getSelectedNetwork() {
  const net = document.getElementById("network").value;
  if (net === "mainnet") return bitcoin.networks.bitcoin;
  if (net === "testnet") return bitcoin.networks.testnet;
  if (net === "regtest") {
    return {
      messagePrefix: "\x18Bitcoin Signed Message:\n",
      bech32: "bcrt",
      bip32: {
        public: 0x043587cf,
        private: 0x04358394,
      },
      pubKeyHash: 0x6f,
      scriptHash: 0xc4,
      wif: 0xef,
    };
  }
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
  if (hex.length % 2 !== 0) throw new Error("Invalid hex string");

  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function decodeAddressFromScript(hex, network) {
  try {
    const script = hexToBytes(hex);
    return bitcoin.address.fromOutputScript(script, network);
  } catch {}

  try {
    const bytes = hexToBytes(hex);
    if (bytes.length === 34 && bytes[0] === 0x51 && bytes[1] === 0x20) {
      const pubkey = bytes.slice(2);
      return bitcoin.address.toBech32(pubkey, 1, network.bech32);
    }
  } catch {}

  return null;
}

function addInput(_, txid = "", vout = "", value = "", scriptPubKey = "") {
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
      <input class="grow script-input" placeholder="scriptPubKey (hex)" value="${scriptPubKey}">
    </div>
    <div class="script-label" style="font-size:0.85rem;color:#555;margin-top:0.2rem;">
      Address: <span>-</span>
    </div>
  `;

  document.getElementById("utxoContainer").appendChild(div);

  div.querySelector(".remove").addEventListener("click", () => {
    div.remove();
    updateFeeCalc();
  });

  const scriptInput = div.querySelector(".script-input");
  const labelSpan = div.querySelector(".script-label span");
  const updateLabel = () => {
    const network = getSelectedNetwork();
    const address = decodeAddressFromScript(scriptInput.value.trim(), network);
    labelSpan.textContent = address || "Invalid scriptPubKey";
    colourField(scriptInput, !!address);
    updateFeeCalc();
  };

  scriptInput.addEventListener("input", updateLabel);
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

function createPsbtFromInputs(utxos, outputs, fee, changeAddress, opReturnData) {
  const network = getSelectedNetwork();
  const psbt = new bitcoin.Psbt({ network });

  let totalInput = 0;
  for (const utxo of utxos) {
    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      sequence: 0xfffffffd,
      witnessUtxo: {
        script: hexToBytes(utxo.scriptPubKey),
        value: BigInt(utxo.value),
      },
    });
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
    if (changeValue < 0) throw new Error("Outputs + fee exceed total input!");
    if (changeValue > 0) {
      psbt.addOutput({ address: changeAddress, value: BigInt(changeValue) });
    }
  } else if (totalInput - totalOutput < 0) {
    throw new Error("Outputs exceed total input (no change addr).");
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

document.getElementById("createPsbt").onclick = () => {
  try {
    const utxos = Array.from(document.getElementById("utxoContainer").children).map(
      (row) => {
        const [txidInput, voutInput, valueInput, scriptInput] = row.querySelectorAll("input");
        return {
          txid: txidInput.value.trim(),
          vout: parseInt(voutInput.value, 10),
          value: Math.round(parseFloat(valueInput.value) * 1e8),
          scriptPubKey: scriptInput.value.trim(),
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
    const network = getSelectedNetwork();

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
      const temp = createPsbtFromInputs(utxos, outputs, 0, changeAddress, opReturnData);
      const vsize = estimateVirtualSize(temp);
      fee = Math.ceil(feeRate * vsize);
      psbt = createPsbtFromInputs(utxos, outputs, fee, changeAddress, opReturnData);
    } else {
      const totalIn = utxos.reduce((sum, utxo) => sum + utxo.value, 0);
      const totalOut = outputs.reduce((sum, output) => sum + output.value, 0);
      fee = totalIn - totalOut;
      if (fee < 0) return alert("Outputs exceed inputs!");
      psbt = createPsbtFromInputs(utxos, outputs, 0, "", opReturnData);
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

document.getElementById("clearButton").onclick = () => {
  document.getElementById("utxoContainer").innerHTML = "";
  document.getElementById("outputContainer").innerHTML = "";
  document.getElementById("feeRate").value = "";
  document.getElementById("changeAddress").value = "";
  document.getElementById("includeOpReturn").checked = false;
  document.getElementById("opReturnMessage").value = "";
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
    return {
      txid: txidInput.value,
      vout: +voutInput.value,
      value: Math.round(parseFloat(valueInput.value || 0) * 1e8),
      scriptPubKey: scriptInput.value,
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
        const temp = createPsbtFromInputs(utxos, outputs, 0, changeAddress);
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
    feeText =
      fee >= 0
        ? `Transaction fee: ${(fee / 1e8).toFixed(8)} BTC`
        : "Outputs exceed inputs!";
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

addInput();
addOutput();
