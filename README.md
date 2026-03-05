# ERPManiaC Grocery ERP (Electron, Offline)

Offline desktop ERP app for grocery stores with:
- Retail and wholesale billing
- Optional GST selection on invoices and purchases
- Product, customer, and supplier masters
- Purchase entry (stock-in)
- Supplier ledger with outstanding due and payment posting
- Barcode scanner support (keyboard-wedge scanners)
- Daily Profit & Loss report
- Native invoice print dialog
- Inventory auto deduction (sales) and auto increment (purchase)
- Offline license lock (12-digit keys, 30 days per key, up to 36 keys)

## Stack
- Electron
- Vanilla HTML/CSS/JS
- Local JSON datastore in Electron user data folder

## Run

```bash
npm install
npm run start
```

## Validate

```bash
npm run check
```

## License Keys

- App requires a valid 12-digit license key to unlock usage.
- One unique key extends validity by `30 days`.
- A maximum of `36` unique keys can be used (about 36 months).
- God key (no expiry, no limit checks): `909090909090`

Generate all 36 keys:

```bash
npm run license:keys
```

## Project Structure

- `main.js` Electron main process and IPC handlers
- `preload.js` secure renderer bridge
- `src/main/store.js` local offline datastore and schema normalization
- `src/main/erpService.js` ERP business logic
- `src/main/invoiceTemplate.js` printable invoice template
- `src/renderer/index.html` UI layout
- `src/renderer/styles.css` app styling
- `src/renderer/app.js` renderer logic

## Usage Highlights

1. Set grocery store details in `Store` (name/phone/address/GSTIN) for invoice header.
2. Add products; SKU auto-generates starting from `10001` and increments.
3. Add customers and suppliers.
4. Create purchases:
   - select supplier
   - add items with qty + unit cost
   - optional GST and payment amount
   - stock updates immediately
5. Record supplier payments from Supplier Ledger.
6. Create invoices:
   - choose retail/wholesale mode
   - add items by manual select or barcode scan
   - enable/disable GST
   - invoice number prefix uses first two letters of store name
7. Print invoices from `Invoices` screen.
   - use `Receive` in invoice list to update payment status (Unpaid/Partial/Paid)
   - Use `View` to preview invoice format even without a printer.
8. Open `Reports` for daily P&L and recent 7-day trend.

## Notes
- Data is persisted locally in Electron `userData` path as `erpmania-data.json`.
- Wholesale invoices enforce wholesale customer selection.
- Wholesale price applies only when item quantity meets configured minimum.
- Product cost is used for COGS and gross profit calculations; purchase entries update weighted cost automatically.
