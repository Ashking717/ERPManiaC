const fs = require('fs');
const path = require('path');
const http = require('http');
const { randomUUID, createHash } = require('crypto');
const { app } = require('electron');
const { LocalStore, nowIso, clone } = require('./store');

const LICENSE_MAX_KEYS = 36;
const LICENSE_KEY_DAYS = 30;
const LICENSE_SECRET = 'ERPMANIA-LICENSE-2026';
const LICENSE_DAYS_MS = LICENSE_KEY_DAYS * 24 * 60 * 60 * 1000;
const GOD_LICENSE_KEY = '909090909090';
const OCR_LANGUAGE = 'eng';
const OCR_LANG_BASENAME = `${OCR_LANGUAGE}.traineddata`;
const OCR_LANG_GZIP_BASENAME = `${OCR_LANG_BASENAME}.gz`;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function toText(value) {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value).trim();
}

function toNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = Number(value);
  if (Number.isNaN(parsed) || !Number.isFinite(parsed)) {
    return fallback;
  }

  return parsed;
}

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizeChannel(channel) {
  return channel === 'wholesale' ? 'wholesale' : 'retail';
}

function normalizeThemeMode(value) {
  const mode = toText(value).toLowerCase();
  if (mode === 'light' || mode === 'dark' || mode === 'auto') {
    return mode;
  }

  return 'auto';
}

function invoicePrefixFromStoreName(storeName) {
  const letters = toText(storeName).toUpperCase().replace(/[^A-Z]/g, '');
  if (letters.length >= 2) {
    return letters.slice(0, 2);
  }

  if (letters.length === 1) {
    return `${letters}X`;
  }

  return 'GS';
}

function invoiceNumber(counter, storeName) {
  const year = new Date().getFullYear();
  const prefix = invoicePrefixFromStoreName(storeName);
  return `${prefix}-${year}-${String(counter).padStart(5, '0')}`;
}

function purchaseNumber(counter) {
  const year = new Date().getFullYear();
  return `PUR-${year}-${String(counter).padStart(5, '0')}`;
}

function paymentNumber(counter) {
  const year = new Date().getFullYear();
  return `PAY-${year}-${String(counter).padStart(5, '0')}`;
}

function expenseNumber(counter, inputDate) {
  const year = new Date(inputDate || Date.now()).getFullYear();
  return `EXP-${year}-${String(counter).padStart(5, '0')}`;
}

function dateStart(inputDate) {
  const dt = new Date(inputDate);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function dayRange(inputDate) {
  const start = dateStart(inputDate || new Date());
  const end = new Date(start);
  end.setDate(start.getDate() + 1);

  return { start, end };
}

function parseLocalDateInput(inputDate) {
  const text = toText(inputDate);
  if (!text) {
    return null;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);

  const parsed = new Date(year, monthIndex, day, 12, 0, 0, 0);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== monthIndex ||
    parsed.getDate() !== day
  ) {
    return null;
  }

  return parsed;
}

function monthStart(inputDate) {
  const dt = new Date(inputDate);
  dt.setDate(1);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function toDayKey(inputDate) {
  const dt = new Date(inputDate);
  const year = dt.getFullYear();
  const month = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toMonthKey(inputDate) {
  const dt = new Date(inputDate);
  const year = dt.getFullYear();
  const month = String(dt.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function toYearKey(inputDate) {
  return String(new Date(inputDate).getFullYear());
}

function monthRange(inputDate) {
  const start = monthStart(inputDate || new Date());
  const end = new Date(start);
  end.setMonth(start.getMonth() + 1);

  return { start, end };
}

function yearRange(inputDate) {
  const dt = new Date(inputDate || new Date());
  const start = new Date(dt.getFullYear(), 0, 1, 0, 0, 0, 0);
  const end = new Date(dt.getFullYear() + 1, 0, 1, 0, 0, 0, 0);

  return { start, end };
}

function normalizeReportPeriod(value) {
  const period = toText(value).toLowerCase();
  if (period === 'daily' || period === 'monthly' || period === 'yearly') {
    return period;
  }

  return 'daily';
}

function resolveReportFocusDate(inputDate) {
  const parsedLocal = parseLocalDateInput(inputDate);
  if (parsedLocal) {
    return parsedLocal;
  }

  const fallback = toText(inputDate) ? new Date(inputDate) : new Date();
  if (!Number.isNaN(fallback.getTime())) {
    return fallback;
  }

  return new Date();
}

function formatMonthLabel(inputDate) {
  return new Date(inputDate).toLocaleString('en-IN', {
    month: 'short',
    year: 'numeric'
  });
}

function isWithinRange(value, start, end) {
  const dt = new Date(value);
  return dt >= start && dt < end;
}

function getPriceByChannel(product, channel, qty) {
  if (channel === 'wholesale') {
    if (qty >= product.wholesaleMinQty) {
      return {
        unitPrice: product.wholesalePrice,
        pricingMode: 'wholesale'
      };
    }

    return {
      unitPrice: product.retailPrice,
      pricingMode: 'retail-fallback'
    };
  }

  return {
    unitPrice: product.retailPrice,
    pricingMode: 'retail'
  };
}

function sortByTimeDesc(arr) {
  return [...arr].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function sortByTimeAsc(arr) {
  return [...arr].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

function defaultLicenseState() {
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

function digitsOnly(value) {
  return toText(value).replace(/\D/g, '');
}

function luhnIsValid(value) {
  if (!/^\d+$/.test(value)) {
    return false;
  }

  let sum = 0;
  let shouldDouble = false;

  for (let i = value.length - 1; i >= 0; i -= 1) {
    let digit = Number(value[i]);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return sum % 10 === 0;
}

function luhnCheckDigit(base) {
  for (let digit = 0; digit <= 9; digit += 1) {
    if (luhnIsValid(`${base}${digit}`)) {
      return String(digit);
    }
  }

  return '0';
}

function generateLicenseCode(index) {
  const slot = String(index).padStart(2, '0');
  const hash = createHash('sha256')
    .update(`${LICENSE_SECRET}:${slot}:ERP-GROCERY-OFFLINE`)
    .digest('hex');

  const numericBody = (BigInt(`0x${hash.slice(0, 15)}`) % 1000000000n).toString().padStart(9, '0');
  const base11 = `${slot}${numericBody}`;
  const checksum = luhnCheckDigit(base11);
  return `${base11}${checksum}`;
}

function parseLicenseCode(rawKey) {
  const key = digitsOnly(rawKey);
  assert(key.length === 12, 'License key must be exactly 12 digits');
  assert(luhnIsValid(key), 'Invalid license key');

  const index = Number(key.slice(0, 2));
  assert(Number.isInteger(index) && index >= 1 && index <= LICENSE_MAX_KEYS, 'Invalid license key');

  const expected = generateLicenseCode(index);
  assert(expected === key, 'Invalid license key');

  return { key, index };
}

function normalizeLicenseState(source) {
  const defaults = defaultLicenseState();
  const raw = source && typeof source === 'object' ? source : {};

  const activatedIndexes = Array.isArray(raw.activatedIndexes)
    ? Array.from(
        new Set(
          raw.activatedIndexes
            .map((value) => Math.trunc(toNumber(value, NaN)))
            .filter((value) => Number.isInteger(value) && value >= 1 && value <= LICENSE_MAX_KEYS)
        )
      ).sort((a, b) => a - b)
    : [];

  const activationHistory = Array.isArray(raw.activationHistory)
    ? raw.activationHistory
        .map((entry) => ({
          index: Math.trunc(toNumber(entry.index, 0)),
          key: digitsOnly(entry.key).slice(0, 12),
          activatedAt: entry.activatedAt || nowIso(),
          validUntil: entry.validUntil || null
        }))
        .filter((entry) => entry.index >= 1 && entry.index <= LICENSE_MAX_KEYS)
    : [];

  const parsedValidUntil = raw.validUntil ? new Date(raw.validUntil) : null;

  return {
    maxKeys: LICENSE_MAX_KEYS,
    keyDays: LICENSE_KEY_DAYS,
    activatedIndexes,
    activationHistory,
    godMode: Boolean(raw.godMode),
    godActivatedAt: raw.godActivatedAt ? String(raw.godActivatedAt) : null,
    validUntil:
      parsedValidUntil && !Number.isNaN(parsedValidUntil.getTime())
        ? parsedValidUntil.toISOString()
        : null,
    createdAt: raw.createdAt || defaults.createdAt,
    updatedAt: raw.updatedAt || defaults.updatedAt
  };
}

function deriveLicenseStatus(licenseSource) {
  const license = normalizeLicenseState(licenseSource);
  const isGodMode = Boolean(license.godMode);
  const now = new Date();
  const expiry = license.validUntil ? new Date(license.validUntil) : null;
  const isActive = isGodMode || Boolean(expiry && expiry > now);
  const daysRemaining =
    isGodMode
      ? null
      : isActive
        ? Math.ceil((expiry.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
        : 0;

  return {
    isActive,
    isGodMode,
    validUntil: isGodMode ? null : license.validUntil,
    daysRemaining,
    keysUsed: license.activatedIndexes.length,
    keysRemaining: Math.max(LICENSE_MAX_KEYS - license.activatedIndexes.length, 0),
    maxKeys: LICENSE_MAX_KEYS,
    keyDays: LICENSE_KEY_DAYS,
    godActivatedAt: license.godActivatedAt,
    usedKeyIndexes: clone(license.activatedIndexes)
  };
}

function getNextGeneratedSku(data) {
  let counter = Math.max(10000, Math.trunc(toNumber(data.meta.skuCounter, 10000)));

  while (true) {
    counter += 1;
    const candidate = String(counter);
    const exists = data.products.some((product) => String(product.sku || '').toUpperCase() === candidate);
    if (!exists) {
      data.meta.skuCounter = counter;
      return candidate;
    }
  }
}

function deriveInvoicePaymentStatus(total, paidAmount, balance) {
  const totalValue = round2(toNumber(total, 0));
  const paidValue = round2(toNumber(paidAmount, 0));
  const balanceValue = round2(
    toNumber(balance, Math.max(totalValue - paidValue, 0))
  );

  if (balanceValue <= 0) {
    return 'paid';
  }

  if (paidValue > 0) {
    return 'partial';
  }

  return 'unpaid';
}

function calculateMetricsForRange(data, start, end) {
  const productById = new Map(data.products.map((product) => [product.id, product]));

  const scopedInvoices = data.invoices.filter((invoice) => isWithinRange(invoice.createdAt, start, end));
  const scopedPurchases = data.purchases.filter((purchase) => isWithinRange(purchase.createdAt, start, end));
  const scopedSupplierPayments = data.supplierPayments.filter((payment) =>
    isWithinRange(payment.createdAt, start, end)
  );
  const scopedExpenses = (Array.isArray(data.expenses) ? data.expenses : []).filter((expense) =>
    isWithinRange(expense.createdAt, start, end)
  );

  const salesGross = round2(scopedInvoices.reduce((sum, invoice) => sum + toNumber(invoice.subtotal, 0), 0));
  const salesDiscount = round2(
    scopedInvoices.reduce((sum, invoice) => sum + toNumber(invoice.discount, 0), 0)
  );
  const netSales = round2(
    scopedInvoices.reduce((sum, invoice) => sum + toNumber(invoice.taxableValue, 0), 0)
  );
  const gstCollected = round2(
    scopedInvoices.reduce((sum, invoice) => sum + toNumber(invoice.gstAmount, 0), 0)
  );
  const salesTotalWithGst = round2(
    scopedInvoices.reduce((sum, invoice) => sum + toNumber(invoice.total, 0), 0)
  );

  let cogs = 0;
  for (const invoice of scopedInvoices) {
    const items = Array.isArray(invoice.items) ? invoice.items : [];
    for (const item of items) {
      const qty = toNumber(item.qty, 0);
      const fallbackCost = toNumber(productById.get(item.productId)?.costPrice, 0);
      const lineCost = toNumber(item.costPrice, fallbackCost);
      cogs += qty * lineCost;
    }
  }
  cogs = round2(cogs);

  const grossProfit = round2(netSales - cogs);

  const purchaseSubtotal = round2(
    scopedPurchases.reduce((sum, purchase) => sum + toNumber(purchase.subtotal, 0), 0)
  );
  const purchaseDiscount = round2(
    scopedPurchases.reduce((sum, purchase) => sum + toNumber(purchase.discount, 0), 0)
  );
  const purchaseNet = round2(
    scopedPurchases.reduce((sum, purchase) => sum + toNumber(purchase.taxableValue, 0), 0)
  );
  const purchaseGst = round2(
    scopedPurchases.reduce((sum, purchase) => sum + toNumber(purchase.gstAmount, 0), 0)
  );
  const purchaseTotal = round2(
    scopedPurchases.reduce((sum, purchase) => sum + toNumber(purchase.total, 0), 0)
  );

  const cashIn = round2(
    scopedInvoices.reduce((sum, invoice) => sum + toNumber(invoice.paidAmount, 0), 0)
  );
  const purchasePaymentsAtEntry = round2(
    scopedPurchases.reduce((sum, purchase) => sum + toNumber(purchase.paidAmount, 0), 0)
  );
  const supplierPayments = round2(
    scopedSupplierPayments.reduce((sum, payment) => sum + toNumber(payment.amount, 0), 0)
  );
  const expenseTotal = round2(
    scopedExpenses.reduce((sum, expense) => sum + toNumber(expense.amount, 0), 0)
  );
  const cashOut = round2(purchasePaymentsAtEntry + supplierPayments + expenseTotal);
  const netCashflow = round2(cashIn - cashOut);

  return {
    invoiceCount: scopedInvoices.length,
    purchaseCount: scopedPurchases.length,
    supplierPaymentCount: scopedSupplierPayments.length,
    expenseCount: scopedExpenses.length,
    salesGross,
    salesDiscount,
    netSales,
    gstCollected,
    salesTotalWithGst,
    cogs,
    grossProfit,
    purchaseSubtotal,
    purchaseDiscount,
    purchaseNet,
    purchaseGst,
    purchaseTotal,
    cashIn,
    cashOut,
    purchasePaymentsAtEntry,
    supplierPayments,
    expenseTotal,
    netCashflow
  };
}

function calculateDailyMetrics(data, inputDate) {
  const { start, end } = dayRange(inputDate);
  return {
    date: toDayKey(start),
    ...calculateMetricsForRange(data, start, end)
  };
}

function toReportHistoryRow(label, metrics) {
  return {
    label,
    netSales: metrics.netSales,
    cogs: metrics.cogs,
    grossProfit: metrics.grossProfit,
    purchaseTotal: metrics.purchaseTotal,
    expenseTotal: metrics.expenseTotal,
    cashIn: metrics.cashIn,
    cashOut: metrics.cashOut,
    netCashflow: metrics.netCashflow
  };
}

function buildReportHistory(data, period, focusDate) {
  const history = [];

  if (period === 'monthly') {
    for (let i = 11; i >= 0; i -= 1) {
      const monthDt = new Date(focusDate.getFullYear(), focusDate.getMonth() - i, 1, 12, 0, 0, 0);
      const { start, end } = monthRange(monthDt);
      const metrics = calculateMetricsForRange(data, start, end);
      history.push(toReportHistoryRow(formatMonthLabel(start), metrics));
    }

    return history;
  }

  if (period === 'yearly') {
    for (let i = 4; i >= 0; i -= 1) {
      const yearDt = new Date(focusDate.getFullYear() - i, 0, 1, 12, 0, 0, 0);
      const { start, end } = yearRange(yearDt);
      const metrics = calculateMetricsForRange(data, start, end);
      history.push(toReportHistoryRow(toYearKey(start), metrics));
    }

    return history;
  }

  for (let i = 6; i >= 0; i -= 1) {
    const day = new Date(focusDate);
    day.setDate(focusDate.getDate() - i);
    const metrics = calculateDailyMetrics(data, day);
    history.push(toReportHistoryRow(metrics.date, metrics));
  }

  return history;
}

function buildDashboard(data) {
  const now = new Date();
  const todayCutoff = dateStart(now);
  const monthCutoff = monthStart(now);

  const invoices = sortByTimeDesc(data.invoices);
  const purchases = sortByTimeDesc(data.purchases);

  let todayRevenue = 0;
  let monthRevenue = 0;
  let receivables = 0;

  for (const invoice of invoices) {
    const createdAt = new Date(invoice.createdAt);
    if (createdAt >= todayCutoff) {
      todayRevenue += invoice.total;
    }

    if (createdAt >= monthCutoff) {
      monthRevenue += invoice.total;
    }

    receivables += invoice.balance;
  }

  const payables = data.purchases.reduce((total, purchase) => total + toNumber(purchase.balance, 0), 0);

  const inventoryValue = data.products.reduce(
    (total, product) => total + toNumber(product.stock, 0) * toNumber(product.costPrice, 0),
    0
  );

  const lowStockProducts = data.products
    .filter((product) => product.stock <= product.reorderLevel)
    .sort((a, b) => a.stock - b.stock)
    .slice(0, 10);

  const todayMetrics = calculateDailyMetrics(data, now);

  return {
    totalProducts: data.products.length,
    totalCustomers: data.customers.length,
    totalSuppliers: data.suppliers.length,
    totalInvoices: data.invoices.length,
    totalPurchases: data.purchases.length,
    totalExpenses: Array.isArray(data.expenses) ? data.expenses.length : 0,
    todayRevenue: round2(todayRevenue),
    monthRevenue: round2(monthRevenue),
    receivables: round2(receivables),
    payables: round2(payables),
    inventoryValue: round2(inventoryValue),
    todayGrossProfit: todayMetrics.grossProfit,
    todayPurchaseSpend: todayMetrics.purchaseTotal,
    todayExpenses: todayMetrics.expenseTotal,
    todayNetCashflow: todayMetrics.netCashflow,
    lowStockProducts,
    recentInvoices: invoices.slice(0, 8).map((invoice) => ({
      id: invoice.id,
      invoiceNo: invoice.invoiceNo,
      channel: invoice.channel,
      customerName: invoice.customerSnapshot.name,
      total: invoice.total,
      createdAt: invoice.createdAt
    })),
    recentPurchases: purchases.slice(0, 8).map((purchase) => ({
      id: purchase.id,
      purchaseNo: purchase.purchaseNo,
      supplierName: purchase.supplierSnapshot.name,
      total: purchase.total,
      balance: purchase.balance,
      createdAt: purchase.createdAt
    }))
  };
}

let cachedTesseractModule = null;
let cachedOcrLangServerPromise = null;

function fileExists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch (_error) {
    return false;
  }
}

function resolveOcrLanguageSource() {
  const candidates = [];

  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'assets', 'ocr'));
  }

  if (app && typeof app.getAppPath === 'function') {
    candidates.push(path.join(app.getAppPath(), 'assets', 'ocr'));
  }

  candidates.push(path.join(__dirname, '..', '..', 'assets', 'ocr'));
  candidates.push(path.join(process.cwd(), 'assets', 'ocr'));

  const uniqueCandidates = Array.from(new Set(candidates));

  for (const folder of uniqueCandidates) {
    const gzipFile = path.join(folder, OCR_LANG_GZIP_BASENAME);
    if (fileExists(gzipFile)) {
      return {
        filePath: gzipFile,
        requestPath: `/${OCR_LANG_GZIP_BASENAME}`,
        gzip: true
      };
    }

    const plainFile = path.join(folder, OCR_LANG_BASENAME);
    if (fileExists(plainFile)) {
      return {
        filePath: plainFile,
        requestPath: `/${OCR_LANG_BASENAME}`,
        gzip: false
      };
    }
  }

  throw new Error(
    'OCR language data not found. Run "npm run ocr:download-eng" to install English OCR data.'
  );
}

function createOcrLanguageServer() {
  const source = resolveOcrLanguageSource();
  const languageData = fs.readFileSync(source.filePath);
  assert(
    languageData && languageData.length > 0,
    'OCR language data is empty. Re-run "npm run ocr:download-eng".'
  );

  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
      if (requestUrl.pathname !== source.requestPath) {
        response.statusCode = 404;
        response.end('Not Found');
        return;
      }

      response.statusCode = 200;
      response.setHeader('Content-Type', 'application/octet-stream');
      response.setHeader('Content-Length', String(languageData.length));
      response.setHeader('Cache-Control', 'no-store');
      response.end(languageData);
    });

    server.once('error', (error) => {
      reject(error);
    });

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address !== 'object' || !address.port) {
        reject(new Error('Failed to start local OCR language server'));
        return;
      }

      resolve({
        server,
        langPath: `http://127.0.0.1:${address.port}`,
        gzip: source.gzip
      });
    });
  });
}

async function getOcrLanguageServer() {
  if (!cachedOcrLangServerPromise) {
    cachedOcrLangServerPromise = createOcrLanguageServer().catch((error) => {
      cachedOcrLangServerPromise = null;
      throw error;
    });
  }

  return cachedOcrLangServerPromise;
}

function decodeBase64ImageDataUrl(imageDataUrl) {
  const value = toText(imageDataUrl);
  assert(value, 'Select an image to run OCR');

  const match = /^data:image\/[a-z0-9.+-]+;base64,([a-z0-9+/=]+)$/i.exec(value);
  assert(match, 'OCR supports image files only');

  const buffer = Buffer.from(match[1], 'base64');
  assert(buffer.length > 0, 'Invalid image data');
  return buffer;
}

function getTesseractModule() {
  if (cachedTesseractModule) {
    return cachedTesseractModule;
  }

  try {
    cachedTesseractModule = require('tesseract.js');
  } catch (_error) {
    throw new Error('OCR engine not installed. Run "npm install" and try again.');
  }

  return cachedTesseractModule;
}

function createErpService() {
  const store = new LocalStore();

  function getLicenseStatus() {
    const data = store.get();
    return deriveLicenseStatus(data.meta.license);
  }

  function assertLicenseActive() {
    const status = getLicenseStatus();
    assert(status.isActive, 'License expired. Enter a valid 12-digit license key to continue.');
    return status;
  }

  function activateLicenseKey(payload) {
    const rawKey = typeof payload === 'string' ? payload : payload && payload.key;
    const cleanKey = digitsOnly(rawKey);
    assert(cleanKey.length === 12, 'License key must be exactly 12 digits');

    let status;

    if (cleanKey === GOD_LICENSE_KEY) {
      store.mutate((data) => {
        const current = normalizeLicenseState(data.meta.license);
        if (!current.godMode) {
          data.meta.license = {
            ...current,
            godMode: true,
            godActivatedAt: nowIso(),
            validUntil: null,
            updatedAt: nowIso()
          };
        } else {
          data.meta.license = {
            ...current,
            updatedAt: nowIso()
          };
        }

        status = deriveLicenseStatus(data.meta.license);
        return data;
      });

      return status;
    }

    const parsed = parseLicenseCode(cleanKey);

    store.mutate((data) => {
      const current = normalizeLicenseState(data.meta.license);
      const usedIndexes = [...current.activatedIndexes];

      assert(!usedIndexes.includes(parsed.index), `License key #${parsed.index} is already used`);
      assert(usedIndexes.length < LICENSE_MAX_KEYS, 'All 36 license keys are already used');

      const now = new Date();
      const currentValidUntil = current.validUntil ? new Date(current.validUntil) : null;
      const extensionFrom =
        currentValidUntil && !Number.isNaN(currentValidUntil.getTime()) && currentValidUntil > now
          ? currentValidUntil
          : now;

      const nextValidUntil = new Date(extensionFrom.getTime() + LICENSE_DAYS_MS).toISOString();
      const activationEntry = {
        index: parsed.index,
        key: parsed.key,
        activatedAt: nowIso(),
        validUntil: nextValidUntil
      };

      data.meta.license = {
        ...current,
        activatedIndexes: [...usedIndexes, parsed.index].sort((a, b) => a - b),
        activationHistory: [...current.activationHistory, activationEntry],
        validUntil: nextValidUntil,
        updatedAt: nowIso()
      };

      status = deriveLicenseStatus(data.meta.license);
      return data;
    });

    return status;
  }

  function getBootstrap() {
    const data = store.get();

    return {
      products: [...data.products].sort((a, b) => a.name.localeCompare(b.name)),
      customers: [...data.customers].sort((a, b) => a.name.localeCompare(b.name)),
      suppliers: [...data.suppliers].sort((a, b) => a.name.localeCompare(b.name)),
      invoices: sortByTimeDesc(data.invoices),
      purchases: sortByTimeDesc(data.purchases),
      supplierPayments: sortByTimeDesc(data.supplierPayments),
      expenses: sortByTimeDesc(Array.isArray(data.expenses) ? data.expenses : []),
      dashboard: buildDashboard(data),
      business: clone(data.meta.business),
      uiSettings: clone(data.meta.uiSettings || { themeMode: 'auto' }),
      licenseStatus: deriveLicenseStatus(data.meta.license)
    };
  }

  function upsertUiSettings(payload) {
    const themeMode = normalizeThemeMode(payload && payload.themeMode);
    let persisted;

    store.mutate((data) => {
      const current =
        data.meta.uiSettings && typeof data.meta.uiSettings === 'object'
          ? data.meta.uiSettings
          : { themeMode: 'auto' };

      data.meta.uiSettings = {
        ...current,
        themeMode
      };

      persisted = clone(data.meta.uiSettings);
      return data;
    });

    return persisted;
  }

  function upsertBusiness(payload) {
    assertLicenseActive();

    const name = toText(payload.name);
    const phone = toText(payload.phone);
    const address = toText(payload.address);
    const gstin = toText(payload.gstin).toUpperCase();

    assert(name.length > 0, 'Grocery store name is required');

    let persisted;

    store.mutate((data) => {
      data.meta.business = {
        name,
        phone,
        address,
        gstin
      };

      persisted = clone(data.meta.business);
      return data;
    });

    return persisted;
  }

  function upsertProduct(payload) {
    assertLicenseActive();

    const id = toText(payload.id);
    const barcode = toText(payload.barcode);
    const name = toText(payload.name);
    const category = toText(payload.category) || 'General';
    const unit = toText(payload.unit) || 'Unit';

    const retailPrice = round2(toNumber(payload.retailPrice, NaN));
    const wholesalePrice = round2(toNumber(payload.wholesalePrice, NaN));
    const fallbackCost =
      Number.isFinite(wholesalePrice) && wholesalePrice > 0 ? wholesalePrice : retailPrice;
    const costPrice = round2(toNumber(payload.costPrice, fallbackCost));
    const wholesaleMinQtyText = toText(payload.wholesaleMinQty);
    const wholesaleMinQty = wholesaleMinQtyText
      ? round2(toNumber(wholesaleMinQtyText, NaN))
      : 1;
    const stock = round2(toNumber(payload.stock, NaN));
    const reorderLevelText = toText(payload.reorderLevel);
    const reorderLevel = reorderLevelText
      ? round2(toNumber(reorderLevelText, NaN))
      : 0;

    assert(name.length > 0, 'Product name is required');
    assert(Number.isFinite(costPrice) && costPrice > 0, 'Cost price must be greater than 0');
    assert(Number.isFinite(retailPrice) && retailPrice > 0, 'Retail price must be greater than 0');
    assert(Number.isFinite(wholesalePrice) && wholesalePrice > 0, 'Wholesale price must be greater than 0');
    assert(
      Number.isFinite(wholesaleMinQty) && wholesaleMinQty >= 1,
      'Wholesale minimum quantity must be at least 1 when provided'
    );
    assert(Number.isFinite(stock) && stock >= 0, 'Stock cannot be negative');
    assert(Number.isFinite(reorderLevel) && reorderLevel >= 0, 'Reorder level cannot be negative');

    let persisted;

    store.mutate((data) => {
      if (barcode) {
        const duplicateBarcode = data.products.find(
          (product) => product.barcode === barcode && product.id !== id
        );
        assert(!duplicateBarcode, `Barcode ${barcode} already exists`);
      }

      if (id) {
        const existing = data.products.find((product) => product.id === id);
        assert(existing, 'Product not found');

        if (!toText(existing.sku)) {
          existing.sku = getNextGeneratedSku(data);
        }
        existing.barcode = barcode;
        existing.name = name;
        existing.category = category;
        existing.unit = unit;
        existing.costPrice = costPrice;
        existing.retailPrice = retailPrice;
        existing.wholesalePrice = wholesalePrice;
        existing.wholesaleMinQty = wholesaleMinQty;
        existing.stock = stock;
        existing.reorderLevel = reorderLevel;
        existing.updatedAt = nowIso();

        persisted = clone(existing);
        return data;
      }

      const created = {
        id: randomUUID(),
        sku: getNextGeneratedSku(data),
        barcode,
        name,
        category,
        unit,
        costPrice,
        retailPrice,
        wholesalePrice,
        wholesaleMinQty,
        stock,
        reorderLevel,
        createdAt: nowIso(),
        updatedAt: nowIso()
      };

      data.products.push(created);
      persisted = clone(created);
      return data;
    });

    return persisted;
  }

  function deleteProduct(productId) {
    assertLicenseActive();

    const id = toText(productId);
    assert(id, 'Product id is required');

    store.mutate((data) => {
      const index = data.products.findIndex((product) => product.id === id);
      assert(index >= 0, 'Product not found');

      const usedInInvoice = data.invoices.some((invoice) =>
        invoice.items.some((item) => item.productId === id)
      );
      const usedInPurchase = data.purchases.some((purchase) =>
        purchase.items.some((item) => item.productId === id)
      );

      assert(!usedInInvoice && !usedInPurchase, 'Cannot delete product used in transactions');
      data.products.splice(index, 1);
      return data;
    });

    return { deleted: true };
  }

  function upsertCustomer(payload) {
    assertLicenseActive();

    const id = toText(payload.id);
    const name = toText(payload.name);
    const type = payload.type === 'wholesale' ? 'wholesale' : 'retail';
    const phone = toText(payload.phone);
    const address = toText(payload.address);
    const gstin = toText(payload.gstin).toUpperCase();

    assert(name.length > 0, 'Customer name is required');

    let persisted;

    store.mutate((data) => {
      if (id) {
        const existing = data.customers.find((customer) => customer.id === id);
        assert(existing, 'Customer not found');

        existing.name = name;
        existing.type = type;
        existing.phone = phone;
        existing.address = address;
        existing.gstin = gstin;
        existing.updatedAt = nowIso();

        persisted = clone(existing);
        return data;
      }

      const created = {
        id: randomUUID(),
        name,
        type,
        phone,
        address,
        gstin,
        createdAt: nowIso(),
        updatedAt: nowIso()
      };

      data.customers.push(created);
      persisted = clone(created);
      return data;
    });

    return persisted;
  }

  function deleteCustomer(customerId) {
    assertLicenseActive();

    const id = toText(customerId);
    assert(id, 'Customer id is required');

    store.mutate((data) => {
      const index = data.customers.findIndex((customer) => customer.id === id);
      assert(index >= 0, 'Customer not found');

      const usedInInvoice = data.invoices.some((invoice) => invoice.customerId === id);
      assert(!usedInInvoice, 'Cannot delete customer with existing invoices');

      const customer = data.customers[index];
      assert(customer.name !== 'Walk-in Customer', 'Walk-in Customer cannot be deleted');

      data.customers.splice(index, 1);
      return data;
    });

    return { deleted: true };
  }

  function upsertSupplier(payload) {
    assertLicenseActive();

    const id = toText(payload.id);
    const name = toText(payload.name);
    const phone = toText(payload.phone);
    const address = toText(payload.address);
    const gstin = toText(payload.gstin).toUpperCase();

    assert(name.length > 0, 'Supplier name is required');

    let persisted;

    store.mutate((data) => {
      const duplicateName = data.suppliers.find(
        (supplier) => supplier.name.toLowerCase() === name.toLowerCase() && supplier.id !== id
      );
      assert(!duplicateName, 'Supplier with same name already exists');

      if (id) {
        const existing = data.suppliers.find((supplier) => supplier.id === id);
        assert(existing, 'Supplier not found');

        existing.name = name;
        existing.phone = phone;
        existing.address = address;
        existing.gstin = gstin;
        existing.updatedAt = nowIso();

        persisted = clone(existing);
        return data;
      }

      const created = {
        id: randomUUID(),
        name,
        phone,
        address,
        gstin,
        createdAt: nowIso(),
        updatedAt: nowIso()
      };

      data.suppliers.push(created);
      persisted = clone(created);
      return data;
    });

    return persisted;
  }

  function deleteSupplier(supplierId) {
    assertLicenseActive();

    const id = toText(supplierId);
    assert(id, 'Supplier id is required');

    store.mutate((data) => {
      const index = data.suppliers.findIndex((supplier) => supplier.id === id);
      assert(index >= 0, 'Supplier not found');

      const hasPurchases = data.purchases.some((purchase) => purchase.supplierId === id);
      assert(!hasPurchases, 'Cannot delete supplier with existing purchases');

      data.suppliers.splice(index, 1);
      return data;
    });

    return { deleted: true };
  }

  function createInvoice(payload) {
    assertLicenseActive();

    const channel = normalizeChannel(payload.channel);
    const customerId = toText(payload.customerId);
    const discount = round2(toNumber(payload.discount, 0));
    const gstEnabled = Boolean(payload.gstEnabled);
    const gstRate = gstEnabled ? round2(toNumber(payload.gstRate, 0)) : 0;
    const paidAmountRaw = payload.paidAmount;
    const paidAmountInput = round2(toNumber(paidAmountRaw, 0));
    const notes = toText(payload.notes);

    assert(discount >= 0, 'Discount cannot be negative');
    assert(gstRate >= 0, 'GST rate cannot be negative');
    assert(paidAmountInput >= 0, 'Paid amount cannot be negative');

    const rawItems = Array.isArray(payload.items) ? payload.items : [];
    assert(rawItems.length > 0, 'Add at least one invoice item');

    const itemMap = new Map();
    for (const item of rawItems) {
      const productId = toText(item.productId);
      const qty = round2(toNumber(item.qty, NaN));

      assert(productId, 'Each invoice item needs a product');
      assert(Number.isFinite(qty) && qty > 0, 'Item quantity must be greater than 0');

      const existingQty = itemMap.get(productId) || 0;
      itemMap.set(productId, round2(existingQty + qty));
    }

    let createdInvoice;

    store.mutate((data) => {
      let customer = data.customers.find((entry) => entry.name === 'Walk-in Customer') || null;
      if (customerId) {
        const requested = data.customers.find((entry) => entry.id === customerId);
        assert(requested, 'Selected customer does not exist');
        customer = requested;
      }

      if (channel === 'wholesale' && customer && customer.type !== 'wholesale') {
        throw new Error('Wholesale invoice should use a wholesale customer');
      }

      const items = [];
      let subtotal = 0;

      for (const [productId, qty] of itemMap.entries()) {
        const product = data.products.find((entry) => entry.id === productId);
        assert(product, 'Invoice item has an invalid product');
        assert(product.stock >= qty, `Insufficient stock for ${product.name}`);

        const pricing = getPriceByChannel(product, channel, qty);
        const lineTotal = round2(pricing.unitPrice * qty);

        subtotal = round2(subtotal + lineTotal);
        items.push({
          productId,
          sku: product.sku,
          barcode: product.barcode,
          name: product.name,
          unit: product.unit,
          qty,
          unitPrice: pricing.unitPrice,
          costPrice: round2(toNumber(product.costPrice, product.wholesalePrice)),
          lineTotal,
          pricingMode: pricing.pricingMode
        });
      }

      const taxableValue = round2(Math.max(subtotal - discount, 0));
      const gstAmount = round2(gstEnabled ? (taxableValue * gstRate) / 100 : 0);
      const total = round2(taxableValue + gstAmount);
      const paidAmountMissing =
        paidAmountRaw === undefined || paidAmountRaw === null || toText(paidAmountRaw) === '';
      const paidAmount =
        channel === 'retail' && paidAmountMissing ? total : paidAmountInput;
      const balance = round2(Math.max(total - paidAmount, 0));
      const change = round2(Math.max(paidAmount - total, 0));

      data.meta.invoiceCounter = (data.meta.invoiceCounter || 0) + 1;

      for (const line of items) {
        const product = data.products.find((entry) => entry.id === line.productId);
        product.stock = round2(product.stock - line.qty);
        product.updatedAt = nowIso();
      }

      createdInvoice = {
        id: randomUUID(),
        invoiceNo: invoiceNumber(data.meta.invoiceCounter, data.meta.business && data.meta.business.name),
        channel,
        customerId: customer ? customer.id : null,
        customerSnapshot: {
          name: customer ? customer.name : 'Walk-in Customer',
          type: customer ? customer.type : 'retail',
          phone: customer ? customer.phone : '',
          address: customer ? customer.address : '',
          gstin: customer ? customer.gstin : ''
        },
        items,
        subtotal,
        discount,
        taxableValue,
        gstEnabled,
        gstRate,
        gstAmount,
        total,
        paidAmount,
        balance,
        paymentStatus: deriveInvoicePaymentStatus(total, paidAmount, balance),
        change,
        notes,
        paymentHistory: [],
        createdAt: nowIso(),
        updatedAt: nowIso()
      };

      data.invoices.push(createdInvoice);
      return data;
    });

    return clone(createdInvoice);
  }

  function createPurchase(payload) {
    assertLicenseActive();

    const supplierId = toText(payload.supplierId);
    const discount = round2(toNumber(payload.discount, 0));
    const gstEnabled = Boolean(payload.gstEnabled);
    const gstRate = gstEnabled ? round2(toNumber(payload.gstRate, 0)) : 0;
    const paidAmount = round2(toNumber(payload.paidAmount, 0));
    const notes = toText(payload.notes);

    assert(supplierId, 'Supplier is required');
    assert(discount >= 0, 'Discount cannot be negative');
    assert(gstRate >= 0, 'GST rate cannot be negative');
    assert(paidAmount >= 0, 'Paid amount cannot be negative');

    const rawItems = Array.isArray(payload.items) ? payload.items : [];
    assert(rawItems.length > 0, 'Add at least one purchase item');

    const consolidated = new Map();
    for (const item of rawItems) {
      const productId = toText(item.productId);
      const qty = round2(toNumber(item.qty, NaN));
      const unitCost = round2(toNumber(item.unitCost, NaN));

      assert(productId, 'Each purchase item needs a product');
      assert(Number.isFinite(qty) && qty > 0, 'Purchase quantity must be greater than 0');
      assert(Number.isFinite(unitCost) && unitCost > 0, 'Unit cost must be greater than 0');

      const key = `${productId}::${unitCost.toFixed(4)}`;
      const existing = consolidated.get(key);
      if (existing) {
        existing.qty = round2(existing.qty + qty);
      } else {
        consolidated.set(key, { productId, qty, unitCost });
      }
    }

    let createdPurchase;

    store.mutate((data) => {
      const supplier = data.suppliers.find((entry) => entry.id === supplierId);
      assert(supplier, 'Selected supplier does not exist');

      const items = [];
      let subtotal = 0;

      for (const line of consolidated.values()) {
        const product = data.products.find((entry) => entry.id === line.productId);
        assert(product, 'Purchase item has an invalid product');

        const lineTotal = round2(line.qty * line.unitCost);
        subtotal = round2(subtotal + lineTotal);

        items.push({
          productId: product.id,
          sku: product.sku,
          barcode: product.barcode,
          name: product.name,
          unit: product.unit,
          qty: line.qty,
          unitCost: line.unitCost,
          lineTotal
        });
      }

      const taxableValue = round2(Math.max(subtotal - discount, 0));
      const gstAmount = round2(gstEnabled ? (taxableValue * gstRate) / 100 : 0);
      const total = round2(taxableValue + gstAmount);
      assert(paidAmount <= total, 'Paid amount cannot exceed purchase total');

      const dueAmount = round2(Math.max(total - paidAmount, 0));

      data.meta.purchaseCounter = (data.meta.purchaseCounter || 0) + 1;

      for (const line of items) {
        const product = data.products.find((entry) => entry.id === line.productId);
        const oldStock = round2(toNumber(product.stock, 0));
        const newStock = round2(oldStock + line.qty);
        const existingCost = round2(toNumber(product.costPrice, line.unitCost));

        const weightedCost =
          newStock > 0
            ? round2((existingCost * oldStock + line.unitCost * line.qty) / newStock)
            : round2(line.unitCost);

        product.stock = newStock;
        product.costPrice = weightedCost;
        product.updatedAt = nowIso();
      }

      createdPurchase = {
        id: randomUUID(),
        purchaseNo: purchaseNumber(data.meta.purchaseCounter),
        supplierId: supplier.id,
        supplierSnapshot: {
          name: supplier.name,
          phone: supplier.phone,
          gstin: supplier.gstin
        },
        items,
        subtotal,
        discount,
        taxableValue,
        gstEnabled,
        gstRate,
        gstAmount,
        total,
        paidAmount,
        dueAmount,
        balance: dueAmount,
        notes,
        createdAt: nowIso(),
        updatedAt: nowIso()
      };

      data.purchases.push(createdPurchase);
      return data;
    });

    return clone(createdPurchase);
  }

  function createSupplierPayment(payload) {
    assertLicenseActive();

    const supplierId = toText(payload.supplierId);
    const amount = round2(toNumber(payload.amount, NaN));
    const notes = toText(payload.notes);

    assert(supplierId, 'Supplier is required');
    assert(Number.isFinite(amount) && amount > 0, 'Payment amount must be greater than 0');

    let createdPayment;

    store.mutate((data) => {
      const supplier = data.suppliers.find((entry) => entry.id === supplierId);
      assert(supplier, 'Selected supplier does not exist');

      const openPurchases = sortByTimeAsc(
        data.purchases.filter((purchase) => purchase.supplierId === supplierId && purchase.balance > 0)
      );

      const outstanding = round2(
        openPurchases.reduce((sum, purchase) => sum + toNumber(purchase.balance, 0), 0)
      );

      assert(outstanding > 0, 'No outstanding balance for this supplier');
      assert(amount <= outstanding, 'Payment cannot exceed outstanding amount');

      let remaining = amount;
      const allocations = [];

      for (const purchase of openPurchases) {
        if (remaining <= 0) {
          break;
        }

        const payable = round2(toNumber(purchase.balance, 0));
        if (payable <= 0) {
          continue;
        }

        const applied = round2(Math.min(payable, remaining));
        purchase.balance = round2(payable - applied);
        purchase.updatedAt = nowIso();

        allocations.push({
          purchaseId: purchase.id,
          purchaseNo: purchase.purchaseNo,
          amount: applied
        });

        remaining = round2(remaining - applied);
      }

      data.meta.paymentCounter = (data.meta.paymentCounter || 0) + 1;

      const outstandingAfter = round2(
        data.purchases
          .filter((purchase) => purchase.supplierId === supplierId)
          .reduce((sum, purchase) => sum + toNumber(purchase.balance, 0), 0)
      );

      createdPayment = {
        id: randomUUID(),
        paymentNo: paymentNumber(data.meta.paymentCounter),
        supplierId: supplier.id,
        supplierSnapshot: {
          name: supplier.name,
          phone: supplier.phone,
          gstin: supplier.gstin
        },
        amount,
        allocations,
        notes,
        outstandingAfter,
        createdAt: nowIso(),
        updatedAt: nowIso()
      };

      data.supplierPayments.push(createdPayment);
      return data;
    });

    return clone(createdPayment);
  }

  function createExpense(payload) {
    assertLicenseActive();

    const category = toText(payload && payload.category) || 'Other';
    const amount = round2(toNumber(payload && payload.amount, NaN));
    const paidTo = toText(payload && payload.paidTo);
    const notes = toText(payload && payload.notes);
    const expenseDate = parseLocalDateInput(payload && payload.expenseDate);

    assert(Number.isFinite(amount) && amount > 0, 'Expense amount must be greater than 0');

    let createdExpense;

    store.mutate((data) => {
      data.meta.expenseCounter = (data.meta.expenseCounter || 0) + 1;

      const createdAt = expenseDate ? expenseDate.toISOString() : nowIso();
      createdExpense = {
        id: randomUUID(),
        expenseNo: expenseNumber(data.meta.expenseCounter, createdAt),
        category,
        amount,
        paidTo,
        notes,
        createdAt,
        updatedAt: nowIso()
      };

      if (!Array.isArray(data.expenses)) {
        data.expenses = [];
      }
      data.expenses.push(createdExpense);
      return data;
    });

    return clone(createdExpense);
  }

  async function extractEnglishOcr(payload) {
    assertLicenseActive();

    const imageDataUrl = payload && payload.imageDataUrl;
    const imageBuffer = decodeBase64ImageDataUrl(imageDataUrl);
    const ocrLanguageServer = await getOcrLanguageServer();
    const Tesseract = getTesseractModule();
    const result = await Tesseract.recognize(imageBuffer, OCR_LANGUAGE, {
      langPath: ocrLanguageServer.langPath,
      gzip: ocrLanguageServer.gzip,
      cacheMethod: 'none',
      // Prevent uncaught exceptions from bubbling out of worker internals.
      errorHandler: () => {},
      // Accuracy-first config for printed bills.
      user_defined_dpi: '300',
      preserve_interword_spaces: '1'
    });

    const data = result && result.data ? result.data : {};
    return {
      text: toText(data.text),
      confidence: round2(toNumber(data.confidence, 0))
    };
  }

  function getCustomerLedger(customerId) {
    assertLicenseActive();

    const requestedId = toText(customerId);
    const data = store.get();

    const customers = [...data.customers].sort((a, b) => a.name.localeCompare(b.name));
    if (!customers.length) {
      return {
        customers: [],
        selectedCustomerId: '',
        customer: null,
        outstanding: 0,
        ledgerEntries: [],
        openInvoices: []
      };
    }

    const selectedCustomerId = requestedId || customers[0].id;
    const customer = customers.find((entry) => entry.id === selectedCustomerId);
    assert(customer, 'Customer not found');

    const invoices = data.invoices.filter((invoice) => invoice.customerId === selectedCustomerId);

    const saleEntries = invoices.map((invoice) => ({
      id: invoice.id,
      createdAt: invoice.createdAt,
      type: 'sale',
      reference: invoice.invoiceNo,
      debit: round2(toNumber(invoice.total, 0)),
      credit: 0,
      note: invoice.notes || '',
      total: invoice.total,
      balance: invoice.balance
    }));

    const paymentEntries = [];
    for (const invoice of invoices) {
      const total = round2(toNumber(invoice.total, 0));
      const balance = round2(Math.max(toNumber(invoice.balance, 0), 0));
      let remainingPaid = round2(Math.max(total - balance, 0));

      const history = sortByTimeAsc(Array.isArray(invoice.paymentHistory) ? invoice.paymentHistory : []);

      for (let index = 0; index < history.length; index += 1) {
        if (remainingPaid <= 0) {
          break;
        }

        const payment = history[index];
        const amountRaw = round2(toNumber(payment.amount, 0));
        if (amountRaw <= 0) {
          continue;
        }

        const amount = round2(Math.min(amountRaw, remainingPaid));
        paymentEntries.push({
          id: payment.id || `${invoice.id}-payment-${index + 1}`,
          createdAt: payment.createdAt || invoice.createdAt,
          type: 'payment',
          reference: invoice.invoiceNo,
          debit: 0,
          credit: amount,
          note: payment.note || '',
          total: amount,
          balance: 0
        });

        remainingPaid = round2(Math.max(remainingPaid - amount, 0));
      }

      if (remainingPaid > 0) {
        paymentEntries.push({
          id: `${invoice.id}-initial-payment`,
          createdAt: invoice.createdAt,
          type: 'payment',
          reference: invoice.invoiceNo,
          debit: 0,
          credit: remainingPaid,
          note: 'Initial payment',
          total: remainingPaid,
          balance: 0
        });
      }
    }

    const ledgerEntries = [...saleEntries, ...paymentEntries].sort((a, b) => {
      const diff = new Date(a.createdAt) - new Date(b.createdAt);
      if (diff !== 0) {
        return diff;
      }

      if (a.type === b.type) {
        return 0;
      }

      return a.type === 'sale' ? -1 : 1;
    });

    let runningBalance = 0;
    for (const entry of ledgerEntries) {
      runningBalance = round2(runningBalance + entry.debit - entry.credit);
      entry.runningBalance = runningBalance;
    }

    const openInvoices = sortByTimeAsc(
      invoices
        .filter((invoice) => toNumber(invoice.balance, 0) > 0)
        .map((invoice) => ({
          id: invoice.id,
          invoiceNo: invoice.invoiceNo,
          createdAt: invoice.createdAt,
          total: invoice.total,
          paidAmount: invoice.paidAmount,
          balance: invoice.balance
        }))
    );

    const outstanding = round2(invoices.reduce((sum, invoice) => sum + toNumber(invoice.balance, 0), 0));

    return {
      customers,
      selectedCustomerId,
      customer,
      outstanding,
      ledgerEntries,
      openInvoices
    };
  }

  function getSupplierLedger(supplierId) {
    assertLicenseActive();

    const requestedId = toText(supplierId);
    const data = store.get();

    const suppliers = [...data.suppliers].sort((a, b) => a.name.localeCompare(b.name));
    if (!suppliers.length) {
      return {
        suppliers: [],
        selectedSupplierId: '',
        supplier: null,
        outstanding: 0,
        ledgerEntries: [],
        openPurchases: []
      };
    }

    const selectedSupplierId = requestedId || suppliers[0].id;
    const supplier = suppliers.find((entry) => entry.id === selectedSupplierId);
    assert(supplier, 'Supplier not found');

    const purchases = data.purchases.filter((purchase) => purchase.supplierId === selectedSupplierId);
    const payments = data.supplierPayments.filter((payment) => payment.supplierId === selectedSupplierId);

    const purchaseEntries = purchases.map((purchase) => ({
      id: purchase.id,
      createdAt: purchase.createdAt,
      type: 'purchase',
      reference: purchase.purchaseNo,
      debit: round2(toNumber(purchase.dueAmount, purchase.total - purchase.paidAmount)),
      credit: 0,
      note: purchase.notes || '',
      total: purchase.total,
      balance: purchase.balance
    }));

    const paymentEntries = payments.map((payment) => ({
      id: payment.id,
      createdAt: payment.createdAt,
      type: 'payment',
      reference: payment.paymentNo,
      debit: 0,
      credit: round2(toNumber(payment.amount, 0)),
      note: payment.notes || '',
      total: payment.amount,
      balance: 0
    }));

    const ledgerEntries = [...purchaseEntries, ...paymentEntries].sort((a, b) => {
      const diff = new Date(a.createdAt) - new Date(b.createdAt);
      if (diff !== 0) {
        return diff;
      }

      if (a.type === b.type) {
        return 0;
      }

      return a.type === 'purchase' ? -1 : 1;
    });

    let runningBalance = 0;
    for (const entry of ledgerEntries) {
      runningBalance = round2(runningBalance + entry.debit - entry.credit);
      entry.runningBalance = runningBalance;
    }

    const openPurchases = sortByTimeAsc(
      purchases
        .filter((purchase) => purchase.balance > 0)
        .map((purchase) => ({
          id: purchase.id,
          purchaseNo: purchase.purchaseNo,
          createdAt: purchase.createdAt,
          total: purchase.total,
          balance: purchase.balance
        }))
    );

    const outstanding = round2(
      purchases.reduce((sum, purchase) => sum + toNumber(purchase.balance, 0), 0)
    );

    return {
      suppliers,
      selectedSupplierId,
      supplier,
      outstanding,
      ledgerEntries,
      openPurchases
    };
  }

  function getDailyProfitLoss(payload) {
    assertLicenseActive();

    const data = store.get();
    const reportInput =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? payload
        : { inputDate: payload };

    const period = normalizeReportPeriod(reportInput.period);
    const focusDate = resolveReportFocusDate(reportInput.inputDate);

    let range;
    let periodKey;
    let periodLabel;

    if (period === 'monthly') {
      range = monthRange(focusDate);
      periodKey = toMonthKey(range.start);
      periodLabel = formatMonthLabel(range.start);
    } else if (period === 'yearly') {
      range = yearRange(focusDate);
      periodKey = toYearKey(range.start);
      periodLabel = toYearKey(range.start);
    } else {
      range = dayRange(focusDate);
      periodKey = toDayKey(range.start);
      periodLabel = periodKey;
    }

    const metrics = calculateMetricsForRange(data, range.start, range.end);
    const history = buildReportHistory(data, period, focusDate);

    return {
      period,
      date: toDayKey(focusDate),
      inputDate: toDayKey(focusDate),
      periodKey,
      periodLabel,
      metrics,
      history,
      recentDays: history.map((row) => ({
        ...row,
        date: row.label
      }))
    };
  }

  function recordInvoicePayment(payload) {
    assertLicenseActive();

    const invoiceId = toText(payload && payload.invoiceId);
    const amount = round2(toNumber(payload && payload.amount, NaN));
    const note = toText(payload && payload.note);

    assert(invoiceId, 'Invoice id is required');
    assert(Number.isFinite(amount) && amount > 0, 'Payment amount must be greater than 0');

    let updatedInvoice;

    store.mutate((data) => {
      const invoice = data.invoices.find((entry) => entry.id === invoiceId);
      assert(invoice, 'Invoice not found');

      const currentBalance = round2(toNumber(invoice.balance, 0));
      assert(currentBalance > 0, 'Invoice is already fully paid');
      assert(amount <= currentBalance, 'Payment cannot exceed pending balance');

      const nextPaidAmount = round2(toNumber(invoice.paidAmount, 0) + amount);
      const nextBalance = round2(Math.max(toNumber(invoice.total, 0) - nextPaidAmount, 0));

      invoice.paidAmount = nextPaidAmount;
      invoice.balance = nextBalance;
      invoice.paymentStatus = deriveInvoicePaymentStatus(invoice.total, nextPaidAmount, nextBalance);
      invoice.updatedAt = nowIso();

      const history = Array.isArray(invoice.paymentHistory) ? invoice.paymentHistory : [];
      history.push({
        id: randomUUID(),
        amount,
        note,
        createdAt: nowIso()
      });
      invoice.paymentHistory = history;

      updatedInvoice = clone(invoice);
      return data;
    });

    return updatedInvoice;
  }

  function getInvoice(invoiceId) {
    assertLicenseActive();

    const id = toText(invoiceId);
    assert(id, 'Invoice id is required');

    const data = store.get();
    const invoice = data.invoices.find((entry) => entry.id === id);

    assert(invoice, 'Invoice not found');
    return clone(invoice);
  }

  function getInvoiceForPrint(invoiceId) {
    const data = store.get();
    const invoice = getInvoice(invoiceId);

    return {
      invoice,
      business: clone(data.meta.business)
    };
  }

  function getStockListForPrint() {
    assertLicenseActive();

    const data = store.get();
    const products = [...data.products].sort((a, b) => a.name.localeCompare(b.name));

    return {
      business: clone(data.meta.business),
      products: clone(products),
      generatedAt: nowIso()
    };
  }

  return {
    getBootstrap,
    getLicenseStatus,
    activateLicenseKey,
    upsertUiSettings,
    upsertBusiness,
    upsertProduct,
    deleteProduct,
    upsertCustomer,
    deleteCustomer,
    upsertSupplier,
    deleteSupplier,
    createInvoice,
    recordInvoicePayment,
    createPurchase,
    createSupplierPayment,
    createExpense,
    extractEnglishOcr,
    getCustomerLedger,
    getSupplierLedger,
    getDailyProfitLoss,
    getInvoice,
    getInvoiceForPrint,
    getStockListForPrint
  };
}

module.exports = {
  createErpService
};
