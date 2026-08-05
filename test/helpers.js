import { readFileSync } from "node:fs";
import { Buffer } from "buffer";
import * as bitcoin from "bitcoinjs-lib";

const html = readFileSync(`${process.cwd()}/index.html`, "utf8");
const bodyMarkup = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] || "";

export const TXID = "11".repeat(32);
export const P2WPKH_HASH = Buffer.alloc(20, 0x22);
export const MAINNET_PAYMENT = bitcoin.payments.p2wpkh({
  hash: P2WPKH_HASH,
  network: bitcoin.networks.bitcoin,
});
export const TESTNET_PAYMENT = bitcoin.payments.p2wpkh({
  hash: P2WPKH_HASH,
  network: bitcoin.networks.testnet,
});

export function installMarkup() {
  document.body.innerHTML = bodyMarkup;
}

export async function loadApp() {
  installMarkup();
  return import("../main.js");
}

export function input(element, value) {
  element.value = value;
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

export function change(element, value) {
  if (value !== undefined) element.value = value;
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

export function fillValidBuilder({ inputBtc = "1", outputBtc = "0.9" } = {}) {
  const inputRow = document.querySelector("[data-utxo]");
  input(inputRow.querySelector(".txid-input"), TXID);
  input(inputRow.querySelector(".vout-input"), "1");
  input(inputRow.querySelector(".sequence-input"), "fffffffd");
  input(inputRow.querySelector(".value-input"), inputBtc);
  input(inputRow.querySelector(".script-input"), Buffer.from(MAINNET_PAYMENT.output).toString("hex"));

  const outputRow = document.querySelector("[data-output]");
  input(outputRow.querySelector(".output-address"), MAINNET_PAYMENT.address);
  input(outputRow.querySelectorAll("input")[1], outputBtc);
  return { inputRow, outputRow };
}

export function makeRawTransaction({ segwit = false, network = bitcoin.networks.bitcoin } = {}) {
  const payment = bitcoin.payments.p2wpkh({ hash: P2WPKH_HASH, network });
  const tx = new bitcoin.Transaction();
  tx.version = 2;
  tx.locktime = 12;
  tx.addInput(Buffer.alloc(32, 0x33), 2, 0xfffffffd, Buffer.alloc(0));
  tx.addOutput(payment.output, 50000n);
  if (segwit) tx.setWitness(0, [Buffer.alloc(64, 0x44)]);
  return tx;
}
