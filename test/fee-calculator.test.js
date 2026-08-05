import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAINNET_PAYMENT,
  change,
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

  it("shows inline errors for invalid, negative, and unbalanced values", () => {
    fillValidBuilder();
    document.getElementById("openFeeCalculator").click();
    input(document.getElementById("calculatorFee"), "1.1");
    expect(document.getElementById("feeCalculatorError").textContent).toContain("last output would be negative");
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
