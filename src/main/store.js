const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { randomUUID } = require('crypto');

function nowIso() {
  return new Date().toISOString();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  if (Number.isNaN(parsed) || !Number.isFinite(parsed)) {
    return fallback;
  }

  return parsed;
}

function sanitizeNarrationText(value) {
  const lines = String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      const normalized = line.toLowerCase();
      return ![
        'computer generated invoice',
        'computer generated invoice.',
        'computer generated receipt',
        'computer generated receipt.',
        'this is a computer generated invoice',
        'this is a computer generated invoice.',
        'this is a computer generated receipt',
        'this is a computer generated receipt.'
      ].includes(normalized);
    });

  return lines.join('\n').trim();
}

function normalizeHsnCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
}

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizePaymentMethod(value) {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'cash' || text === 'bank' || text === 'upi' || text === 'card' || text === 'other') {
    return text;
  }

  if (text === 'digital' || text === 'online' || text === 'bank_transfer' || text === 'bank transfer') {
    return 'bank';
  }

  return 'cash';
}

function normalizeRecordId(value) {
  if (value === undefined || value === null) {
    return randomUUID();
  }

  const text = String(value).trim();
  return text || randomUUID();
}

function normalizeRefId(value) {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value).trim();
}

function parseJsonSafely(value, fallback = null) {
  try {
    return JSON.parse(String(value || ''));
  } catch (_error) {
    return fallback;
  }
}

function fallbackDocumentNumber(prefix, createdAt, id) {
  const year = new Date(createdAt || Date.now()).getFullYear();
  const suffix = String(id || '')
    .replace(/[^a-z0-9]/gi, '')
    .toUpperCase()
    .slice(0, 8);

  return `${prefix}-${year}-${suffix || 'PENDING'}`;
}

function normalizePartySnapshot(snapshot, fallbackName, fallbackType = 'retail') {
  const source = snapshot && typeof snapshot === 'object' ? snapshot : {};

  return {
    name: String(source.name || fallbackName || '').trim() || fallbackName,
    type: String(source.type || fallbackType).trim().toLowerCase() === 'wholesale' ? 'wholesale' : 'retail',
    phone: String(source.phone || '').trim(),
    address: String(source.address || '').trim(),
    gstin: String(source.gstin || '').trim().toUpperCase()
  };
}

const LICENSE_MAX_KEYS = 36;
const LICENSE_KEY_DAYS = 31;
const MAX_BUSINESS_LOGO_DATA_URL_LENGTH = 2800000;

function defaultBusiness() {
  return {
    name: ' Grocery Store',
    phone: '+91 90000 00000',
    address: 'Main Street',
    gstin: '',
    logoDataUrl: ''
  };
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

const UI_MODE_VIEWS = [
  'dashboard',
  'products',
  'customers',
  'suppliers',
  'purchases',
  'expenses',
  'billing',
  'invoices',
  'reports',
  'settings'
];

function normalizeUiViewMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'pc' || mode === 'touch') {
    return mode;
  }

  return 'global';
}

function normalizeUiViewModes(source) {
  const input = source && typeof source === 'object' ? source : {};
  const result = {};

  for (const viewName of UI_MODE_VIEWS) {
    const mode = normalizeUiViewMode(input[viewName]);
    if (mode !== 'global') {
      result[viewName] = mode;
    }
  }

  return result;
}

function defaultUiSettings() {
  return {
    themeMode: 'auto',
    uiMode: 'pc',
    viewModes: {},
    setupCompleted: false,
    billingGstEnabled: false,
    billingGstRate: 0,
    thermalAutoPrintEnabled: false,
    thermalPrinterName: ''
  };
}

function defaultGstFilingHistory() {
  return [];
}

function defaultGstLockedPeriods() {
  return [];
}

function defaultBackupSettings() {
  return {
    mode: 'local-folder',
    enabled: false,
    folderPath: '',
    autoBackupEnabled: false,
    autoBackupIntervalHours: 24,
    lastBackupAt: null,
    lastBackupFileId: '',
    lastBackupFileName: '',
    lastBackupStatus: 'never',
    lastBackupError: '',
    lastRestoreAt: null,
    lastRestoreFileId: '',
    lastRestoreFileName: '',
    lastRestoreStatus: 'never',
    lastRestoreError: '',
    updatedAt: nowIso()
  };
}

function normalizeStatus(value) {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'never' || text === 'success' || text === 'failed') {
    return text;
  }

  return 'never';
}

function normalizeIsoOrNull(value) {
  const text = String(value || '').trim();
  if (!text) {
    return null;
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function normalizeBackupSettings(backupSource) {
  const defaults = defaultBackupSettings();
  const source = backupSource && typeof backupSource === 'object' ? backupSource : {};

  const interval = Math.trunc(toNumber(source.autoBackupIntervalHours, defaults.autoBackupIntervalHours));

  return {
    mode: String(source.mode || defaults.mode).trim().toLowerCase() === 'local-folder' ? 'local-folder' : 'local-folder',
    enabled: Boolean(source.enabled),
    folderPath: String(source.folderPath || '').trim(),
    autoBackupEnabled: Boolean(source.autoBackupEnabled),
    autoBackupIntervalHours: Math.max(1, Math.min(168, interval || defaults.autoBackupIntervalHours)),
    lastBackupAt: normalizeIsoOrNull(source.lastBackupAt),
    lastBackupFileId: String(source.lastBackupFileId || '').trim(),
    lastBackupFileName: String(source.lastBackupFileName || '').trim(),
    lastBackupStatus: normalizeStatus(source.lastBackupStatus),
    lastBackupError: String(source.lastBackupError || '').trim(),
    lastRestoreAt: normalizeIsoOrNull(source.lastRestoreAt),
    lastRestoreFileId: String(source.lastRestoreFileId || '').trim(),
    lastRestoreFileName: String(source.lastRestoreFileName || '').trim(),
    lastRestoreStatus: normalizeStatus(source.lastRestoreStatus),
    lastRestoreError: String(source.lastRestoreError || '').trim(),
    updatedAt: normalizeIsoOrNull(source.updatedAt) || nowIso()
  };
}

function detectSkuCounter(products) {
  let maxNumericSku = 10000;

  for (const product of products) {
    const sku = String(product.sku || '').trim();
    if (!/^\d+$/.test(sku)) {
      continue;
    }

    const numeric = Math.trunc(toNumber(sku, 0));
    if (numeric > maxNumericSku) {
      maxNumericSku = numeric;
    }
  }

  return maxNumericSku;
}

function defaultLicense() {
  return {
    maxKeys: LICENSE_MAX_KEYS,
    keyDays: LICENSE_KEY_DAYS,
    activatedIndexes: [],
    activationHistory: [],
    godMode: false,
    godActivatedAt: null,
    validUntil: null,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

function normalizeProduct(product) {
  const legacyRetailPrice = round2(toNumber(product.retailPrice, 0));
  const loosePrice = round2(toNumber(product.loosePrice, legacyRetailPrice));
  const retailPrice = loosePrice > 0 ? loosePrice : legacyRetailPrice;
  const wholesalePrice = round2(toNumber(product.wholesalePrice, retailPrice));
  const fallbackCost = wholesalePrice > 0 ? wholesalePrice : retailPrice;
  const costPrice = round2(toNumber(product.costPrice, fallbackCost));
  const packSize = Math.max(1, Math.trunc(toNumber(product.packSize, 1)));
  const explicitPackEnabled = Boolean(product.packEnabled);
  const rawPackPrice = round2(toNumber(product.packPrice, retailPrice * packSize));
  const inferredPackEnabled = explicitPackEnabled || packSize > 1 || rawPackPrice > 0;
  const packEnabled = inferredPackEnabled && packSize > 1;
  const packPrice = round2(toNumber(product.packPrice, retailPrice * packSize));

  return {
    id: normalizeRecordId(product.id),
    sku: String(product.sku || '').trim().toUpperCase(),
    barcode: String(product.barcode || '').trim(),
    hsnCode: normalizeHsnCode(product.hsnCode),
    name: String(product.name || '').trim(),
    category: String(product.category || 'General').trim() || 'General',
    unit: String(product.unit || 'Unit').trim() || 'Unit',
    costPrice: costPrice > 0 ? costPrice : 0,
    retailPrice,
    loosePrice: retailPrice,
    packEnabled,
    packSize,
    packPrice: packEnabled ? packPrice : 0,
    wholesalePrice,
    wholesaleMinQty: round2(toNumber(product.wholesaleMinQty, 1)),
    stock: round2(toNumber(product.stock, 0)),
    reorderLevel: round2(toNumber(product.reorderLevel, 0)),
    createdAt: product.createdAt || nowIso(),
    updatedAt: product.updatedAt || nowIso()
  };
}

function normalizeCustomer(customer) {
  return {
    id: normalizeRecordId(customer.id),
    name: String(customer.name || '').trim(),
    type: customer.type === 'wholesale' ? 'wholesale' : 'retail',
    phone: String(customer.phone || '').trim(),
    address: String(customer.address || '').trim(),
    gstin: String(customer.gstin || '').trim().toUpperCase(),
    createdAt: customer.createdAt || nowIso(),
    updatedAt: customer.updatedAt || nowIso()
  };
}

function normalizeSupplier(supplier) {
  return {
    id: normalizeRecordId(supplier.id),
    name: String(supplier.name || '').trim(),
    phone: String(supplier.phone || '').trim(),
    address: String(supplier.address || '').trim(),
    gstin: String(supplier.gstin || '').trim().toUpperCase(),
    createdAt: supplier.createdAt || nowIso(),
    updatedAt: supplier.updatedAt || nowIso()
  };
}

function normalizeInvoice(invoice) {
  const createdAt = invoice.createdAt || nowIso();
  const rawItems = Array.isArray(invoice.items) ? invoice.items : [];
  const discount = round2(toNumber(invoice.discount, 0));
  const subtotal = round2(
    toNumber(
      invoice.subtotal,
      rawItems.reduce(
        (sum, item) =>
          sum +
          round2(toNumber(item.lineTotal, toNumber(item.qty, 0) * toNumber(item.unitPrice, 0))),
        0
      )
    )
  );
  const gstRate = round2(toNumber(invoice.gstRate, 0));
  const gstAmount = round2(toNumber(invoice.gstAmount, 0));
  const taxableValue = round2(toNumber(invoice.taxableValue, Math.max(subtotal - discount, 0)));
  const total = round2(toNumber(invoice.total, taxableValue + gstAmount));
  const paidAmount = round2(toNumber(invoice.paidAmount, 0));
  const balance = round2(toNumber(invoice.balance, Math.max(total - paidAmount, 0)));
  const change = round2(toNumber(invoice.change, Math.max(paidAmount - total, 0)));
  const paymentStatus =
    balance <= 0 ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid';
  const gstEnabled = Boolean(invoice.gstEnabled) || gstRate > 0 || gstAmount > 0;
  const normalizedId = normalizeRecordId(invoice.id);
  const invoiceNo = String(invoice.invoiceNo || invoice.invoiceNumber || invoice.number || '').trim();

  return {
    ...invoice,
    id: normalizedId,
    invoiceNo: invoiceNo || fallbackDocumentNumber('INV', createdAt, normalizedId),
    channel: String(invoice.channel || '').trim().toLowerCase() === 'wholesale' ? 'wholesale' : 'retail',
    customerId: normalizeRefId(invoice.customerId) || null,
    customerSnapshot: normalizePartySnapshot(invoice.customerSnapshot, 'Walk-in Customer'),
    subtotal,
    discount,
    taxableValue: round2(toNumber(invoice.taxableValue, Math.max(total - gstAmount, 0))),
    gstEnabled,
    gstRate,
    gstAmount,
    total,
    paidAmount,
    change,
    balance,
    paidMethod: normalizePaymentMethod(invoice.paidMethod || invoice.paymentMethod || invoice.paidVia),
    paymentStatus: ['unpaid', 'partial', 'paid'].includes(String(invoice.paymentStatus))
      ? String(invoice.paymentStatus)
      : paymentStatus,
    notes: sanitizeNarrationText(invoice.notes),
    createdAt,
    updatedAt: invoice.updatedAt || nowIso(),
    paymentHistory: Array.isArray(invoice.paymentHistory)
      ? invoice.paymentHistory.map((entry) => ({
          id: normalizeRecordId(entry.id),
          amount: round2(toNumber(entry.amount, 0)),
          note: sanitizeNarrationText(entry.note),
          paymentMethod: normalizePaymentMethod(entry.paymentMethod || entry.mode || entry.method),
          createdAt: entry.createdAt || nowIso()
        }))
      : [],
    items: Array.isArray(invoice.items)
      ? invoice.items.map((item) => {
          const qty = round2(toNumber(item.qty, 0));
          const saleUnit = String(item.saleUnit || '').toLowerCase() === 'pack' ? 'pack' : 'loose';
          const packSize = Math.max(1, Math.trunc(toNumber(item.packSize, 1)));
          const baseQtyFromItem = round2(toNumber(item.baseQty, NaN));
          const baseQty =
            Number.isFinite(baseQtyFromItem) && baseQtyFromItem > 0
              ? baseQtyFromItem
              : saleUnit === 'pack'
                ? round2(qty * packSize)
                : qty;
          const costPriceRaw = toNumber(item.costPrice, NaN);
          const costPrice =
            Number.isFinite(costPriceRaw) && costPriceRaw > 0 ? round2(costPriceRaw) : null;

          return {
            ...item,
            productId: normalizeRefId(item.productId),
            hsnCode: normalizeHsnCode(item.hsnCode),
            qty,
            baseQty,
            saleUnit,
            packSize,
            looseUnit: String(item.looseUnit || item.unit || '').trim(),
            unitPrice: round2(toNumber(item.unitPrice, 0)),
            lineTotal: round2(toNumber(item.lineTotal, 0)),
            costPrice
          };
        })
      : []
  };
}

function normalizePurchase(purchase) {
  const createdAt = purchase.createdAt || nowIso();
  const rawItems = Array.isArray(purchase.items) ? purchase.items : [];
  const discount = round2(toNumber(purchase.discount, 0));
  const subtotal = round2(
    toNumber(
      purchase.subtotal,
      rawItems.reduce(
        (sum, item) =>
          sum +
          round2(toNumber(item.lineTotal, toNumber(item.qty, 0) * toNumber(item.unitCost, 0))),
        0
      )
    )
  );
  const gstRate = round2(toNumber(purchase.gstRate, 0));
  const gstAmount = round2(toNumber(purchase.gstAmount, 0));
  const taxableValue = round2(toNumber(purchase.taxableValue, Math.max(subtotal - discount, 0)));
  const total = round2(toNumber(purchase.total, taxableValue + gstAmount));
  const paidAmount = round2(toNumber(purchase.paidAmount, 0));
  const gstEnabled = Boolean(purchase.gstEnabled) || gstRate > 0 || gstAmount > 0;
  const normalizedId = normalizeRecordId(purchase.id);
  const purchaseNo = String(purchase.purchaseNo || purchase.number || '').trim();

  return {
    ...purchase,
    id: normalizedId,
    purchaseNo: purchaseNo || fallbackDocumentNumber('PUR', createdAt, normalizedId),
    supplierId: normalizeRefId(purchase.supplierId),
    supplierSnapshot: normalizePartySnapshot(purchase.supplierSnapshot, 'Unknown Supplier'),
    subtotal,
    discount,
    taxableValue: round2(toNumber(purchase.taxableValue, Math.max(total - gstAmount, 0))),
    gstEnabled,
    gstRate,
    gstAmount,
    total,
    paidAmount,
    paidMethod: normalizePaymentMethod(purchase.paidMethod || purchase.paymentMethod || purchase.paidVia),
    dueAmount: round2(
      toNumber(purchase.dueAmount, Math.max(total - paidAmount, 0))
    ),
    balance: round2(toNumber(purchase.balance, 0)),
    notes: sanitizeNarrationText(purchase.notes),
    createdAt,
    updatedAt: purchase.updatedAt || nowIso(),
    items: Array.isArray(purchase.items)
      ? purchase.items.map((item) => ({
          ...item,
          productId: normalizeRefId(item.productId),
          hsnCode: normalizeHsnCode(item.hsnCode),
          qty: round2(toNumber(item.qty, 0)),
          unitCost: round2(toNumber(item.unitCost, 0)),
          lineTotal: round2(toNumber(item.lineTotal, 0))
        }))
      : []
  };
}

function normalizeGstNote(gstNote) {
  const createdAt = gstNote.createdAt || nowIso();
  const taxableValue = round2(toNumber(gstNote.taxableValue, 0));
  const gstRate = round2(Math.max(toNumber(gstNote.gstRate, 0), 0));
  const fallbackGstAmount = taxableValue > 0 ? round2((taxableValue * gstRate) / 100) : 0;
  const gstAmount = round2(toNumber(gstNote.gstAmount, fallbackGstAmount));
  const total = round2(toNumber(gstNote.total, taxableValue + gstAmount));
  const noteType = String(gstNote.noteType || '').trim().toLowerCase() === 'debit' ? 'debit' : 'credit';
  const direction = String(gstNote.direction || '').trim().toLowerCase() === 'inward' ? 'inward' : 'outward';
  const referenceType = String(gstNote.referenceType || '').trim().toLowerCase();

  return {
    id: normalizeRecordId(gstNote.id),
    noteNo: String(gstNote.noteNo || '').trim(),
    noteType,
    direction,
    referenceType:
      referenceType === 'invoice' || referenceType === 'purchase' || referenceType === 'manual'
        ? referenceType
        : 'manual',
    referenceId: normalizeRefId(gstNote.referenceId),
    referenceNo: String(gstNote.referenceNo || '').trim(),
    partyName: String(gstNote.partyName || '').trim(),
    partyGstin: String(gstNote.partyGstin || '').trim().toUpperCase(),
    taxableValue,
    gstRate,
    gstAmount,
    total,
    notes: sanitizeNarrationText(gstNote.notes),
    createdAt,
    updatedAt: gstNote.updatedAt || nowIso()
  };
}

function normalizeGstFilingHistoryEntry(entry) {
  const source = entry && typeof entry === 'object' ? entry : {};
  const allowedPeriods = ['daily', 'monthly', 'yearly'];
  const period = allowedPeriods.includes(String(source.period || '').trim().toLowerCase())
    ? String(source.period).trim().toLowerCase()
    : 'monthly';

  return {
    id: normalizeRecordId(source.id),
    period,
    periodKey: String(source.periodKey || '').trim(),
    periodLabel: String(source.periodLabel || '').trim(),
    rangeStart: normalizeIsoOrNull(source.rangeStart),
    rangeEnd: normalizeIsoOrNull(source.rangeEnd),
    returnTypes: Array.isArray(source.returnTypes)
      ? Array.from(
          new Set(
            source.returnTypes
              .map((value) => String(value || '').trim().toUpperCase())
              .filter(Boolean)
          )
        )
      : [],
    acknowledgementNo: String(source.acknowledgementNo || '').trim(),
    portalReference: String(source.portalReference || '').trim(),
    notes: sanitizeNarrationText(source.notes),
    filedAt: normalizeIsoOrNull(source.filedAt) || nowIso(),
    locked: Boolean(source.locked),
    summary:
      source.summary && typeof source.summary === 'object'
        ? clone(source.summary)
        : null
  };
}

function normalizeGstLockedPeriod(entry) {
  const source = entry && typeof entry === 'object' ? entry : {};
  const allowedPeriods = ['daily', 'monthly', 'yearly'];
  const period = allowedPeriods.includes(String(source.period || '').trim().toLowerCase())
    ? String(source.period).trim().toLowerCase()
    : 'monthly';

  return {
    id: normalizeRecordId(source.id),
    period,
    periodKey: String(source.periodKey || '').trim(),
    periodLabel: String(source.periodLabel || '').trim(),
    rangeStart: normalizeIsoOrNull(source.rangeStart),
    rangeEnd: normalizeIsoOrNull(source.rangeEnd),
    lockedAt: normalizeIsoOrNull(source.lockedAt) || nowIso(),
    unlockedAt: normalizeIsoOrNull(source.unlockedAt),
    filingHistoryId: normalizeRefId(source.filingHistoryId),
    acknowledgementNo: String(source.acknowledgementNo || '').trim(),
    notes: sanitizeNarrationText(source.notes),
    active: source.active === undefined ? true : Boolean(source.active)
  };
}

function normalizeSupplierPayment(payment) {
  return {
    ...payment,
    id: normalizeRecordId(payment.id),
    supplierId: normalizeRefId(payment.supplierId),
    amount: round2(toNumber(payment.amount, 0)),
    paymentMethod: normalizePaymentMethod(payment.paymentMethod || payment.mode || payment.method),
    notes: sanitizeNarrationText(payment.notes),
    createdAt: payment.createdAt || nowIso(),
    updatedAt: payment.updatedAt || nowIso(),
    allocations: Array.isArray(payment.allocations)
      ? payment.allocations.map((entry) => ({
          ...entry,
          purchaseId: normalizeRefId(entry.purchaseId),
          amount: round2(toNumber(entry.amount, 0))
        }))
      : []
  };
}

function normalizeExpense(expense) {
  return {
    id: normalizeRecordId(expense.id),
    expenseNo: String(expense.expenseNo || '').trim(),
    category: String(expense.category || 'Other').trim() || 'Other',
    amount: round2(toNumber(expense.amount, 0)),
    paymentMethod: normalizePaymentMethod(expense.paymentMethod || expense.mode || expense.method),
    paidTo: String(expense.paidTo || '').trim(),
    notes: sanitizeNarrationText(expense.notes),
    createdAt: expense.createdAt || nowIso(),
    updatedAt: expense.updatedAt || nowIso()
  };
}

function normalizeLicense(licenseSource) {
  const defaults = defaultLicense();
  const source = licenseSource && typeof licenseSource === 'object' ? licenseSource : {};

  const activatedIndexes = Array.isArray(source.activatedIndexes)
    ? Array.from(
        new Set(
          source.activatedIndexes
            .map((value) => Math.trunc(toNumber(value, NaN)))
            .filter((value) => Number.isInteger(value) && value >= 1 && value <= defaults.maxKeys)
        )
      ).sort((a, b) => a - b)
    : [];

  const activationHistory = Array.isArray(source.activationHistory)
    ? source.activationHistory
        .map((entry) => ({
          index: Math.trunc(toNumber(entry.index, 0)),
          key: String(entry.key || '').replace(/\D/g, '').slice(0, 12),
          activatedAt: entry.activatedAt || nowIso(),
          validUntil: entry.validUntil || null
        }))
        .filter((entry) => entry.index >= 1 && entry.index <= defaults.maxKeys)
    : [];

  const validUntil = source.validUntil ? String(source.validUntil) : null;
  const parsedExpiry = validUntil ? new Date(validUntil) : null;

  return {
    maxKeys: defaults.maxKeys,
    keyDays: defaults.keyDays,
    activatedIndexes,
    activationHistory,
    godMode: Boolean(source.godMode),
    godActivatedAt: source.godActivatedAt ? String(source.godActivatedAt) : null,
    validUntil:
      parsedExpiry && !Number.isNaN(parsedExpiry.getTime()) ? parsedExpiry.toISOString() : null,
    createdAt: source.createdAt || defaults.createdAt,
    updatedAt: source.updatedAt || defaults.updatedAt
  };
}

function normalizeUiSettings(uiSettingsSource) {
  const defaults = defaultUiSettings();
  const source = uiSettingsSource && typeof uiSettingsSource === 'object' ? uiSettingsSource : {};

  return {
    themeMode: normalizeThemeMode(source.themeMode || defaults.themeMode),
    uiMode: normalizeUiMode(source.uiMode || defaults.uiMode),
    viewModes: normalizeUiViewModes(source.viewModes),
    setupCompleted: Boolean(source.setupCompleted),
    billingGstEnabled: Boolean(source.billingGstEnabled),
    billingGstRate: Math.max(0, round2(toNumber(source.billingGstRate, defaults.billingGstRate))),
    thermalAutoPrintEnabled: Boolean(source.thermalAutoPrintEnabled),
    thermalPrinterName: String(source.thermalPrinterName || '').trim()
  };
}

function normalizeData(source) {
  const createdAt = nowIso();
  const data = source && typeof source === 'object' ? source : {};

  const meta = data.meta && typeof data.meta === 'object' ? data.meta : {};
  const businessSource = meta.business && typeof meta.business === 'object' ? meta.business : {};
  const businessDefault = defaultBusiness();
  const normalizedProducts = Array.isArray(data.products) ? data.products.map(normalizeProduct) : [];
  const detectedSkuCounter = detectSkuCounter(normalizedProducts);

  return {
    meta: {
      invoiceCounter: Math.max(0, Math.trunc(toNumber(meta.invoiceCounter, 0))),
      purchaseCounter: Math.max(0, Math.trunc(toNumber(meta.purchaseCounter, 0))),
      paymentCounter: Math.max(0, Math.trunc(toNumber(meta.paymentCounter, 0))),
      expenseCounter: Math.max(0, Math.trunc(toNumber(meta.expenseCounter, 0))),
      skuCounter: Math.max(
        10000,
        Math.trunc(toNumber(meta.skuCounter, detectedSkuCounter)),
        detectedSkuCounter
      ),
      license: normalizeLicense(meta.license),
      uiSettings: normalizeUiSettings(meta.uiSettings),
      backup: normalizeBackupSettings(meta.backup),
      gstFilingHistory: Array.isArray(meta.gstFilingHistory)
        ? meta.gstFilingHistory.map(normalizeGstFilingHistoryEntry)
        : defaultGstFilingHistory(),
      gstLockedPeriods: Array.isArray(meta.gstLockedPeriods)
        ? meta.gstLockedPeriods.map(normalizeGstLockedPeriod)
        : defaultGstLockedPeriods(),
      business: {
        name: String(businessSource.name || businessDefault.name).trim(),
        phone: String(businessSource.phone || businessDefault.phone).trim(),
        address: String(businessSource.address || businessDefault.address).trim(),
        gstin: String(businessSource.gstin || businessDefault.gstin).trim().toUpperCase(),
        logoDataUrl: normalizeBusinessLogoDataUrl(businessSource.logoDataUrl || businessDefault.logoDataUrl)
      },
      createdAt: meta.createdAt || createdAt,
      updatedAt: meta.updatedAt || createdAt
    },
    products: normalizedProducts,
    customers: Array.isArray(data.customers) ? data.customers.map(normalizeCustomer) : [],
    suppliers: Array.isArray(data.suppliers) ? data.suppliers.map(normalizeSupplier) : [],
    invoices: Array.isArray(data.invoices) ? data.invoices.map(normalizeInvoice) : [],
    purchases: Array.isArray(data.purchases) ? data.purchases.map(normalizePurchase) : [],
    gstNotes: Array.isArray(data.gstNotes) ? data.gstNotes.map(normalizeGstNote) : [],
    supplierPayments: Array.isArray(data.supplierPayments)
      ? data.supplierPayments.map(normalizeSupplierPayment)
      : [],
    expenses: Array.isArray(data.expenses) ? data.expenses.map(normalizeExpense) : []
  };
}

function getSeedData() {
  const createdAt = nowIso();

  return normalizeData({
    meta: {
      invoiceCounter: 0,
      purchaseCounter: 0,
      paymentCounter: 0,
      expenseCounter: 0,
      skuCounter: 10000,
      license: defaultLicense(),
      uiSettings: defaultUiSettings(),
      backup: defaultBackupSettings(),
      gstFilingHistory: defaultGstFilingHistory(),
      gstLockedPeriods: defaultGstLockedPeriods(),
      business: defaultBusiness(),
      createdAt,
      updatedAt: createdAt
    },
    products: [
      
    ],
    customers: [
      {
        id: randomUUID(),
        name: 'Walk-in Customer',
        type: 'retail',
        phone: '',
        address: '',
        gstin: '',
        createdAt,
        updatedAt: createdAt
      },
      
    ],
    suppliers: [
      
    ],
    invoices: [],
    purchases: [],
    gstNotes: [],
    supplierPayments: [],
    expenses: []
  });
}

const Database = require('better-sqlite3');

class LocalStore {
  constructor(fileName = 'erpmania-data.sqlite') {
    const dataDir = path.join(app.getPath('userData'), 'data');
    this.filePath = path.join(dataDir, fileName);

    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    this.db = new Database(this.filePath);
    this.initSchema();
    this.data = this.readDB();
  }

  initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, sku TEXT, barcode TEXT, name TEXT, category TEXT, unit TEXT, costPrice REAL, retailPrice REAL, loosePrice REAL, packEnabled INTEGER, packSize REAL, packPrice REAL, wholesalePrice REAL, wholesaleMinQty REAL, stock REAL, reorderLevel REAL, createdAt TEXT, updatedAt TEXT);
      CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, name TEXT, type TEXT, phone TEXT, address TEXT, gstin TEXT, createdAt TEXT, updatedAt TEXT);
      CREATE TABLE IF NOT EXISTS suppliers (id TEXT PRIMARY KEY, name TEXT, phone TEXT, address TEXT, gstin TEXT, createdAt TEXT, updatedAt TEXT);
      CREATE TABLE IF NOT EXISTS invoices (id TEXT PRIMARY KEY, invoiceNo TEXT, channel TEXT, customerId TEXT, customerSnapshotJson TEXT, subtotal REAL, discount REAL, taxableValue REAL, gstEnabled INTEGER, gstRate REAL, gstAmount REAL, total REAL, paidAmount REAL, change REAL, balance REAL, paidMethod TEXT, paymentStatus TEXT, notes TEXT, createdAt TEXT, updatedAt TEXT, itemsJson TEXT, paymentHistoryJson TEXT);
      CREATE TABLE IF NOT EXISTS purchases (id TEXT PRIMARY KEY, purchaseNo TEXT, supplierId TEXT, supplierSnapshotJson TEXT, subtotal REAL, discount REAL, taxableValue REAL, gstEnabled INTEGER, gstRate REAL, gstAmount REAL, total REAL, paidAmount REAL, dueAmount REAL, balance REAL, paidMethod TEXT, notes TEXT, createdAt TEXT, updatedAt TEXT, itemsJson TEXT);
      CREATE TABLE IF NOT EXISTS gstNotes (id TEXT PRIMARY KEY, noteNo TEXT, noteType TEXT, direction TEXT, referenceType TEXT, referenceId TEXT, referenceNo TEXT, partyName TEXT, partyGstin TEXT, taxableValue REAL, gstRate REAL, gstAmount REAL, total REAL, notes TEXT, createdAt TEXT, updatedAt TEXT);
      CREATE TABLE IF NOT EXISTS supplierPayments (id TEXT PRIMARY KEY, supplierId TEXT, amount REAL, paymentMethod TEXT, createdAt TEXT, updatedAt TEXT, allocationsJson TEXT);
      CREATE TABLE IF NOT EXISTS expenses (id TEXT PRIMARY KEY, expenseNo TEXT, category TEXT, amount REAL, paymentMethod TEXT, paidTo TEXT, notes TEXT, createdAt TEXT, updatedAt TEXT);
    `);

    this.ensureColumn('products', 'hsnCode', 'TEXT');
    this.ensureColumn('invoices', 'invoiceNo', 'TEXT');
    this.ensureColumn('invoices', 'channel', 'TEXT');
    this.ensureColumn('invoices', 'customerSnapshotJson', 'TEXT');
    this.ensureColumn('invoices', 'subtotal', 'REAL');
    this.ensureColumn('invoices', 'change', 'REAL');
    this.ensureColumn('invoices', 'notes', 'TEXT');

    this.ensureColumn('purchases', 'purchaseNo', 'TEXT');
    this.ensureColumn('purchases', 'supplierSnapshotJson', 'TEXT');
    this.ensureColumn('purchases', 'subtotal', 'REAL');
    this.ensureColumn('purchases', 'notes', 'TEXT');
  }

  ensureColumn(tableName, columnName, definition) {
    const columns = this.db.prepare(`PRAGMA table_info(${tableName})`).all();
    if (columns.some((column) => column.name === columnName)) {
      return;
    }

    this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }

  readDB() {
    try {
       const metaRows = this.db.prepare('SELECT * FROM meta').all();
       if (metaRows.length === 0) {
         const jsonPath = this.filePath.replace('.sqlite', '.json');
         let parsedData;
         if (fs.existsSync(jsonPath)) {
            parsedData = normalizeData(JSON.parse(fs.readFileSync(jsonPath, 'utf8')));
         } else {
            parsedData = getSeedData();
         }
         this.writeDB(parsedData);
         return parsedData;
       }
       const meta = {}; metaRows.forEach(r => meta[r.key] = r.value);
       
       const products = this.db.prepare('SELECT * FROM products').all().map(p => ({...p, packEnabled: p.packEnabled === 1}));
       const customers = this.db.prepare('SELECT * FROM customers').all();
       const suppliers = this.db.prepare('SELECT * FROM suppliers').all();
       const invoices = this.db.prepare('SELECT * FROM invoices').all().map((i) => ({
         ...i,
         gstEnabled: i.gstEnabled === 1,
         customerSnapshot: parseJsonSafely(i.customerSnapshotJson, {}),
         items: parseJsonSafely(i.itemsJson, []),
         paymentHistory: parseJsonSafely(i.paymentHistoryJson, [])
       }));
       const purchases = this.db.prepare('SELECT * FROM purchases').all().map((p) => ({
         ...p,
         gstEnabled: p.gstEnabled === 1,
         supplierSnapshot: parseJsonSafely(p.supplierSnapshotJson, {}),
         items: parseJsonSafely(p.itemsJson, [])
       }));
       const gstNotes = this.db.prepare('SELECT * FROM gstNotes').all();
       const supplierPayments = this.db.prepare('SELECT * FROM supplierPayments').all().map((s) => ({...s, allocations: parseJsonSafely(s.allocationsJson, [])}));
       const expenses = this.db.prepare('SELECT * FROM expenses').all();

       const parsedMeta = {
         invoiceCounter: Number(meta.invoiceCounter || 0),
         purchaseCounter: Number(meta.purchaseCounter || 0),
         paymentCounter: Number(meta.paymentCounter || 0),
         expenseCounter: Number(meta.expenseCounter || 0),
         skuCounter: Number(meta.skuCounter || 10000),
         business: meta.business ? JSON.parse(meta.business) : {},
         uiSettings: meta.uiSettings ? JSON.parse(meta.uiSettings) : {},
         gstFilingHistory: meta.gstFilingHistory ? JSON.parse(meta.gstFilingHistory) : [],
         gstLockedPeriods: meta.gstLockedPeriods ? JSON.parse(meta.gstLockedPeriods) : [],
         license: meta.license ? JSON.parse(meta.license) : null,
         createdAt: meta.createdAt || nowIso(),
         updatedAt: meta.updatedAt || nowIso()
       };

       return normalizeData({ meta: parsedMeta, products, customers, suppliers, invoices, purchases, gstNotes, supplierPayments, expenses });
    } catch(e) {
       console.error("Failed to read SQLite", e);
       const seed = getSeedData();
       this.writeDB(seed);
       return seed;
    }
  }

  writeDB(data) {
    const db = this.db;
    const runInTransaction = db.transaction((d) => {
      const insertMeta = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
      insertMeta.run('invoiceCounter', String(d.meta.invoiceCounter || 0));
      insertMeta.run('purchaseCounter', String(d.meta.purchaseCounter || 0));
      insertMeta.run('paymentCounter', String(d.meta.paymentCounter || 0));
      insertMeta.run('expenseCounter', String(d.meta.expenseCounter || 0));
      insertMeta.run('skuCounter', String(d.meta.skuCounter || 10000));
      insertMeta.run('business', JSON.stringify(d.meta.business || {}));
      insertMeta.run('uiSettings', JSON.stringify(d.meta.uiSettings || {}));
      insertMeta.run('gstFilingHistory', JSON.stringify(d.meta.gstFilingHistory || []));
      insertMeta.run('gstLockedPeriods', JSON.stringify(d.meta.gstLockedPeriods || []));
      insertMeta.run('license', JSON.stringify(d.meta.license || null));
      insertMeta.run('createdAt', String(d.meta.createdAt || nowIso()));
      insertMeta.run('updatedAt', String(d.meta.updatedAt || nowIso()));

      db.prepare('DELETE FROM products').run();
      const insertProduct = db.prepare('INSERT INTO products (id, sku, barcode, hsnCode, name, category, unit, costPrice, retailPrice, loosePrice, packEnabled, packSize, packPrice, wholesalePrice, wholesaleMinQty, stock, reorderLevel, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      d.products?.forEach(p => insertProduct.run(p.id, p.sku, p.barcode, p.hsnCode, p.name, p.category, p.unit, p.costPrice, p.retailPrice, p.loosePrice, p.packEnabled ? 1 : 0, p.packSize, p.packPrice, p.wholesalePrice, p.wholesaleMinQty, p.stock, p.reorderLevel, p.createdAt, p.updatedAt));

      db.prepare('DELETE FROM customers').run();
      const insertCustomer = db.prepare('INSERT INTO customers (id, name, type, phone, address, gstin, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      d.customers?.forEach(c => insertCustomer.run(c.id, c.name, c.type, c.phone, c.address, c.gstin, c.createdAt, c.updatedAt));

      db.prepare('DELETE FROM suppliers').run();
      const insertSupplier = db.prepare('INSERT INTO suppliers (id, name, phone, address, gstin, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)');
      d.suppliers?.forEach(s => insertSupplier.run(s.id, s.name, s.phone, s.address, s.gstin, s.createdAt, s.updatedAt));

      db.prepare('DELETE FROM invoices').run();
      const insertInvoice = db.prepare('INSERT INTO invoices (id, invoiceNo, channel, customerId, customerSnapshotJson, subtotal, discount, taxableValue, gstEnabled, gstRate, gstAmount, total, paidAmount, change, balance, paidMethod, paymentStatus, notes, createdAt, updatedAt, itemsJson, paymentHistoryJson) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      d.invoices?.forEach((inv) =>
        insertInvoice.run(
          inv.id,
          inv.invoiceNo,
          inv.channel,
          inv.customerId,
          JSON.stringify(inv.customerSnapshot || {}),
          inv.subtotal,
          inv.discount,
          inv.taxableValue,
          inv.gstEnabled ? 1 : 0,
          inv.gstRate,
          inv.gstAmount,
          inv.total,
          inv.paidAmount,
          inv.change,
          inv.balance,
          inv.paidMethod,
          inv.paymentStatus,
          inv.notes,
          inv.createdAt,
          inv.updatedAt,
          JSON.stringify(inv.items || []),
          JSON.stringify(inv.paymentHistory || [])
        )
      );

      db.prepare('DELETE FROM purchases').run();
      const insertPurchase = db.prepare('INSERT INTO purchases (id, purchaseNo, supplierId, supplierSnapshotJson, subtotal, discount, taxableValue, gstEnabled, gstRate, gstAmount, total, paidAmount, dueAmount, balance, paidMethod, notes, createdAt, updatedAt, itemsJson) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      d.purchases?.forEach((p) =>
        insertPurchase.run(
          p.id,
          p.purchaseNo,
          p.supplierId,
          JSON.stringify(p.supplierSnapshot || {}),
          p.subtotal,
          p.discount,
          p.taxableValue,
          p.gstEnabled ? 1 : 0,
          p.gstRate,
          p.gstAmount,
          p.total,
          p.paidAmount,
          p.dueAmount,
          p.balance,
          p.paidMethod,
          p.notes,
          p.createdAt,
          p.updatedAt,
          JSON.stringify(p.items || [])
        )
      );

      db.prepare('DELETE FROM gstNotes').run();
      const insertGstNote = db.prepare('INSERT INTO gstNotes (id, noteNo, noteType, direction, referenceType, referenceId, referenceNo, partyName, partyGstin, taxableValue, gstRate, gstAmount, total, notes, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      d.gstNotes?.forEach((note) =>
        insertGstNote.run(
          note.id,
          note.noteNo,
          note.noteType,
          note.direction,
          note.referenceType,
          note.referenceId,
          note.referenceNo,
          note.partyName,
          note.partyGstin,
          note.taxableValue,
          note.gstRate,
          note.gstAmount,
          note.total,
          note.notes,
          note.createdAt,
          note.updatedAt
        )
      );

      db.prepare('DELETE FROM supplierPayments').run();
      const insertSupplierPayment = db.prepare('INSERT INTO supplierPayments (id, supplierId, amount, paymentMethod, createdAt, updatedAt, allocationsJson) VALUES (?, ?, ?, ?, ?, ?, ?)');
      d.supplierPayments?.forEach(sp => insertSupplierPayment.run(sp.id, sp.supplierId, sp.amount, sp.paymentMethod, sp.createdAt, sp.updatedAt, JSON.stringify(sp.allocations || [])));

      db.prepare('DELETE FROM expenses').run();
      const insertExpense = db.prepare('INSERT INTO expenses (id, expenseNo, category, amount, paymentMethod, paidTo, notes, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      d.expenses?.forEach(e => insertExpense.run(e.id, e.expenseNo, e.category, e.amount, e.paymentMethod, e.paidTo, e.notes, e.createdAt, e.updatedAt));
    });

    runInTransaction(data);
  }

  get() {
    return clone(this.data);
  }

  mutate(mutator) {
    const draft = clone(this.data);
    const updated = mutator(draft) || draft;
    const normalized = normalizeData(updated);

    normalized.meta.updatedAt = nowIso();
    this.data = normalized;
    this.writeDB(this.data);
    return clone(this.data);
  }
}

module.exports = {
  LocalStore,
  nowIso,
  clone
};
