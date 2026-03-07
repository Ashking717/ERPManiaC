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

function defaultUiSettings() {
  return {
    themeMode: 'auto',
    thermalAutoPrintEnabled: false,
    thermalPrinterName: ''
  };
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
    id: product.id || randomUUID(),
    sku: String(product.sku || '').trim().toUpperCase(),
    barcode: String(product.barcode || '').trim(),
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
    id: customer.id || randomUUID(),
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
    id: supplier.id || randomUUID(),
    name: String(supplier.name || '').trim(),
    phone: String(supplier.phone || '').trim(),
    address: String(supplier.address || '').trim(),
    gstin: String(supplier.gstin || '').trim().toUpperCase(),
    createdAt: supplier.createdAt || nowIso(),
    updatedAt: supplier.updatedAt || nowIso()
  };
}

function normalizeInvoice(invoice) {
  const total = round2(toNumber(invoice.total, 0));
  const paidAmount = round2(toNumber(invoice.paidAmount, 0));
  const balance = round2(toNumber(invoice.balance, Math.max(total - paidAmount, 0)));
  const paymentStatus =
    balance <= 0 ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid';

  return {
    ...invoice,
    discount: round2(toNumber(invoice.discount, 0)),
    taxableValue: round2(toNumber(invoice.taxableValue, invoice.subtotal || 0)),
    gstEnabled: Boolean(invoice.gstEnabled),
    gstRate: round2(toNumber(invoice.gstRate, 0)),
    gstAmount: round2(toNumber(invoice.gstAmount, 0)),
    total,
    paidAmount,
    balance,
    paidMethod: normalizePaymentMethod(invoice.paidMethod || invoice.paymentMethod || invoice.paidVia),
    paymentStatus: ['unpaid', 'partial', 'paid'].includes(String(invoice.paymentStatus))
      ? String(invoice.paymentStatus)
      : paymentStatus,
    createdAt: invoice.createdAt || nowIso(),
    updatedAt: invoice.updatedAt || nowIso(),
    paymentHistory: Array.isArray(invoice.paymentHistory)
      ? invoice.paymentHistory.map((entry) => ({
          id: entry.id || randomUUID(),
          amount: round2(toNumber(entry.amount, 0)),
          note: String(entry.note || '').trim(),
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
  return {
    ...purchase,
    discount: round2(toNumber(purchase.discount, 0)),
    taxableValue: round2(toNumber(purchase.taxableValue, purchase.subtotal || 0)),
    gstEnabled: Boolean(purchase.gstEnabled),
    gstRate: round2(toNumber(purchase.gstRate, 0)),
    gstAmount: round2(toNumber(purchase.gstAmount, 0)),
    total: round2(toNumber(purchase.total, 0)),
    paidAmount: round2(toNumber(purchase.paidAmount, 0)),
    paidMethod: normalizePaymentMethod(purchase.paidMethod || purchase.paymentMethod || purchase.paidVia),
    dueAmount: round2(
      toNumber(purchase.dueAmount, Math.max(toNumber(purchase.total, 0) - toNumber(purchase.paidAmount, 0), 0))
    ),
    balance: round2(toNumber(purchase.balance, 0)),
    createdAt: purchase.createdAt || nowIso(),
    updatedAt: purchase.updatedAt || nowIso(),
    items: Array.isArray(purchase.items)
      ? purchase.items.map((item) => ({
          ...item,
          qty: round2(toNumber(item.qty, 0)),
          unitCost: round2(toNumber(item.unitCost, 0)),
          lineTotal: round2(toNumber(item.lineTotal, 0))
        }))
      : []
  };
}

function normalizeSupplierPayment(payment) {
  return {
    ...payment,
    amount: round2(toNumber(payment.amount, 0)),
    paymentMethod: normalizePaymentMethod(payment.paymentMethod || payment.mode || payment.method),
    createdAt: payment.createdAt || nowIso(),
    updatedAt: payment.updatedAt || nowIso(),
    allocations: Array.isArray(payment.allocations)
      ? payment.allocations.map((entry) => ({
          ...entry,
          amount: round2(toNumber(entry.amount, 0))
        }))
      : []
  };
}

function normalizeExpense(expense) {
  return {
    id: expense.id || randomUUID(),
    expenseNo: String(expense.expenseNo || '').trim(),
    category: String(expense.category || 'Other').trim() || 'Other',
    amount: round2(toNumber(expense.amount, 0)),
    paymentMethod: normalizePaymentMethod(expense.paymentMethod || expense.mode || expense.method),
    paidTo: String(expense.paidTo || '').trim(),
    notes: String(expense.notes || '').trim(),
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
    supplierPayments: [],
    expenses: []
  });
}

class LocalStore {
  constructor(fileName = 'erpmania-data.json') {
    const dataDir = path.join(app.getPath('userData'), 'data');
    this.filePath = path.join(dataDir, fileName);

    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    this.data = this.readOrCreate();
  }

  readOrCreate() {
    if (!fs.existsSync(this.filePath)) {
      const seedData = getSeedData();
      this.write(seedData);
      return seedData;
    }

    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      const normalized = normalizeData(parsed);
      this.write(normalized);
      return normalized;
    } catch (_error) {
      const seedData = getSeedData();
      this.write(seedData);
      return seedData;
    }
  }

  write(data) {
    const tempFile = `${this.filePath}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tempFile, this.filePath);
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
    this.write(this.data);
    return clone(this.data);
  }
}

module.exports = {
  LocalStore,
  nowIso,
  clone
};
