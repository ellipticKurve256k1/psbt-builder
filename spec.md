# Bitcoin PSBT Builder - Functional Specification

## 1. Purpose

This application builds **unsigned Bitcoin PSBTs** in the browser and exports them as Base64 text or as a `.psbt` file.

It is designed for a manual workflow where the user enters UTXOs and outputs, optionally adds an `OP_RETURN` output, and then generates a PSBT for signing in an external wallet.

## 2. Platform and Scope

- Runtime: Browser-based single-page app.
- Data processing: Client-side only.
- Primary artifact: Unsigned PSBT (`toBase64()` output and binary download).
- Supported script types for validation:
  - Standard scriptPubKey decoding to address where possible.
  - Taproot-like witness script pattern handling for display.

## 3. Network Selection

The `Network` selector controls address/script interpretation and PSBT network parameters.

Supported values:

- `mainnet`
- `testnet` (UI label is `Testnet4`)
- `regtest`

When network changes:

- All existing input scriptPubKey fields are revalidated.
- Change address validation state is re-evaluated.

## 4. Inputs (UTXOs) Section

### 4.1 Add / Remove Inputs

- `+ Add Input` appends a new UTXO row.
- Each row includes:
  - `txid`
  - `vout`
  - `value (BTC)`
  - `scriptPubKey (hex)`
  - Remove (`✕`) button

Removing a row immediately updates fee/balance calculations.

### 4.2 Input Row Validation and UI Feedback

- `scriptPubKey` is decoded against selected network.
- If decoding succeeds:
  - A derived address is shown in the row.
  - Input border is set to green.
- If decoding fails:
  - Row displays `Invalid scriptPubKey`.
  - Input border is set to red.
- Empty field uses neutral border color.

### 4.3 Input Value Unit

- User enters input amount in **BTC**.
- Internal conversion: `Math.round(parseFloat(valueBTC) * 1e8)` to satoshis.

## 5. Outputs Section

### 5.1 Add / Remove Outputs

- `+ Add Output` appends a new output row.
- Each row includes:
  - `address`
  - `value (BTC)`
  - Remove (`✕`) button

Removing an output row triggers immediate recalculation.

### 5.2 Output Address Validation

- Address validity is checked against selected network.
- Supports base58 and bech32/bech32m-compatible forms used by the app logic.
- UI border coloring:
  - Green: valid
  - Red: invalid
  - Neutral: empty

### 5.3 Output Value Unit

- User enters output amount in **BTC**.
- Internal conversion: `Math.round(parseFloat(valueBTC) * 1e8)` to satoshis.

## 6. OP_RETURN Feature

### 6.1 Enable/Disable

- Controlled by checkbox: `Add OP_RETURN message`.
- Enabling reveals OP_RETURN message input group.
- Disabling hides the group and resets UI status text to `0 / 83 bytes`.

### 6.2 Input Rules (Current Effective Behavior)

- Message is treated as UTF-8 text input.
- Maximum payload is **83 bytes**.
- Byte counter is shown live (`N / 83 bytes`).
- If byte count exceeds limit:
  - Counter switches to error state.
  - Input gets error styling.
  - `Create PSBT` button is disabled.

### 6.3 Hex Prefix Restriction in UI Layer

- If value starts with `0x`/`0X`, UI enforces:
  - Error message: `Hex input disabled. Enter plain text.`
  - Create button disabled.

### 6.4 PSBT Encoding Behavior

- On creation, OP_RETURN data is encoded as a zero-value output:
  - Script form: `OP_RETURN <data>`
  - Value: `0` sat

## 7. Build Actions

## 7.1 Create PSBT

Clicking `Create PSBT` performs:

1. Read all input rows and output rows.
2. Convert BTC amounts to satoshis.
3. Build PSBT object for selected network.
4. Optionally append OP_RETURN output (if enabled and valid).
5. Validate total amounts.
6. Serialize PSBT to Base64.
7. Show result panel and store current PSBT in `window.currentPsbt`.

### 7.1.1 Input Mapping to PSBT

Each input is added with:

- `hash`: `txid`
- `index`: `vout`
- `sequence`: `4294967293` (`0xfffffffd`)
- `witnessUtxo.script`: parsed scriptPubKey bytes
- `witnessUtxo.value`: satoshis as `BigInt`

### 7.1.2 Output Mapping to PSBT

Each standard output is added with:

- `address`
- `value`: satoshis as `BigInt`

## 7.2 Clear

`Clear` resets:

- All input rows
- All output rows
- Fee-rate and change fields
- OP_RETURN checkbox/message/group visibility
- PSBT display area and Base64 field
- `window.currentPsbt`

Then it initializes one default input row and one default output row.

## 7.3 Copy to Clipboard

- Copies Base64 PSBT text.
- Button label temporarily changes to `Copied!` (2 seconds) on success.
- Shows alert on failure.

## 7.4 Download PSBT File

- Available after PSBT creation (`window.currentPsbt` exists).
- Generates `unsigned.psbt` as binary (`application/octet-stream`) via Blob download.

## 8. Fee and Balance Behavior

The visible mode is currently fixed to **no-change mode** because `includeChange` is hidden/disabled in UI.

In this active mode:

- Fee is computed as:
  - `sum(inputs) - sum(outputs)` (satoshis)
- If fee < 0:
  - User gets `Outputs exceed inputs!` on create.
- Summary panel displays:
  - Total Inputs (BTC)
  - Total Outputs (BTC)
  - Fee (BTC)

Realtime updates run on input/output edits.

## 9. Hidden/Inactive Change-Output Mode (Implemented but not user-exposed)

Code includes a change-address + fee-rate flow behind hidden controls:

- Requires positive fee rate.
- Requires valid change address for selected network.
- Estimates vsize, computes fee, and appends change output when positive remainder exists.

Current UI keeps this mode inaccessible (`includeChange` is hidden and disabled), but logic remains present.

## 10. Reordering (Drag and Drop)

Both lists support drag-and-drop reordering:

- Inputs list (`utxoContainer`)
- Outputs list (`outputContainer`)

Implemented using Sortable behavior with animation and ghost styling.

## 11. Error Handling and User Messages

Primary user-visible errors include:

- `Enter an OP_RETURN message.`
- `OP_RETURN data exceeds 83 bytes.`
- `Outputs exceed inputs!`
- `Error creating PSBT: <reason>`
- `Failed to copy: <error>`
- `Invalid scriptPubKey` (inline label)

Additional internal checks can surface via the generic creation error dialog (for example invalid hex, invalid tx structure, invalid numeric input resulting in downstream failure).

## 12. Numeric and Formatting Conventions

- Monetary input unit: BTC
- Internal arithmetic unit: satoshi
- Displayed precision in summaries: 8 decimal places (`toFixed(8)`)
- Fee labels and totals are shown in BTC

## 13. Initial State

On first load:

- One empty input row is auto-created.
- One empty output row is auto-created.
- OP_RETURN section is hidden.
- PSBT result section is hidden.

## 14. Non-Goals (Current Version)

- No signing capability.
- No private key handling.
- No automatic UTXO discovery or wallet integration.
- No persistence across page reloads.
- No server-side validation.
