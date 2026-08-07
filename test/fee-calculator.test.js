import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAINNET_PAYMENT,
  change,
  fillTaprootBuilder,
  fillValidBuilder,
  input,
  loadApp,
} from "./helpers.js";

beforeAll(async () => {
  await loadApp();
});

beforeEach(() => {
  vi.clearAllMocks();
  const dialog = document.getElementById("feeCalculatorDialog");
  if (dialog.open) dialog.close("test-reset");
  document.getElementById("clearButton").click();
  change(document.getElementById("network"), "mainnet");
});

describe("absolute fee calculator", () => {
  it("opens with exact totals and treats the last output as balancing", () => {
    fillValidBuilder({ inputBtc: "1", outputBtc: "0.9" });
    document.getElementById("openFeeCalculator").click();
    expect(document.getElementById("feeCalculatorDialog").open).toBe(true);
    expect(document.getElementById("calculatorTotalInputs").textContent).toBe("1.00000000 BTC");
    expect(document.getElementById("calculatorTotalOutputs").textContent).toBe("0.90000000 BTC");
    expect(document.getElementById("calculatorFee").value).toBe("0.10000000");
    expect(document.querySelector(".fee-output-name").textContent).toContain("auto-adjusted");
    expect(document.querySelector(".fee-balancing-radio").checked).toBe(true);
    expect(document.getElementById("applyFeeCalculator").disabled).toBe(false);
  });

  it("editing the fee adjusts the balancing output and editing it adjusts the fee", () => {
    fillValidBuilder();
    document.getElementById("openFeeCalculator").click();
    input(document.getElementById("calculatorFee"), "0.25");
    const output = document.querySelector(".calculator-output-value");
    expect(output.value).toBe("0.75000000");
    input(output, "0.8");
    expect(document.getElementById("calculatorFee").value).toBe("0.20000000");
    expect(document.getElementById("calculatorFeePreview").textContent).toBe("0.20000000 BTC");
  });

  it("editing a fixed output preserves the fee and adjusts the last output", () => {
    fillValidBuilder({ outputBtc: "0.4" });
    document.getElementById("addOutputButton").click();
    const last = document.querySelectorAll("[data-output]")[1];
    input(last.querySelector(".output-address"), MAINNET_PAYMENT.address);
    input(last.querySelectorAll("input")[1], "0.5");
    document.getElementById("openFeeCalculator").click();
    const fields = document.querySelectorAll(".calculator-output-value");
    input(fields[0], "0.3");
    expect(fields[1].value).toBe("0.60000000");
    expect(document.getElementById("calculatorFee").value).toBe("0.10000000");
  });

  it("lets the user select and persist a different auto-adjusted output", () => {
    fillValidBuilder({ outputBtc: "0.4" });
    document.getElementById("addOutputButton").click();
    const builderRows = document.querySelectorAll("[data-output]");
    input(builderRows[1].querySelector(".output-address"), MAINNET_PAYMENT.address);
    input(builderRows[1].querySelectorAll("input")[1], "0.5");

    document.getElementById("openFeeCalculator").click();
    const radios = document.querySelectorAll(".fee-balancing-radio");
    expect(radios).toHaveLength(2);
    expect(radios[1].checked).toBe(true);
    radios[0].checked = true;
    change(radios[0]);
    expect(document.querySelectorAll(".fee-output-name")[0].textContent)
      .toContain("auto-adjusted");

    input(document.getElementById("calculatorFee"), "0.2");
    const calculatorValues = document.querySelectorAll(".calculator-output-value");
    expect(calculatorValues[0].value).toBe("0.30000000");
    input(calculatorValues[1], "0.4");
    expect(calculatorValues[0].value).toBe("0.40000000");
    input(calculatorValues[0], "0.35");
    expect(document.getElementById("calculatorFee").value).toBe("0.25000000");

    document.getElementById("applyFeeCalculator").click();
    expect(builderRows[0].dataset.feeBalancingOutput).toBe("true");
    expect(builderRows[1].dataset.feeBalancingOutput).toBeUndefined();
    document.getElementById("openFeeCalculator").click();
    expect(document.querySelectorAll(".fee-balancing-radio")[0].checked).toBe(true);
  });

  it("discards uncommitted output selection on Cancel and backdrop dismissal", () => {
    fillValidBuilder({ outputBtc: "0.4" });
    document.getElementById("addOutputButton").click();
    const builderRows = document.querySelectorAll("[data-output]");
    input(builderRows[1].querySelector(".output-address"), MAINNET_PAYMENT.address);
    input(builderRows[1].querySelectorAll("input")[1], "0.5");

    document.getElementById("openFeeCalculator").click();
    let radios = document.querySelectorAll(".fee-balancing-radio");
    radios[0].checked = true;
    change(radios[0]);
    document.getElementById("applyFeeCalculator").click();

    document.getElementById("openFeeCalculator").click();
    radios = document.querySelectorAll(".fee-balancing-radio");
    radios[1].checked = true;
    change(radios[1]);
    document.getElementById("cancelFeeCalculator").click();
    document.getElementById("openFeeCalculator").click();
    expect(document.querySelectorAll(".fee-balancing-radio")[0].checked).toBe(true);

    radios = document.querySelectorAll(".fee-balancing-radio");
    radios[1].checked = true;
    change(radios[1]);
    const dialog = document.getElementById("feeCalculatorDialog");
    vi.spyOn(dialog, "getBoundingClientRect").mockReturnValue({
      left: 100, right: 500, top: 100, bottom: 500, width: 400, height: 400, x: 100, y: 100,
      toJSON: () => ({}),
    });
    dialog.dispatchEvent(new MouseEvent("click", { clientX: 10, clientY: 10, bubbles: true }));
    document.getElementById("openFeeCalculator").click();
    expect(document.querySelectorAll(".fee-balancing-radio")[0].checked).toBe(true);
  });

  it("keeps a saved selection when adding outputs and falls back after removing it or clearing", () => {
    fillValidBuilder({ outputBtc: "0.4" });
    document.getElementById("addOutputButton").click();
    let builderRows = document.querySelectorAll("[data-output]");
    input(builderRows[1].querySelector(".output-address"), MAINNET_PAYMENT.address);
    input(builderRows[1].querySelectorAll("input")[1], "0.5");
    document.getElementById("openFeeCalculator").click();
    const firstRadio = document.querySelectorAll(".fee-balancing-radio")[0];
    firstRadio.checked = true;
    change(firstRadio);
    document.getElementById("applyFeeCalculator").click();

    document.getElementById("addOutputButton").click();
    builderRows = document.querySelectorAll("[data-output]");
    input(builderRows[2].querySelector(".output-address"), MAINNET_PAYMENT.address);
    input(builderRows[2].querySelectorAll("input")[1], "0");
    document.getElementById("openFeeCalculator").click();
    expect(document.querySelectorAll(".fee-balancing-radio")[0].checked).toBe(true);
    document.getElementById("cancelFeeCalculator").click();

    builderRows[0].querySelector(".remove").click();
    document.getElementById("openFeeCalculator").click();
    const fallbackRadios = document.querySelectorAll(".fee-balancing-radio");
    expect(fallbackRadios[fallbackRadios.length - 1].checked).toBe(true);
    document.getElementById("cancelFeeCalculator").click();

    document.getElementById("clearButton").click();
    document.getElementById("openFeeCalculator").click();
    expect(document.querySelectorAll(".fee-balancing-radio")).toHaveLength(1);
    expect(document.querySelector(".fee-balancing-radio").checked).toBe(true);
  });

  it("shows inline errors for invalid, negative, and unbalanced values", () => {
    fillValidBuilder();
    document.getElementById("openFeeCalculator").click();
    input(document.getElementById("calculatorFee"), "1.1");
    expect(document.getElementById("feeCalculatorError").textContent)
      .toContain("selected auto-adjusted output would be negative");
    expect(document.getElementById("applyFeeCalculator").disabled).toBe(true);
    input(document.getElementById("calculatorFee"), "0.000000001");
    expect(document.getElementById("feeCalculatorError").textContent).toContain("up to 8 decimals");
  });

  it("applies output values to the form and refreshes the balance", () => {
    fillValidBuilder();
    document.getElementById("openFeeCalculator").click();
    input(document.getElementById("calculatorFee"), "0.2");
    document.getElementById("applyFeeCalculator").click();
    expect(document.getElementById("feeCalculatorDialog").open).toBe(false);
    expect(document.querySelector("[data-output] input:nth-of-type(2)").value).toBe("0.80000000");
    expect(document.getElementById("feeAmount").textContent).toBe("0.20000000 BTC");
  });

  it("Cancel and backdrop close discard modal edits", () => {
    fillValidBuilder();
    document.getElementById("openFeeCalculator").click();
    input(document.getElementById("calculatorFee"), "0.2");
    document.getElementById("cancelFeeCalculator").click();
    expect(document.querySelector("[data-output] input:nth-of-type(2)").value).toBe("0.9");

    document.getElementById("openFeeCalculator").click();
    const dialog = document.getElementById("feeCalculatorDialog");
    vi.spyOn(dialog, "getBoundingClientRect").mockReturnValue({
      left: 100, right: 500, top: 100, bottom: 500, width: 400, height: 400, x: 100, y: 100,
      toJSON: () => ({}),
    });
    dialog.dispatchEvent(new MouseEvent("click", { clientX: 10, clientY: 10, bubbles: true }));
    expect(dialog.open).toBe(false);
  });

  it("handles missing and invalid form values", () => {
    document.querySelector("[data-output] .remove").click();
    document.getElementById("openFeeCalculator").click();
    expect(document.getElementById("feeCalculatorError").textContent).toContain("at least one output");
    document.getElementById("cancelFeeCalculator").click();

    document.getElementById("clearButton").click();
    document.getElementById("openFeeCalculator").click();
    expect(document.getElementById("feeCalculatorError").textContent).toContain("Input #1 is required");
  });
});

describe("fee-rate calculator", () => {
  it("estimates vsize, rounds fees up, and makes calculated values read-only", () => {
    fillValidBuilder();
    document.getElementById("openFeeCalculator").click();
    document.getElementById("calculatorRateMode").click();
    const rate = document.getElementById("calculatorFeeRate");
    input(rate, "1.00000001");
    const vsize = Number.parseInt(document.getElementById("calculatorVsize").textContent, 10);
    const feeSats = BigInt(document.getElementById("calculatorFee").value.replace(".", ""));
    expect(vsize).toBeGreaterThan(100);
    expect(feeSats).toBe(BigInt(vsize) + 1n);
    expect(document.getElementById("calculatorFee").readOnly).toBe(true);
    expect(document.querySelector(".calculator-output-value").readOnly).toBe(true);
    expect(document.getElementById("calculatorRateField").hidden).toBe(false);
  });

  it("requires valid network addresses and validates fee rates", () => {
    const { outputRow } = fillValidBuilder();
    input(outputRow.querySelector(".output-address"), "invalid");
    document.getElementById("openFeeCalculator").click();
    document.getElementById("calculatorRateMode").click();
    expect(document.getElementById("feeCalculatorError").textContent).toContain("invalid address");
    input(outputRow.querySelector(".output-address"), MAINNET_PAYMENT.address);
    input(document.getElementById("calculatorFeeRate"), "-1");
    expect(document.getElementById("feeCalculatorError").textContent).toContain("non-negative");
  });

  it("makes the selected output read-only and adjusts it when fixed outputs change", () => {
    fillValidBuilder({ outputBtc: "0.4" });
    document.getElementById("addOutputButton").click();
    const last = document.querySelectorAll("[data-output]")[1];
    input(last.querySelector(".output-address"), MAINNET_PAYMENT.address);
    input(last.querySelectorAll("input")[1], "0.5");
    document.getElementById("openFeeCalculator").click();
    const radios = document.querySelectorAll(".fee-balancing-radio");
    radios[0].checked = true;
    change(radios[0]);
    document.getElementById("calculatorRateMode").click();
    input(document.getElementById("calculatorFeeRate"), "1");

    const fields = document.querySelectorAll(".calculator-output-value");
    expect(fields[0].readOnly).toBe(true);
    expect(fields[1].readOnly).toBe(false);
    const before = BigInt(fields[0].value.replace(".", ""));
    input(fields[1], "0.4");
    const after = BigInt(fields[0].value.replace(".", ""));
    expect(after - before).toBe(10_000_000n);

    radios[1].checked = true;
    change(radios[1]);
    expect(fields[0].readOnly).toBe(false);
    expect(fields[1].readOnly).toBe(true);
  });

  it("includes enabled OP_RETURN output size in the estimate", () => {
    fillValidBuilder();
    document.getElementById("openFeeCalculator").click();
    document.getElementById("calculatorRateMode").click();
    input(document.getElementById("calculatorFeeRate"), "1");
    const withoutOpReturn = Number.parseInt(document.getElementById("calculatorVsize").textContent, 10);
    document.getElementById("cancelFeeCalculator").click();

    const enabled = document.getElementById("includeOpReturn");
    enabled.checked = true;
    change(enabled);
    input(document.getElementById("opReturnMessage"), "hello");
    document.getElementById("openFeeCalculator").click();
    document.getElementById("calculatorRateMode").click();
    input(document.getElementById("calculatorFeeRate"), "1");
    const withOpReturn = Number.parseInt(document.getElementById("calculatorVsize").textContent, 10);
    expect(withOpReturn).toBeGreaterThan(withoutOpReturn);
  });

  it("estimates 100,000-byte OP_RETURN payloads but rejects payloads above the hard maximum", () => {
    fillValidBuilder();
    const enabled = document.getElementById("includeOpReturn");
    enabled.checked = true;
    change(enabled);
    input(document.getElementById("opReturnMessage"), "x".repeat(100_000));
    document.getElementById("openFeeCalculator").click();
    document.getElementById("calculatorRateMode").click();
    expect(document.getElementById("feeCalculatorError").textContent).toBe("");
    expect(Number.parseInt(document.getElementById("calculatorVsize").textContent, 10)).toBeGreaterThan(0);

    document.getElementById("cancelFeeCalculator").click();
    input(document.getElementById("opReturnMessage"), "x".repeat(100_001));
    document.getElementById("openFeeCalculator").click();
    document.getElementById("calculatorRateMode").click();
    expect(document.getElementById("feeCalculatorError").textContent).toContain("exceeds 100000 bytes");

    document.getElementById("cancelFeeCalculator").click();
    enabled.checked = false;
    change(enabled);
  });

  it("switches back to absolute mode with editable values", () => {
    fillValidBuilder();
    document.getElementById("openFeeCalculator").click();
    document.getElementById("calculatorRateMode").click();
    input(document.getElementById("calculatorFeeRate"), "2");
    document.getElementById("calculatorAbsoluteMode").click();
    expect(document.getElementById("calculatorFee").readOnly).toBe(false);
    expect(document.querySelector(".calculator-output-value").readOnly).toBe(false);
    expect(document.getElementById("calculatorRateField").hidden).toBe(true);
  });

  it("uses 64-byte DEFAULT and 65-byte explicit Taproot key-path signatures", () => {
    fillTaprootBuilder();
    document.getElementById("openFeeCalculator").click();
    document.getElementById("calculatorRateMode").click();
    input(document.getElementById("calculatorFeeRate"), "1");
    const defaultVsize = Number.parseInt(document.getElementById("calculatorVsize").textContent, 10);
    document.getElementById("cancelFeeCalculator").click();

    change(document.getElementById("sighashType"), "ALL");
    document.getElementById("openFeeCalculator").click();
    document.getElementById("calculatorRateMode").click();
    input(document.getElementById("calculatorFeeRate"), "1");
    const explicitVsize = Number.parseInt(document.getElementById("calculatorVsize").textContent, 10);
    expect(explicitVsize).toBe(defaultVsize + 1);
  });
});

describe("hidden change-output logic", () => {
  it("creates a calculated change output when enabled programmatically", () => {
    fillValidBuilder({ inputBtc: "1", outputBtc: "0.5" });
    const includeChange = document.getElementById("includeChange");
    includeChange.disabled = false;
    includeChange.checked = true;
    change(includeChange);
    input(document.getElementById("feeRate"), "1");
    input(document.getElementById("changeAddress"), MAINNET_PAYMENT.address);
    document.getElementById("createPsbt").click();
    expect(window.alert).not.toHaveBeenCalled();
    expect(window.currentPsbt.txOutputs).toHaveLength(2);
    expect(window.currentPsbt.txOutputs[1].value).toBeGreaterThan(0n);
    expect(window.currentPsbt.txOutputs[1].value).toBeLessThan(50000000n);
  });

  it("requires a positive fee rate and valid change address", () => {
    fillValidBuilder();
    const includeChange = document.getElementById("includeChange");
    includeChange.disabled = false;
    includeChange.checked = true;
    change(includeChange);
    document.getElementById("createPsbt").click();
    expect(window.alert).toHaveBeenLastCalledWith("Enter a fee‑rate.");
    input(document.getElementById("feeRate"), "1");
    input(document.getElementById("changeAddress"), "invalid");
    document.getElementById("createPsbt").click();
    expect(window.alert).toHaveBeenLastCalledWith("Invalid change address.");
  });
});
