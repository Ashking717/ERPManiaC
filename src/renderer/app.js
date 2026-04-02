const state = {
  products: [],
  customers: [],
  suppliers: [],
  invoices: [],
  purchases: [],
  supplierPayments: [],
  expenses: [],
  dashboard: null,
  business: null,
  backup: null,
  draftItems: [],
  purchaseDraftItems: [],
  customerLedger: null,
  supplierLedger: null,
  pnlReport: null,
  trialBalanceReport: null,
  reportPeriod: 'daily',
  licenseStatus: null,
  uiSettings: null,
  availablePrinters: [],
  invoicePaidTouched: false,
  currentView: 'dashboard',
  invoiceSearch: '',
  purchaseSearch: '',
  billingProductSearch: '',
  touchPosCategory: 'all',
  expenseSearch: '',
  selectedLedgerCustomerId: '',
  selectedLedgerSupplierId: '',
  pendingPurchaseBarcode: '',
  purchaseOcrText: '',
  businessLogoDataUrl: '',
  editingPurchaseId: '',
  editingExpenseId: '',
  editingInvoiceId: ''
};

const dom = {};
let toastTimer = null;
const BARCODE_SCAN_IDLE_MS = 120;
let billingBarcodeTimer = null;
let touchPosBarcodeTimer = null;
let purchaseBarcodeTimer = null;
let themeAutoTimer = null;
let touchTableLabelFrame = null;
let touchTableObserver = null;
const MAX_BUSINESS_LOGO_FILE_BYTES = 2 * 1024 * 1024;
const MAX_BUSINESS_LOGO_DATA_URL_LENGTH = 2800000;
const UI_MODE_VIEWS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'products', label: 'Products' },
  { id: 'customers', label: 'Customers' },
  { id: 'suppliers', label: 'Suppliers' },
  { id: 'purchases', label: 'Purchases' },
  { id: 'expenses', label: 'Expenses' },
  { id: 'billing', label: 'Billing' },
  { id: 'invoices', label: 'Invoices' },
  { id: 'reports', label: 'Reports' },
  { id: 'settings', label: 'Settings' }
];

function getApi() {
  if (!window.erpApi) {
    throw new Error('ERP bridge is not available');
  }

  return window.erpApi;
}

async function invoke(method, ...args) {
  const api = getApi();
  const response = await api[method](...args);

  if (!response?.ok) {
    throw new Error(response?.error || 'Operation failed');
  }

  return response.data;
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  if (Number.isNaN(parsed) || !Number.isFinite(parsed)) {
    return fallback;
  }

  return parsed;
}

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatMoney(value) {
  return `Rs ${round2(toNumber(value)).toFixed(2)}`;
}

function formatDate(value) {
  if (!value) {
    return '-';
  }

  return new Date(value).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function normalizeSaleUnit(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'pack' || normalized.startsWith('pack') ? 'pack' : 'loose';
}

function normalizePaymentMethod(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (
    normalized === 'cash' ||
    normalized === 'bank' ||
    normalized === 'upi' ||
    normalized === 'card' ||
    normalized === 'other'
  ) {
    return normalized;
  }

  if (normalized === 'digital' || normalized === 'online' || normalized === 'bank transfer') {
    return 'bank';
  }

  return 'cash';
}

function paymentMethodLabel(value) {
  const normalized = normalizePaymentMethod(value);
  if (normalized === 'cash') {
    return 'Cash';
  }
  if (normalized === 'bank') {
    return 'Bank';
  }
  if (normalized === 'upi') {
    return 'UPI';
  }
  if (normalized === 'card') {
    return 'Card';
  }
  return 'Other';
}

function getProductPackConfig(product) {
  const packSize = Math.max(1, Math.trunc(toNumber(product && product.packSize, 1)));
  const looseUnit = String((product && product.unit) || 'Unit').trim() || 'Unit';
  const loosePrice = round2(toNumber(product && product.loosePrice, product && product.retailPrice));
  const rawPackPrice = round2(
    toNumber(
      product && product.packPrice,
      loosePrice * packSize
    )
  );
  const packEnabled = (Boolean(product && product.packEnabled) || packSize > 1 || rawPackPrice > 0) && packSize > 1;
  const packPrice = round2(
    packEnabled
      ? toNumber(product && product.packPrice, loosePrice * packSize)
      : loosePrice * packSize
  );

  return {
    packEnabled,
    packSize,
    looseUnit,
    loosePrice,
    packPrice
  };
}

function toBaseQty(product, qty, saleUnit) {
  const config = getProductPackConfig(product);
  const cleanQty = round2(toNumber(qty, 0));
  const mode = normalizeSaleUnit(saleUnit);
  if (mode === 'pack' && config.packEnabled) {
    return round2(cleanQty * config.packSize);
  }

  return cleanQty;
}

function getDisplayUnit(product, saleUnit) {
  const config = getProductPackConfig(product);
  const mode = normalizeSaleUnit(saleUnit);
  if (mode === 'pack' && config.packEnabled) {
    return 'Pack';
  }

  return config.looseUnit;
}

function getSelectedBillingSaleUnit() {
  if (!dom.draftSaleUnit) {
    return 'loose';
  }

  const selectedOption = dom.draftSaleUnit.options[dom.draftSaleUnit.selectedIndex];
  const selectedValue = selectedOption ? selectedOption.value : dom.draftSaleUnit.value;
  return normalizeSaleUnit(selectedValue);
}

function updateProductStockInputMode() {
  if (!dom.productStockInput || !dom.productStockLabel || !dom.productStockHint || !dom.productPackEnabled) {
    return;
  }

  if (!dom.productPackEnabled.checked) {
    dom.productStockLabel.textContent = 'Stock Qty (Loose)';
    dom.productStockHint.textContent = 'Stored as loose/base units.';
    return;
  }

  const packSize = Math.max(2, Math.trunc(toNumber(dom.productPackSize && dom.productPackSize.value, 2)));
  const packCount = round2(toNumber(dom.productStockInput.value, 0));
  const looseQty = round2(packCount * packSize);
  const unitText = String((dom.productUnitSelect && dom.productUnitSelect.value) || 'Unit').trim() || 'Unit';

  dom.productStockLabel.textContent = 'Opening Stock (Packs)';
  dom.productStockHint.textContent = `Loose stock = packs x size (${packCount} x ${packSize} = ${looseQty} ${unitText})`;
}

function findProductByBarcodeOrSku(code) {
  const normalized = String(code || '').trim();
  if (!normalized) {
    return null;
  }

  return (
    state.products.find(
      (entry) =>
        String(entry.barcode || '') === normalized ||
        String(entry.sku || '').toUpperCase() === normalized.toUpperCase()
    ) || null
  );
}

function resolvePreferredBillingSaleUnit(product, preferredSaleUnit) {
  const normalized = normalizeSaleUnit(preferredSaleUnit);
  const config = getProductPackConfig(product);
  return normalized === 'pack' && config.packEnabled ? 'pack' : 'loose';
}

function addBillingProductToDraft(product, qty, preferredSaleUnit) {
  if (!product) {
    showToast('Invalid product selected', 'error');
    return false;
  }
  dom.draftProductId.value = product.id;
  renderBillingSaleUnitOptions(product);
  const saleUnit = resolvePreferredBillingSaleUnit(product, preferredSaleUnit);
  dom.draftSaleUnit.value = saleUnit;
  return addDraftItem(product.id, qty, saleUnit);
}

function processBillingBarcodeValue(barcodeValue, options = {}) {
  const barcode = String(barcodeValue || '').trim();
  if (!barcode) {
    return false;
  }

  const product = findProductByBarcodeOrSku(barcode);
  if (!product) {
    showToast(`No product found for barcode ${barcode}`, 'error');
    return false;
  }

  const qty = round2(toNumber(options.qty, toNumber(dom.draftQty.value, 1)));
  const preferredSaleUnit =
    options.saleUnit ||
    (dom.touchPosSaleUnit && dom.touchPosSaleUnit.value ? dom.touchPosSaleUnit.value : getSelectedBillingSaleUnit());

  const added = addBillingProductToDraft(product, qty, preferredSaleUnit);
  if (added) {
    showToast(`Added ${product.name}`);
  }

  return added;
}

function processBillingBarcodeScan() {
  const barcode = dom.barcodeInput.value.trim();
  if (!barcode) {
    return;
  }

  processBillingBarcodeValue(barcode, {
    qty: toNumber(dom.draftQty.value, 1),
    saleUnit: getSelectedBillingSaleUnit()
  });

  dom.barcodeInput.value = '';
  focusBillingScannerInput();
}

function processPurchaseBarcodeScan() {
  const barcode = dom.purchaseBarcodeInput.value.trim();
  if (!barcode) {
    return;
  }

  const product = findProductByBarcodeOrSku(barcode);
  if (!product) {
    openPurchaseUnknownBarcodeModal(barcode);
    return;
  }

  const previousProductId = dom.purchaseDraftProductId.value;
  dom.purchaseDraftProductId.value = product.id;
  const qty = toNumber(dom.purchaseDraftQty.value, 1);

  let unitCost = round2(toNumber(dom.purchaseDraftCost.value, NaN));
  const defaultCost = round2(toNumber(product.costPrice, product.wholesalePrice));
  if (!Number.isFinite(unitCost) || unitCost <= 0 || previousProductId !== product.id) {
    unitCost = defaultCost;
  }
  dom.purchaseDraftCost.value = unitCost;

  const added = addPurchaseDraftItem(product.id, qty, unitCost);
  if (added) {
    showToast(`Added ${product.name}`);
    dom.purchaseDraftQty.value = '1';
  }

  dom.purchaseBarcodeInput.value = '';
  dom.purchaseBarcodeInput.focus();
}

function todayKey() {
  const dt = new Date();
  const year = dt.getFullYear();
  const month = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toDateInputValue(value, fallback = '') {
  if (!value) {
    return fallback;
  }

  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) {
    return fallback;
  }

  const year = dt.getFullYear();
  const month = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function setSelectValueWithFallback(selectElement, value) {
  if (!selectElement) {
    return;
  }

  Array.from(selectElement.options).forEach((option) => {
    if (option.dataset.dynamic === 'true') {
      option.remove();
    }
  });

  const normalized = String(value || '').trim();
  if (!normalized) {
    selectElement.selectedIndex = 0;
    return;
  }

  const hasMatch = Array.from(selectElement.options).some((option) => option.value === normalized);
  if (!hasMatch) {
    const dynamicOption = document.createElement('option');
    dynamicOption.value = normalized;
    dynamicOption.textContent = `${normalized} (Existing)`;
    dynamicOption.dataset.dynamic = 'true';
    selectElement.appendChild(dynamicOption);
  }

  selectElement.value = normalized;
}

function invoicePrefixPreview(storeName) {
  const letters = String(storeName || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (letters.length >= 2) {
    return letters.slice(0, 2);
  }

  if (letters.length === 1) {
    return `${letters}X`;
  }

  return 'GS';
}

function normalizeReportPeriod(value) {
  const period = String(value || '').trim().toLowerCase();
  if (period === 'daily' || period === 'monthly' || period === 'yearly') {
    return period;
  }

  return 'daily';
}

function reportTitleByPeriod(period) {
  if (period === 'monthly') {
    return 'Monthly Profit & Loss';
  }

  if (period === 'yearly') {
    return 'Yearly Profit & Loss';
  }

  return 'Daily Profit & Loss';
}

function reportHistoryLabelByPeriod(period) {
  if (period === 'monthly') {
    return 'Last 12 months';
  }

  if (period === 'yearly') {
    return 'Last 5 years';
  }

  return 'Last 7 days';
}

function getInvoicePaymentStatus(invoice) {
  const explicit = String(invoice && invoice.paymentStatus ? invoice.paymentStatus : '').toLowerCase();
  if (explicit === 'paid' || explicit === 'partial' || explicit === 'unpaid') {
    return explicit;
  }

  const total = round2(toNumber(invoice && invoice.total, 0));
  const paid = round2(toNumber(invoice && invoice.paidAmount, 0));
  const balance = round2(toNumber(invoice && invoice.balance, Math.max(total - paid, 0)));

  if (balance <= 0) {
    return 'paid';
  }

  if (paid > 0) {
    return 'partial';
  }

  return 'unpaid';
}

function getInvoicePendingAmount(invoice) {
  const total = round2(toNumber(invoice && invoice.total, 0));
  const paid = round2(toNumber(invoice && invoice.paidAmount, 0));
  const fallbackBalance = round2(Math.max(total - paid, 0));
  return round2(Math.max(toNumber(invoice && invoice.balance, fallbackBalance), 0));
}

function getInvoicePaymentModeLabel(invoice) {
  const methods = new Set();
  const history = Array.isArray(invoice && invoice.paymentHistory) ? invoice.paymentHistory : [];
  const paidAmount = round2(toNumber(invoice && invoice.paidAmount, 0));
  let historyPaid = 0;

  for (const payment of history) {
    const amount = round2(toNumber(payment && payment.amount, 0));
    if (amount <= 0) {
      continue;
    }
    historyPaid = round2(historyPaid + amount);
    methods.add(normalizePaymentMethod(payment && payment.paymentMethod));
  }

  const initialPaid = round2(Math.max(paidAmount - historyPaid, 0));
  if (initialPaid > 0) {
    methods.add(normalizePaymentMethod(invoice && invoice.paidMethod));
  }

  if (!methods.size) {
    return '-';
  }

  if (methods.size === 1) {
    return paymentMethodLabel([...methods][0]);
  }

  return 'Mixed';
}

function setStatus(text) {
  dom.statusPill.textContent = text;
}

function normalizeThemeMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'light' || mode === 'dark' || mode === 'auto') {
    return mode;
  }

  return 'auto';
}

function normalizeUiMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return mode === 'touch' ? 'touch' : 'pc';
}

function normalizeUiViewMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'pc' || mode === 'touch') {
    return mode;
  }

  return 'global';
}

function normalizeUiViewModes(value) {
  const source = value && typeof value === 'object' ? value : {};
  const normalized = {};

  for (const view of UI_MODE_VIEWS) {
    const mode = normalizeUiViewMode(source[view.id]);
    if (mode !== 'global') {
      normalized[view.id] = mode;
    }
  }

  return normalized;
}

function normalizeUiSettingsForUi(settings) {
  const source = settings && typeof settings === 'object' ? settings : {};
  return {
    themeMode: normalizeThemeMode(source.themeMode),
    uiMode: normalizeUiMode(source.uiMode),
    viewModes: normalizeUiViewModes(source.viewModes),
    thermalAutoPrintEnabled: Boolean(source.thermalAutoPrintEnabled),
    thermalPrinterName: String(source.thermalPrinterName || '').trim()
  };
}

function resolveUiModeForView(viewName, settingsInput = state.uiSettings) {
  const settings = normalizeUiSettingsForUi(settingsInput);
  const normalizedView = String(viewName || '').trim().toLowerCase();
  const overrideMode = normalizeUiViewMode(settings.viewModes && settings.viewModes[normalizedView]);
  if (overrideMode === 'pc' || overrideMode === 'touch') {
    return overrideMode;
  }

  return normalizeUiMode(settings.uiMode);
}

function normalizeBusinessLogoDataUrl(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }

  if (!/^data:image\//i.test(text)) {
    return '';
  }

  if (text.length > MAX_BUSINESS_LOGO_DATA_URL_LENGTH) {
    return '';
  }

  return text;
}

function resolveThemeByMode(mode) {
  if (mode === 'light' || mode === 'dark') {
    return mode;
  }

  const hour = new Date().getHours();
  return hour >= 6 && hour < 18 ? 'light' : 'dark';
}

function clearThemeAutoTimer() {
  if (!themeAutoTimer) {
    return;
  }

  clearInterval(themeAutoTimer);
  themeAutoTimer = null;
}

function setThemeLiveLabel(mode, appliedTheme) {
  if (!dom.themeModeLive) {
    return;
  }

  const appliedLabel = appliedTheme === 'dark' ? 'Dark' : 'Light';
  dom.themeModeLive.textContent =
    mode === 'auto' ? `Current: ${appliedLabel} (Auto)` : `Current: ${appliedLabel}`;
}

function applyThemeMode(modeInput) {
  const mode = normalizeThemeMode(modeInput);
  const appliedTheme = resolveThemeByMode(mode);

  document.documentElement.dataset.theme = appliedTheme;

  if (dom.themeModeSelect && dom.themeModeSelect.value !== mode) {
    dom.themeModeSelect.value = mode;
  }

  setThemeLiveLabel(mode, appliedTheme);
  clearThemeAutoTimer();

  if (mode !== 'auto') {
    return;
  }

  themeAutoTimer = setInterval(() => {
    const currentMode = normalizeThemeMode(state.uiSettings && state.uiSettings.themeMode);
    if (currentMode !== 'auto') {
      clearThemeAutoTimer();
      return;
    }

    const nextTheme = resolveThemeByMode('auto');
    if (document.documentElement.dataset.theme !== nextTheme) {
      document.documentElement.dataset.theme = nextTheme;
    }
    setThemeLiveLabel('auto', nextTheme);
  }, 60 * 1000);
}

function applyUiMode(modeInput) {
  const mode = normalizeUiMode(modeInput);
  document.documentElement.dataset.uiMode = mode;
  document.body.classList.toggle('touch-ui', mode === 'touch');

  scheduleTouchTableLabels();
}

function isTouchUiModeActive(viewName = state.currentView || 'dashboard') {
  return resolveUiModeForView(viewName) === 'touch';
}

function focusBillingScannerInput() {
  window.requestAnimationFrame(() => {
    const isTouchMode = normalizeUiMode(document.documentElement.dataset.uiMode) === 'touch';
    if (isTouchMode && dom.touchPosBarcode) {
      dom.touchPosBarcode.focus();
      return;
    }

    if (dom.barcodeInput) {
      dom.barcodeInput.focus();
    }
  });
}

function applyTouchTableLabels() {
  if (normalizeUiMode(document.documentElement.dataset.uiMode) !== 'touch') {
    return;
  }

  document.querySelectorAll('.table-wrap table').forEach((table) => {
    const headers = Array.from(table.querySelectorAll('thead th')).map((th) =>
      String(th.textContent || '').trim()
    );
    if (!headers.length) {
      return;
    }

    table.querySelectorAll('tbody tr').forEach((row) => {
      const cells = Array.from(row.querySelectorAll('td'));
      if (!cells.length) {
        return;
      }

      const singleCellRow = cells.length === 1;
      cells.forEach((cell, index) => {
        if (singleCellRow || Number(cell.colSpan || 1) > 1 || cell.classList.contains('empty')) {
          cell.removeAttribute('data-label');
          return;
        }

        const header = headers[index] || '';
        if (header) {
          cell.setAttribute('data-label', header);
        } else {
          cell.removeAttribute('data-label');
        }
      });
    });
  });
}

function scheduleTouchTableLabels() {
  if (touchTableLabelFrame) {
    window.cancelAnimationFrame(touchTableLabelFrame);
  }

  touchTableLabelFrame = window.requestAnimationFrame(() => {
    touchTableLabelFrame = null;
    applyTouchTableLabels();
  });
}

function ensureTouchTableObserver() {
  if (touchTableObserver || !document.body) {
    return;
  }

  touchTableObserver = new MutationObserver(() => {
    if (normalizeUiMode(document.documentElement.dataset.uiMode) !== 'touch') {
      return;
    }
    scheduleTouchTableLabels();
  });

  touchTableObserver.observe(document.body, {
    childList: true,
    subtree: true
  });
}

function showToast(message, type = '') {
  dom.toast.textContent = message;
  dom.toast.className = `toast show ${type}`.trim();

  if (toastTimer) {
    clearTimeout(toastTimer);
  }

  toastTimer = setTimeout(() => {
    dom.toast.className = 'toast';
  }, 2600);
}

function getLicenseStatusSafe() {
  return (
    state.licenseStatus || {
      isActive: false,
      isGodMode: false,
      validUntil: null,
      daysRemaining: 0,
      keysUsed: 0,
      keysRemaining: 36,
      maxKeys: 36,
      keyDays: 30,
      godActivatedAt: null
    }
  );
}

function renderLicenseGate() {
  const status = getLicenseStatusSafe();
  const isActive = Boolean(status.isActive);
  const isGodMode = Boolean(status.isGodMode);
  const expiryText = status.validUntil ? formatDate(status.validUntil) : 'Not active';

  if (isGodMode) {
    dom.licenseMessage.textContent = 'God mode active. License restrictions are disabled.';
    dom.licenseMeta.textContent = `Unlimited usage enabled${status.godActivatedAt ? ` | Activated: ${formatDate(status.godActivatedAt)}` : ''}`;
  } else {
    dom.licenseMessage.textContent = isActive
      ? `License active until ${expiryText}.`
      : 'License expired or not active. Enter a valid key to continue.';
    dom.licenseMeta.textContent = `Keys used: ${status.keysUsed}/${status.maxKeys} | Remaining: ${status.keysRemaining} | 1 key = ${status.keyDays} days`;
  }

  dom.licenseGate.classList.toggle('show', !isActive);
  document.body.classList.toggle('license-locked', !isActive);

  if (!isActive) {
    setStatus('License required');
    dom.licenseKeyInput.focus();
  }
}

function cacheDom() {
  dom.mainNav = document.getElementById('main-nav');
  dom.viewTitle = document.getElementById('view-title');
  dom.statusPill = document.getElementById('status-pill');
  dom.toast = document.getElementById('toast');
  dom.brandShopName = document.getElementById('brand-shop-name');
  dom.themeModeSelect = document.getElementById('theme-mode-select');
  dom.themeModeLive = document.getElementById('theme-mode-live');
  dom.licenseGate = document.getElementById('license-gate');
  dom.licenseMessage = document.getElementById('license-message');
  dom.licenseMeta = document.getElementById('license-meta');
  dom.licenseKeyInput = document.getElementById('license-key-input');
  dom.licenseActivateBtn = document.getElementById('license-activate-btn');

  dom.dashboardCards = document.getElementById('dashboard-cards');
  dom.lowStockBody = document.getElementById('low-stock-body');
  dom.recentInvoicesBody = document.getElementById('recent-invoices-body');
  dom.recentPurchasesBody = document.getElementById('recent-purchases-body');
  dom.todaySnapshot = document.getElementById('today-snapshot');

  dom.businessForm = document.getElementById('business-form');
  dom.businessName = document.getElementById('business-name');
  dom.businessPhone = document.getElementById('business-phone');
  dom.businessGstin = document.getElementById('business-gstin');
  dom.businessAddress = document.getElementById('business-address');
  dom.businessInvoicePrefix = document.getElementById('business-invoice-prefix');
  dom.businessLogoFile = document.getElementById('business-logo-file');
  dom.businessLogoPreview = document.getElementById('business-logo-preview');
  dom.businessLogoEmpty = document.getElementById('business-logo-empty');
  dom.businessLogoClearBtn = document.getElementById('business-logo-clear-btn');
  dom.businessSaveBtn = document.getElementById('business-save-btn');
  dom.uiModeForm = document.getElementById('ui-mode-form');
  dom.uiModeSelect = document.getElementById('ui-mode-select');
  dom.uiModePageGrid = document.getElementById('ui-mode-page-grid');
  dom.uiModeSaveBtn = document.getElementById('ui-mode-save-btn');
  dom.backupForm = document.getElementById('backup-form');
  dom.backupEnabled = document.getElementById('backup-enabled');
  dom.backupAutoEnabled = document.getElementById('backup-auto-enabled');
  dom.backupAutoInterval = document.getElementById('backup-auto-interval');
  dom.backupFolderPath = document.getElementById('backup-folder-path');
  dom.backupChooseFolderBtn = document.getElementById('backup-choose-folder-btn');
  dom.backupStatus = document.getElementById('backup-status');
  dom.backupLastFile = document.getElementById('backup-last-file');
  dom.backupLastError = document.getElementById('backup-last-error');
  dom.backupSaveBtn = document.getElementById('backup-save-btn');
  dom.backupManualBtn = document.getElementById('backup-manual-btn');
  dom.backupRestoreBtn = document.getElementById('backup-restore-btn');
  dom.thermalPrintForm = document.getElementById('thermal-print-form');
  dom.thermalAutoPrintEnabled = document.getElementById('thermal-auto-print-enabled');
  dom.thermalPrinterSelect = document.getElementById('thermal-printer-select');
  dom.thermalRefreshPrintersBtn = document.getElementById('thermal-refresh-printers-btn');
  dom.thermalSaveBtn = document.getElementById('thermal-save-btn');

  dom.productForm = document.getElementById('product-form');
  dom.productBody = document.getElementById('products-body');
  dom.productSaveBtn = document.getElementById('product-save-btn');
  dom.productResetBtn = document.getElementById('product-reset-btn');
  dom.productStockPdfBtn = document.getElementById('product-stock-pdf-btn');
  dom.productPackEnabled = document.getElementById('product-pack-enabled');
  dom.productPackSize = document.getElementById('product-pack-size');
  dom.productPackPrice = document.getElementById('product-pack-price');
  dom.productLoosePrice = document.getElementById('product-loose-price');
  dom.productStockInput = document.getElementById('product-stock');
  dom.productStockLabel = document.getElementById('product-stock-label');
  dom.productStockHint = document.getElementById('product-stock-hint');
  dom.productUnitSelect = document.getElementById('product-unit');

  dom.customerForm = document.getElementById('customer-form');
  dom.customerBody = document.getElementById('customers-body');
  dom.customerSaveBtn = document.getElementById('customer-save-btn');
  dom.customerResetBtn = document.getElementById('customer-reset-btn');
  dom.ledgerCustomerSelect = document.getElementById('ledger-customer-select');
  dom.customerOutstanding = document.getElementById('customer-outstanding');
  dom.customerLedgerBody = document.getElementById('customer-ledger-body');

  dom.supplierForm = document.getElementById('supplier-form');
  dom.supplierBody = document.getElementById('suppliers-body');
  dom.supplierSaveBtn = document.getElementById('supplier-save-btn');
  dom.supplierResetBtn = document.getElementById('supplier-reset-btn');
  dom.ledgerSupplierSelect = document.getElementById('ledger-supplier-select');
  dom.supplierOutstanding = document.getElementById('supplier-outstanding');
  dom.supplierPaymentAmount = document.getElementById('supplier-payment-amount');
  dom.supplierPaymentMethod = document.getElementById('supplier-payment-method');
  dom.supplierPaymentNotes = document.getElementById('supplier-payment-notes');
  dom.supplierPaymentBtn = document.getElementById('supplier-payment-btn');
  dom.supplierLedgerBody = document.getElementById('supplier-ledger-body');

  dom.purchaseForm = document.getElementById('purchase-form');
  dom.purchaseSupplier = document.getElementById('purchase-supplier');
  dom.purchaseGstEnabled = document.getElementById('purchase-gst-enabled');
  dom.purchaseGstRate = document.getElementById('purchase-gst-rate');
  dom.purchaseDiscount = document.getElementById('purchase-discount');
  dom.purchasePaid = document.getElementById('purchase-paid');
  dom.purchasePaidMethod = document.getElementById('purchase-paid-method');
  dom.purchaseNotes = document.getElementById('purchase-notes');
  dom.purchaseBarcodeInput = document.getElementById('purchase-barcode-input');
  dom.purchaseOcrBtn = document.getElementById('purchase-ocr-btn');
  dom.purchaseOcrFile = document.getElementById('purchase-ocr-file');

  dom.purchaseDraftProductId = document.getElementById('purchase-draft-product-id');
  dom.purchaseDraftQty = document.getElementById('purchase-draft-qty');
  dom.purchaseDraftCost = document.getElementById('purchase-draft-cost');
  dom.addPurchaseItemBtn = document.getElementById('add-purchase-item-btn');
  dom.purchaseDraftItemsBody = document.getElementById('purchase-draft-items-body');

  dom.purchaseSubtotalValue = document.getElementById('purchase-subtotal-value');
  dom.purchaseDiscountValue = document.getElementById('purchase-discount-value');
  dom.purchaseGstValue = document.getElementById('purchase-gst-value');
  dom.purchaseTotalValue = document.getElementById('purchase-total-value');
  dom.purchaseBalanceValue = document.getElementById('purchase-balance-value');
  dom.purchaseSubmitBtn = document.getElementById('purchase-submit-btn');
  dom.purchaseCancelEditBtn = document.getElementById('purchase-cancel-edit-btn');
  dom.purchaseSearch = document.getElementById('purchase-search');
  dom.purchasesBody = document.getElementById('purchases-body');
  dom.openPurchaseSupplierModalBtn = document.getElementById('open-purchase-supplier-modal-btn');
  dom.openPurchaseProductModalBtn = document.getElementById('open-purchase-product-modal-btn');

  dom.purchaseSupplierModal = document.getElementById('purchase-supplier-modal');
  dom.purchaseSupplierForm = document.getElementById('purchase-supplier-form');
  dom.purchaseSupplierName = document.getElementById('purchase-supplier-name');
  dom.purchaseSupplierPhone = document.getElementById('purchase-supplier-phone');
  dom.purchaseSupplierGstin = document.getElementById('purchase-supplier-gstin');
  dom.purchaseSupplierAddress = document.getElementById('purchase-supplier-address');
  dom.purchaseSupplierCancelBtn = document.getElementById('purchase-supplier-cancel-btn');
  dom.purchaseSupplierSaveBtn = document.getElementById('purchase-supplier-save-btn');

  dom.purchaseProductModal = document.getElementById('purchase-product-modal');
  dom.purchaseProductForm = document.getElementById('purchase-product-form');
  dom.purchaseProductName = document.getElementById('purchase-product-name');
  dom.purchaseProductBarcode = document.getElementById('purchase-product-barcode');
  dom.purchaseProductCategory = document.getElementById('purchase-product-category');
  dom.purchaseProductUnit = document.getElementById('purchase-product-unit');
  dom.purchaseProductPackEnabled = document.getElementById('purchase-product-pack-enabled');
  dom.purchaseProductPackSize = document.getElementById('purchase-product-pack-size');
  dom.purchaseProductPackPrice = document.getElementById('purchase-product-pack-price');
  dom.purchaseProductCostPrice = document.getElementById('purchase-product-cost-price');
  dom.purchaseProductRetailPrice = document.getElementById('purchase-product-retail-price');
  dom.purchaseProductWholesalePrice = document.getElementById('purchase-product-wholesale-price');
  dom.purchaseProductWholesaleMinQty = document.getElementById('purchase-product-wholesale-min-qty');
  dom.purchaseProductReorderLevel = document.getElementById('purchase-product-reorder-level');
  dom.purchaseProductCancelBtn = document.getElementById('purchase-product-cancel-btn');
  dom.purchaseProductSaveBtn = document.getElementById('purchase-product-save-btn');
  dom.purchaseUnknownBarcodeModal = document.getElementById('purchase-unknown-barcode-modal');
  dom.purchaseUnknownProductForm = document.getElementById('purchase-unknown-product-form');
  dom.purchaseUnknownBarcodeValue = document.getElementById('purchase-unknown-barcode-value');
  dom.purchaseUnknownProductName = document.getElementById('purchase-unknown-product-name');
  dom.purchaseUnknownProductCategory = document.getElementById('purchase-unknown-product-category');
  dom.purchaseUnknownProductUnit = document.getElementById('purchase-unknown-product-unit');
  dom.purchaseUnknownProductPackEnabled = document.getElementById('purchase-unknown-product-pack-enabled');
  dom.purchaseUnknownProductPackSize = document.getElementById('purchase-unknown-product-pack-size');
  dom.purchaseUnknownProductPackPrice = document.getElementById('purchase-unknown-product-pack-price');
  dom.purchaseUnknownProductCostPrice = document.getElementById('purchase-unknown-product-cost-price');
  dom.purchaseUnknownProductRetailPrice = document.getElementById('purchase-unknown-product-retail-price');
  dom.purchaseUnknownProductWholesalePrice = document.getElementById(
    'purchase-unknown-product-wholesale-price'
  );
  dom.purchaseUnknownProductWholesaleMinQty = document.getElementById(
    'purchase-unknown-product-wholesale-min-qty'
  );
  dom.purchaseUnknownProductReorderLevel = document.getElementById(
    'purchase-unknown-product-reorder-level'
  );
  dom.purchaseUnknownCancelBtn = document.getElementById('purchase-unknown-cancel-btn');
  dom.purchaseUnknownSaveBtn = document.getElementById('purchase-unknown-save-btn');
  dom.purchaseOcrModal = document.getElementById('purchase-ocr-modal');
  dom.purchaseOcrText = document.getElementById('purchase-ocr-text');
  dom.purchaseOcrMeta = document.getElementById('purchase-ocr-meta');
  dom.purchaseOcrCloseBtn = document.getElementById('purchase-ocr-close-btn');
  dom.purchaseOcrApplyBtn = document.getElementById('purchase-ocr-apply-btn');
  dom.purchaseOcrAddItemsBtn = document.getElementById('purchase-ocr-add-items-btn');

  dom.expenseForm = document.getElementById('expense-form');
  dom.expenseCategory = document.getElementById('expense-category');
  dom.expenseAmount = document.getElementById('expense-amount');
  dom.expensePaymentMethod = document.getElementById('expense-payment-method');
  dom.expenseDate = document.getElementById('expense-date');
  dom.expensePaidTo = document.getElementById('expense-paid-to');
  dom.expenseNotes = document.getElementById('expense-notes');
  dom.expenseSubmitBtn = document.getElementById('expense-submit-btn');
  dom.expenseCancelEditBtn = document.getElementById('expense-cancel-edit-btn');
  dom.expenseSearch = document.getElementById('expense-search');
  dom.expensesBody = document.getElementById('expenses-body');

  dom.invoiceForm = document.getElementById('invoice-form');
  dom.invoiceChannel = document.getElementById('invoice-channel');
  dom.invoiceCustomer = document.getElementById('invoice-customer');
  dom.invoiceGstEnabled = document.getElementById('invoice-gst-enabled');
  dom.invoiceGstRate = document.getElementById('invoice-gst-rate');
  dom.invoiceDiscount = document.getElementById('invoice-discount');
  dom.invoicePaid = document.getElementById('invoice-paid');
  dom.invoicePaidMethod = document.getElementById('invoice-paid-method');
  dom.invoiceNotes = document.getElementById('invoice-notes');
  dom.openBillingCustomerModalBtn = document.getElementById('open-billing-customer-modal-btn');
  dom.billingCustomerModal = document.getElementById('billing-customer-modal');
  dom.billingCustomerForm = document.getElementById('billing-customer-form');
  dom.billingCustomerName = document.getElementById('billing-customer-name');
  dom.billingCustomerType = document.getElementById('billing-customer-type');
  dom.billingCustomerPhone = document.getElementById('billing-customer-phone');
  dom.billingCustomerGstin = document.getElementById('billing-customer-gstin');
  dom.billingCustomerAddress = document.getElementById('billing-customer-address');
  dom.billingCustomerCancelBtn = document.getElementById('billing-customer-cancel-btn');
  dom.billingCustomerSaveBtn = document.getElementById('billing-customer-save-btn');

  dom.barcodeInput = document.getElementById('barcode-input');
  dom.billingProductSearch = document.getElementById('billing-product-search');
  dom.draftProductId = document.getElementById('draft-product-id');
  dom.draftSaleUnit = document.getElementById('draft-sale-unit');
  dom.draftQty = document.getElementById('draft-qty');
  dom.addItemBtn = document.getElementById('add-item-btn');
  dom.draftItemsBody = document.getElementById('draft-items-body');
  dom.touchPosWorkspace = document.getElementById('touch-pos-workspace');
  dom.touchPosCategoryList = document.getElementById('touch-pos-category-list');
  dom.touchPosProductGrid = document.getElementById('touch-pos-product-grid');
  dom.touchPosCartLines = document.getElementById('touch-pos-cart-lines');
  dom.touchPosSearch = document.getElementById('touch-pos-search');
  dom.touchPosBarcode = document.getElementById('touch-pos-barcode');
  dom.touchPosSaleUnit = document.getElementById('touch-pos-sale-unit');
  dom.touchPosQty = document.getElementById('touch-pos-qty');
  dom.touchPosChannel = document.getElementById('touch-pos-channel');
  dom.touchPosCustomer = document.getElementById('touch-pos-customer');
  dom.touchPosPaid = document.getElementById('touch-pos-paid');
  dom.touchPosPaymentMethod = document.getElementById('touch-pos-payment-method');
  dom.touchPosDiscount = document.getElementById('touch-pos-discount');
  dom.touchPosTotal = document.getElementById('touch-pos-total');
  dom.touchPosSubtotal = document.getElementById('touch-pos-subtotal');
  dom.touchPosBalance = document.getElementById('touch-pos-balance');
  dom.touchPosKeypad = document.getElementById('touch-pos-keypad');
  dom.touchPosClearBtn = document.getElementById('touch-pos-clear-btn');
  dom.touchPosCreateBtn = document.getElementById('touch-pos-create-btn');

  dom.subtotalValue = document.getElementById('subtotal-value');
  dom.discountValue = document.getElementById('discount-value');
  dom.gstValue = document.getElementById('gst-value');
  dom.totalValue = document.getElementById('total-value');
  dom.balanceValue = document.getElementById('balance-value');
  dom.invoiceSubmitBtn = document.getElementById('invoice-submit-btn');
  dom.invoiceCancelEditBtn = document.getElementById('invoice-cancel-edit-btn');

  dom.invoiceSearch = document.getElementById('invoice-search');
  dom.invoicesBody = document.getElementById('invoices-body');
  dom.invoicePaymentModal = document.getElementById('invoice-payment-modal');
  dom.invoicePaymentForm = document.getElementById('invoice-payment-form');
  dom.invoicePaymentMeta = document.getElementById('invoice-payment-meta');
  dom.invoicePaymentInvoiceId = document.getElementById('invoice-payment-invoice-id');
  dom.invoicePaymentPending = document.getElementById('invoice-payment-pending');
  dom.invoicePaymentAmount = document.getElementById('invoice-payment-amount');
  dom.invoicePaymentMethod = document.getElementById('invoice-payment-method');
  dom.invoicePaymentNote = document.getElementById('invoice-payment-note');
  dom.invoicePaymentCancelBtn = document.getElementById('invoice-payment-cancel-btn');
  dom.invoicePaymentFullBtn = document.getElementById('invoice-payment-full-btn');
  dom.invoicePaymentPartialBtn = document.getElementById('invoice-payment-partial-btn');

  dom.reportTitle = document.getElementById('report-title');
  dom.reportPeriod = document.getElementById('report-period');
  dom.reportDate = document.getElementById('report-date');
  dom.reportRefreshBtn = document.getElementById('report-refresh-btn');
  dom.reportCards = document.getElementById('report-cards');
  dom.reportHistoryLabel = document.getElementById('report-history-label');
  dom.pnlHistoryBody = document.getElementById('pnl-history-body');
  dom.trialBalanceTitle = document.getElementById('trial-balance-title');
  dom.trialBalanceStatus = document.getElementById('trial-balance-status');
  dom.trialBalanceDebitTotal = document.getElementById('trial-balance-debit-total');
  dom.trialBalanceCreditTotal = document.getElementById('trial-balance-credit-total');
  dom.trialBalanceDiffTotal = document.getElementById('trial-balance-diff-total');
  dom.trialBalanceBody = document.getElementById('trial-balance-body');
}

function bindNavigation() {
  dom.mainNav.addEventListener('click', (event) => {
    const button = event.target.closest('[data-view]');
    if (!button) {
      return;
    }

    switchView(button.dataset.view);
  });
}

function bindSidebarShortcuts() {
  const viewByDigit = {
    Digit1: 'dashboard',
    Digit2: 'products',
    Digit3: 'customers',
    Digit4: 'suppliers',
    Digit5: 'purchases',
    Digit6: 'expenses',
    Digit7: 'billing',
    Digit8: 'invoices',
    Digit9: 'reports',
    Digit0: 'settings'
  };

  document.addEventListener('keydown', (event) => {
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }

    const activeTag = document.activeElement && document.activeElement.tagName;
    const isTypingTarget =
      activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT';
    if (isTypingTarget) {
      return;
    }

    const targetView = viewByDigit[event.code];
    if (!targetView) {
      return;
    }

    event.preventDefault();
    switchView(targetView);
  });
}

function clickIfEnabled(button) {
  if (!button || button.disabled) {
    return false;
  }

  button.click();
  return true;
}

function runPrimaryActionShortcut() {
  if (dom.invoicePaymentModal && dom.invoicePaymentModal.open) {
    return clickIfEnabled(dom.invoicePaymentPartialBtn);
  }

  const view = state.currentView || 'dashboard';
  if (view === 'billing') {
    return clickIfEnabled(dom.invoiceSubmitBtn);
  }
  if (view === 'purchases') {
    return clickIfEnabled(dom.purchaseSubmitBtn);
  }
  if (view === 'expenses') {
    return clickIfEnabled(dom.expenseSubmitBtn);
  }
  if (view === 'products') {
    return clickIfEnabled(dom.productSaveBtn);
  }
  if (view === 'customers') {
    return clickIfEnabled(dom.customerSaveBtn);
  }
  if (view === 'suppliers') {
    return clickIfEnabled(dom.supplierSaveBtn);
  }
  if (view === 'settings') {
    return clickIfEnabled(dom.businessSaveBtn);
  }

  return false;
}

function bindActionShortcuts() {
  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) {
      return;
    }

    if (
      event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      String(event.key || '').toLowerCase() === 'enter'
    ) {
      if (runPrimaryActionShortcut()) {
        event.preventDefault();
      }
      return;
    }

    if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) {
      return;
    }

    const view = state.currentView || 'dashboard';
    let handled = false;

    if (event.code === 'KeyI' && view === 'billing') {
      handled = clickIfEnabled(dom.invoiceSubmitBtn);
    } else if (event.code === 'KeyP' && view === 'purchases') {
      handled = clickIfEnabled(dom.purchaseSubmitBtn);
    } else if (event.code === 'KeyE' && view === 'expenses') {
      handled = clickIfEnabled(dom.expenseSubmitBtn);
    } else if (event.code === 'KeyU' && view === 'suppliers') {
      handled = clickIfEnabled(dom.supplierPaymentBtn);
    } else if (event.code === 'KeyR' && dom.invoicePaymentModal && dom.invoicePaymentModal.open) {
      handled = clickIfEnabled(dom.invoicePaymentPartialBtn);
    }

    if (handled) {
      event.preventDefault();
    }
  });
}

function bindThemeMode() {
  if (!dom.themeModeSelect) {
    return;
  }

  dom.themeModeSelect.addEventListener('change', async () => {
    const previousSettings = normalizeUiSettingsForUi(state.uiSettings);
    const nextMode = normalizeThemeMode(dom.themeModeSelect.value);
    const previousStatus = dom.statusPill.textContent;

    state.uiSettings = {
      ...previousSettings,
      themeMode: nextMode
    };
    applyThemeMode(nextMode);

    try {
      setStatus('Saving theme...');
      const updated = await invoke('upsertUiSettings', { themeMode: nextMode });
      state.uiSettings = normalizeUiSettingsForUi(
        updated || {
          ...previousSettings,
          themeMode: nextMode
        }
      );
      renderUiSettings();
      setStatus(previousStatus);
    } catch (error) {
      state.uiSettings = previousSettings;
      renderUiSettings();
      setStatus(previousStatus);
      showToast(error.message, 'error');
    }
  });
}

function renderUiModePageSettings() {
  if (!dom.uiModePageGrid) {
    return;
  }

  const uiSettings = normalizeUiSettingsForUi(state.uiSettings);
  dom.uiModePageGrid.innerHTML = UI_MODE_VIEWS
    .map((view) => {
      const selectedMode = normalizeUiViewMode(
        uiSettings.viewModes && uiSettings.viewModes[view.id]
      );

      return `
        <label class="ui-mode-page-item">
          <span>${view.label}</span>
          <select data-ui-view-mode="${view.id}">
            <option value="global">Use Global</option>
            <option value="pc" ${selectedMode === 'pc' ? 'selected' : ''}>PC</option>
            <option value="touch" ${selectedMode === 'touch' ? 'selected' : ''}>Touch</option>
          </select>
        </label>
      `;
    })
    .join('');
}

function readUiModeSettingsFromForm() {
  const uiMode = normalizeUiMode(dom.uiModeSelect ? dom.uiModeSelect.value : 'pc');
  const viewModes = {};
  if (dom.uiModePageGrid) {
    dom.uiModePageGrid.querySelectorAll('select[data-ui-view-mode]').forEach((selectNode) => {
      const viewName = String(selectNode.dataset.uiViewMode || '').trim().toLowerCase();
      if (!viewName) {
        return;
      }

      const mode = normalizeUiViewMode(selectNode.value);
      if (mode === 'pc' || mode === 'touch') {
        viewModes[viewName] = mode;
      }
    });
  }

  return {
    uiMode,
    viewModes: normalizeUiViewModes(viewModes)
  };
}

function uiModeSettingsEqual(a, b) {
  const first = normalizeUiSettingsForUi(a);
  const second = normalizeUiSettingsForUi(b);
  if (first.uiMode !== second.uiMode) {
    return false;
  }

  const firstModes = normalizeUiViewModes(first.viewModes);
  const secondModes = normalizeUiViewModes(second.viewModes);
  const firstKeys = Object.keys(firstModes).sort();
  const secondKeys = Object.keys(secondModes).sort();
  if (firstKeys.length !== secondKeys.length) {
    return false;
  }

  for (let index = 0; index < firstKeys.length; index += 1) {
    const key = firstKeys[index];
    if (key !== secondKeys[index] || firstModes[key] !== secondModes[key]) {
      return false;
    }
  }

  return true;
}

function bindUiMode() {
  if (!dom.uiModeForm || !dom.uiModeSelect) {
    return;
  }

  let uiModeSaveInFlight = false;

  const persistUiModeSettings = async (nextSettings, options = {}) => {
    const { notify = true } = options;
    const previousSettings = normalizeUiSettingsForUi(state.uiSettings);
    const previousStatus = dom.statusPill.textContent;
    const normalizedNextSettings = {
      ...previousSettings,
      uiMode: normalizeUiMode(nextSettings && nextSettings.uiMode),
      viewModes: normalizeUiViewModes(nextSettings && nextSettings.viewModes)
    };

    if (uiModeSettingsEqual(previousSettings, normalizedNextSettings)) {
      applyUiMode(resolveUiModeForView(state.currentView || 'dashboard', previousSettings));
      return true;
    }

    if (uiModeSaveInFlight) {
      return false;
    }

    uiModeSaveInFlight = true;
    state.uiSettings = normalizedNextSettings;
    applyUiMode(resolveUiModeForView(state.currentView || 'dashboard', state.uiSettings));

    try {
      setStatus('Saving interface mode...');
      const updated = await invoke('upsertUiSettings', {
        uiMode: normalizedNextSettings.uiMode,
        viewModes: normalizedNextSettings.viewModes
      });
      state.uiSettings = normalizeUiSettingsForUi(
        updated || normalizedNextSettings
      );
      renderUiSettings();
      if (notify) {
        showToast('Interface mode updated');
      }
      setStatus(previousStatus);
      return true;
    } catch (error) {
      state.uiSettings = previousSettings;
      renderUiSettings();
      setStatus(previousStatus);
      showToast(error.message, 'error');
      return false;
    } finally {
      uiModeSaveInFlight = false;
    }
  };

  dom.uiModeForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const nextSettings = readUiModeSettingsFromForm();
    await persistUiModeSettings(nextSettings, { notify: true });
  });
}

function bindBusiness() {
  dom.businessName.addEventListener('input', () => {
    dom.businessInvoicePrefix.value = invoicePrefixPreview(dom.businessName.value);
  });

  if (dom.businessLogoClearBtn) {
    dom.businessLogoClearBtn.addEventListener('click', () => {
      state.businessLogoDataUrl = '';
      renderBusinessLogoPreview();
      showToast('Logo removed. Click Save Settings to apply');
    });
  }

  if (dom.businessLogoFile) {
    dom.businessLogoFile.addEventListener('change', async () => {
      const file = dom.businessLogoFile.files && dom.businessLogoFile.files[0];
      if (!file) {
        return;
      }

      const previousStatus = dom.statusPill.textContent;

      try {
        if (!String(file.type || '').toLowerCase().startsWith('image/')) {
          throw new Error('Please choose an image file for store logo');
        }

        if (file.size > MAX_BUSINESS_LOGO_FILE_BYTES) {
          throw new Error('Logo file must be 2 MB or smaller');
        }

        setStatus('Reading logo...');
        const dataUrl = await readFileAsDataUrl(file);
        const normalizedLogo = normalizeBusinessLogoDataUrl(dataUrl);
        if (!normalizedLogo) {
          throw new Error('Unsupported logo format');
        }

        state.businessLogoDataUrl = normalizedLogo;
        renderBusinessLogoPreview();
        showToast('Logo ready. Click Save Settings to apply');
        setStatus(previousStatus);
      } catch (error) {
        setStatus(previousStatus);
        showToast(error.message, 'error');
      } finally {
        dom.businessLogoFile.value = '';
      }
    });
  }

  dom.businessForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const payload = {
      name: dom.businessName.value,
      phone: dom.businessPhone.value,
      gstin: dom.businessGstin.value,
      address: dom.businessAddress.value,
      logoDataUrl: normalizeBusinessLogoDataUrl(state.businessLogoDataUrl)
    };

    try {
      setStatus('Saving settings...');
      await invoke('upsertBusiness', payload);
      await reloadData();
      showToast('Settings updated');
      setStatus('Live');
    } catch (error) {
      setStatus('Live');
      showToast(error.message, 'error');
    }
  });
}

function normalizeBackupSettingsForUi(backup) {
  const source = backup && typeof backup === 'object' ? backup : {};
  const interval = Math.trunc(toNumber(source.autoBackupIntervalHours, 24));
  return {
    mode: String(source.mode || 'local-folder').trim().toLowerCase() === 'local-folder' ? 'local-folder' : 'local-folder',
    enabled: Boolean(source.enabled),
    autoBackupEnabled: Boolean(source.autoBackupEnabled),
    autoBackupIntervalHours: Math.max(1, Math.min(168, interval || 24)),
    folderPath: String(source.folderPath || '').trim(),
    lastBackupAt: source.lastBackupAt || null,
    lastBackupFileName: String(source.lastBackupFileName || '').trim(),
    lastBackupStatus: String(source.lastBackupStatus || 'never').trim().toLowerCase(),
    lastBackupError: String(source.lastBackupError || '').trim(),
    lastRestoreAt: source.lastRestoreAt || null,
    lastRestoreFileName: String(source.lastRestoreFileName || '').trim(),
    lastRestoreStatus: String(source.lastRestoreStatus || 'never').trim().toLowerCase(),
    lastRestoreError: String(source.lastRestoreError || '').trim()
  };
}

function backupStatusLabel(status, timeValue) {
  const normalized = String(status || 'never').toLowerCase();
  if (normalized === 'success') {
    return `Success${timeValue ? ` (${formatDate(timeValue)})` : ''}`;
  }

  if (normalized === 'failed') {
    return `Failed${timeValue ? ` (${formatDate(timeValue)})` : ''}`;
  }

  return 'Never';
}

function updateBackupFormState() {
  if (!dom.backupForm) {
    return;
  }

  const enabled = Boolean(dom.backupEnabled && dom.backupEnabled.checked);
  const autoEnabled = Boolean(dom.backupAutoEnabled && dom.backupAutoEnabled.checked);
  const controlsDisabled = !enabled;

  [dom.backupFolderPath, dom.backupAutoEnabled, dom.backupManualBtn, dom.backupRestoreBtn].forEach((node) => {
    if (node) {
      node.disabled = controlsDisabled;
    }
  });

  if (dom.backupChooseFolderBtn) {
    dom.backupChooseFolderBtn.disabled = controlsDisabled;
  }

  if (dom.backupAutoInterval) {
    dom.backupAutoInterval.disabled = controlsDisabled || !autoEnabled;
  }
}

function readBackupPayloadFromForm() {
  return {
    mode: 'local-folder',
    enabled: Boolean(dom.backupEnabled && dom.backupEnabled.checked),
    autoBackupEnabled: Boolean(dom.backupAutoEnabled && dom.backupAutoEnabled.checked),
    autoBackupIntervalHours: Math.max(1, Math.min(168, Math.trunc(toNumber(dom.backupAutoInterval.value, 24)))),
    folderPath: dom.backupFolderPath.value
  };
}

async function saveBackupSettings(options = {}) {
  const { silentSuccess = false } = options;
  const payload = readBackupPayloadFromForm();
  const updated = await invoke('upsertBackupSettings', payload);
  state.backup = normalizeBackupSettingsForUi(updated);
  renderBackupSettings();
  if (!silentSuccess) {
    showToast('Backup settings saved');
  }
  return updated;
}

function bindBackup() {
  if (!dom.backupForm) {
    return;
  }

  if (dom.backupChooseFolderBtn) {
    dom.backupChooseFolderBtn.addEventListener('click', async () => {
      try {
        const currentPath = dom.backupFolderPath.value;
        const result = await invoke('pickBackupFolder', currentPath);
        if (result && result.selected && result.folderPath) {
          dom.backupFolderPath.value = result.folderPath;
        }
      } catch (error) {
        showToast(error.message, 'error');
      }
    });
  }

  if (dom.backupEnabled) {
    dom.backupEnabled.addEventListener('change', () => {
      updateBackupFormState();
    });
  }

  if (dom.backupAutoEnabled) {
    dom.backupAutoEnabled.addEventListener('change', () => {
      updateBackupFormState();
    });
  }

  dom.backupForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const previousStatus = dom.statusPill.textContent;
    try {
      setStatus('Saving backup settings...');
      await saveBackupSettings();
      setStatus(previousStatus);
    } catch (error) {
      setStatus(previousStatus);
      showToast(error.message, 'error');
    }
  });

  if (dom.backupManualBtn) {
    dom.backupManualBtn.addEventListener('click', async () => {
      const previousStatus = dom.statusPill.textContent;
      try {
        setStatus('Saving backup settings...');
        await saveBackupSettings({ silentSuccess: true });
        setStatus('Creating backup file...');
        const result = await invoke('runLocalBackup');
        await reloadData();
        showToast(`Backup created: ${result.fileName}`);
        setStatus(previousStatus);
      } catch (error) {
        setStatus(previousStatus);
        showToast(error.message, 'error');
      }
    });
  }

  if (dom.backupRestoreBtn) {
    dom.backupRestoreBtn.addEventListener('click', async () => {
      const confirmed = window.confirm(
        'Restore latest backup file? This will replace current local data with backup data.'
      );
      if (!confirmed) {
        return;
      }

      const previousStatus = dom.statusPill.textContent;
      try {
        setStatus('Saving backup settings...');
        await saveBackupSettings({ silentSuccess: true });
        setStatus('Restoring latest backup...');
        const result = await invoke('restoreLatestLocalBackup');
        await reloadData();
        showToast(`Restored: ${result.fileName}`);
        setStatus(previousStatus);
      } catch (error) {
        setStatus(previousStatus);
        showToast(error.message, 'error');
      }
    });
  }
}

function normalizePrinterList(printers) {
  const source = Array.isArray(printers) ? printers : [];
  const seen = new Set();
  const normalized = [];

  for (const printer of source) {
    const name = String(printer && printer.name ? printer.name : '').trim();
    const displayName = String(
      printer && (printer.displayName || printer.name) ? printer.displayName || printer.name : ''
    ).trim();

    if (!name || seen.has(name)) {
      continue;
    }

    seen.add(name);
    normalized.push({
      name,
      displayName: displayName || name,
      isDefault: Boolean(printer && printer.isDefault)
    });
  }

  return normalized.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function updateThermalFormState() {
  if (!dom.thermalPrintForm) {
    return;
  }

  const enabled = Boolean(dom.thermalAutoPrintEnabled && dom.thermalAutoPrintEnabled.checked);

  if (dom.thermalPrinterSelect) {
    dom.thermalPrinterSelect.disabled = !enabled;
  }
}

function renderThermalPrinterOptions(selectedPrinterName = '') {
  if (!dom.thermalPrinterSelect) {
    return;
  }

  const selected = String(selectedPrinterName || '').trim();
  const printers = Array.isArray(state.availablePrinters) ? state.availablePrinters : [];
  dom.thermalPrinterSelect.innerHTML = '';

  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = 'System Default Printer';
  dom.thermalPrinterSelect.append(defaultOption);

  for (const printer of printers) {
    const option = document.createElement('option');
    option.value = printer.name;
    option.textContent = printer.isDefault
      ? `${printer.displayName} (Default)`
      : printer.displayName;
    dom.thermalPrinterSelect.append(option);
  }

  const hasSelectedPrinter = printers.some((printer) => printer.name === selected);
  if (selected && !hasSelectedPrinter) {
    const manualOption = document.createElement('option');
    manualOption.value = selected;
    manualOption.textContent = `${selected} (Saved)`;
    dom.thermalPrinterSelect.append(manualOption);
  }

  dom.thermalPrinterSelect.value = selected || '';
}

function renderThermalSettings() {
  if (!dom.thermalPrintForm) {
    return;
  }

  const uiSettings = normalizeUiSettingsForUi(state.uiSettings);
  dom.thermalAutoPrintEnabled.checked = uiSettings.thermalAutoPrintEnabled;
  renderThermalPrinterOptions(uiSettings.thermalPrinterName);
  updateThermalFormState();
}

async function refreshThermalPrinters(options = {}) {
  const { silentError = false } = options;

  try {
    const printers = await invoke('getPrinters');
    state.availablePrinters = normalizePrinterList(printers);
    const selectedValue = dom.thermalPrinterSelect
      ? dom.thermalPrinterSelect.value
      : normalizeUiSettingsForUi(state.uiSettings).thermalPrinterName;
    renderThermalPrinterOptions(selectedValue);
  } catch (error) {
    state.availablePrinters = [];
    renderThermalPrinterOptions(dom.thermalPrinterSelect ? dom.thermalPrinterSelect.value : '');
    if (!silentError) {
      showToast(error.message, 'error');
    }
  }
}

function readThermalSettingsPayloadFromForm() {
  return {
    thermalAutoPrintEnabled: Boolean(
      dom.thermalAutoPrintEnabled && dom.thermalAutoPrintEnabled.checked
    ),
    thermalPrinterName: String(dom.thermalPrinterSelect && dom.thermalPrinterSelect.value ? dom.thermalPrinterSelect.value : '').trim()
  };
}

async function saveThermalSettings() {
  const payload = readThermalSettingsPayloadFromForm();
  const updated = await invoke('upsertUiSettings', payload);
  state.uiSettings = normalizeUiSettingsForUi(updated || { ...(state.uiSettings || {}), ...payload });
  renderUiSettings();
  showToast('Thermal settings saved');
}

function bindThermalPrinting() {
  if (!dom.thermalPrintForm) {
    return;
  }

  if (dom.thermalAutoPrintEnabled) {
    dom.thermalAutoPrintEnabled.addEventListener('change', () => {
      updateThermalFormState();
    });
  }

  if (dom.thermalRefreshPrintersBtn) {
    dom.thermalRefreshPrintersBtn.addEventListener('click', async () => {
      const previousStatus = dom.statusPill.textContent;
      try {
        setStatus('Loading printers...');
        await refreshThermalPrinters();
        setStatus(previousStatus);
      } catch (_error) {
        setStatus(previousStatus);
      }
    });
  }

  dom.thermalPrintForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const previousStatus = dom.statusPill.textContent;
    try {
      setStatus('Saving thermal settings...');
      await saveThermalSettings();
      setStatus(previousStatus);
    } catch (error) {
      setStatus(previousStatus);
      showToast(error.message, 'error');
    }
  });
}

function bindLicense() {
  dom.licenseKeyInput.addEventListener('input', () => {
    dom.licenseKeyInput.value = dom.licenseKeyInput.value.replace(/\D/g, '').slice(0, 12);
  });

  dom.licenseKeyInput.addEventListener('keydown', async (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      dom.licenseActivateBtn.click();
    }
  });

  dom.licenseActivateBtn.addEventListener('click', async () => {
    const key = dom.licenseKeyInput.value.trim();
    if (!key) {
      showToast('Enter a 12-digit license key', 'error');
      return;
    }

    try {
      setStatus('Activating license...');
      const status = await invoke('activateLicenseKey', { key });
      state.licenseStatus = status;
      dom.licenseKeyInput.value = '';
      await reloadData();
      if (status.isGodMode) {
        showToast('God mode activated. License restrictions removed.');
      } else {
        showToast(`License active for ${status.daysRemaining} days`);
      }
      setStatus('Live');
    } catch (error) {
      setStatus('License required');
      showToast(error.message, 'error');
    }
  });
}

function bindProducts() {
  const suggestPackPrice = () => {
    if (!dom.productPackEnabled || !dom.productPackEnabled.checked) {
      return;
    }
    const loosePrice = round2(toNumber(dom.productLoosePrice.value, 0));
    const packSize = Math.max(2, Math.trunc(toNumber(dom.productPackSize.value, 2)));
    const currentPackPrice = round2(toNumber(dom.productPackPrice.value, 0));
    if (currentPackPrice > 0) {
      return;
    }
    dom.productPackPrice.value = round2(loosePrice * packSize).toFixed(2);
  };

  const syncProductPackFields = () => {
    const enabled = Boolean(dom.productPackEnabled && dom.productPackEnabled.checked);
    if (!dom.productPackSize || !dom.productPackPrice) {
      return;
    }

    dom.productPackSize.disabled = !enabled;
    dom.productPackPrice.disabled = !enabled;
    if (!enabled) {
      dom.productPackSize.value = '1';
      dom.productPackPrice.value = '0';
    } else if (toNumber(dom.productPackSize.value, 0) < 2) {
      dom.productPackSize.value = '2';
    }
    suggestPackPrice();
    updateProductStockInputMode();
  };

  if (dom.productPackEnabled) {
    dom.productPackEnabled.addEventListener('change', syncProductPackFields);
    dom.productPackSize.addEventListener('input', () => {
      suggestPackPrice();
      updateProductStockInputMode();
    });
    dom.productLoosePrice.addEventListener('input', suggestPackPrice);
    if (dom.productStockInput) {
      dom.productStockInput.addEventListener('input', updateProductStockInputMode);
    }
    if (dom.productUnitSelect) {
      dom.productUnitSelect.addEventListener('change', updateProductStockInputMode);
    }
    syncProductPackFields();
  }

  if (dom.productStockPdfBtn) {
    dom.productStockPdfBtn.addEventListener('click', async () => {
      try {
        setStatus('Generating stock list PDF...');
        const result = await invoke('exportStockListPdf');
        if (result && result.saved) {
          showToast('Stock list PDF saved');
        } else {
          showToast('Stock list PDF export cancelled', 'info');
        }
        setStatus('Live');
      } catch (error) {
        setStatus('Live');
        showToast(error.message, 'error');
      }
    });
  }

  dom.productForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    try {
      setStatus('Saving product...');

      const payload = {
        id: dom.productForm.querySelector('#product-id').value,
        sku: dom.productForm.querySelector('#product-sku').value,
        barcode: dom.productForm.querySelector('#product-barcode').value,
        name: dom.productForm.querySelector('#product-name').value,
        category: dom.productForm.querySelector('#product-category').value,
        unit: dom.productForm.querySelector('#product-unit').value,
        costPrice: dom.productForm.querySelector('#product-cost-price').value,
        retailPrice: dom.productForm.querySelector('#product-loose-price').value,
        loosePrice: dom.productForm.querySelector('#product-loose-price').value,
        packEnabled: dom.productPackEnabled.checked,
        packSize: dom.productForm.querySelector('#product-pack-size').value,
        packPrice: dom.productForm.querySelector('#product-pack-price').value,
        wholesalePrice: dom.productForm.querySelector('#product-wholesale-price').value,
        wholesaleMinQty: dom.productForm.querySelector('#product-wholesale-min-qty').value,
        stock: dom.productForm.querySelector('#product-stock').value,
        stockMode: dom.productPackEnabled.checked ? 'pack' : 'loose',
        reorderLevel: dom.productForm.querySelector('#product-reorder-level').value
      };

      await invoke('upsertProduct', payload);
      resetProductForm();
      await reloadData();

      showToast('Product saved');
      setStatus('Live');
    } catch (error) {
      setStatus('Live');
      showToast(error.message, 'error');
    }
  });

  dom.productResetBtn.addEventListener('click', () => {
    resetProductForm();
  });

  dom.productBody.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) {
      return;
    }

    const { action, id } = button.dataset;
    const product = state.products.find((entry) => String(entry.id) === String(id));

    if (!product) {
      return;
    }

    if (action === 'edit') {
      fillProductForm(product);
      switchView('products');
      return;
    }

    if (action === 'delete') {
      const allowed = window.confirm(`Delete product ${product.name}?`);
      if (!allowed) {
        return;
      }

      try {
        setStatus('Deleting product...');
        await invoke('deleteProduct', id);
        await reloadData();
        showToast('Product deleted');
        setStatus('Live');
      } catch (error) {
        setStatus('Live');
        showToast(error.message, 'error');
      }
    }
  });
}

function bindCustomers() {
  dom.customerForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    try {
      setStatus('Saving customer...');

      const payload = {
        id: dom.customerForm.querySelector('#customer-id').value,
        name: dom.customerForm.querySelector('#customer-name').value,
        type: dom.customerForm.querySelector('#customer-type').value,
        phone: dom.customerForm.querySelector('#customer-phone').value,
        address: dom.customerForm.querySelector('#customer-address').value,
        gstin: dom.customerForm.querySelector('#customer-gstin').value
      };

      await invoke('upsertCustomer', payload);
      resetCustomerForm();
      await reloadData();
      showToast('Customer saved');
      setStatus('Live');
    } catch (error) {
      setStatus('Live');
      showToast(error.message, 'error');
    }
  });

  dom.customerResetBtn.addEventListener('click', () => {
    resetCustomerForm();
  });

  dom.customerBody.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) {
      return;
    }

    const { action, id } = button.dataset;
    const customer = state.customers.find((entry) => entry.id === id);
    if (!customer) {
      return;
    }

    if (action === 'edit') {
      fillCustomerForm(customer);
      switchView('customers');
      return;
    }

    if (action === 'delete') {
      const allowed = window.confirm(`Delete customer ${customer.name}?`);
      if (!allowed) {
        return;
      }

      try {
        setStatus('Deleting customer...');
        await invoke('deleteCustomer', id);
        if (state.selectedLedgerCustomerId === id) {
          state.selectedLedgerCustomerId = '';
        }
        await reloadData();
        showToast('Customer deleted');
        setStatus('Live');
      } catch (error) {
        setStatus('Live');
        showToast(error.message, 'error');
      }
    }
  });

  dom.ledgerCustomerSelect.addEventListener('change', async () => {
    state.selectedLedgerCustomerId = dom.ledgerCustomerSelect.value;
    await loadCustomerLedger();
  });
}

function bindSuppliers() {
  dom.supplierForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    try {
      setStatus('Saving supplier...');

      const payload = {
        id: dom.supplierForm.querySelector('#supplier-id').value,
        name: dom.supplierForm.querySelector('#supplier-name').value,
        phone: dom.supplierForm.querySelector('#supplier-phone').value,
        gstin: dom.supplierForm.querySelector('#supplier-gstin').value,
        address: dom.supplierForm.querySelector('#supplier-address').value
      };

      await invoke('upsertSupplier', payload);
      resetSupplierForm();
      await reloadData();
      showToast('Supplier saved');
      setStatus('Live');
    } catch (error) {
      setStatus('Live');
      showToast(error.message, 'error');
    }
  });

  dom.supplierResetBtn.addEventListener('click', () => {
    resetSupplierForm();
  });

  dom.supplierBody.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) {
      return;
    }

    const { action, id } = button.dataset;
    const supplier = state.suppliers.find((entry) => entry.id === id);
    if (!supplier) {
      return;
    }

    if (action === 'edit') {
      fillSupplierForm(supplier);
      switchView('suppliers');
      return;
    }

    if (action === 'delete') {
      const allowed = window.confirm(`Delete supplier ${supplier.name}?`);
      if (!allowed) {
        return;
      }

      try {
        setStatus('Deleting supplier...');
        await invoke('deleteSupplier', id);
        if (state.selectedLedgerSupplierId === id) {
          state.selectedLedgerSupplierId = '';
        }
        await reloadData();
        showToast('Supplier deleted');
        setStatus('Live');
      } catch (error) {
        setStatus('Live');
        showToast(error.message, 'error');
      }
    }
  });

  dom.ledgerSupplierSelect.addEventListener('change', async () => {
    state.selectedLedgerSupplierId = dom.ledgerSupplierSelect.value;
    await loadSupplierLedger();
  });

  dom.supplierPaymentBtn.addEventListener('click', async () => {
    const supplierId = state.selectedLedgerSupplierId || dom.ledgerSupplierSelect.value;
    const amount = dom.supplierPaymentAmount.value;
    const paymentMethod = normalizePaymentMethod(dom.supplierPaymentMethod.value);
    const notes = dom.supplierPaymentNotes.value;

    if (!supplierId) {
      showToast('Select a supplier for payment', 'error');
      return;
    }

    try {
      setStatus('Recording supplier payment...');
      const payment = await invoke('createSupplierPayment', {
        supplierId,
        amount,
        paymentMethod,
        notes
      });

      dom.supplierPaymentAmount.value = '';
      dom.supplierPaymentMethod.value = 'cash';
      dom.supplierPaymentNotes.value = '';

      await reloadData();
      showToast(`Payment ${payment.paymentNo} recorded`);
      setStatus('Live');
    } catch (error) {
      setStatus('Live');
      showToast(error.message, 'error');
    }
  });
}

function bindPurchases() {
  if (dom.openPurchaseSupplierModalBtn) {
    dom.openPurchaseSupplierModalBtn.addEventListener('click', () => {
      openPurchaseSupplierModal();
    });
  }

  if (dom.openPurchaseProductModalBtn) {
    dom.openPurchaseProductModalBtn.addEventListener('click', () => {
      openPurchaseProductModal();
    });
  }

  if (dom.purchaseSupplierCancelBtn) {
    dom.purchaseSupplierCancelBtn.addEventListener('click', () => {
      closePurchaseSupplierModal();
    });
  }

  if (dom.purchaseProductCancelBtn) {
    dom.purchaseProductCancelBtn.addEventListener('click', () => {
      closePurchaseProductModal();
    });
  }

  if (dom.purchaseSupplierModal) {
    dom.purchaseSupplierModal.addEventListener('close', () => {
      dom.purchaseBarcodeInput.focus();
    });
  }

  if (dom.purchaseProductModal) {
    dom.purchaseProductModal.addEventListener('close', () => {
      dom.purchaseBarcodeInput.focus();
    });
  }

  if (dom.purchaseProductPackEnabled) {
    dom.purchaseProductPackEnabled.addEventListener('change', syncPurchaseProductPackFields);
    dom.purchaseProductPackSize.addEventListener('input', syncPurchaseProductPackFields);
    dom.purchaseProductRetailPrice.addEventListener('input', syncPurchaseProductPackFields);
    syncPurchaseProductPackFields();
  }

  if (dom.purchaseUnknownProductPackEnabled) {
    dom.purchaseUnknownProductPackEnabled.addEventListener('change', syncPurchaseUnknownPackFields);
    dom.purchaseUnknownProductPackSize.addEventListener('input', syncPurchaseUnknownPackFields);
    dom.purchaseUnknownProductRetailPrice.addEventListener('input', syncPurchaseUnknownPackFields);
    syncPurchaseUnknownPackFields();
  }

  dom.purchaseGstEnabled.addEventListener('change', () => {
    dom.purchaseGstRate.disabled = !dom.purchaseGstEnabled.checked;
    if (!dom.purchaseGstEnabled.checked) {
      dom.purchaseGstRate.value = '0';
    }
    renderPurchaseDraftItems();
  });

  [dom.purchaseGstRate, dom.purchaseDiscount, dom.purchasePaid].forEach((input) => {
    input.addEventListener('input', () => {
      renderPurchaseTotals();
    });
  });

  dom.purchaseDraftProductId.addEventListener('change', () => {
    const product = state.products.find((entry) => entry.id === dom.purchaseDraftProductId.value);
    if (product) {
      dom.purchaseDraftCost.value = round2(toNumber(product.costPrice, product.wholesalePrice));
    }
  });

  dom.addPurchaseItemBtn.addEventListener('click', () => {
    addSelectedPurchaseProduct();
  });

  dom.purchaseBarcodeInput.addEventListener('input', () => {
    if (purchaseBarcodeTimer) {
      clearTimeout(purchaseBarcodeTimer);
      purchaseBarcodeTimer = null;
    }

    const barcode = dom.purchaseBarcodeInput.value.trim();
    if (!barcode) {
      return;
    }

    purchaseBarcodeTimer = window.setTimeout(() => {
      purchaseBarcodeTimer = null;
      processPurchaseBarcodeScan();
    }, BARCODE_SCAN_IDLE_MS);
  });

  dom.purchaseBarcodeInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') {
      return;
    }

    event.preventDefault();
    if (purchaseBarcodeTimer) {
      clearTimeout(purchaseBarcodeTimer);
      purchaseBarcodeTimer = null;
    }
    processPurchaseBarcodeScan();
  });

  if (dom.purchaseOcrBtn && dom.purchaseOcrFile) {
    dom.purchaseOcrBtn.addEventListener('click', () => {
      dom.purchaseOcrFile.click();
    });

    dom.purchaseOcrFile.addEventListener('change', async (event) => {
      const input = event.target;
      const file = input && input.files && input.files[0] ? input.files[0] : null;
      await runPurchaseOcr(file);
    });
  }

  if (dom.purchaseOcrCloseBtn) {
    dom.purchaseOcrCloseBtn.addEventListener('click', () => {
      closePurchaseOcrModal();
      dom.purchaseBarcodeInput.focus();
    });
  }

  if (dom.purchaseOcrApplyBtn) {
    dom.purchaseOcrApplyBtn.addEventListener('click', () => {
      applyPurchaseOcrToNotes();
    });
  }

  if (dom.purchaseOcrAddItemsBtn) {
    dom.purchaseOcrAddItemsBtn.addEventListener('click', () => {
      applyPurchaseOcrToDraft();
    });
  }

  if (dom.purchaseOcrModal) {
    dom.purchaseOcrModal.addEventListener('close', () => {
      dom.purchaseBarcodeInput.focus();
    });
  }

  [dom.purchaseDraftQty, dom.purchaseDraftCost].forEach((input) => {
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        addSelectedPurchaseProduct();
      }
    });
  });

  dom.purchaseDraftItemsBody.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-remove-index]');
    if (!button) {
      return;
    }

    const index = Number(button.dataset.removeIndex);
    if (Number.isNaN(index)) {
      return;
    }

    state.purchaseDraftItems.splice(index, 1);
    renderPurchaseDraftItems();
  });

  dom.purchaseDraftItemsBody.addEventListener('change', (event) => {
    const qtyInput = event.target.closest('input[data-qty-index]');
    const costInput = event.target.closest('input[data-cost-index]');

    if (!qtyInput && !costInput) {
      return;
    }

    if (qtyInput) {
      const index = Number(qtyInput.dataset.qtyIndex);
      const qty = round2(toNumber(qtyInput.value, NaN));
      if (Number.isNaN(index) || !state.purchaseDraftItems[index]) {
        return;
      }

      if (!Number.isFinite(qty) || qty <= 0) {
        showToast('Quantity must be greater than 0', 'error');
        renderPurchaseDraftItems();
        return;
      }

      state.purchaseDraftItems[index].qty = qty;
      renderPurchaseDraftItems();
      return;
    }

    if (costInput) {
      const index = Number(costInput.dataset.costIndex);
      const unitCost = round2(toNumber(costInput.value, NaN));
      if (Number.isNaN(index) || !state.purchaseDraftItems[index]) {
        return;
      }

      if (!Number.isFinite(unitCost) || unitCost <= 0) {
        showToast('Unit cost must be greater than 0', 'error');
        renderPurchaseDraftItems();
        return;
      }

      state.purchaseDraftItems[index].unitCost = unitCost;
      renderPurchaseDraftItems();
    }
  });

  dom.purchaseSubmitBtn.addEventListener('click', async () => {
    if (!dom.purchaseSupplier.value) {
      showToast('Select a supplier', 'error');
      return;
    }

    if (state.purchaseDraftItems.length === 0) {
      showToast('Add at least one purchase item', 'error');
      return;
    }

    const payload = {
      supplierId: dom.purchaseSupplier.value,
      gstEnabled: dom.purchaseGstEnabled.checked,
      gstRate: dom.purchaseGstRate.value,
      discount: dom.purchaseDiscount.value,
      paidAmount: dom.purchasePaid.value,
      paidMethod: normalizePaymentMethod(dom.purchasePaidMethod.value),
      notes: dom.purchaseNotes.value,
      items: state.purchaseDraftItems.map((item) => ({
        productId: item.productId,
        qty: item.qty,
        unitCost: item.unitCost
      }))
    };

    try {
      const isEdit = Boolean(state.editingPurchaseId);
      const method = isEdit ? 'updatePurchase' : 'createPurchase';
      const actionText = isEdit ? 'Updating purchase...' : 'Creating purchase...';
      const requestPayload = isEdit
        ? {
            ...payload,
            id: state.editingPurchaseId
          }
        : payload;

      setStatus(actionText);
      const purchase = await invoke(method, requestPayload);
      clearPurchaseDraft();
      await reloadData();
      showToast(
        isEdit
          ? `Purchase ${purchase.purchaseNo} updated`
          : `Purchase ${purchase.purchaseNo} created`
      );
      setStatus('Live');
    } catch (error) {
      setStatus('Live');
      showToast(error.message, 'error');
    }
  });

  if (dom.purchaseCancelEditBtn) {
    dom.purchaseCancelEditBtn.addEventListener('click', () => {
      clearPurchaseDraft();
      dom.purchaseBarcodeInput.focus();
    });
  }

  dom.purchaseSearch.addEventListener('input', () => {
    state.purchaseSearch = dom.purchaseSearch.value.trim().toLowerCase();
    renderPurchases();
  });

  dom.purchasesBody.addEventListener('click', (event) => {
    const editBtn = event.target.closest('button[data-edit-purchase-id]');
    if (!editBtn) {
      return;
    }

    const purchase = state.purchases.find((entry) => entry.id === editBtn.dataset.editPurchaseId);
    if (!purchase) {
      showToast('Purchase not found', 'error');
      return;
    }

    startPurchaseEdit(purchase);
  });

  dom.purchaseSupplierForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const payload = {
      name: dom.purchaseSupplierName.value,
      phone: dom.purchaseSupplierPhone.value,
      gstin: dom.purchaseSupplierGstin.value,
      address: dom.purchaseSupplierAddress.value
    };

    try {
      setStatus('Saving supplier...');
      const supplier = await invoke('upsertSupplier', payload);

      state.selectedLedgerSupplierId = supplier.id;
      await reloadData();
      if (state.suppliers.some((entry) => entry.id === supplier.id)) {
        dom.purchaseSupplier.value = supplier.id;
      }

      resetPurchaseSupplierForm();
      closePurchaseSupplierModal();
      showToast(`Supplier ${supplier.name} saved`);
      setStatus('Ready');
      dom.purchaseNotes.focus();
    } catch (error) {
      setStatus('Ready');
      showToast(error.message, 'error');
    }
  });

  dom.purchaseProductForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    try {
      setStatus('Saving new product...');
      const product = await createQuickPurchaseProduct({
        name: dom.purchaseProductName.value,
        barcode: dom.purchaseProductBarcode.value,
        category: dom.purchaseProductCategory.value,
        unit: dom.purchaseProductUnit.value,
        packEnabled: dom.purchaseProductPackEnabled.checked,
        packSize: dom.purchaseProductPackSize.value,
        packPrice: dom.purchaseProductPackPrice.value,
        costPrice: dom.purchaseProductCostPrice.value,
        retailPrice: dom.purchaseProductRetailPrice.value,
        wholesalePrice: dom.purchaseProductWholesalePrice.value,
        wholesaleMinQty: dom.purchaseProductWholesaleMinQty.value,
        reorderLevel: dom.purchaseProductReorderLevel.value
      });
      resetPurchaseProductForm();
      closePurchaseProductModal();

      showToast(`Product ${product.name} added with stock 0`);
      setStatus('Ready');
      dom.purchaseDraftQty.focus();
    } catch (error) {
      setStatus('Ready');
      showToast(error.message, 'error');
    }
  });

  if (dom.purchaseUnknownCancelBtn) {
    dom.purchaseUnknownCancelBtn.addEventListener('click', () => {
      closePurchaseUnknownBarcodeModal();
    });
  }

  if (dom.purchaseUnknownBarcodeModal) {
    dom.purchaseUnknownBarcodeModal.addEventListener('close', () => {
      state.pendingPurchaseBarcode = '';
      dom.purchaseBarcodeInput.value = '';
      dom.purchaseBarcodeInput.focus();
    });
  }

  if (dom.purchaseUnknownProductForm) {
    dom.purchaseUnknownProductForm.addEventListener('submit', async (event) => {
      event.preventDefault();

      const barcode = dom.purchaseUnknownBarcodeValue.value.trim();
      if (!barcode) {
        showToast('Barcode is required', 'error');
        dom.purchaseUnknownProductName.focus();
        return;
      }

      try {
        setStatus('Saving new product...');
        const product = await createQuickPurchaseProduct(
          {
            name: dom.purchaseUnknownProductName.value,
            barcode,
            category: dom.purchaseUnknownProductCategory.value,
            unit: dom.purchaseUnknownProductUnit.value,
            packEnabled: dom.purchaseUnknownProductPackEnabled.checked,
            packSize: dom.purchaseUnknownProductPackSize.value,
            packPrice: dom.purchaseUnknownProductPackPrice.value,
            costPrice: dom.purchaseUnknownProductCostPrice.value,
            retailPrice: dom.purchaseUnknownProductRetailPrice.value,
            wholesalePrice: dom.purchaseUnknownProductWholesalePrice.value,
            wholesaleMinQty: dom.purchaseUnknownProductWholesaleMinQty.value,
            reorderLevel: dom.purchaseUnknownProductReorderLevel.value
          },
          {
            autoAddToDraft: true,
            qty: 1
          }
        );

        closePurchaseUnknownBarcodeModal();
        showToast(`Product ${product.name} added and included in purchase`);
        setStatus('Ready');
      } catch (error) {
        setStatus('Ready');
        showToast(error.message, 'error');
      }
    });
  }
}

function bindExpenses() {
  dom.expenseForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const payload = {
      category: dom.expenseCategory.value,
      amount: dom.expenseAmount.value,
      paymentMethod: normalizePaymentMethod(dom.expensePaymentMethod.value),
      expenseDate: dom.expenseDate.value,
      paidTo: dom.expensePaidTo.value,
      notes: dom.expenseNotes.value
    };

    try {
      const isEdit = Boolean(state.editingExpenseId);
      const method = isEdit ? 'updateExpense' : 'createExpense';
      const actionText = isEdit ? 'Updating expense...' : 'Recording expense...';
      const requestPayload = isEdit
        ? {
            ...payload,
            id: state.editingExpenseId
          }
        : payload;

      setStatus(actionText);
      const expense = await invoke(method, requestPayload);

      resetExpenseForm();

      await reloadData();
      showToast(
        isEdit
          ? `Expense ${expense.expenseNo} updated`
          : `Expense ${expense.expenseNo} recorded`
      );
      setStatus('Live');
      dom.expenseAmount.focus();
    } catch (error) {
      setStatus('Live');
      showToast(error.message, 'error');
    }
  });

  dom.expenseSearch.addEventListener('input', () => {
    state.expenseSearch = dom.expenseSearch.value.trim().toLowerCase();
    renderExpenses();
  });

  if (dom.expenseCancelEditBtn) {
    dom.expenseCancelEditBtn.addEventListener('click', () => {
      resetExpenseForm();
      dom.expenseAmount.focus();
    });
  }

  dom.expensesBody.addEventListener('click', (event) => {
    const editBtn = event.target.closest('button[data-edit-expense-id]');
    if (!editBtn) {
      return;
    }

    const expense = state.expenses.find((entry) => entry.id === editBtn.dataset.editExpenseId);
    if (!expense) {
      showToast('Expense not found', 'error');
      return;
    }

    startExpenseEdit(expense);
  });
}

function triggerThermalInvoiceAutoPrint(invoice) {
  if (!invoice || !invoice.id) {
    return;
  }

  const uiSettings = normalizeUiSettingsForUi(state.uiSettings);
  if (!uiSettings.thermalAutoPrintEnabled) {
    return;
  }

  invoke('autoPrintInvoiceThermal', {
    invoiceId: invoice.id,
    printerName: uiSettings.thermalPrinterName
  }).catch((error) => {
    showToast(`Thermal print failed: ${error.message}`, 'error');
  });
}

function bindBilling() {
  if (dom.openBillingCustomerModalBtn) {
    dom.openBillingCustomerModalBtn.addEventListener('click', () => {
      openBillingCustomerModal();
    });
  }

  if (dom.billingCustomerCancelBtn) {
    dom.billingCustomerCancelBtn.addEventListener('click', () => {
      closeBillingCustomerModal();
    });
  }

  if (dom.billingCustomerModal) {
    dom.billingCustomerModal.addEventListener('close', () => {
      dom.invoiceCustomer.focus();
    });
  }

  dom.invoiceChannel.addEventListener('change', () => {
    if (dom.invoiceChannel.value === 'retail') {
      state.invoicePaidTouched = false;
    }
    syncBillingQuickCustomerType();
    renderBillingCustomerOptions();
    renderDraftItems();
  });

  dom.invoiceGstEnabled.addEventListener('change', () => {
    dom.invoiceGstRate.disabled = !dom.invoiceGstEnabled.checked;
    if (!dom.invoiceGstEnabled.checked) {
      dom.invoiceGstRate.value = '0';
    }
    renderDraftItems();
  });

  [dom.invoiceGstRate, dom.invoiceDiscount].forEach((input) => {
    input.addEventListener('input', () => {
      renderDraftTotals();
    });
  });

  dom.invoicePaid.addEventListener('input', () => {
    const hasValue = dom.invoicePaid.value.trim().length > 0;
    state.invoicePaidTouched = hasValue;
    renderDraftTotals();
  });

  dom.addItemBtn.addEventListener('click', () => {
    addSelectedProductToDraft();
  });

  dom.draftProductId.addEventListener('change', () => {
    const product = state.products.find((entry) => entry.id === dom.draftProductId.value) || null;
    renderBillingSaleUnitOptions(product);
  });

  dom.billingProductSearch.addEventListener('input', () => {
    state.billingProductSearch = dom.billingProductSearch.value.trim().toLowerCase();
    renderBillingProductOptions();
  });

  dom.billingProductSearch.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') {
      return;
    }
    event.preventDefault();
    addSelectedProductToDraft();
  });

  dom.draftQty.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addSelectedProductToDraft();
    }
  });

  const syncTouchPaidToInvoice = (nextValue) => {
    if (!dom.touchPosPaid) {
      return;
    }
    dom.touchPosPaid.value = String(nextValue === undefined || nextValue === null ? '' : nextValue);
    dom.invoicePaid.value = dom.touchPosPaid.value;
    dom.invoicePaid.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const currentInvoiceTotal = () =>
    round2(toNumber(String(dom.totalValue.textContent || '').replace(/[^0-9.-]/g, ''), 0));

  if (dom.touchPosChannel) {
    dom.touchPosChannel.addEventListener('change', () => {
      dom.invoiceChannel.value = dom.touchPosChannel.value;
      dom.invoiceChannel.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  if (dom.touchPosCustomer) {
    dom.touchPosCustomer.addEventListener('change', () => {
      dom.invoiceCustomer.value = dom.touchPosCustomer.value;
      renderDraftItems();
    });
  }

  if (dom.touchPosSearch) {
    dom.touchPosSearch.addEventListener('input', () => {
      state.billingProductSearch = dom.touchPosSearch.value.trim().toLowerCase();
      dom.billingProductSearch.value = dom.touchPosSearch.value;
      renderBillingProductOptions();
    });

    dom.touchPosSearch.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') {
        return;
      }
      event.preventDefault();
      const firstProduct = getTouchPosFilteredProducts()[0];
      if (!firstProduct) {
        return;
      }
      const qty = round2(toNumber(dom.touchPosQty && dom.touchPosQty.value, 1));
      const saleUnit = normalizeSaleUnit(dom.touchPosSaleUnit && dom.touchPosSaleUnit.value);
      addBillingProductToDraft(firstProduct, qty, saleUnit);
    });
  }

  if (dom.touchPosDiscount) {
    dom.touchPosDiscount.addEventListener('input', () => {
      dom.invoiceDiscount.value = dom.touchPosDiscount.value;
      dom.invoiceDiscount.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  if (dom.touchPosPaymentMethod) {
    dom.touchPosPaymentMethod.addEventListener('change', () => {
      dom.invoicePaidMethod.value = normalizePaymentMethod(dom.touchPosPaymentMethod.value);
    });
  }

  if (dom.touchPosPaid) {
    dom.touchPosPaid.addEventListener('input', () => {
      syncTouchPaidToInvoice(dom.touchPosPaid.value);
    });
  }

  const isTouchPosDigitKey = (value) => /^[0-9]$/.test(value) || value === '00';
  const shouldResetTouchPaidOnDigit = (currentText, key) =>
    isTouchPosDigitKey(key) && /^\d+\.\d{2}$/.test(String(currentText || ''));

  if (dom.touchPosKeypad) {
    dom.touchPosKeypad.addEventListener('click', (event) => {
      const key = event.target.closest('button[data-key]')?.dataset.key;
      if (!key) {
        return;
      }

      const currentText = dom.touchPosPaid ? dom.touchPosPaid.value.trim() : '';
      if (key === 'back') {
        syncTouchPaidToInvoice(currentText.slice(0, -1));
        return;
      }
      if (key === 'clear') {
        syncTouchPaidToInvoice('');
        return;
      }
      if (key === 'full') {
        syncTouchPaidToInvoice(currentInvoiceTotal().toFixed(2));
        return;
      }
      if (key === '+10' || key === '+50' || key === '+100') {
        const increment = Number(key.slice(1));
        const nextValue = round2(toNumber(currentText, 0) + increment);
        syncTouchPaidToInvoice(nextValue.toFixed(2));
        return;
      }

      if (shouldResetTouchPaidOnDigit(currentText, key)) {
        syncTouchPaidToInvoice(key === '00' ? '0' : key);
        return;
      }

      if (key === '.') {
        if (currentText.includes('.')) {
          return;
        }
        syncTouchPaidToInvoice(currentText ? `${currentText}.` : '0.');
        return;
      }

      syncTouchPaidToInvoice(`${currentText}${key}`);
    });
  }

  if (dom.touchPosBarcode) {
    dom.touchPosBarcode.addEventListener('input', () => {
      if (touchPosBarcodeTimer) {
        clearTimeout(touchPosBarcodeTimer);
        touchPosBarcodeTimer = null;
      }

      const barcode = dom.touchPosBarcode.value.trim();
      if (!barcode) {
        return;
      }

      touchPosBarcodeTimer = window.setTimeout(() => {
        touchPosBarcodeTimer = null;
        const qty = round2(toNumber(dom.touchPosQty && dom.touchPosQty.value, 1));
        const saleUnit = normalizeSaleUnit(dom.touchPosSaleUnit && dom.touchPosSaleUnit.value);
        const added = processBillingBarcodeValue(barcode, { qty, saleUnit });
        if (added) {
          dom.touchPosBarcode.value = '';
          dom.touchPosBarcode.focus();
        }
      }, BARCODE_SCAN_IDLE_MS);
    });

    dom.touchPosBarcode.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') {
        return;
      }
      event.preventDefault();
      if (touchPosBarcodeTimer) {
        clearTimeout(touchPosBarcodeTimer);
        touchPosBarcodeTimer = null;
      }
      const barcode = dom.touchPosBarcode.value.trim();
      const qty = round2(toNumber(dom.touchPosQty && dom.touchPosQty.value, 1));
      const saleUnit = normalizeSaleUnit(dom.touchPosSaleUnit && dom.touchPosSaleUnit.value);
      const added = processBillingBarcodeValue(barcode, { qty, saleUnit });
      if (added) {
        dom.touchPosBarcode.value = '';
        dom.touchPosBarcode.focus();
      }
    });
  }

  if (dom.touchPosCategoryList) {
    dom.touchPosCategoryList.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-touch-category]');
      if (!button) {
        return;
      }
      state.touchPosCategory = button.dataset.touchCategory || 'all';
      renderTouchPosWorkspace();
    });
  }

  if (dom.touchPosProductGrid) {
    dom.touchPosProductGrid.addEventListener('click', (event) => {
      const card = event.target.closest('button[data-touch-product-id]');
      if (!card) {
        return;
      }
      const product = state.products.find((entry) => entry.id === card.dataset.touchProductId);
      if (!product) {
        return;
      }
      const qty = round2(toNumber(dom.touchPosQty && dom.touchPosQty.value, 1));
      const saleUnit = normalizeSaleUnit(dom.touchPosSaleUnit && dom.touchPosSaleUnit.value);
      addBillingProductToDraft(product, qty, saleUnit);
    });
  }

  if (dom.touchPosCartLines) {
    dom.touchPosCartLines.addEventListener('click', (event) => {
      const removeButton = event.target.closest('button[data-touch-line-remove]');
      if (removeButton) {
        const index = Number(removeButton.dataset.touchLineRemove);
        if (!Number.isNaN(index) && state.draftItems[index]) {
          state.draftItems.splice(index, 1);
          renderDraftItems();
        }
        return;
      }

      const incButton = event.target.closest('button[data-touch-line-inc]');
      if (incButton) {
        const index = Number(incButton.dataset.touchLineInc);
        if (!Number.isNaN(index) && state.draftItems[index]) {
          updateDraftItemQuantity(index, round2(state.draftItems[index].qty + 1));
        }
        return;
      }

      const decButton = event.target.closest('button[data-touch-line-dec]');
      if (decButton) {
        const index = Number(decButton.dataset.touchLineDec);
        if (Number.isNaN(index) || !state.draftItems[index]) {
          return;
        }
        const nextQty = round2(state.draftItems[index].qty - 1);
        if (nextQty <= 0) {
          state.draftItems.splice(index, 1);
          renderDraftItems();
          return;
        }
        updateDraftItemQuantity(index, nextQty);
      }
    });
  }

  if (dom.touchPosClearBtn) {
    dom.touchPosClearBtn.addEventListener('click', () => {
      clearInvoiceDraft();
    });
  }

  if (dom.touchPosCreateBtn) {
    dom.touchPosCreateBtn.addEventListener('click', () => {
      dom.invoiceSubmitBtn.click();
    });
  }

  dom.barcodeInput.addEventListener('input', () => {
    if (billingBarcodeTimer) {
      clearTimeout(billingBarcodeTimer);
      billingBarcodeTimer = null;
    }

    const barcode = dom.barcodeInput.value.trim();
    if (!barcode) {
      return;
    }

    billingBarcodeTimer = window.setTimeout(() => {
      billingBarcodeTimer = null;
      processBillingBarcodeScan();
    }, BARCODE_SCAN_IDLE_MS);
  });

  dom.barcodeInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') {
      return;
    }

    event.preventDefault();
    if (billingBarcodeTimer) {
      clearTimeout(billingBarcodeTimer);
      billingBarcodeTimer = null;
    }
    processBillingBarcodeScan();
  });

  dom.draftItemsBody.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-remove-index]');
    if (!button) {
      return;
    }

    const index = Number(button.dataset.removeIndex);
    if (Number.isNaN(index)) {
      return;
    }

    state.draftItems.splice(index, 1);
    renderDraftItems();
  });

  dom.draftItemsBody.addEventListener('change', (event) => {
    const input = event.target.closest('input[data-qty-index]');
    if (!input) {
      return;
    }

    const index = Number(input.dataset.qtyIndex);
    updateDraftItemQuantity(index, input.value);
  });

  dom.billingCustomerForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const payload = {
      name: dom.billingCustomerName.value,
      type: dom.billingCustomerType.value,
      phone: dom.billingCustomerPhone.value,
      address: dom.billingCustomerAddress.value,
      gstin: dom.billingCustomerGstin.value
    };

    try {
      setStatus('Saving customer...');
      const customer = await invoke('upsertCustomer', payload);
      await reloadData();

      if (dom.invoiceChannel.value === 'wholesale' && customer.type !== 'wholesale') {
        showToast('Retail customer saved. Switch channel to Retail to use it.', 'info');
      } else if (state.customers.some((entry) => entry.id === customer.id)) {
        dom.invoiceCustomer.value = customer.id;
      }

      resetBillingCustomerForm();
      closeBillingCustomerModal();
      showToast(`Customer ${customer.name} saved`);
      setStatus('Ready');
      dom.invoiceCustomer.focus();
    } catch (error) {
      setStatus('Ready');
      showToast(error.message, 'error');
    }
  });

  dom.invoiceSubmitBtn.addEventListener('click', async () => {
    if (state.draftItems.length === 0) {
      showToast('Add at least one item before creating invoice', 'error');
      return;
    }

    if (dom.invoiceChannel.value === 'wholesale' && !dom.invoiceCustomer.value) {
      showToast('Select a wholesale customer', 'error');
      return;
    }

    const payload = {
      channel: dom.invoiceChannel.value,
      customerId: dom.invoiceCustomer.value || null,
      gstEnabled: dom.invoiceGstEnabled.checked,
      gstRate: dom.invoiceGstRate.value,
      discount: dom.invoiceDiscount.value,
      paidAmount: dom.invoicePaid.value,
      paidMethod: normalizePaymentMethod(dom.invoicePaidMethod.value),
      notes: dom.invoiceNotes.value,
      items: state.draftItems.map((item) => ({
        productId: item.productId,
        qty: item.qty,
        saleUnit: normalizeSaleUnit(item.saleUnit)
      }))
    };

    try {
      const isEdit = Boolean(state.editingInvoiceId);
      const method = isEdit ? 'updateInvoice' : 'createInvoice';
      const actionText = isEdit ? 'Updating invoice...' : 'Creating invoice...';
      const requestPayload = isEdit
        ? {
            ...payload,
            id: state.editingInvoiceId
          }
        : payload;

      setStatus(actionText);
      const invoice = await invoke(method, requestPayload);

      clearInvoiceDraft();
      await reloadData();
      if (!isEdit) {
        triggerThermalInvoiceAutoPrint(invoice);
      }
      showToast(
        isEdit
          ? `Invoice ${invoice.invoiceNo} updated successfully`
          : `Invoice ${invoice.invoiceNo} created successfully`
      );
      focusBillingScannerInput();
      setStatus('Live');
    } catch (error) {
      setStatus('Live');
      showToast(error.message, 'error');
    }
  });

  if (dom.invoiceCancelEditBtn) {
    dom.invoiceCancelEditBtn.addEventListener('click', () => {
      clearInvoiceDraft();
      focusBillingScannerInput();
    });
  }
}

function openDialog(modal) {
  if (!modal) {
    return false;
  }

  if (typeof modal.showModal === 'function') {
    if (!modal.open) {
      modal.showModal();
    }
  } else {
    modal.setAttribute('open', 'open');
  }

  return true;
}

function closeDialog(modal) {
  if (!modal || !modal.open) {
    return;
  }

  if (typeof modal.close === 'function') {
    modal.close();
  } else {
    modal.removeAttribute('open');
  }
}

function openPurchaseSupplierModal() {
  resetPurchaseSupplierForm();
  if (!openDialog(dom.purchaseSupplierModal)) {
    return;
  }
  dom.purchaseSupplierName.focus();
}

function closePurchaseSupplierModal() {
  closeDialog(dom.purchaseSupplierModal);
}

function openPurchaseProductModal() {
  resetPurchaseProductForm();
  if (!openDialog(dom.purchaseProductModal)) {
    return;
  }
  dom.purchaseProductName.focus();
}

function closePurchaseProductModal() {
  closeDialog(dom.purchaseProductModal);
}

function openBillingCustomerModal() {
  resetBillingCustomerForm();
  if (!openDialog(dom.billingCustomerModal)) {
    return;
  }
  dom.billingCustomerName.focus();
}

function closeBillingCustomerModal() {
  closeDialog(dom.billingCustomerModal);
}

function closeInvoicePaymentModal() {
  const modal = dom.invoicePaymentModal;
  if (!modal || !modal.open) {
    return;
  }

  if (typeof modal.close === 'function') {
    modal.close();
  } else {
    modal.removeAttribute('open');
  }
}

function openInvoicePaymentModal(invoice) {
  const modal = dom.invoicePaymentModal;
  if (!modal) {
    return false;
  }

  const pending = getInvoicePendingAmount(invoice);
  dom.invoicePaymentInvoiceId.value = invoice.id;
  dom.invoicePaymentMeta.textContent = `${invoice.invoiceNo} • ${invoice.customerSnapshot.name} • Pending ${formatMoney(
    pending
  )}`;
  dom.invoicePaymentPending.value = formatMoney(pending);
  dom.invoicePaymentAmount.value = pending.toFixed(2);
  dom.invoicePaymentMethod.value = normalizePaymentMethod(invoice.paidMethod || 'cash');
  dom.invoicePaymentNote.value = '';

  if (typeof modal.showModal === 'function') {
    if (!modal.open) {
      modal.showModal();
    }
  } else {
    modal.setAttribute('open', 'open');
  }

  dom.invoicePaymentAmount.focus();
  dom.invoicePaymentAmount.select();
  return true;
}

async function submitInvoicePayment(invoice, amountInput, paymentMethodInput, noteInput) {
  if (!invoice) {
    showToast('Invoice not found', 'error');
    return false;
  }

  const maxAmount = getInvoicePendingAmount(invoice);
  if (maxAmount <= 0) {
    showToast('Invoice is already fully paid', 'info');
    return false;
  }

  const amount = round2(toNumber(amountInput, NaN));
  const paymentMethod = normalizePaymentMethod(paymentMethodInput);
  if (!Number.isFinite(amount) || amount <= 0) {
    showToast('Enter a valid payment amount', 'error');
    return false;
  }

  if (amount > maxAmount) {
    showToast('Payment cannot exceed pending balance', 'error');
    return false;
  }

  try {
    setStatus('Recording invoice payment...');
    const updated = await invoke('recordInvoicePayment', {
      invoiceId: invoice.id,
      amount,
      paymentMethod,
      note: String(noteInput || '').trim()
    });
    await reloadData();
    closeInvoicePaymentModal();
    const remaining = getInvoicePendingAmount(updated);
    if (remaining > 0) {
      showToast(`${updated.invoiceNo} partial payment recorded (${formatMoney(remaining)} pending)`);
    } else {
      showToast(`${updated.invoiceNo} payment completed`);
    }
    setStatus('Live');
    return true;
  } catch (error) {
    setStatus('Live');
    showToast(error.message, 'error');
    return false;
  }
}

function bindInvoices() {
  dom.invoiceSearch.addEventListener('input', () => {
    state.invoiceSearch = dom.invoiceSearch.value.trim().toLowerCase();
    renderInvoices();
  });

  if (dom.invoicePaymentModal && dom.invoicePaymentForm) {
    dom.invoicePaymentCancelBtn.addEventListener('click', () => {
      closeInvoicePaymentModal();
    });

    dom.invoicePaymentFullBtn.addEventListener('click', async () => {
      const invoiceId = dom.invoicePaymentInvoiceId.value;
      const invoice = state.invoices.find((entry) => entry.id === invoiceId);
      if (!invoice) {
        showToast('Invoice not found', 'error');
        return;
      }

      await submitInvoicePayment(
        invoice,
        getInvoicePendingAmount(invoice),
        dom.invoicePaymentMethod.value,
        dom.invoicePaymentNote.value
      );
    });

    dom.invoicePaymentForm.addEventListener('submit', async (event) => {
      event.preventDefault();

      const invoiceId = dom.invoicePaymentInvoiceId.value;
      const invoice = state.invoices.find((entry) => entry.id === invoiceId);
      if (!invoice) {
        showToast('Invoice not found', 'error');
        return;
      }

      await submitInvoicePayment(
        invoice,
        dom.invoicePaymentAmount.value,
        dom.invoicePaymentMethod.value,
        dom.invoicePaymentNote.value
      );
    });
  }

  dom.invoicesBody.addEventListener('click', async (event) => {
    const editBtn = event.target.closest('button[data-edit-invoice-id]');
    if (editBtn) {
      const invoice = state.invoices.find((entry) => entry.id === editBtn.dataset.editInvoiceId);
      if (!invoice) {
        showToast('Invoice not found', 'error');
        return;
      }

      startInvoiceEdit(invoice);
      return;
    }

    const paymentBtn = event.target.closest('button[data-pay-id]');
    if (paymentBtn) {
      const invoiceId = paymentBtn.dataset.payId;
      const invoice = state.invoices.find((entry) => entry.id === invoiceId);
      if (!invoice) {
        showToast('Invoice not found', 'error');
        return;
      }

      const maxAmount = getInvoicePendingAmount(invoice);
      if (maxAmount <= 0) {
        showToast('Invoice is already fully paid', 'info');
        return;
      }

      if (openInvoicePaymentModal(invoice)) {
        return;
      }

      const promptValue = window.prompt(
        `Enter payment amount for ${invoice.invoiceNo} (Pending: ${formatMoney(maxAmount)})`,
        String(maxAmount)
      );
      if (promptValue === null) {
        return;
      }
      await submitInvoicePayment(invoice, promptValue, 'cash', '');
      return;
    }

    const previewBtn = event.target.closest('button[data-preview-id]');
    if (previewBtn) {
      try {
        setStatus('Opening invoice preview...');
        await invoke('previewInvoice', previewBtn.dataset.previewId, { mode: 'a4' });
        showToast('Invoice preview opened');
        setStatus('Live');
      } catch (error) {
        setStatus('Live');
        showToast(error.message, 'error');
      }
      return;
    }

    const thermalPreviewBtn = event.target.closest('button[data-preview-thermal-id]');
    if (thermalPreviewBtn) {
      try {
        setStatus('Opening thermal preview...');
        await invoke('previewInvoice', thermalPreviewBtn.dataset.previewThermalId, { mode: 'thermal' });
        showToast('Thermal receipt preview opened');
        setStatus('Live');
      } catch (error) {
        setStatus('Live');
        showToast(error.message, 'error');
      }
      return;
    }

    const printBtn = event.target.closest('button[data-print-id]');
    if (printBtn) {
      const invoiceId = printBtn.dataset.printId;

      try {
        setStatus('Opening print dialog...');
        const result = await invoke('printInvoice', invoiceId);

        if (result.printed) {
          showToast('Invoice sent to printer');
        } else {
          showToast(result.reason || 'Print cancelled', 'info');
        }

        setStatus('Live');
      } catch (error) {
        setStatus('Live');
        showToast(error.message, 'error');
      }
    }
  });
}

function bindReports() {
  dom.reportRefreshBtn.addEventListener('click', async () => {
    await loadReports(dom.reportDate.value, dom.reportPeriod.value);
  });

  dom.reportDate.addEventListener('change', async () => {
    await loadReports(dom.reportDate.value, dom.reportPeriod.value);
  });

  dom.reportPeriod.addEventListener('change', async () => {
    state.reportPeriod = normalizeReportPeriod(dom.reportPeriod.value);
    await loadReports(dom.reportDate.value, state.reportPeriod);
  });
}

function switchView(view) {
  state.currentView = view;
  const effectiveMode = resolveUiModeForView(view);
  applyUiMode(effectiveMode);
  const isTouchMode = effectiveMode === 'touch';

  document.querySelectorAll('.view').forEach((section) => {
    section.classList.toggle('active', section.id === `view-${view}`);
  });

  document.querySelectorAll('.nav-btn').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === view);
  });

  const titles = {
    dashboard: 'Dashboard',
    products: 'Products',
    customers: 'Customers',
    suppliers: 'Suppliers',
    purchases: 'Purchases',
    expenses: 'Expenses',
    billing: 'Billing',
    invoices: 'Invoices',
    reports: 'Reports',
    settings: 'Settings'
  };

  dom.viewTitle.textContent = titles[view] || 'ERPManiaC';

  if (view === 'billing') {
    focusBillingScannerInput();
  } else if (view === 'purchases' && !isTouchMode) {
    dom.purchaseBarcodeInput.focus();
  } else if (view === 'expenses' && !isTouchMode) {
    dom.expenseAmount.focus();
  } else if (view === 'settings' && dom.businessName && !isTouchMode) {
    dom.businessName.focus();
  }
}

function resetProductForm() {
  dom.productForm.reset();
  dom.productForm.querySelector('#product-id').value = '';
  dom.productForm.querySelector('#product-sku').value = '';
  setSelectValueWithFallback(dom.productForm.querySelector('#product-category'), 'General');
  setSelectValueWithFallback(dom.productForm.querySelector('#product-unit'), 'Unit');
  dom.productPackEnabled.checked = false;
  dom.productPackSize.value = '1';
  dom.productPackPrice.value = '0';
  dom.productPackSize.disabled = true;
  dom.productPackPrice.disabled = true;
  updateProductStockInputMode();
  dom.productSaveBtn.textContent = 'Save Product';
}

function resetPurchaseProductForm() {
  dom.purchaseProductForm.reset();
  setSelectValueWithFallback(dom.purchaseProductCategory, 'General');
  setSelectValueWithFallback(dom.purchaseProductUnit, 'Unit');
  dom.purchaseProductWholesaleMinQty.value = '';
  dom.purchaseProductReorderLevel.value = '';
  if (dom.purchaseProductPackEnabled) {
    dom.purchaseProductPackEnabled.checked = false;
  }
  if (dom.purchaseProductPackSize) {
    dom.purchaseProductPackSize.value = '1';
  }
  if (dom.purchaseProductPackPrice) {
    dom.purchaseProductPackPrice.value = '0';
  }
  syncPurchaseProductPackFields();
}

function resetPurchaseUnknownProductForm() {
  if (!dom.purchaseUnknownProductForm) {
    return;
  }

  dom.purchaseUnknownProductForm.reset();
  setSelectValueWithFallback(dom.purchaseUnknownProductCategory, 'General');
  setSelectValueWithFallback(dom.purchaseUnknownProductUnit, 'Unit');
  dom.purchaseUnknownProductWholesaleMinQty.value = '';
  dom.purchaseUnknownProductReorderLevel.value = '';
  if (dom.purchaseUnknownProductPackEnabled) {
    dom.purchaseUnknownProductPackEnabled.checked = false;
  }
  if (dom.purchaseUnknownProductPackSize) {
    dom.purchaseUnknownProductPackSize.value = '1';
  }
  if (dom.purchaseUnknownProductPackPrice) {
    dom.purchaseUnknownProductPackPrice.value = '0';
  }
  syncPurchaseUnknownPackFields();
}

function syncQuickPurchasePackFields(enabledInput, sizeInput, priceInput, retailPriceInput) {
  if (!enabledInput || !sizeInput || !priceInput) {
    return;
  }

  const enabled = Boolean(enabledInput.checked);
  sizeInput.disabled = !enabled;
  priceInput.disabled = !enabled;

  if (!enabled) {
    sizeInput.value = '1';
    priceInput.value = '0';
    return;
  }

  const packSize = Math.max(2, Math.trunc(toNumber(sizeInput.value, 2)));
  sizeInput.value = String(packSize);

  const retailPrice = round2(parseQuickPriceInput(retailPriceInput && retailPriceInput.value, 0));
  const currentPackPrice = round2(parseQuickPriceInput(priceInput.value, 0));
  if (!(currentPackPrice > 0)) {
    priceInput.value = round2(retailPrice * packSize).toFixed(2);
  }
}

function syncPurchaseProductPackFields() {
  syncQuickPurchasePackFields(
    dom.purchaseProductPackEnabled,
    dom.purchaseProductPackSize,
    dom.purchaseProductPackPrice,
    dom.purchaseProductRetailPrice
  );
}

function syncPurchaseUnknownPackFields() {
  syncQuickPurchasePackFields(
    dom.purchaseUnknownProductPackEnabled,
    dom.purchaseUnknownProductPackSize,
    dom.purchaseUnknownProductPackPrice,
    dom.purchaseUnknownProductRetailPrice
  );
}

function parseQuickPriceInput(value, fallback = NaN) {
  const text = String(value === undefined || value === null ? '' : value).trim();
  if (!text) {
    return fallback;
  }

  const normalized = text.replace(',', '.');
  const parsed = Number(normalized);
  if (Number.isNaN(parsed) || !Number.isFinite(parsed)) {
    return fallback;
  }

  return parsed;
}

function getPurchaseProductPayload(input) {
  const costPrice = round2(parseQuickPriceInput(input.costPrice, NaN));
  const retailPrice = round2(parseQuickPriceInput(input.retailPrice, costPrice));
  const wholesalePrice = round2(parseQuickPriceInput(input.wholesalePrice, retailPrice));
  const wholesaleMinQtyRaw = parseQuickPriceInput(input.wholesaleMinQty, NaN);
  const reorderLevelRaw = parseQuickPriceInput(input.reorderLevel, NaN);
  const packEnabled = Boolean(input.packEnabled);
  const parsedPackSize = Math.trunc(parseQuickPriceInput(input.packSize, NaN));
  const packSize = packEnabled ? Math.max(2, parsedPackSize || 2) : 1;
  const parsedPackPrice = round2(parseQuickPriceInput(input.packPrice, NaN));
  const packPrice = packEnabled
    ? round2(Number.isFinite(parsedPackPrice) && parsedPackPrice > 0 ? parsedPackPrice : retailPrice * packSize)
    : 0;

  return {
    name: input.name,
    barcode: input.barcode,
    category: input.category,
    unit: input.unit,
    costPrice,
    retailPrice,
    loosePrice: retailPrice,
    packEnabled,
    packSize,
    packPrice,
    wholesalePrice,
    wholesaleMinQty: Number.isFinite(wholesaleMinQtyRaw) ? round2(wholesaleMinQtyRaw) : '',
    stock: 0,
    reorderLevel: Number.isFinite(reorderLevelRaw) ? round2(reorderLevelRaw) : ''
  };
}

async function createQuickPurchaseProduct(input, options = {}) {
  const payload = getPurchaseProductPayload(input);
  const product = await invoke('upsertProduct', payload);
  await reloadData();

  if (state.products.some((entry) => entry.id === product.id)) {
    dom.purchaseDraftProductId.value = product.id;
  }

  const unitCost = round2(toNumber(product.costPrice, product.wholesalePrice));
  dom.purchaseDraftCost.value = unitCost;

  if (options.autoAddToDraft) {
    const qty = round2(toNumber(options.qty, 1));
    const added = addPurchaseDraftItem(product.id, qty, unitCost);
    if (added) {
      dom.purchaseDraftQty.value = '1';
    }
  }

  return product;
}

function closePurchaseUnknownBarcodeModal() {
  const modal = dom.purchaseUnknownBarcodeModal;
  if (!modal || !modal.open) {
    return;
  }

  if (typeof modal.close === 'function') {
    modal.close();
  } else {
    modal.removeAttribute('open');
  }
}

function openPurchaseUnknownBarcodeModal(barcode) {
  const modal = dom.purchaseUnknownBarcodeModal;
  if (!modal) {
    showToast(`No product found for barcode ${barcode}`, 'error');
    dom.purchaseBarcodeInput.value = '';
    dom.purchaseBarcodeInput.focus();
    return;
  }

  state.pendingPurchaseBarcode = String(barcode || '').trim();
  resetPurchaseUnknownProductForm();
  dom.purchaseUnknownBarcodeValue.value = state.pendingPurchaseBarcode;

  if (typeof modal.showModal === 'function') {
    if (!modal.open) {
      modal.showModal();
    }
  } else {
    modal.setAttribute('open', 'open');
  }

  dom.purchaseUnknownProductName.focus();
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => {
      reject(new Error('Failed to read selected file'));
    };
    reader.onload = () => {
      const output = String(reader.result || '');
      resolve(output);
    };
    reader.readAsDataURL(file);
  });
}

function closePurchaseOcrModal() {
  const modal = dom.purchaseOcrModal;
  if (!modal || !modal.open) {
    return;
  }

  if (typeof modal.close === 'function') {
    modal.close();
  } else {
    modal.removeAttribute('open');
  }
}

function openPurchaseOcrModal(payload) {
  const modal = dom.purchaseOcrModal;
  if (!modal) {
    return;
  }

  const text = String(payload && payload.text ? payload.text : '').trim();
  const confidence = round2(toNumber(payload && payload.confidence, 0));
  state.purchaseOcrText = text;
  dom.purchaseOcrText.value = text || '';
  dom.purchaseOcrMeta.textContent = text
    ? `Confidence: ${confidence.toFixed(2)}% • Use "Auto Add Items" to fill purchase draft`
    : 'No text detected. Try a clearer image.';

  if (typeof modal.showModal === 'function') {
    if (!modal.open) {
      modal.showModal();
    }
  } else {
    modal.setAttribute('open', 'open');
  }
}

function normalizeOcrTokenText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isOcrSummaryLine(line) {
  const text = normalizeOcrTokenText(line);
  if (!text || text.length < 4) {
    return true;
  }

  if (/^\d+$/.test(text)) {
    return true;
  }

  return /\b(total|subtotal|grand|gst|cgst|sgst|tax|discount|amount|invoice|bill|date|time|cash|upi|balance|change|round|phone|address|thanks)\b/i.test(
    text
  );
}

function findProductByOcrLine(line) {
  const rawLine = String(line || '').trim();
  if (!rawLine) {
    return null;
  }

  const scanTokens = rawLine.match(/[A-Za-z0-9]{4,}/g) || [];
  for (const token of scanTokens) {
    const direct = findProductByBarcodeOrSku(token);
    if (direct) {
      return direct;
    }
  }

  const normalizedLine = normalizeOcrTokenText(rawLine);
  if (!normalizedLine) {
    return null;
  }

  const lineWords = new Set(normalizedLine.split(' ').filter((word) => word.length > 2));
  let best = null;
  let bestScore = 0;

  for (const product of state.products) {
    const normalizedName = normalizeOcrTokenText(product.name);
    if (!normalizedName || normalizedName.length < 3) {
      continue;
    }

    if (normalizedLine.includes(normalizedName)) {
      const exactScore = normalizedName.length + 100;
      if (exactScore > bestScore) {
        best = product;
        bestScore = exactScore;
      }
      continue;
    }

    const nameWords = normalizedName.split(' ').filter((word) => word.length > 2);
    if (!nameWords.length) {
      continue;
    }

    let hitCount = 0;
    for (const word of nameWords) {
      if (lineWords.has(word)) {
        hitCount += 1;
      }
    }

    const ratio = hitCount / nameWords.length;
    if (ratio >= 0.66) {
      const score = ratio * 100 + normalizedName.length;
      if (score > bestScore) {
        best = product;
        bestScore = score;
      }
    }
  }

  return bestScore >= 70 ? best : null;
}

function deriveOcrQtyAndCost(line, product) {
  const fallbackCost = round2(toNumber(product.costPrice, product.wholesalePrice));
  const compactLine = String(line || '').replace(/,/g, '');
  const pairMatch = /(\d+(?:\.\d+)?)\s*(?:x|X|\*)\s*(\d+(?:\.\d+)?)/.exec(compactLine);

  let qty = 1;
  let unitCost = fallbackCost;

  if (pairMatch) {
    qty = toNumber(pairMatch[1], 1);
    unitCost = toNumber(pairMatch[2], fallbackCost);
  } else {
    const numbers = (compactLine.match(/\d+(?:\.\d+)?/g) || [])
      .map((token) => Number(token))
      .filter((value) => Number.isFinite(value) && value > 0);

    if (numbers.length >= 3) {
      qty = numbers[numbers.length - 3];
      unitCost = numbers[numbers.length - 2];
    } else if (numbers.length === 2) {
      qty = numbers[0] <= 200 ? numbers[0] : 1;
      unitCost = numbers[1];
    } else if (numbers.length === 1) {
      if (numbers[0] <= 200) {
        qty = numbers[0];
      } else {
        unitCost = numbers[0];
      }
    }
  }

  if (!Number.isFinite(qty) || qty <= 0 || qty > 100000) {
    qty = 1;
  }
  if (!Number.isFinite(unitCost) || unitCost <= 0 || unitCost > 10000000) {
    unitCost = fallbackCost;
  }

  return {
    qty: round2(qty),
    unitCost: round2(unitCost)
  };
}

function applyPurchaseOcrToDraft() {
  const text = String(state.purchaseOcrText || '').trim();
  if (!text) {
    showToast('No OCR text to process', 'error');
    return;
  }

  const lines = text
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (!lines.length) {
    showToast('No OCR lines to process', 'error');
    return;
  }

  let addedCount = 0;
  let matchedCount = 0;

  for (const line of lines) {
    if (isOcrSummaryLine(line)) {
      continue;
    }

    const product = findProductByOcrLine(line);
    if (!product) {
      continue;
    }

    matchedCount += 1;
    const parsed = deriveOcrQtyAndCost(line, product);
    const added = addPurchaseDraftItem(product.id, parsed.qty, parsed.unitCost);
    if (added) {
      addedCount += 1;
    }
  }

  if (!addedCount) {
    showToast('No purchase items matched from OCR text', 'error');
    return;
  }

  closePurchaseOcrModal();
  showToast(`OCR added ${addedCount} item line(s) to purchase (${matchedCount} matched)`);
  dom.purchaseBarcodeInput.focus();
}

function applyPurchaseOcrToNotes() {
  const text = String(state.purchaseOcrText || '').trim();
  if (!text) {
    showToast('No OCR text to apply', 'error');
    return;
  }

  const current = dom.purchaseNotes.value.trim();
  const merged = current
    ? `${current}\n\n[OCR Extracted]\n${text}`
    : `[OCR Extracted]\n${text}`;
  dom.purchaseNotes.value = merged;
  closePurchaseOcrModal();
  showToast('OCR text added to purchase notes');
  dom.purchaseNotes.focus();
}

async function runPurchaseOcr(file) {
  if (!file) {
    if (dom.purchaseOcrFile) {
      dom.purchaseOcrFile.value = '';
    }
    return;
  }

  const fileType = String(file.type || '').toLowerCase();
  if (!fileType.startsWith('image/')) {
    showToast('Please select an image file for OCR', 'error');
    if (dom.purchaseOcrFile) {
      dom.purchaseOcrFile.value = '';
    }
    return;
  }

  const previousStatus = dom.statusPill.textContent;

  try {
    setStatus('Running OCR...');
    const imageDataUrl = await readFileAsDataUrl(file);
    const result = await invoke('extractEnglishOcr', {
      imageDataUrl,
      fileName: file.name
    });
    openPurchaseOcrModal(result || { text: '', confidence: 0 });
    setStatus(previousStatus);
  } catch (error) {
    setStatus(previousStatus);
    showToast(error.message, 'error');
  } finally {
    dom.purchaseOcrFile.value = '';
  }
}

function resetPurchaseSupplierForm() {
  dom.purchaseSupplierForm.reset();
}

function syncBillingQuickCustomerType() {
  if (dom.invoiceChannel.value === 'wholesale') {
    dom.billingCustomerType.value = 'wholesale';
  } else {
    dom.billingCustomerType.value = 'retail';
  }
}

function resetBillingCustomerForm() {
  dom.billingCustomerForm.reset();
  syncBillingQuickCustomerType();
}

function resetExpenseForm() {
  state.editingExpenseId = '';
  dom.expenseForm.reset();
  dom.expenseDate.value = todayKey();
  dom.expensePaymentMethod.value = 'cash';
  dom.expenseSubmitBtn.textContent = 'Record Expense';
  if (dom.expenseCancelEditBtn) {
    dom.expenseCancelEditBtn.classList.add('hidden');
  }
}

function startExpenseEdit(expense) {
  if (!expense) {
    return;
  }

  state.editingExpenseId = expense.id;
  setSelectValueWithFallback(dom.expenseCategory, expense.category || 'Miscellaneous');
  dom.expenseAmount.value = round2(toNumber(expense.amount, 0)).toFixed(2);
  dom.expensePaymentMethod.value = normalizePaymentMethod(expense.paymentMethod);
  dom.expenseDate.value = toDateInputValue(expense.createdAt, todayKey());
  dom.expensePaidTo.value = expense.paidTo || '';
  dom.expenseNotes.value = expense.notes || '';
  dom.expenseSubmitBtn.textContent = 'Update Expense';
  if (dom.expenseCancelEditBtn) {
    dom.expenseCancelEditBtn.classList.remove('hidden');
  }
  switchView('expenses');
  dom.expenseAmount.focus();
  dom.expenseAmount.select();
}

function fillProductForm(product) {
  const packConfig = getProductPackConfig(product);
  dom.productForm.querySelector('#product-id').value = product.id;
  dom.productForm.querySelector('#product-sku').value = product.sku;
  dom.productForm.querySelector('#product-barcode').value = product.barcode || '';
  dom.productForm.querySelector('#product-name').value = product.name;
  setSelectValueWithFallback(dom.productForm.querySelector('#product-category'), product.category);
  setSelectValueWithFallback(dom.productForm.querySelector('#product-unit'), product.unit);
  dom.productForm.querySelector('#product-cost-price').value = product.costPrice;
  dom.productForm.querySelector('#product-loose-price').value = packConfig.loosePrice;
  dom.productPackEnabled.checked = packConfig.packEnabled;
  dom.productForm.querySelector('#product-pack-size').value = packConfig.packSize;
  dom.productForm.querySelector('#product-pack-price').value = packConfig.packEnabled ? packConfig.packPrice : 0;
  dom.productPackSize.disabled = !packConfig.packEnabled;
  dom.productPackPrice.disabled = !packConfig.packEnabled;
  dom.productForm.querySelector('#product-wholesale-price').value = product.wholesalePrice;
  dom.productForm.querySelector('#product-wholesale-min-qty').value = product.wholesaleMinQty;
  dom.productForm.querySelector('#product-stock').value = packConfig.packEnabled
    ? round2(toNumber(product.stock, 0) / packConfig.packSize)
    : product.stock;
  dom.productForm.querySelector('#product-reorder-level').value = product.reorderLevel;
  updateProductStockInputMode();
  dom.productSaveBtn.textContent = 'Update Product';
}

function resetCustomerForm() {
  dom.customerForm.reset();
  dom.customerForm.querySelector('#customer-id').value = '';
  dom.customerSaveBtn.textContent = 'Save Customer';
}

function fillCustomerForm(customer) {
  dom.customerForm.querySelector('#customer-id').value = customer.id;
  dom.customerForm.querySelector('#customer-name').value = customer.name;
  dom.customerForm.querySelector('#customer-type').value = customer.type;
  dom.customerForm.querySelector('#customer-phone').value = customer.phone || '';
  dom.customerForm.querySelector('#customer-address').value = customer.address || '';
  dom.customerForm.querySelector('#customer-gstin').value = customer.gstin || '';
  dom.customerSaveBtn.textContent = 'Update Customer';
}

function resetSupplierForm() {
  dom.supplierForm.reset();
  dom.supplierForm.querySelector('#supplier-id').value = '';
  dom.supplierSaveBtn.textContent = 'Save Supplier';
}

function fillSupplierForm(supplier) {
  dom.supplierForm.querySelector('#supplier-id').value = supplier.id;
  dom.supplierForm.querySelector('#supplier-name').value = supplier.name;
  dom.supplierForm.querySelector('#supplier-phone').value = supplier.phone || '';
  dom.supplierForm.querySelector('#supplier-gstin').value = supplier.gstin || '';
  dom.supplierForm.querySelector('#supplier-address').value = supplier.address || '';
  dom.supplierSaveBtn.textContent = 'Update Supplier';
}

function renderBusinessLogoPreview() {
  if (!dom.businessLogoPreview || !dom.businessLogoEmpty || !dom.businessLogoClearBtn) {
    return;
  }

  const logoDataUrl = normalizeBusinessLogoDataUrl(state.businessLogoDataUrl);
  state.businessLogoDataUrl = logoDataUrl;

  if (!logoDataUrl) {
    dom.businessLogoPreview.classList.remove('show');
    dom.businessLogoPreview.removeAttribute('src');
    dom.businessLogoEmpty.style.display = '';
    dom.businessLogoClearBtn.disabled = true;
    return;
  }

  dom.businessLogoPreview.src = logoDataUrl;
  dom.businessLogoPreview.classList.add('show');
  dom.businessLogoEmpty.style.display = 'none';
  dom.businessLogoClearBtn.disabled = false;
}

function renderBusiness() {
  const business = state.business || {
    name: '',
    phone: '',
    address: '',
    gstin: '',
    logoDataUrl: ''
  };

  dom.businessName.value = business.name || '';
  dom.businessPhone.value = business.phone || '';
  dom.businessGstin.value = business.gstin || '';
  dom.businessAddress.value = business.address || '';
  dom.businessInvoicePrefix.value = invoicePrefixPreview(business.name || '');
  dom.brandShopName.textContent = business.name || 'Grocery Offline ERP';
  state.businessLogoDataUrl = normalizeBusinessLogoDataUrl(business.logoDataUrl);
  if (dom.businessLogoFile) {
    dom.businessLogoFile.value = '';
  }
  renderBusinessLogoPreview();
}

function renderBackupSettings() {
  if (!dom.backupForm) {
    return;
  }

  const backup = normalizeBackupSettingsForUi(state.backup);
  dom.backupEnabled.checked = backup.enabled;
  dom.backupAutoEnabled.checked = backup.autoBackupEnabled;
  dom.backupAutoInterval.value = String(backup.autoBackupIntervalHours);
  dom.backupFolderPath.value = backup.folderPath || '';

  const backupText = `Backup: ${backupStatusLabel(backup.lastBackupStatus, backup.lastBackupAt)}`;
  const restoreText = `Restore: ${backupStatusLabel(backup.lastRestoreStatus, backup.lastRestoreAt)}`;
  dom.backupStatus.value = `${backupText} | ${restoreText}`;
  dom.backupLastFile.value = backup.lastBackupFileName || backup.lastRestoreFileName || '-';
  dom.backupLastError.value = backup.lastBackupError || backup.lastRestoreError || '';
  updateBackupFormState();
}

function renderUiSettings() {
  const uiSettings = normalizeUiSettingsForUi(state.uiSettings);
  state.uiSettings = uiSettings;
  if (dom.uiModeSelect) {
    dom.uiModeSelect.value = uiSettings.uiMode;
  }
  renderUiModePageSettings();
  applyUiMode(resolveUiModeForView(state.currentView || 'dashboard', uiSettings));
  applyThemeMode(uiSettings.themeMode);
  renderThermalSettings();
}

function renderDashboard() {
  const dashboard = state.dashboard || {
    totalProducts: 0,
    totalCustomers: 0,
    totalSuppliers: 0,
    totalInvoices: 0,
    totalPurchases: 0,
    totalExpenses: 0,
    todayRevenue: 0,
    monthRevenue: 0,
    receivables: 0,
    payables: 0,
    inventoryValue: 0,
    todayGrossProfit: 0,
    todayPurchaseSpend: 0,
    todayExpenses: 0,
    todayNetCashflow: 0,
    lowStockProducts: [],
    recentInvoices: [],
    recentPurchases: []
  };

  dom.dashboardCards.innerHTML = `
    <article class="metric-card">
      <p class="metric-label">Products</p>
      <p class="metric-value">${dashboard.totalProducts}</p>
    </article>
    <article class="metric-card">
      <p class="metric-label">Customers</p>
      <p class="metric-value">${dashboard.totalCustomers}</p>
    </article>
    <article class="metric-card">
      <p class="metric-label">Suppliers</p>
      <p class="metric-value">${dashboard.totalSuppliers}</p>
    </article>
    <article class="metric-card">
      <p class="metric-label">Today Sales</p>
      <p class="metric-value">${formatMoney(dashboard.todayRevenue)}</p>
    </article>
    <article class="metric-card">
      <p class="metric-label">Month Sales</p>
      <p class="metric-value">${formatMoney(dashboard.monthRevenue)}</p>
    </article>
    <article class="metric-card">
      <p class="metric-label">Receivables</p>
      <p class="metric-value">${formatMoney(dashboard.receivables)}</p>
    </article>
    <article class="metric-card">
      <p class="metric-label">Payables</p>
      <p class="metric-value">${formatMoney(dashboard.payables)}</p>
    </article>
    <article class="metric-card">
      <p class="metric-label">Inventory Value</p>
      <p class="metric-value">${formatMoney(dashboard.inventoryValue)}</p>
    </article>
    <article class="metric-card">
      <p class="metric-label">Expenses Logged</p>
      <p class="metric-value">${dashboard.totalExpenses}</p>
    </article>
  `;

  if (!dashboard.lowStockProducts.length) {
    dom.lowStockBody.innerHTML = '<tr><td colspan="4" class="empty">No low stock items</td></tr>';
  } else {
    dom.lowStockBody.innerHTML = dashboard.lowStockProducts
      .map(
        (product) => `
          <tr>
            <td>${product.name}</td>
            <td>${product.sku}</td>
            <td>${product.stock}</td>
            <td>${product.reorderLevel}</td>
          </tr>
        `
      )
      .join('');
  }

  if (!dashboard.recentInvoices.length) {
    dom.recentInvoicesBody.innerHTML = '<tr><td colspan="4" class="empty">No invoices yet</td></tr>';
  } else {
    dom.recentInvoicesBody.innerHTML = dashboard.recentInvoices
      .map(
        (invoice) => `
          <tr>
            <td>${invoice.invoiceNo}</td>
            <td><span class="tag ${invoice.channel}">${invoice.channel}</span></td>
            <td>${invoice.customerName}</td>
            <td>${formatMoney(invoice.total)}</td>
          </tr>
        `
      )
      .join('');
  }

  if (!dashboard.recentPurchases.length) {
    dom.recentPurchasesBody.innerHTML = '<tr><td colspan="4" class="empty">No purchases yet</td></tr>';
  } else {
    dom.recentPurchasesBody.innerHTML = dashboard.recentPurchases
      .map(
        (purchase) => `
          <tr>
            <td>${purchase.purchaseNo}</td>
            <td>${purchase.supplierName}</td>
            <td>${formatMoney(purchase.total)}</td>
            <td>${formatMoney(purchase.balance)}</td>
          </tr>
        `
      )
      .join('');
  }

  dom.todaySnapshot.innerHTML = `
    <p><span>Gross Profit</span><strong>${formatMoney(dashboard.todayGrossProfit)}</strong></p>
    <p><span>Purchase Spend</span><strong>${formatMoney(dashboard.todayPurchaseSpend)}</strong></p>
    <p><span>Expense Spend</span><strong>${formatMoney(dashboard.todayExpenses)}</strong></p>
    <p><span>Net Cashflow</span><strong>${formatMoney(dashboard.todayNetCashflow)}</strong></p>
    <p><span>Total Invoices</span><strong>${dashboard.totalInvoices}</strong></p>
    <p><span>Total Purchases</span><strong>${dashboard.totalPurchases}</strong></p>
  `;
}

function renderProducts() {
  if (!state.products.length) {
    dom.productBody.innerHTML = '<tr><td colspan="8" class="empty">No products found</td></tr>';
    return;
  }

  dom.productBody.innerHTML = state.products
    .map(
      (product) => {
        const packConfig = getProductPackConfig(product);
        const retailText = packConfig.packEnabled
          ? `${formatMoney(packConfig.loosePrice)} / loose <br /><span class="muted">${formatMoney(
              packConfig.packPrice
            )} / pack (${packConfig.packSize})</span>`
          : formatMoney(packConfig.loosePrice);

        return `
        <tr>
          <td>${product.name}</td>
          <td>${product.sku}</td>
          <td>${product.barcode || '-'}</td>
          <td>${product.stock} ${packConfig.looseUnit}</td>
          <td>${formatMoney(product.costPrice)}</td>
          <td>${retailText}</td>
          <td>${formatMoney(product.wholesalePrice)} / min ${product.wholesaleMinQty}</td>
          <td>
            <button class="btn small ghost" data-action="edit" data-id="${product.id}">Edit</button>
            <button class="btn small warn" data-action="delete" data-id="${product.id}">Delete</button>
          </td>
        </tr>
      `;
      }
    )
    .join('');
}

function renderCustomers() {
  if (!state.customers.length) {
    dom.customerBody.innerHTML = '<tr><td colspan="5" class="empty">No customers found</td></tr>';
    return;
  }

  dom.customerBody.innerHTML = state.customers
    .map(
      (customer) => `
        <tr>
          <td>${customer.name}</td>
          <td><span class="tag ${customer.type}">${customer.type}</span></td>
          <td>${customer.phone || '-'}</td>
          <td>${customer.gstin || '-'}</td>
          <td>
            <button class="btn small ghost" data-action="edit" data-id="${customer.id}">Edit</button>
            ${
              customer.name === 'Walk-in Customer'
                ? '<span class="muted">locked</span>'
                : `<button class="btn small warn" data-action="delete" data-id="${customer.id}">Delete</button>`
            }
          </td>
        </tr>
      `
    )
    .join('');
}

function renderCustomerOptions() {
  const selectedLedgerCustomer = state.selectedLedgerCustomerId || dom.ledgerCustomerSelect.value;

  if (!state.customers.length) {
    dom.ledgerCustomerSelect.innerHTML = '<option value="">No customer</option>';
    state.selectedLedgerCustomerId = '';
    return;
  }

  const optionsHtml = state.customers
    .map((customer) => `<option value="${customer.id}">${customer.name}</option>`)
    .join('');

  dom.ledgerCustomerSelect.innerHTML = optionsHtml;

  if (state.customers.some((customer) => customer.id === selectedLedgerCustomer)) {
    dom.ledgerCustomerSelect.value = selectedLedgerCustomer;
    state.selectedLedgerCustomerId = selectedLedgerCustomer;
  } else {
    dom.ledgerCustomerSelect.value = state.customers[0].id;
    state.selectedLedgerCustomerId = state.customers[0].id;
  }
}

function buildSupplierOutstandingMap() {
  const map = new Map();
  for (const purchase of state.purchases) {
    const current = map.get(purchase.supplierId) || 0;
    map.set(purchase.supplierId, round2(current + toNumber(purchase.balance, 0)));
  }
  return map;
}

function renderSuppliers() {
  if (!state.suppliers.length) {
    dom.supplierBody.innerHTML = '<tr><td colspan="4" class="empty">No suppliers found</td></tr>';
    return;
  }

  const outstandingMap = buildSupplierOutstandingMap();

  dom.supplierBody.innerHTML = state.suppliers
    .map(
      (supplier) => `
        <tr>
          <td>${supplier.name}</td>
          <td>${supplier.phone || '-'}</td>
          <td>${formatMoney(outstandingMap.get(supplier.id) || 0)}</td>
          <td>
            <button class="btn small ghost" data-action="edit" data-id="${supplier.id}">Edit</button>
            <button class="btn small warn" data-action="delete" data-id="${supplier.id}">Delete</button>
          </td>
        </tr>
      `
    )
    .join('');
}

function renderSupplierOptions() {
  const selectedPurchaseSupplier = dom.purchaseSupplier.value;
  const selectedLedgerSupplier = state.selectedLedgerSupplierId || dom.ledgerSupplierSelect.value;

  if (!state.suppliers.length) {
    dom.purchaseSupplier.innerHTML = '<option value="">No supplier</option>';
    dom.ledgerSupplierSelect.innerHTML = '<option value="">No supplier</option>';
    state.selectedLedgerSupplierId = '';
    return;
  }

  const optionsHtml = state.suppliers
    .map((supplier) => `<option value="${supplier.id}">${supplier.name}</option>`)
    .join('');

  dom.purchaseSupplier.innerHTML = optionsHtml;
  dom.ledgerSupplierSelect.innerHTML = optionsHtml;

  if (state.suppliers.some((supplier) => supplier.id === selectedPurchaseSupplier)) {
    dom.purchaseSupplier.value = selectedPurchaseSupplier;
  }

  if (state.suppliers.some((supplier) => supplier.id === selectedLedgerSupplier)) {
    dom.ledgerSupplierSelect.value = selectedLedgerSupplier;
    state.selectedLedgerSupplierId = selectedLedgerSupplier;
  } else {
    dom.ledgerSupplierSelect.value = state.suppliers[0].id;
    state.selectedLedgerSupplierId = state.suppliers[0].id;
  }
}

async function loadCustomerLedger(silent = false) {
  if (!state.customers.length) {
    state.customerLedger = null;
    renderCustomerLedger();
    return;
  }

  const customerId = state.selectedLedgerCustomerId || state.customers[0].id;

  try {
    const ledger = await invoke('getCustomerLedger', customerId);
    state.customerLedger = ledger;
    state.selectedLedgerCustomerId = ledger.selectedCustomerId;
    dom.ledgerCustomerSelect.value = ledger.selectedCustomerId;
    renderCustomerLedger();
  } catch (error) {
    state.customerLedger = null;
    renderCustomerLedger();
    if (!silent) {
      showToast(error.message, 'error');
    }
  }
}

function renderCustomerLedger() {
  const ledger = state.customerLedger;

  if (!ledger || !ledger.customer) {
    dom.customerOutstanding.textContent = formatMoney(0);
    dom.customerLedgerBody.innerHTML =
      '<tr><td colspan="7" class="empty">Select customer to view ledger</td></tr>';
    return;
  }

  dom.customerOutstanding.textContent = formatMoney(ledger.outstanding || 0);

  if (!ledger.ledgerEntries.length) {
    dom.customerLedgerBody.innerHTML = '<tr><td colspan="7" class="empty">No ledger entries</td></tr>';
    return;
  }

  dom.customerLedgerBody.innerHTML = ledger.ledgerEntries
    .map(
      (entry) => `
        <tr>
          <td>${formatDate(entry.createdAt)}</td>
          <td><span class="tag ${entry.type}">${entry.type}</span></td>
          <td>${entry.reference}</td>
          <td>${entry.debit ? formatMoney(entry.debit) : '-'}</td>
          <td>${entry.credit ? formatMoney(entry.credit) : '-'}</td>
          <td>${formatMoney(entry.runningBalance)}</td>
          <td>${entry.note || '-'}</td>
        </tr>
      `
    )
    .join('');
}

async function loadSupplierLedger(silent = false) {
  if (!state.suppliers.length) {
    state.supplierLedger = null;
    renderSupplierLedger();
    return;
  }

  const supplierId = state.selectedLedgerSupplierId || state.suppliers[0].id;

  try {
    const ledger = await invoke('getSupplierLedger', supplierId);
    state.supplierLedger = ledger;
    state.selectedLedgerSupplierId = ledger.selectedSupplierId;
    dom.ledgerSupplierSelect.value = ledger.selectedSupplierId;
    renderSupplierLedger();
  } catch (error) {
    state.supplierLedger = null;
    renderSupplierLedger();
    if (!silent) {
      showToast(error.message, 'error');
    }
  }
}

function renderSupplierLedger() {
  const ledger = state.supplierLedger;

  if (!ledger || !ledger.supplier) {
    dom.supplierOutstanding.textContent = formatMoney(0);
    dom.supplierLedgerBody.innerHTML =
      '<tr><td colspan="7" class="empty">Select supplier to view ledger</td></tr>';
    return;
  }

  dom.supplierOutstanding.textContent = formatMoney(ledger.outstanding || 0);

  if (!ledger.ledgerEntries.length) {
    dom.supplierLedgerBody.innerHTML = '<tr><td colspan="7" class="empty">No ledger entries</td></tr>';
    return;
  }

  dom.supplierLedgerBody.innerHTML = ledger.ledgerEntries
    .map(
      (entry) => `
        <tr>
          <td>${formatDate(entry.createdAt)}</td>
          <td><span class="tag ${entry.type}">${entry.type}</span></td>
          <td>${entry.reference}</td>
          <td>${entry.debit ? formatMoney(entry.debit) : '-'}</td>
          <td>${entry.credit ? formatMoney(entry.credit) : '-'}</td>
          <td>${formatMoney(entry.runningBalance)}</td>
          <td>${entry.note || '-'}</td>
        </tr>
      `
    )
    .join('');
}

function renderPurchaseProductOptions() {
  if (!state.products.length) {
    dom.purchaseDraftProductId.innerHTML = '<option value="">No products</option>';
    dom.purchaseDraftCost.value = '0';
    return;
  }

  dom.purchaseDraftProductId.innerHTML = state.products
    .map(
      (product) => `
        <option value="${product.id}">
          ${product.name} (${product.sku}) - cost ${formatMoney(product.costPrice)}
        </option>
      `
    )
    .join('');

  const selected = state.products.find((entry) => entry.id === dom.purchaseDraftProductId.value);
  const firstProduct = selected || state.products[0];
  if (firstProduct) {
    dom.purchaseDraftProductId.value = firstProduct.id;
    if (!toNumber(dom.purchaseDraftCost.value, 0)) {
      dom.purchaseDraftCost.value = round2(toNumber(firstProduct.costPrice, firstProduct.wholesalePrice));
    }
  }
}

function resolvePurchaseDraftLines() {
  return state.purchaseDraftItems
    .map((item) => {
      const product = state.products.find((entry) => entry.id === item.productId);
      if (!product) {
        return null;
      }

      const lineTotal = round2(item.qty * item.unitCost);
      return {
        product,
        qty: item.qty,
        unitCost: item.unitCost,
        lineTotal
      };
    })
    .filter(Boolean);
}

function renderPurchaseTotals() {
  const lines = resolvePurchaseDraftLines();
  const subtotal = round2(lines.reduce((sum, line) => sum + line.lineTotal, 0));
  const discount = round2(Math.max(0, toNumber(dom.purchaseDiscount.value, 0)));
  const taxable = round2(Math.max(subtotal - discount, 0));
  const gstEnabled = dom.purchaseGstEnabled.checked;
  const gstRate = gstEnabled ? Math.max(0, toNumber(dom.purchaseGstRate.value, 0)) : 0;
  const gstAmount = round2(gstEnabled ? (taxable * gstRate) / 100 : 0);
  const total = round2(taxable + gstAmount);
  const paid = round2(Math.max(0, toNumber(dom.purchasePaid.value, 0)));
  const balance = round2(Math.max(total - paid, 0));

  dom.purchaseSubtotalValue.textContent = formatMoney(subtotal);
  dom.purchaseDiscountValue.textContent = formatMoney(discount);
  dom.purchaseGstValue.textContent = formatMoney(gstAmount);
  dom.purchaseTotalValue.textContent = formatMoney(total);
  dom.purchaseBalanceValue.textContent = formatMoney(balance);
}

function renderPurchaseDraftItems() {
  const lines = resolvePurchaseDraftLines();

  if (!lines.length) {
    dom.purchaseDraftItemsBody.innerHTML =
      '<tr><td colspan="5" class="empty">No purchase items added yet</td></tr>';
    renderPurchaseTotals();
    return;
  }

  dom.purchaseDraftItemsBody.innerHTML = lines
    .map(
      (line, index) => `
        <tr>
          <td>
            <strong>${line.product.name}</strong>
            <div class="muted">${line.product.sku}</div>
          </td>
          <td><input data-qty-index="${index}" type="number" min="0.01" step="0.01" value="${line.qty}" /></td>
          <td><input data-cost-index="${index}" type="number" min="0.01" step="0.01" value="${line.unitCost}" /></td>
          <td>${formatMoney(line.lineTotal)}</td>
          <td><button class="btn small warn" data-remove-index="${index}">Remove</button></td>
        </tr>
      `
    )
    .join('');

  renderPurchaseTotals();
}

function addPurchaseDraftItem(productId, qty, unitCost) {
  const product = state.products.find((entry) => entry.id === productId);
  if (!product) {
    showToast('Invalid product selected', 'error');
    return false;
  }

  const cleanQty = round2(toNumber(qty, NaN));
  const cleanCost = round2(toNumber(unitCost, NaN));

  if (!Number.isFinite(cleanQty) || cleanQty <= 0) {
    showToast('Quantity must be greater than 0', 'error');
    return false;
  }

  if (!Number.isFinite(cleanCost) || cleanCost <= 0) {
    showToast('Unit cost must be greater than 0', 'error');
    return false;
  }

  const existing = state.purchaseDraftItems.find(
    (item) =>
      item.productId === productId &&
      Math.abs(round2(toNumber(item.unitCost, 0)) - cleanCost) < 0.0001
  );
  if (existing) {
    existing.qty = round2(existing.qty + cleanQty);
  } else {
    state.purchaseDraftItems.push({ productId, qty: cleanQty, unitCost: cleanCost });
  }

  renderPurchaseDraftItems();
  return true;
}

function addSelectedPurchaseProduct() {
  const productId = dom.purchaseDraftProductId.value;
  const qty = dom.purchaseDraftQty.value;
  const unitCost = dom.purchaseDraftCost.value;

  if (!productId) {
    showToast('Select a product first', 'error');
    return;
  }

  const added = addPurchaseDraftItem(productId, qty, unitCost);
  if (added) {
    dom.purchaseDraftQty.value = '1';
    const product = state.products.find((entry) => entry.id === productId);
    if (product) {
      dom.purchaseDraftCost.value = round2(toNumber(product.costPrice, product.wholesalePrice));
    }
  }
}

function startPurchaseEdit(purchase) {
  if (!purchase) {
    return;
  }

  state.editingPurchaseId = purchase.id;
  dom.purchaseSubmitBtn.textContent = 'Update Purchase';
  if (dom.purchaseCancelEditBtn) {
    dom.purchaseCancelEditBtn.classList.remove('hidden');
  }

  renderSupplierOptions();
  renderPurchaseProductOptions();

  if (state.suppliers.some((entry) => entry.id === purchase.supplierId)) {
    dom.purchaseSupplier.value = purchase.supplierId;
  }

  dom.purchaseGstEnabled.checked = Boolean(purchase.gstEnabled);
  dom.purchaseGstRate.disabled = !dom.purchaseGstEnabled.checked;
  dom.purchaseGstRate.value = round2(toNumber(purchase.gstRate, 0)).toFixed(2);
  dom.purchaseDiscount.value = round2(toNumber(purchase.discount, 0)).toFixed(2);
  dom.purchasePaid.value = round2(toNumber(purchase.paidAmount, 0)).toFixed(2);
  dom.purchasePaidMethod.value = normalizePaymentMethod(purchase.paidMethod);
  dom.purchaseNotes.value = purchase.notes || '';
  dom.purchaseBarcodeInput.value = '';
  dom.purchaseDraftQty.value = '1';

  state.purchaseDraftItems = (Array.isArray(purchase.items) ? purchase.items : [])
    .map((item) => ({
      productId: item.productId,
      qty: round2(toNumber(item.qty, 0)),
      unitCost: round2(toNumber(item.unitCost, 0))
    }))
    .filter((line) => line.productId && line.qty > 0 && line.unitCost > 0);

  renderPurchaseDraftItems();
  switchView('purchases');
  dom.purchaseBarcodeInput.focus();
}

function clearPurchaseDraft() {
  state.editingPurchaseId = '';
  state.purchaseDraftItems = [];
  dom.purchaseForm.reset();
  dom.purchaseGstEnabled.checked = false;
  dom.purchaseGstRate.value = '0';
  dom.purchaseGstRate.disabled = true;
  dom.purchaseDiscount.value = '0';
  dom.purchasePaid.value = '0';
  dom.purchasePaidMethod.value = 'cash';
  dom.purchaseNotes.value = '';
  dom.purchaseBarcodeInput.value = '';
  dom.purchaseDraftQty.value = '1';
  dom.purchaseSubmitBtn.textContent = 'Create Purchase';
  if (dom.purchaseCancelEditBtn) {
    dom.purchaseCancelEditBtn.classList.add('hidden');
  }

  renderSupplierOptions();
  renderPurchaseProductOptions();
  renderPurchaseDraftItems();
}

function renderPurchases() {
  const search = state.purchaseSearch;

  let purchases = [...state.purchases];
  if (search) {
    purchases = purchases.filter((purchase) => {
      const text =
        `${purchase.purchaseNo} ${purchase.supplierSnapshot.name} ${paymentMethodLabel(purchase.paidMethod)}`.toLowerCase();
      return text.includes(search);
    });
  }

  if (!purchases.length) {
    dom.purchasesBody.innerHTML = '<tr><td colspan="8" class="empty">No purchases found</td></tr>';
    return;
  }

  dom.purchasesBody.innerHTML = purchases
    .map(
      (purchase) => `
        <tr>
          <td>${purchase.purchaseNo}</td>
          <td>${formatDate(purchase.createdAt)}</td>
          <td>${purchase.supplierSnapshot.name}</td>
          <td>${formatMoney(purchase.total)}</td>
          <td>
            ${formatMoney(purchase.paidAmount)}
            <div class="muted">${paymentMethodLabel(purchase.paidMethod)}</div>
          </td>
          <td>${formatMoney(purchase.balance)}</td>
          <td>${purchase.gstEnabled ? `${purchase.gstRate}%` : 'No GST'}</td>
          <td>
            <button class="btn small ghost" data-edit-purchase-id="${purchase.id}">Edit</button>
          </td>
        </tr>
      `
    )
    .join('');
}

function renderExpenses() {
  const search = state.expenseSearch;
  let expenses = [...state.expenses];

  if (search) {
    expenses = expenses.filter((expense) => {
      const text =
        `${expense.expenseNo} ${expense.category} ${expense.paidTo || ''} ${expense.notes || ''} ${paymentMethodLabel(
          expense.paymentMethod
        )}`.toLowerCase();
      return text.includes(search);
    });
  }

  if (!expenses.length) {
    dom.expensesBody.innerHTML = '<tr><td colspan="7" class="empty">No expenses recorded</td></tr>';
    return;
  }

  dom.expensesBody.innerHTML = expenses
    .map(
      (expense) => `
        <tr>
          <td>${expense.expenseNo}</td>
          <td>${formatDate(expense.createdAt)}</td>
          <td><span class="tag expense">${expense.category}</span></td>
          <td>${expense.paidTo || '-'}</td>
          <td>${expense.notes || '-'}</td>
          <td>
            ${formatMoney(expense.amount)}
            <div class="muted">${paymentMethodLabel(expense.paymentMethod)}</div>
          </td>
          <td>
            <button class="btn small ghost" data-edit-expense-id="${expense.id}">Edit</button>
          </td>
        </tr>
      `
    )
    .join('');
}

function renderBillingProductOptions() {
  const selectedProductId = dom.draftProductId.value;
  let productsWithStock = state.products.filter((product) => product.stock > 0);
  const search = state.billingProductSearch;

  if (search) {
    productsWithStock = productsWithStock.filter((product) => {
      const text = `${product.name} ${product.sku} ${product.barcode || ''}`.toLowerCase();
      return text.includes(search);
    });
  }

  if (!productsWithStock.length) {
    dom.draftProductId.innerHTML = search
      ? '<option value="">No matching product</option>'
      : '<option value="">No stock available</option>';
    renderBillingSaleUnitOptions(null);
    renderTouchPosWorkspace();
    return;
  }

  dom.draftProductId.innerHTML = productsWithStock
    .map(
      (product) => {
        const config = getProductPackConfig(product);
        const stockText = config.packEnabled
          ? `${product.stock} ${config.looseUnit} (~${round2(product.stock / config.packSize)} pack)`
          : `${product.stock}`;

        return `
        <option value="${product.id}">
          ${product.name} (${product.sku}) - stock ${stockText}
        </option>
      `;
      }
    )
    .join('');

  if (productsWithStock.some((product) => product.id === selectedProductId)) {
    dom.draftProductId.value = selectedProductId;
  } else {
    dom.draftProductId.value = productsWithStock[0].id;
  }

  const activeProduct = state.products.find((product) => product.id === dom.draftProductId.value) || null;
  renderBillingSaleUnitOptions(activeProduct);
  renderTouchPosWorkspace();
}

function renderBillingSaleUnitOptions(product) {
  if (!dom.draftSaleUnit) {
    return;
  }

  const selectedMode = normalizeSaleUnit(dom.draftSaleUnit.value);
  if (!product) {
    dom.draftSaleUnit.innerHTML = '<option value="loose">Loose</option>';
    dom.draftSaleUnit.value = 'loose';
    return;
  }

  const config = getProductPackConfig(product);
  const options = [
    `<option value="loose">Loose (${config.looseUnit})</option>`
  ];
  if (config.packEnabled) {
    options.push(
      `<option value="pack">Pack (1 = ${config.packSize} ${config.looseUnit})</option>`
    );
  }

  dom.draftSaleUnit.innerHTML = options.join('');
  dom.draftSaleUnit.value = config.packEnabled && selectedMode === 'pack' ? 'pack' : 'loose';
}

function renderBillingCustomerOptions() {
  const channel = dom.invoiceChannel.value;
  const selected = dom.invoiceCustomer.value;

  let availableCustomers = [];
  if (channel === 'wholesale') {
    availableCustomers = state.customers.filter((customer) => customer.type === 'wholesale');
  } else {
    availableCustomers = [...state.customers];
  }

  if (!availableCustomers.length) {
    dom.invoiceCustomer.innerHTML = '<option value="">No customer available</option>';
    return;
  }

  dom.invoiceCustomer.innerHTML = availableCustomers
    .map(
      (customer) =>
        `<option value="${customer.id}">${customer.name} (${customer.type.toUpperCase()})</option>`
    )
    .join('');

  const stillExists = availableCustomers.some((customer) => customer.id === selected);
  if (stillExists) {
    dom.invoiceCustomer.value = selected;
  }

  syncTouchPosPanelFromForm();
}

function getTouchPosFilteredProducts() {
  const search = state.billingProductSearch;
  let products = state.products.filter((product) => product.stock > 0);

  if (state.touchPosCategory && state.touchPosCategory !== 'all') {
    products = products.filter(
      (product) => String(product.category || 'General').trim() === state.touchPosCategory
    );
  }

  if (search) {
    products = products.filter((product) => {
      const text = `${product.name} ${product.sku} ${product.barcode || ''}`.toLowerCase();
      return text.includes(search);
    });
  }

  return products;
}

function syncTouchPosPanelFromForm() {
  if (!dom.touchPosWorkspace) {
    return;
  }

  const rawSearchText = dom.billingProductSearch ? dom.billingProductSearch.value : state.billingProductSearch;
  if (dom.touchPosSearch && dom.touchPosSearch.value !== rawSearchText) {
    dom.touchPosSearch.value = rawSearchText;
  }

  if (dom.touchPosChannel && dom.touchPosChannel.value !== dom.invoiceChannel.value) {
    dom.touchPosChannel.value = dom.invoiceChannel.value;
  }

  if (dom.touchPosCustomer) {
    dom.touchPosCustomer.innerHTML = dom.invoiceCustomer.innerHTML;
    const selectedCustomer = dom.invoiceCustomer.value;
    if (selectedCustomer && dom.touchPosCustomer.querySelector(`option[value="${selectedCustomer}"]`)) {
      dom.touchPosCustomer.value = selectedCustomer;
    }
  }

  if (dom.touchPosSaleUnit && dom.touchPosSaleUnit.value !== normalizeSaleUnit(dom.draftSaleUnit.value)) {
    dom.touchPosSaleUnit.value = normalizeSaleUnit(dom.draftSaleUnit.value);
  }

  if (dom.touchPosPaymentMethod && dom.touchPosPaymentMethod.value !== dom.invoicePaidMethod.value) {
    dom.touchPosPaymentMethod.value = dom.invoicePaidMethod.value;
  }

  if (dom.touchPosDiscount && dom.touchPosDiscount.value !== dom.invoiceDiscount.value) {
    dom.touchPosDiscount.value = dom.invoiceDiscount.value;
  }

  if (dom.touchPosPaid && dom.touchPosPaid.value !== dom.invoicePaid.value) {
    dom.touchPosPaid.value = dom.invoicePaid.value;
  }

  if (dom.touchPosTotal) {
    dom.touchPosTotal.textContent = dom.totalValue.textContent;
  }
  if (dom.touchPosSubtotal) {
    dom.touchPosSubtotal.textContent = dom.subtotalValue.textContent;
  }
  if (dom.touchPosBalance) {
    dom.touchPosBalance.textContent = dom.balanceValue.textContent;
  }
}

function renderTouchPosCategories() {
  if (!dom.touchPosCategoryList) {
    return;
  }

  const categories = Array.from(
    new Set(
      state.products
        .filter((product) => product.stock > 0)
        .map((product) => String(product.category || 'General').trim() || 'General')
    )
  ).sort((a, b) => a.localeCompare(b));

  const allCategories = ['all', ...categories];
  if (!allCategories.includes(state.touchPosCategory)) {
    state.touchPosCategory = 'all';
  }

  dom.touchPosCategoryList.innerHTML = allCategories
    .map((category) => {
      const isAll = category === 'all';
      const label = isAll ? 'All' : category;
      const count = isAll
        ? state.products.filter((product) => product.stock > 0).length
        : state.products.filter(
            (product) => product.stock > 0 && String(product.category || 'General').trim() === category
          ).length;
      const activeClass = state.touchPosCategory === category ? 'active' : '';
      return `<button type="button" class="touch-pos-category-btn ${activeClass}" data-touch-category="${category}">${label} <span>${count}</span></button>`;
    })
    .join('');
}

function renderTouchPosProductGrid() {
  if (!dom.touchPosProductGrid) {
    return;
  }

  const products = getTouchPosFilteredProducts();
  if (!products.length) {
    dom.touchPosProductGrid.innerHTML = '<div class="touch-pos-empty">No products in this filter</div>';
    return;
  }

  dom.touchPosProductGrid.innerHTML = products
    .map((product) => {
      const config = getProductPackConfig(product);
      const stockText = config.packEnabled
        ? `${product.stock} ${config.looseUnit} (~${round2(product.stock / config.packSize)} pack)`
        : `${product.stock} ${config.looseUnit}`;

      return `
        <button type="button" class="touch-pos-product-card" data-touch-product-id="${product.id}">
          <strong>${product.name}</strong>
          <span>${formatMoney(config.loosePrice)} / ${config.looseUnit}</span>
          ${
            config.packEnabled
              ? `<span>${formatMoney(config.packPrice)} / Pack (${config.packSize})</span>`
              : '<span>Pack sale not enabled</span>'
          }
          <small>Stock: ${stockText}</small>
        </button>
      `;
    })
    .join('');
}

function renderTouchPosCartLines() {
  if (!dom.touchPosCartLines) {
    return;
  }

  const lines = resolveDraftLines();
  if (!lines.length) {
    dom.touchPosCartLines.innerHTML = '<div class="touch-pos-empty">No items added yet</div>';
    return;
  }

  dom.touchPosCartLines.innerHTML = lines
    .map(
      (line, index) => `
        <div class="touch-pos-cart-line">
          <div class="touch-pos-cart-main">
            <strong>${line.product.name}</strong>
            <small>${line.qty} ${line.unitLabel} • ${formatMoney(line.unitPrice)}</small>
          </div>
          <div class="touch-pos-cart-amount">${formatMoney(line.lineTotal)}</div>
          <div class="touch-pos-cart-actions">
            <button type="button" data-touch-line-dec="${index}">-</button>
            <button type="button" data-touch-line-inc="${index}">+</button>
            <button type="button" data-touch-line-remove="${index}">X</button>
          </div>
        </div>
      `
    )
    .join('');
}

function renderTouchPosWorkspace() {
  if (!dom.touchPosWorkspace) {
    return;
  }

  syncTouchPosPanelFromForm();
  renderTouchPosCategories();
  renderTouchPosProductGrid();
  renderTouchPosCartLines();
}

function getUnitPrice(product, channel, qty, saleUnit) {
  const config = getProductPackConfig(product);
  const unitMode = normalizeSaleUnit(saleUnit);
  const usePack = unitMode === 'pack' && config.packEnabled;
  const baseQty = round2(usePack ? qty * config.packSize : qty);

  if (channel === 'wholesale') {
    const perLoosePrice =
      baseQty >= product.wholesaleMinQty ? product.wholesalePrice : config.loosePrice;
    return {
      unitPrice: usePack ? round2(perLoosePrice * config.packSize) : perLoosePrice,
      mode: baseQty >= product.wholesaleMinQty ? 'wholesale' : 'retail-fallback',
      saleUnit: usePack ? 'pack' : 'loose',
      unitLabel: getDisplayUnit(product, usePack ? 'pack' : 'loose'),
      baseQty,
      packSize: config.packSize,
      looseUnit: config.looseUnit
    };
  }

  return {
    unitPrice: usePack ? config.packPrice : config.loosePrice,
    mode: usePack ? 'retail-pack' : 'retail-loose',
    saleUnit: usePack ? 'pack' : 'loose',
    unitLabel: getDisplayUnit(product, usePack ? 'pack' : 'loose'),
    baseQty,
    packSize: config.packSize,
    looseUnit: config.looseUnit
  };
}

function addDraftItem(productId, qty, saleUnit = 'loose') {
  const product = state.products.find((entry) => entry.id === productId);
  if (!product) {
    showToast('Invalid product selected', 'error');
    return false;
  }

  const cleanQty = round2(toNumber(qty, NaN));
  const packConfig = getProductPackConfig(product);
  const cleanSaleUnit =
    normalizeSaleUnit(saleUnit) === 'pack' && packConfig.packEnabled ? 'pack' : 'loose';
  if (!Number.isFinite(cleanQty) || cleanQty <= 0) {
    showToast('Quantity must be greater than 0', 'error');
    return false;
  }

  const additionalBaseQty = toBaseQty(product, cleanQty, cleanSaleUnit);
  const currentBaseQty = round2(
    state.draftItems.reduce((sum, item) => {
      if (item.productId !== productId) {
        return sum;
      }
      return round2(sum + toBaseQty(product, item.qty, item.saleUnit));
    }, 0)
  );
  const totalBaseQty = round2(currentBaseQty + additionalBaseQty);

  if (totalBaseQty > product.stock) {
    showToast(`Only ${product.stock} loose units available for ${product.name}`, 'error');
    return false;
  }

  const existing = state.draftItems.find(
    (item) => item.productId === productId && normalizeSaleUnit(item.saleUnit) === cleanSaleUnit
  );

  if (existing) {
    existing.qty = round2(existing.qty + cleanQty);
  } else {
    state.draftItems.push({ productId, qty: cleanQty, saleUnit: cleanSaleUnit });
  }

  renderDraftItems();
  return true;
}

function updateDraftItemQuantity(index, nextQtyInput) {
  const indexNumber = Number(index);
  const nextQty = round2(toNumber(nextQtyInput, NaN));

  if (Number.isNaN(indexNumber) || !state.draftItems[indexNumber]) {
    return false;
  }

  if (!Number.isFinite(nextQty) || nextQty <= 0) {
    showToast('Quantity must be greater than 0', 'error');
    renderDraftItems();
    return false;
  }

  const line = state.draftItems[indexNumber];
  const product = state.products.find((entry) => entry.id === line.productId);
  if (!product) {
    showToast('Invalid product in draft', 'error');
    renderDraftItems();
    return false;
  }

  const nextBaseQty = toBaseQty(product, nextQty, line.saleUnit);
  const otherBaseQty = round2(
    state.draftItems.reduce((sum, current, currentIndex) => {
      if (currentIndex === indexNumber || current.productId !== line.productId) {
        return sum;
      }
      return round2(sum + toBaseQty(product, current.qty, current.saleUnit));
    }, 0)
  );
  const totalBaseQty = round2(otherBaseQty + nextBaseQty);

  if (totalBaseQty > product.stock) {
    showToast(`Only ${product.stock} loose units available for ${product.name}`, 'error');
    renderDraftItems();
    return false;
  }

  line.qty = nextQty;
  renderDraftItems();
  return true;
}

function addSelectedProductToDraft() {
  const productId = dom.draftProductId.value;
  const saleUnit = getSelectedBillingSaleUnit();
  const qty = round2(toNumber(dom.draftQty.value, NaN));

  if (!productId) {
    showToast('Select a product first', 'error');
    return;
  }

  const product = state.products.find((entry) => entry.id === productId);
  const added = addBillingProductToDraft(product, qty, saleUnit);
  if (added) {
    dom.draftQty.value = '1';
    focusBillingScannerInput();
  }
}

function resolveDraftLines() {
  const channel = dom.invoiceChannel.value;

  return state.draftItems
    .map((item) => {
      const product = state.products.find((entry) => entry.id === item.productId);
      if (!product) {
        return null;
      }

      const pricing = getUnitPrice(product, channel, item.qty, item.saleUnit);
      const lineTotal = round2(pricing.unitPrice * item.qty);

      return {
        product,
        qty: item.qty,
        saleUnit: pricing.saleUnit,
        unitLabel: pricing.unitLabel,
        baseQty: pricing.baseQty,
        packSize: pricing.packSize,
        looseUnit: pricing.looseUnit,
        unitPrice: pricing.unitPrice,
        lineTotal,
        mode: pricing.mode
      };
    })
    .filter(Boolean);
}

function renderDraftTotals() {
  const lines = resolveDraftLines();
  const subtotal = round2(lines.reduce((sum, line) => sum + line.lineTotal, 0));
  const discount = round2(Math.max(0, toNumber(dom.invoiceDiscount.value, 0)));

  const taxable = round2(Math.max(subtotal - discount, 0));
  const gstEnabled = dom.invoiceGstEnabled.checked;
  const gstRate = gstEnabled ? Math.max(0, toNumber(dom.invoiceGstRate.value, 0)) : 0;
  const gstAmount = round2(gstEnabled ? (taxable * gstRate) / 100 : 0);
  const total = round2(taxable + gstAmount);
  if (dom.invoiceChannel.value === 'retail' && !state.invoicePaidTouched) {
    dom.invoicePaid.value = total.toFixed(2);
  }
  const paid = round2(Math.max(0, toNumber(dom.invoicePaid.value, 0)));
  const balance = round2(Math.max(total - paid, 0));

  dom.subtotalValue.textContent = formatMoney(subtotal);
  dom.discountValue.textContent = formatMoney(discount);
  dom.gstValue.textContent = formatMoney(gstAmount);
  dom.totalValue.textContent = formatMoney(total);
  dom.balanceValue.textContent = formatMoney(balance);
  syncTouchPosPanelFromForm();
}

function renderDraftItems() {
  const lines = resolveDraftLines();

  if (!lines.length) {
    dom.draftItemsBody.innerHTML = '<tr><td colspan="5" class="empty">No items added yet</td></tr>';
    renderDraftTotals();
    renderTouchPosWorkspace();
    return;
  }

  dom.draftItemsBody.innerHTML = lines
    .map(
      (line, index) => `
        <tr>
          <td>
            <strong>${line.product.name}</strong>
            <div class="muted">
              ${line.product.sku} • ${line.qty} ${line.unitLabel} (base ${line.baseQty} ${line.looseUnit})${
                line.mode === 'retail-fallback' ? ' • Retail rate: min wholesale qty not met' : ''
              }
            </div>
          </td>
          <td><input data-qty-index="${index}" type="number" min="0.01" step="0.01" value="${line.qty}" /></td>
          <td>${formatMoney(line.unitPrice)}</td>
          <td>${formatMoney(line.lineTotal)}</td>
          <td><button class="btn small warn" data-remove-index="${index}">Remove</button></td>
        </tr>
      `
    )
    .join('');

  renderDraftTotals();
  renderTouchPosWorkspace();
}

function startInvoiceEdit(invoice) {
  if (!invoice) {
    return;
  }

  state.editingInvoiceId = invoice.id;
  state.invoicePaidTouched = true;

  dom.invoiceChannel.value = invoice.channel || 'retail';
  renderBillingCustomerOptions();

  if (invoice.customerId && state.customers.some((entry) => entry.id === invoice.customerId)) {
    dom.invoiceCustomer.value = invoice.customerId;
  } else {
    const walkIn = state.customers.find((entry) => entry.name === 'Walk-in Customer');
    if (walkIn) {
      dom.invoiceCustomer.value = walkIn.id;
    }
  }

  dom.invoiceGstEnabled.checked = Boolean(invoice.gstEnabled);
  dom.invoiceGstRate.disabled = !dom.invoiceGstEnabled.checked;
  dom.invoiceGstRate.value = round2(toNumber(invoice.gstRate, 0)).toFixed(2);
  dom.invoiceDiscount.value = round2(toNumber(invoice.discount, 0)).toFixed(2);
  dom.invoicePaid.value = round2(toNumber(invoice.paidAmount, 0)).toFixed(2);
  dom.invoicePaidMethod.value = normalizePaymentMethod(invoice.paidMethod);
  dom.invoiceNotes.value = invoice.notes || '';
  state.billingProductSearch = '';
  state.touchPosCategory = 'all';
  dom.billingProductSearch.value = '';
  if (dom.touchPosSearch) {
    dom.touchPosSearch.value = '';
  }
  dom.barcodeInput.value = '';
  if (dom.touchPosBarcode) {
    dom.touchPosBarcode.value = '';
  }
  dom.draftQty.value = '1';

  state.draftItems = (Array.isArray(invoice.items) ? invoice.items : [])
    .map((item) => ({
      productId: item.productId,
      qty: round2(toNumber(item.qty, 0)),
      saleUnit: normalizeSaleUnit(item.saleUnit)
    }))
    .filter((line) => line.productId && line.qty > 0);

  dom.invoiceSubmitBtn.textContent = 'Update Invoice';
  if (dom.invoiceCancelEditBtn) {
    dom.invoiceCancelEditBtn.classList.remove('hidden');
  }

  renderBillingCustomerOptions();
  renderBillingProductOptions();
  renderDraftItems();
  switchView('billing');
  focusBillingScannerInput();
}

function clearInvoiceDraft() {
  state.editingInvoiceId = '';
  state.draftItems = [];
  state.invoicePaidTouched = false;

  dom.invoiceForm.reset();
  dom.invoiceChannel.value = 'retail';
  dom.invoiceGstEnabled.checked = false;
  dom.invoiceGstRate.value = '0';
  dom.invoiceGstRate.disabled = true;
  dom.invoiceDiscount.value = '0';
  dom.invoicePaid.value = '';
  dom.invoicePaidMethod.value = 'cash';
  dom.invoiceNotes.value = '';
  state.billingProductSearch = '';
  state.touchPosCategory = 'all';
  dom.billingProductSearch.value = '';
  if (dom.touchPosSearch) {
    dom.touchPosSearch.value = '';
  }
  if (dom.touchPosQty) {
    dom.touchPosQty.value = '1';
  }
  if (dom.touchPosBarcode) {
    dom.touchPosBarcode.value = '';
  }
  dom.draftQty.value = '1';
  dom.draftSaleUnit.value = 'loose';
  dom.barcodeInput.value = '';
  dom.invoiceSubmitBtn.textContent = 'Create Invoice';
  if (dom.invoiceCancelEditBtn) {
    dom.invoiceCancelEditBtn.classList.add('hidden');
  }

  renderBillingCustomerOptions();
  renderBillingProductOptions();
  resetBillingCustomerForm();
  renderDraftItems();
  if (state.currentView === 'billing') {
    focusBillingScannerInput();
  }
}

function renderInvoices() {
  const search = state.invoiceSearch;

  let invoices = [...state.invoices];
  if (search) {
    invoices = invoices.filter((invoice) => {
      const text = `${invoice.invoiceNo} ${invoice.customerSnapshot.name}`.toLowerCase();
      return text.includes(search);
    });
  }

  if (!invoices.length) {
    dom.invoicesBody.innerHTML = '<tr><td colspan="9" class="empty">No invoices found</td></tr>';
    return;
  }

  dom.invoicesBody.innerHTML = invoices
    .map((invoice) => {
      const paymentStatus = getInvoicePaymentStatus(invoice);
      const pendingAmount = getInvoicePendingAmount(invoice);
      const paymentLabel =
        paymentStatus === 'paid'
          ? 'Paid'
          : paymentStatus === 'partial'
            ? 'Partial'
            : 'Unpaid';
      const paymentModeLabel = getInvoicePaymentModeLabel(invoice);

      const receiveDisabled = pendingAmount <= 0 ? 'disabled' : '';

      return `
        <tr>
          <td>${invoice.invoiceNo}</td>
          <td>${formatDate(invoice.createdAt)}</td>
          <td><span class="tag ${invoice.channel}">${invoice.channel}</span></td>
          <td>${invoice.customerSnapshot.name}</td>
          <td>${formatMoney(invoice.total)}</td>
          <td>${formatMoney(pendingAmount)}</td>
          <td>
            <span class="tag payment-${paymentStatus}">${paymentLabel}</span>
            <div class="muted">${paymentModeLabel}</div>
          </td>
          <td>${invoice.gstEnabled ? `${invoice.gstRate}%` : 'No GST'}</td>
          <td>
            <div class="invoice-action-grid">
                <button class="btn small ghost" data-edit-invoice-id="${invoice.id}">Edit</button>
              <button class="btn small subtle" data-pay-id="${invoice.id}" ${receiveDisabled}>Receive</button>
              <button class="btn small subtle" data-preview-id="${invoice.id}">View</button>
              <button class="btn small subtle" data-preview-thermal-id="${invoice.id}">Thermal</button>
              <button class="btn small ghost" data-print-id="${invoice.id}">Print</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join('');
}

async function loadPnlReport(inputDate, inputPeriod, silent = false) {
  try {
    const dateKey = inputDate || dom.reportDate.value || todayKey();
    const period = normalizeReportPeriod(inputPeriod || state.reportPeriod || dom.reportPeriod.value);
    const report = await invoke('getDailyProfitLoss', {
      inputDate: dateKey,
      period
    });

    state.pnlReport = report;
    state.reportPeriod = normalizeReportPeriod(report.period || period);

    if (dom.reportPeriod.value !== state.reportPeriod) {
      dom.reportPeriod.value = state.reportPeriod;
    }

    const normalizedDate = report.inputDate || report.date || dateKey;
    if (dom.reportDate.value !== normalizedDate) {
      dom.reportDate.value = normalizedDate;
    }
    return true;
  } catch (error) {
    if (!silent) {
      showToast(error.message, 'error');
    }
    return false;
  }
}

async function loadTrialBalanceReport(inputDate, inputPeriod, silent = false) {
  try {
    const dateKey = inputDate || dom.reportDate.value || todayKey();
    const period = normalizeReportPeriod(inputPeriod || state.reportPeriod || dom.reportPeriod.value);
    const report = await invoke('getTrialBalance', {
      inputDate: dateKey,
      period
    });

    state.trialBalanceReport = report;
    return true;
  } catch (error) {
    if (!silent) {
      showToast(error.message, 'error');
    }
    return false;
  }
}

async function loadReports(inputDate, inputPeriod, silent = false) {
  const results = await Promise.all([
    loadPnlReport(inputDate, inputPeriod, true),
    loadTrialBalanceReport(inputDate, inputPeriod, true)
  ]);
  if (!silent && !results.some(Boolean)) {
    showToast('Unable to load reports', 'error');
  }
  renderReports();
}

function renderReports() {
  const report = state.pnlReport || {
    period: state.reportPeriod || 'daily',
    metrics: {
      invoiceCount: 0,
      purchaseCount: 0,
      expenseCount: 0,
      netSales: 0,
      cogs: 0,
      grossProfit: 0,
      purchaseTotal: 0,
      expenseTotal: 0,
      cashIn: 0,
      cashOut: 0,
      netCashflow: 0
    },
    history: []
  };
  const period = normalizeReportPeriod(report.period || state.reportPeriod);
  const history = Array.isArray(report.history)
    ? report.history
    : Array.isArray(report.recentDays)
      ? report.recentDays.map((row) => ({
          ...row,
          label: row.label || row.date || '-'
        }))
      : [];
  const metrics = report.metrics || {};
  dom.reportTitle.textContent = reportTitleByPeriod(period);
  dom.reportHistoryLabel.textContent = reportHistoryLabelByPeriod(period);

  dom.reportCards.innerHTML = `
    <article class="metric-card">
      <p class="metric-label">Net Sales</p>
      <p class="metric-value">${formatMoney(metrics.netSales)}</p>
    </article>
    <article class="metric-card">
      <p class="metric-label">COGS</p>
      <p class="metric-value">${formatMoney(metrics.cogs)}</p>
    </article>
    <article class="metric-card">
      <p class="metric-label">Gross Profit</p>
      <p class="metric-value">${formatMoney(metrics.grossProfit)}</p>
    </article>
    <article class="metric-card">
      <p class="metric-label">Purchase Spend</p>
      <p class="metric-value">${formatMoney(metrics.purchaseTotal)}</p>
    </article>
    <article class="metric-card">
      <p class="metric-label">Expenses</p>
      <p class="metric-value">${formatMoney(metrics.expenseTotal)}</p>
    </article>
    <article class="metric-card">
      <p class="metric-label">Cash In</p>
      <p class="metric-value">${formatMoney(metrics.cashIn)}</p>
    </article>
    <article class="metric-card">
      <p class="metric-label">Cash Out</p>
      <p class="metric-value">${formatMoney(metrics.cashOut)}</p>
    </article>
    <article class="metric-card">
      <p class="metric-label">Net Cashflow</p>
      <p class="metric-value">${formatMoney(metrics.netCashflow)}</p>
    </article>
    <article class="metric-card">
      <p class="metric-label">Txn Count</p>
      <p class="metric-value">S:${metrics.invoiceCount || 0} / P:${metrics.purchaseCount || 0} / E:${metrics.expenseCount || 0}</p>
    </article>
  `;

  if (!history.length) {
    dom.pnlHistoryBody.innerHTML = '<tr><td colspan="9" class="empty">No report data</td></tr>';
  } else {
    dom.pnlHistoryBody.innerHTML = history
      .map(
        (row) => `
          <tr>
            <td>${row.label || row.date || '-'}</td>
            <td>${formatMoney(row.netSales)}</td>
            <td>${formatMoney(row.cogs)}</td>
            <td>${formatMoney(row.grossProfit)}</td>
            <td>${formatMoney(row.purchaseTotal)}</td>
            <td>${formatMoney(row.expenseTotal)}</td>
            <td>${formatMoney(row.cashIn)}</td>
            <td>${formatMoney(row.cashOut)}</td>
            <td>${formatMoney(row.netCashflow)}</td>
          </tr>
        `
      )
      .join('');
  }

  renderTrialBalance();
}

function renderTrialBalance() {
  const report = state.trialBalanceReport || {
    periodLabel: '-',
    asOf: '-',
    rows: [],
    totals: {
      debit: 0,
      credit: 0,
      difference: 0
    },
    isBalanced: true
  };

  const asOfText = report.asOf ? `as of ${report.asOf}` : 'as of -';
  dom.trialBalanceTitle.textContent = `Trial Balance (${report.periodLabel || '-'}, ${asOfText})`;
  dom.trialBalanceStatus.textContent = report.isBalanced
    ? 'Balanced'
    : `Not balanced (Difference ${formatMoney(report.totals && report.totals.difference)})`;
  dom.trialBalanceStatus.classList.toggle('trial-unbalanced', !report.isBalanced);

  const totals = report.totals || { debit: 0, credit: 0, difference: 0 };
  dom.trialBalanceDebitTotal.textContent = formatMoney(totals.debit || 0);
  dom.trialBalanceCreditTotal.textContent = formatMoney(totals.credit || 0);
  dom.trialBalanceDiffTotal.textContent = formatMoney(totals.difference || 0);

  const rows = Array.isArray(report.rows) ? report.rows : [];
  if (!rows.length) {
    dom.trialBalanceBody.innerHTML = '<tr><td colspan="3" class="empty">No trial balance data</td></tr>';
    return;
  }

  dom.trialBalanceBody.innerHTML = rows
    .map(
      (row) => `
        <tr>
          <td>${row.account}</td>
          <td>${formatMoney(row.debit || 0)}</td>
          <td>${formatMoney(row.credit || 0)}</td>
        </tr>
      `
    )
    .join('');
}

function renderAll() {
  renderUiSettings();
  renderDashboard();
  renderBusiness();
  renderBackupSettings();
  renderProducts();
  renderCustomers();
  renderCustomerOptions();
  renderSuppliers();
  renderSupplierOptions();
  renderPurchaseProductOptions();
  renderExpenses();
  renderBillingProductOptions();
  renderBillingCustomerOptions();
  renderDraftItems();
  renderPurchaseDraftItems();
  renderPurchases();
  renderInvoices();
  renderReports();
  renderLicenseGate();
  scheduleTouchTableLabels();
}

async function reloadData() {
  const bootstrap = await invoke('getBootstrap');
  state.products = bootstrap.products || [];
  state.customers = bootstrap.customers || [];
  state.suppliers = bootstrap.suppliers || [];
  state.invoices = bootstrap.invoices || [];
  state.purchases = bootstrap.purchases || [];
  state.supplierPayments = bootstrap.supplierPayments || [];
  state.expenses = bootstrap.expenses || [];
  state.dashboard = bootstrap.dashboard || null;
  state.business = bootstrap.business || null;
  state.backup = bootstrap.backup || null;
  state.licenseStatus = bootstrap.licenseStatus || null;
  state.uiSettings = normalizeUiSettingsForUi(bootstrap.uiSettings);

  if (
    state.selectedLedgerCustomerId &&
    !state.customers.some((customer) => customer.id === state.selectedLedgerCustomerId)
  ) {
    state.selectedLedgerCustomerId = '';
  }

  if (
    state.selectedLedgerSupplierId &&
    !state.suppliers.some((supplier) => supplier.id === state.selectedLedgerSupplierId)
  ) {
    state.selectedLedgerSupplierId = '';
  }

  renderAll();
  await loadCustomerLedger(true);
  await loadSupplierLedger(true);
  await loadReports(dom.reportDate.value || todayKey(), state.reportPeriod, true);
}

async function initializeApp() {
  cacheDom();
  ensureTouchTableObserver();
  state.uiSettings = normalizeUiSettingsForUi({});
  applyUiMode(resolveUiModeForView('dashboard', state.uiSettings));
  applyThemeMode(state.uiSettings.themeMode);
  bindLicense();
  bindNavigation();
  bindSidebarShortcuts();
  bindActionShortcuts();
  bindThemeMode();
  bindUiMode();
  bindThermalPrinting();
  bindBusiness();
  bindBackup();
  bindProducts();
  bindCustomers();
  bindSuppliers();
  bindPurchases();
  bindExpenses();
  bindBilling();
  bindInvoices();
  bindReports();

  dom.invoiceGstRate.disabled = !dom.invoiceGstEnabled.checked;
  dom.purchaseGstRate.disabled = !dom.purchaseGstEnabled.checked;
  state.reportPeriod = 'daily';
  dom.reportPeriod.value = state.reportPeriod;
  dom.reportDate.value = todayKey();
  resetExpenseForm();
  state.billingProductSearch = '';
  dom.billingProductSearch.value = '';
  resetPurchaseSupplierForm();
  resetPurchaseProductForm();
  resetBillingCustomerForm();

  try {
    setStatus('Loading data...');
    await reloadData();
    await refreshThermalPrinters({ silentError: true });
    if (state.licenseStatus?.isActive) {
      if (resolveUiModeForView('billing') === 'touch') {
        switchView('billing');
      }
      setStatus('Live');
      focusBillingScannerInput();
    } else {
      setStatus('License required');
      dom.licenseKeyInput.focus();
    }
  } catch (error) {
    setStatus('Failed to load');
    showToast(error.message, 'error');
  }
}

document.addEventListener('DOMContentLoaded', initializeApp);
