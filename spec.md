# Bitcoin PSBT Builder - Functional Specification

## 1. Purpose

This application builds **unsigned Bitcoin PSBTs** in the browser and exports them as Base64 text or as a `.psbt` file.

It is designed for a manual workflow where the user enters UTXOs and outputs, optionally adds an `OP_RETURN` output, and then generates a PSBT for signing in an external wallet.

## 2. Platform and Scope

- Runtime: Browser-based single-page app.
- Data processing: Client-side only.
- Primary artifact: Unsigned PSBT (`toBase64()` output and binary download).
- Descriptor artifact: Locally derived receiving/change addresses with balances fetched from Blockstream Esplora.
- Supported input script types:
  - Native P2WPKH (`OP_0 PUSH20`).
  - Native P2TR (`OP_1 PUSH32`) using BIP86 key-path spending.

## 3. Network Selection

The `Network` selector controls address/script interpretation and PSBT network parameters.

Supported values:

- `mainnet`
- `testnet`
- `signet`

Signet uses the same address and key encodings as testnet. Chain-specific raw
transaction lookups use the Signet mempool.space endpoint.

When network changes:

- All existing input scriptPubKey fields are revalidated.
- All existing output address fields are revalidated.
- Change address validation state is re-evaluated.
- The raw transaction summary is re-rendered for the selected network.
- Existing descriptor requests are cancelled and results are cleared. The user
  must click `Derive Addresses` and confirm the privacy warning again before any
  Esplora request is made for the new network.

## 4. Descriptor Address Derivation

The `Descriptor Addresses` menu opens a dedicated in-app page. It alters the PSBT
Builder form only when the user selects `Use as Output` on a displayed address.

### 4.1 Browser-Only Privacy Guarantee

- Descriptor parsing, checksum validation, BIP32 child derivation, script creation,
  and address encoding run entirely in browser JavaScript bundled with the app.
- Derivation itself makes no HTTP, WebSocket, beacon, or backend request. After
  derivation, each resulting address is sent to the selected network's public
  Blockstream Esplora API for a balance and transaction-history lookup. A scan
  sends at most 200 receiving/change address pairs.
- Descriptor text and derived addresses are not written to cookies, browser
  storage, application logs, or the page URL.
- Descriptor text, extended public keys, and key-origin information are never
  included in external requests. Only individual derived addresses are sent to
  Esplora.
- Extended private keys and WIF private keys are rejected. Only public watch-only
  descriptors are accepted.
- Every `Derive Addresses` click opens a required privacy dialog before validation,
  derivation, loading state, or network activity begins. Consent is not remembered.
- The dialog warns that Blockstream can observe the user's IP, correlate the
  queried addresses, and infer wallet balances, history, and UTXOs.
- `OK` begins the scan. `Cancel` makes no request, preserves the descriptor form,
  and returns to the PSBT Builder. Escape and backdrop clicks cannot dismiss the
  dialog; one of the two explicit actions is required.

### 4.2 Descriptor Requirements

- One public ranged multipath descriptor is accepted.
- The descriptor must contain `/<0;1>/*`.
- Branch `0` derives receiving addresses and branch `1` derives change addresses.
- A descriptor checksum is optional; when supplied, it must be valid.
- Any supported public descriptor that resolves to exactly one address per branch
  and index can be used, including singlesig, multisig/Miniscript, and Taproot.
- The selected Mainnet/Testnet/Signet network controls extended-key validation and
  address encoding.

### 4.3 Range and Results

- Start index defaults to `0` and must be within `0..2147483647`.
- Unused-address count defaults to `20` per branch and must be within `1..100`.
- Scanning begins at the start index, proceeds in batches of up to 20 pairs, and
  stops when each branch has the requested unused count or 200 pairs were checked.
- The complete scan remains within the unhardened BIP32 limit.
- While deriving and fetching balances, the page shows a loading spinner, marks
  the panel busy, and disables the derive button until the result or error is ready.
- Results open in an expandable/collapsible panel containing separate receiving,
  change, and funded-address components with visible result counts. The three
  components appear side by side on desktop and stack on narrower screens.
- Each component has its own bounded vertical scroll area, so long ranges do not
  make the surrounding page scroll with the list.
- Available balance is calculated in satoshis as confirmed funded minus confirmed
  spent plus mempool funded minus mempool spent.
- An address is funded when available balance is positive, unused when balance and
  confirmed/mempool transaction counts are zero, and used-empty otherwise.
- The receiving and change components contain only the first requested number of
  unused addresses for their respective branches. All funded addresses encountered
  appear in the consolidated funded component with a receiving/change branch badge.
  Funded rows are ordered by child index, receiving before change at the same index.
  Used-empty addresses are hidden to avoid address reuse.
- Funded and unused rows have distinct badges. Funded rows show their BTC/satoshi
  balance; unused rows show zero. Each component has its own empty-state message.
- Reaching the 200-pair cap returns the available partial results and an inline
  warning with the unused counts found.
- Balance requests use at most four concurrent HTTP requests. A failed or malformed
  lookup fails the complete scan rather than treating an unknown address as empty.
- Clear, network changes, and newer derivations cancel or invalidate stale requests.
  Network changes never reuse prior consent or automatically restart a scan.
- Every displayed row shows its child index, address, classification, balance,
  Copy, and `Use as Output` actions.
- Funded P2WPKH and plain key-path P2TR rows also provide `Use UTXOs as Inputs`.
  Funded P2WSH/multisig, Taproot script-tree, and other unsupported rows show the
  action disabled with an explanation.
- The input action requests `GET /address/:address/utxo` from the selected
  Blockstream Esplora API. The returned array is accepted only when every txid,
  vout, satoshi value, confirmation flag, and outpoint is valid and unique.
- A scrollable selection dialog shows every current UTXO. Confirmed UTXOs are
  checked by default; unconfirmed UTXOs are visibly warned and unchecked.
- Applying fills the first blank Builder input and appends additional selected
  UTXOs. Each row receives txid, vout, BTC value, locally derived scriptPubKey,
  default sequence, and the compatible P2TR internal key when applicable.
- Existing populated inputs are preserved. Duplicate txid:vout outpoints are
  skipped and reported; an all-duplicate selection leaves the dialog open.
- UTXO lookup errors, empty responses, stale responses, dismissal, Clear, and
  network changes never partially modify Builder inputs.
- `Use as Output` fills the first completely blank Builder output or appends a new
  output, leaves its amount blank, validates it, and opens the PSBT Builder without
  replacing populated outputs.
- `Clear` removes the descriptor and results and restores the default range.

## 5. Inputs (UTXOs) Section

### 5.1 Add / Remove Inputs

- `+ Add Input` appends a new UTXO row.
- Each row includes:
  - `txid`
  - `vout`
  - `value (BTC)`
  - `scriptPubKey (hex)`
  - Optional `tapInternalKey` for P2TR inputs
  - Remove (`✕`) button

Removing a row immediately updates fee/balance calculations.

### 5.2 Input Row Validation and UI Feedback

- `scriptPubKey` is classified as P2WPKH or P2TR and decoded against the selected network.
- If decoding succeeds:
  - A derived address is shown in the row.
  - Input border is set to green.
- If decoding fails:
  - Row displays `Invalid scriptPubKey`.
  - Input border is set to red.
- Empty field uses neutral border color.

### 5.3 Taproot Input Metadata

- P2TR inputs use `witnessUtxo` and support BIP86 key-path spending only.
- An optional 32-byte x-only `tapInternalKey` can be supplied for external signer compatibility.
- When supplied, the internal key must be a valid secp256k1 x-only point and its BIP86 tweak must match the input scriptPubKey.
- Taproot script paths, Merkle roots, control blocks, and Taproot BIP32 derivations are not supported.
- Descriptor-imported plain P2TR UTXOs receive their locally derived internal key.

### 5.4 Input Value Unit

- User enters input amount in **BTC**.
- Internal conversion: `Math.round(parseFloat(valueBTC) * 1e8)` to satoshis.

## 6. Outputs Section

### 6.1 Add / Remove Outputs

- `+ Add Output` appends a new output row.
- Each row includes:
  - `address`
  - `value (BTC)`
  - Remove (`✕`) button

Removing an output row triggers immediate recalculation.

### 6.2 Output Address Validation

- Address validity is checked against selected network.
- Supports base58 and bech32/bech32m-compatible forms used by the app logic.
- UI border coloring:
  - Green: valid
  - Red: invalid
  - Neutral: empty

### 6.3 Output Value Unit

- User enters output amount in **BTC**.
- Internal conversion: `Math.round(parseFloat(valueBTC) * 1e8)` to satoshis.

## 7. OP_RETURN Feature

### 7.1 Enable/Disable

- Controlled by checkbox: `Add OP_RETURN message`.
- Enabling reveals OP_RETURN message input group.
- Disabling hides the group and resets UI status text to `0 / 100,000 bytes`.

### 7.2 Input Rules (Current Effective Behavior)

- Message is treated as UTF-8 text input.
- The standard threshold is **83 bytes** and the hard maximum is **100,000 bytes**.
- Byte counter is shown live (`N / 100,000 bytes`).
- At 84–100,000 bytes, the counter and input are highlighted red with a non-standard warning, but PSBT creation remains enabled.
- Above 100,000 bytes, the red state becomes a blocking error and `Create PSBT` is disabled.

### 7.3 Hex Input

- Values starting with `0x`/`0X` are interpreted as hexadecimal payload bytes.
- Hex input must contain only hexadecimal characters and an even number of digits.
- The same 83-byte warning threshold and 100,000-byte hard maximum apply.

### 7.4 PSBT Encoding Behavior

- On creation, OP_RETURN data is encoded as a zero-value output:
  - Script form: `OP_RETURN <data>`
  - Value: `0` sat

## 8. Build Actions

## 8.1 Create PSBT

Clicking `Create PSBT` performs:

1. Read all input rows and output rows.
2. Convert BTC amounts to satoshis.
3. Build PSBT object for selected network.
4. Optionally append OP_RETURN output (if enabled and valid).
5. Validate total amounts.
6. Serialize PSBT to Base64.
7. Show result panel and store current PSBT in `window.currentPsbt`.

### 8.1.1 Input Mapping to PSBT

Each input is added with:

- `hash`: `txid`
- `index`: `vout`
- `sequence`: `4294967293` (`0xfffffffd`)
- `witnessUtxo.script`: parsed scriptPubKey bytes
- `witnessUtxo.value`: satoshis as `BigInt`
- `tapInternalKey`: optional 32-byte x-only key for compatible P2TR inputs

### 8.1.2 Output Mapping to PSBT

Each standard output is added with:

- `address`
- `value`: satoshis as `BigInt`

## 8.2 Clear

`Clear` resets:

- All input rows
- All output rows
- Fee-rate and change fields
- OP_RETURN checkbox/message/group visibility
- PSBT display area and Base64 field
- `window.currentPsbt`

Then it initializes one default input row and one default output row.

## 8.3 Copy to Clipboard

- Copies Base64 PSBT text.
- Button label temporarily changes to `Copied!` (2 seconds) on success.
- Shows alert on failure.

## 8.4 Download PSBT File

- Available after PSBT creation (`window.currentPsbt` exists).
- Generates `unsigned.psbt` as binary (`application/octet-stream`) via Blob download.

## 9. Fee and Balance Behavior

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

### 9.1 Fee Calculator

- `Fee Calculator` opens a modal using the current input and output amounts.
- Total inputs are read-only. In absolute-fee mode, every standard output amount
  and the absolute fee are editable in BTC.
- The last output is always the balancing output and is labeled as auto-adjusted.
- Editing the fee or another output adjusts the balancing output. Editing the
  balancing output adjusts the fee.
- The calculator opens in `Absolute Fee` mode and can switch to `Fee Rate` mode.
- Fee-rate mode accepts a non-negative sat/vB value with up to 8 decimals,
  displays an estimated vsize, and rounds the calculated fee up to a whole
  satoshi.
- Fee-rate mode makes the absolute fee and last output read-only. Editing the
  rate or another output automatically recalculates both values.
- Vsize is estimated locally from each input's P2WPKH or P2TR key-path witness
  sizing and the actual serialized output script lengths, including an enabled
  OP_RETURN output.
- Output addresses must be valid for the selected network before fee-rate mode
  can estimate transaction size.
- Calculations use integer satoshis and accept at most 8 BTC decimal places.
- Invalid, negative, or unbalanced values disable `Apply` and show an inline
  error.
- `Apply` copies output amounts back to the form and refreshes the balance
  summary. `Cancel`, Escape, and backdrop close discard modal changes.
- Output addresses, ordering, and row count are not changed by the calculator.

## 10. Hidden/Inactive Change-Output Mode (Implemented but not user-exposed)

Code includes a change-address + fee-rate flow behind hidden controls:

- Requires positive fee rate.
- Requires valid change address for selected network.
- Estimates vsize, computes fee, and appends change output when positive remainder exists.

Current UI keeps this mode inaccessible (`includeChange` is hidden and disabled), but logic remains present.

## 11. Reordering (Drag and Drop)

Both lists support drag-and-drop reordering:

- Inputs list (`utxoContainer`)
- Outputs list (`outputContainer`)

Implemented using Sortable behavior with animation and ghost styling.

## 12. Error Handling and User Messages

Primary user-visible errors include:

- `Enter an OP_RETURN message.`
- `OP_RETURN data exceeds 100000 bytes.`
- `Outputs exceed inputs!`
- `Error creating PSBT: <reason>`
- `Failed to copy: <error>`
- `Invalid scriptPubKey` (inline label)

Additional internal checks can surface via the generic creation error dialog (for example invalid hex, invalid tx structure, invalid numeric input resulting in downstream failure).

## 13. Numeric and Formatting Conventions

- Monetary input unit: BTC
- Internal arithmetic unit: satoshi
- Displayed precision in summaries: 8 decimal places (`toFixed(8)`)
- Fee labels and totals are shown in BTC

## 14. Initial State

On first load:

- One empty input row is auto-created.
- One empty output row is auto-created.
- OP_RETURN section is hidden.
- PSBT result section is hidden.

## 15. Non-Goals (Current Version)

- No signing capability.
- No private key handling.
- No Taproot script-path spending or script-tree metadata editing.
- No automatic UTXO discovery or wallet integration.
- No persistence across page reloads.
- No server-side validation.
