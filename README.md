# ERPManiaC

Offline Electron ERP application for grocery stores with retail + wholesale billing, purchase/inventory control, supplier ledger, expenses, reports, barcode workflows, invoice print/preview, and optional GST.

## What This App Includes

### Core ERP
- Store profile (name, phone, address, GSTIN)
- Product master with auto SKU generation (`10001`, `10002`, ...)
- Customer and supplier masters
- Purchase entry with stock-in and weighted cost updates
- Billing/invoicing (retail and wholesale)
- Expense tracking (electricity, rent, salary, travel, etc.)
- Supplier ledger and supplier payment posting

### Billing + Purchase Efficiency
- Barcode scanner support (keyboard-wedge scanners)
- Purchase barcode handling for known/unknown products
- Quick add supplier/product from purchase screen
- Quick add customer from billing screen
- Product search in billing by name / SKU / barcode

### Finance + Reports
- Invoice payment tracking (`unpaid`, `partial`, `paid`)
- Daily / monthly / yearly P&L report views
- Stock list PDF export from Products screen
- Invoice preview (without printer) and print

### OCR (Offline, English)
- OCR from purchase bill image (`OCR Bill (EN)`)
- Add OCR text to purchase notes
- Auto-add matched OCR items to purchase draft

### Theme + UX
- Light / dark / auto mode
- Auto mode schedule: light from 6 AM to 6 PM, dark otherwise
- Sidebar keyboard shortcuts:
  - `Alt+1` Dashboard
  - `Alt+2` Store
  - `Alt+3` Products
  - `Alt+4` Customers
  - `Alt+5` Suppliers
  - `Alt+6` Purchases
  - `Alt+0` Expenses
  - `Alt+7` Billing
  - `Alt+8` Invoices
  - `Alt+9` Reports

## License System

- License key format: 12-digit numeric
- 1 key = 30 days extension
- Maximum unique keys: 36 (about 36 months)
- God key (no expiry restriction): `909090909090`

Generate all valid 36 keys:

```bash
npm run license:keys
```

## Tech Stack

- Electron
- Vanilla HTML/CSS/JS
- Local JSON datastore

## Local Data Storage

All business data (products, invoices, purchases, license state, settings) is stored locally in Electron user data path:

- Windows:
  - `%APPDATA%\ERPManiaC\data\erpmania-data.json`
- macOS:
  - `~/Library/Application Support/ERPManiaC/data/erpmania-data.json`
- Linux:
  - `~/.config/ERPManiaC/data/erpmania-data.json`

Important:
- If this file remains, app data and activated keys remain.
- If this file is deleted, app behaves like fresh install.

## Installation & Run (Development)

```bash
npm install
npm run start
```

Validate JS syntax:

```bash
npm run check
```

## OCR Setup (High Accuracy, Offline English)

Download the English OCR model (`tessdata_best`) into `assets/ocr/`:

```bash
npm run ocr:download-eng
```

Notes:
- OCR works offline after model download.
- The OCR model file is intentionally ignored in git via `.gitignore`.

## First-Time Usage Flow

1. Activate license key.
2. Open `Store` and save shop details.
3. Add products (or quick-add from Purchase).
4. Add customers/suppliers.
5. Start using:
   - `Purchases` for stock-in
   - `Billing` for invoices
   - `Expenses` for operational costs
   - `Reports` for P&L analysis

## Operational Notes

### Product Pricing / Stock
- Cost price must be > 0.
- Retail and wholesale prices must be > 0.
- Wholesale min qty and reorder level are optional.
- Purchases update stock and weighted average cost.

### Invoices
- Retail is paid by default if paid amount is not entered.
- Wholesale can be paid partially.
- Invoice list supports payment receive/update.

### Barcodes
- If product has barcode: scan to add quickly.
- If product has no barcode: use SKU or product search.
- In purchase, scanning unknown barcode opens quick add modal.

### OCR Auto Add Items
- OCR attempts product matching by:
  - barcode/SKU token match first
  - then name-based fuzzy match
- Qty/cost are inferred from line numbers.
- Always verify OCR-added lines before final purchase save.

## Stock List PDF

From `Products` screen:
- Click `Stock List PDF`
- Choose save location
- PDF contains:
  - shop details
  - product stock table
  - low-stock highlighting
  - total inventory value

## Build Installer / Packages

### Version Bump

Patch bump:

```bash
npm version patch --no-git-tag-version
```

Example for `1.2.0`:

```bash
npm version 1.2.0 --no-git-tag-version
```

### Windows Installer Output

Configured artifact name:

`ERPManiaC ERP Setup <version>.exe`

Build command:

```bash
npx electron-builder --win --x64
```

### If Building Windows Package on macOS

If Wine metadata/sign-edit step fails, use:

```bash
npx electron-builder --win --x64 -c.win.signAndEditExecutable=false
```

If disk space error appears (`no space left on device`), free disk and rebuild.

## Install / Update on Windows

- For normal users, install with:
  - `ERPManiaC ERP Setup <version>.exe`
- Do not distribute only unpacked `.exe` from `win-unpacked`.
  - That can cause missing DLL errors (example: `ffmpeg.dll`).

Update behavior:
- Installing newer setup over existing app generally preserves local data and license (same app identity/path).
- Backup `erpmania-data.json` before major updates for safety.

## Backup & Restore

### Backup
- Copy `erpmania-data.json` to safe location.

### Restore
- Close app.
- Replace current `erpmania-data.json` with backup.
- Reopen app.

## GitHub Connection and Push

Current remote expected:

```bash
git remote -v
```

If missing/disconnected:

```bash
git remote remove origin 2>/dev/null || true
git remote add origin https://github.com/Ashking717/ERPManiaC.git
git remote -v
```

Push steps:

```bash
git add .
git commit -m "Update ERPManiaC"
git push -u origin main
```

## Project Structure

- `main.js`: Electron main process, IPC, print/PDF actions
- `preload.js`: secure renderer bridge
- `src/main/store.js`: local datastore, normalization
- `src/main/erpService.js`: ERP business logic
- `src/main/invoiceTemplate.js`: invoice print template
- `src/main/stockListTemplate.js`: stock list PDF template
- `src/renderer/index.html`: UI
- `src/renderer/styles.css`: styles
- `src/renderer/app.js`: renderer logic
- `scripts/generate-license-codes.js`: license key generation
- `scripts/download-ocr-eng.js`: OCR model download

## Troubleshooting

### 1) App asks for license again after reinstall
- Check whether old `erpmania-data.json` still exists.
- Restore from backup if needed.

### 2) `ffmpeg.dll was not found`
- You are likely running unpacked app binary directly.
- Install using setup `.exe` generated by electron-builder.

### 3) OCR language error
- Run `npm run ocr:download-eng`.
- Ensure `assets/ocr/eng.traineddata` exists before packaging.

### 4) Cross-build Wine failures on macOS
- Use `-c.win.signAndEditExecutable=false`.
- Prefer building Windows installer on a Windows machine for best reliability.

### 5) Git says “not a git repository”
- This usually indicates local `.git` metadata issue.
- Recreate/fix `.git/HEAD` and verify with `git rev-parse --is-inside-work-tree`.

