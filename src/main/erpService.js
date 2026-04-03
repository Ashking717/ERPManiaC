const fs = require('fs');
const path = require('path');
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
const BACKUP_ROLLING_FILE_NAME = 'ERPManiaC-Backup-Latest.json';
const MAX_BUSINESS_LOGO_DATA_URL_LENGTH = 2800000;
const OPEN_FACTS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const OPEN_FACTS_RATE_LIMIT_COOLDOWN_MS = 60 * 1000;
const OPEN_FACTS_SOURCES = [
  {
    id: 'off',
    name: 'Open Food Facts',
    endpoint: 'https://world.openfoodfacts.org/api/v2/product'
  },
  {
    id: 'obf',
    name: 'Open Beauty Facts',
    endpoint: 'https://world.openbeautyfacts.org/api/v2/product'
  },
  {
    id: 'opf',
    name: 'Open Products Facts',
    endpoint: 'https://world.openproductsfacts.org/api/v2/product'
  },
  {
    id: 'opff',
    name: 'Open Pet Food Facts',
    endpoint: 'https://world.openpetfoodfacts.org/api/v2/product'
  }
];

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
  return toText(value)
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
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

function splitTaxValue(value) {
  const totalValue = round2(toNumber(value, 0));
  const primaryAmount = round2(totalValue / 2);

  return {
    primary: primaryAmount,
    secondary: round2(totalValue - primaryAmount)
  };
}

function normalizeChannel(channel) {
  return channel === 'wholesale' ? 'wholesale' : 'retail';
}

function normalizePaymentMethod(value) {
  const text = toText(value).toLowerCase();
  if (text === 'cash' || text === 'bank' || text === 'upi' || text === 'card' || text === 'other') {
    return text;
  }

  if (text === 'digital' || text === 'online' || text === 'bank_transfer' || text === 'bank transfer') {
    return 'bank';
  }

  return 'cash';
}

function paymentAccountForMethod(value) {
  return normalizePaymentMethod(value) === 'cash' ? 'Cash in Hand' : 'Bank / Digital';
}

function paymentMethodLabel(value) {
  const method = normalizePaymentMethod(value);
  if (method === 'cash') {
    return 'Cash';
  }
  if (method === 'bank') {
    return 'Bank';
  }
  if (method === 'upi') {
    return 'UPI';
  }
  if (method === 'card') {
    return 'Card';
  }
  return 'Other';
}

function normalizeBarcodeLookupInput(value) {
  return toText(value).replace(/\s+/g, '').replace(/[^0-9]/g, '');
}

function pickFirstNonEmpty(...values) {
  for (const value of values) {
    const text = toText(value);
    if (text) {
      return text;
    }
  }

  return '';
}

function buildOpenFoodFactsCategoryCandidates(product) {
  const tags = Array.isArray(product && product.categories_tags_en)
    ? product.categories_tags_en
    : [];
  const categories = toText(product && product.categories)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  return [...tags, ...categories];
}

function mapOpenFoodFactsCategory(product) {
  const candidates = buildOpenFoodFactsCategoryCandidates(product);

  for (const entry of candidates) {
    const value = toText(entry).toLowerCase();

    if (!value) {
      continue;
    }

    if (value.includes('beverage') || value.includes('drink') || value.includes('juice') || value.includes('tea') || value.includes('coffee') || value.includes('soft-drink') || value.includes('water')) {
      return 'Beverages';
    }
    if (value.includes('snack') || value.includes('chip') || value.includes('biscuit') || value.includes('cookie') || value.includes('confection') || value.includes('chocolate') || value.includes('candy')) {
      return 'Snacks';
    }
    if (value.includes('dairy') || value.includes('milk') || value.includes('cheese') || value.includes('yogurt') || value.includes('butter')) {
      return 'Dairy';
    }
    if (value.includes('bread') || value.includes('bakery') || value.includes('cake') || value.includes('bun') || value.includes('pastry')) {
      return 'Bakery';
    }
    if (value.includes('fruit') || value.includes('vegetable') || value.includes('produce')) {
      return 'Fruits & Vegetables';
    }
    if (value.includes('rice') || value.includes('grain') || value.includes('cereal') || value.includes('flour') || value.includes('pasta')) {
      return 'Rice & Grains';
    }
    if (value.includes('spice') || value.includes('masala') || value.includes('seasoning') || value.includes('condiment')) {
      return 'Spices';
    }
    if (value.includes('frozen')) {
      return 'Frozen Foods';
    }
    if (value.includes('cleaning') || value.includes('detergent') || value.includes('dishwashing') || value.includes('laundry')) {
      return 'Cleaning';
    }
    if (value.includes('personal-care') || value.includes('cosmetic') || value.includes('soap') || value.includes('shampoo') || value.includes('toothpaste') || value.includes('skin-care')) {
      return 'Personal Care';
    }
    if (value.includes('household') || value.includes('homecare') || value.includes('paper') || value.includes('kitchen')) {
      return 'Household';
    }
  }

  return 'General';
}

function fallbackCategoryForOpenFactsSource(sourceId) {
  if (sourceId === 'obf') {
    return 'Personal Care';
  }
  if (sourceId === 'opff') {
    return 'Pet Care';
  }
  if (sourceId === 'opf') {
    return 'Household';
  }

  return 'General';
}

function inferOpenFoodFactsUnitHint(product) {
  const unit = toText(product && product.product_quantity_unit).toLowerCase();
  const quantity = toText(product && product.quantity).toLowerCase();

  if (['l', 'lt', 'ltr', 'litre', 'liter', 'ml', 'cl'].includes(unit)) {
    return 'Litre';
  }

  if (['kg', 'g', 'gram', 'grams'].includes(unit)) {
    return 'Kg';
  }

  if (quantity.includes('pack')) {
    return 'Pack';
  }

  if (quantity.includes('piece') || quantity.includes('pcs') || quantity.includes('pc')) {
    return 'Piece';
  }

  return 'Unit';
}

function buildOpenFoodFactsName(product) {
  const productName = pickFirstNonEmpty(
    product && product.product_name,
    product && product.product_name_en,
    product && product.generic_name
  );
  const brand = pickFirstNonEmpty(product && product.brands);

  if (!productName) {
    return '';
  }

  if (!brand) {
    return productName;
  }

  const normalizedName = productName.toLowerCase();
  const normalizedBrand = brand.toLowerCase();
  if (normalizedName.includes(normalizedBrand)) {
    return productName;
  }

  return `${brand} ${productName}`.trim();
}

async function fetchOpenFactsSourceProduct(source, barcode, rateLimitState) {
  const nowTs = Date.now();
  const rateLimitedUntil = rateLimitState.get(source.id) || 0;
  if (rateLimitedUntil > nowTs) {
    return {
      status: 'rate_limited',
      source,
      retryAfterMs: rateLimitedUntil - nowTs
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  const url = new URL(`${source.endpoint}/${barcode}.json`);
  url.searchParams.set(
    'fields',
    [
      'code',
      'product_name',
      'product_name_en',
      'generic_name',
      'brands',
      'categories',
      'categories_tags_en',
      'quantity',
      'product_quantity',
      'product_quantity_unit'
    ].join(',')
  );

  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'ERPManiaC/4.1.0 (OpenFactsLookup)'
      },
      signal: controller.signal
    });
  } catch (error) {
    if (error && error.name === 'AbortError') {
      return {
        status: 'error',
        source,
        message: `${source.name} request timed out. Check your internet connection and try again.`
      };
    }

    return {
      status: 'error',
      source,
      message: `Could not reach ${source.name}. Check your internet connection and try again.`
    };
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    if (response.status === 404) {
      return {
        status: 'not_found',
        source
      };
    }

    if (response.status === 429) {
      const retryAfterHeader = Number(response.headers.get('retry-after'));
      const retryAfterMs =
        Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
          ? retryAfterHeader * 1000
          : OPEN_FACTS_RATE_LIMIT_COOLDOWN_MS;
      rateLimitState.set(source.id, Date.now() + retryAfterMs);
      return {
        status: 'rate_limited',
        source,
        retryAfterMs
      };
    }

    return {
      status: 'error',
      source,
      message: `${source.name} lookup failed (${response.status})`
    };
  }

  const result = await response.json();
  const product = result && typeof result === 'object' ? result.product : null;
  if (!(result && Number(result.status) === 1 && product)) {
    return {
      status: 'not_found',
      source
    };
  }

  const name = buildOpenFoodFactsName(product);
  if (!name) {
    return {
      status: 'error',
      source,
      message: `${source.name} did not return a usable product name for this barcode`
    };
  }

  const mappedCategory = mapOpenFoodFactsCategory(product);

  return {
    status: 'success',
    source,
    data: {
      barcode,
      name,
      brand: pickFirstNonEmpty(product.brands),
      category:
        mappedCategory && mappedCategory !== 'General'
          ? mappedCategory
          : fallbackCategoryForOpenFactsSource(source.id),
      unitHint: inferOpenFoodFactsUnitHint(product),
      quantityLabel: pickFirstNonEmpty(product.quantity),
      source: source.name,
      sourceUrl: `${source.endpoint.replace('/api/v2/product', '')}/product/${barcode}`,
      rawCategory: pickFirstNonEmpty(product.categories)
    }
  };
}

function getErrorHeadline(value, fallback = 'Unexpected error') {
  const text = String(value || '').trim();
  if (!text) {
    return fallback;
  }

  return text.split('\n')[0].trim() || fallback;
}

function normalizeThemeMode(value) {
  const mode = toText(value).toLowerCase();
  if (mode === 'light' || mode === 'dark' || mode === 'auto') {
    return mode;
  }

  return 'auto';
}

function normalizeUiMode(value) {
  return toText(value).toLowerCase() === 'touch' ? 'touch' : 'pc';
}

function normalizeReturnTypes(value) {
  const source = Array.isArray(value) ? value : value ? [value] : [];
  return Array.from(
    new Set(
      source
        .map((entry) => toText(entry).toUpperCase())
        .filter((entry) => entry === 'GSTR-1' || entry === 'GSTR-3B')
    )
  );
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
  const mode = toText(value).toLowerCase();
  if (mode === 'pc' || mode === 'touch') {
    return mode;
  }

  return 'global';
}

function normalizeUiViewModes(value) {
  const input = value && typeof value === 'object' ? value : {};
  const normalized = {};

  for (const viewName of UI_MODE_VIEWS) {
    const mode = normalizeUiViewMode(input[viewName]);
    if (mode !== 'global') {
      normalized[viewName] = mode;
    }
  }

  return normalized;
}

function normalizeThermalPrinterName(value) {
  return toText(value);
}

function normalizeBusinessLogoDataUrl(value) {
  const text = toText(value);
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

function normalizeIsoOrNull(value) {
  const text = toText(value);
  if (!text) {
    return null;
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function normalizeBackupStatus(value) {
  const text = toText(value).toLowerCase();
  if (text === 'success' || text === 'failed' || text === 'never') {
    return text;
  }

  return 'never';
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

function normalizeBackupSettings(source) {
  const defaults = defaultBackupSettings();
  const input = source && typeof source === 'object' ? source : {};
  const interval = Math.trunc(toNumber(input.autoBackupIntervalHours, defaults.autoBackupIntervalHours));

  return {
    mode: toText(input.mode).toLowerCase() === 'local-folder' ? 'local-folder' : 'local-folder',
    enabled: Boolean(input.enabled),
    folderPath: toText(input.folderPath),
    autoBackupEnabled: Boolean(input.autoBackupEnabled),
    autoBackupIntervalHours: Math.max(1, Math.min(168, interval || defaults.autoBackupIntervalHours)),
    lastBackupAt: normalizeIsoOrNull(input.lastBackupAt),
    lastBackupFileId: toText(input.lastBackupFileId),
    lastBackupFileName: toText(input.lastBackupFileName),
    lastBackupStatus: normalizeBackupStatus(input.lastBackupStatus),
    lastBackupError: toText(input.lastBackupError),
    lastRestoreAt: normalizeIsoOrNull(input.lastRestoreAt),
    lastRestoreFileId: toText(input.lastRestoreFileId),
    lastRestoreFileName: toText(input.lastRestoreFileName),
    lastRestoreStatus: normalizeBackupStatus(input.lastRestoreStatus),
    lastRestoreError: toText(input.lastRestoreError),
    updatedAt: normalizeIsoOrNull(input.updatedAt) || nowIso()
  };
}

function hasBackupFolderPath(settings) {
  return Boolean(toText(settings && settings.folderPath));
}

function parseJsonSafely(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch (_error) {
    return fallback;
  }
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

function gstNoteNumber(counter, noteType, inputDate) {
  const dt = new Date(inputDate || Date.now());
  const year = dt.getFullYear();
  const month = String(dt.getMonth() + 1).padStart(2, '0');
  const prefix = noteType === 'debit' ? 'DBN' : 'CRN';
  return `${prefix}-${year}${month}-${String(counter).padStart(4, '0')}`;
}

function fallbackDocumentNumber(prefix, createdAt, id) {
  const year = new Date(createdAt || Date.now()).getFullYear();
  const suffix = toText(id).replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 8);
  return `${prefix}-${year}-${suffix || 'PENDING'}`;
}

function detectNextGstNoteCounter(data) {
  const notes = Array.isArray(data && data.gstNotes) ? data.gstNotes : [];
  let maxCounter = 0;

  for (const note of notes) {
    const noteNo = toText(note && note.noteNo);
    const match = /(\d{4})$/.exec(noteNo);
    if (!match) {
      continue;
    }

    const numericValue = Math.trunc(toNumber(match[1], 0));
    if (numericValue > maxCounter) {
      maxCounter = numericValue;
    }
  }

  return maxCounter + 1;
}

function findActiveGstLockForDate(data, inputDate) {
  const locks =
    data &&
    data.meta &&
    Array.isArray(data.meta.gstLockedPeriods)
      ? data.meta.gstLockedPeriods
      : [];
  const targetDate = new Date(inputDate);
  const targetTs = targetDate.getTime();
  if (Number.isNaN(targetTs)) {
    return null;
  }

  return (
    locks.find((lock) => {
      if (lock && lock.active === false) {
        return false;
      }

      const startTs = new Date(lock && lock.rangeStart).getTime();
      const endTs = new Date(lock && lock.rangeEnd).getTime();
      if (Number.isNaN(startTs) || Number.isNaN(endTs)) {
        return false;
      }

      return targetTs >= startTs && targetTs < endTs;
    }) || null
  );
}

function assertGstPeriodUnlocked(data, inputDate, actionLabel) {
  const activeLock = findActiveGstLockForDate(data, inputDate);
  assert(
    !activeLock,
    `${actionLabel} is not allowed because ${toText(activeLock && activeLock.periodLabel) || 'this filing period'} is locked. Unlock it in GST Filing first.`
  );
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

function productPackMeta(product) {
  const packSize = Math.max(1, Math.trunc(toNumber(product && product.packSize, 1)));
  const looseUnit = toText(product && product.unit) || 'Unit';
  const loosePrice = round2(toNumber(product && product.loosePrice, product && product.retailPrice));
  const rawPackPrice = round2(toNumber(product && product.packPrice, loosePrice * packSize));
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

function getPriceByChannel(product, channel, qty, saleUnit) {
  const meta = productPackMeta(product);
  const normalizedSaleUnit = toText(saleUnit).toLowerCase() === 'pack' ? 'pack' : 'loose';
  const usePack = normalizedSaleUnit === 'pack' && meta.packEnabled;
  const baseQty = round2(usePack ? qty * meta.packSize : qty);
  const unitLabel = usePack ? 'Pack' : meta.looseUnit;

  if (channel === 'wholesale') {
    const perLoosePrice =
      baseQty >= product.wholesaleMinQty ? product.wholesalePrice : meta.loosePrice;

    return {
      unitPrice: usePack ? round2(perLoosePrice * meta.packSize) : perLoosePrice,
      pricingMode: baseQty >= product.wholesaleMinQty ? 'wholesale' : 'retail-fallback',
      saleUnit: usePack ? 'pack' : 'loose',
      unitLabel,
      baseQty,
      packSize: meta.packSize,
      looseUnit: meta.looseUnit
    };
  }

  return {
    unitPrice: usePack ? meta.packPrice : meta.loosePrice,
    pricingMode: usePack ? 'retail-pack' : 'retail-loose',
    saleUnit: usePack ? 'pack' : 'loose',
    unitLabel,
    baseQty,
    packSize: meta.packSize,
    looseUnit: meta.looseUnit
  };
}

function buildPurchaseCostTimeline(purchases) {
  const timeline = new Map();

  const allPurchases = Array.isArray(purchases) ? purchases : [];
  for (const purchase of allPurchases) {
    const purchaseTs = new Date(purchase && purchase.createdAt).getTime();
    if (Number.isNaN(purchaseTs)) {
      continue;
    }

    const items = Array.isArray(purchase && purchase.items) ? purchase.items : [];
    for (const item of items) {
      const productId = toText(item && item.productId);
      const unitCost = round2(toNumber(item && item.unitCost, NaN));
      if (!productId || !Number.isFinite(unitCost) || unitCost <= 0) {
        continue;
      }

      const entries = timeline.get(productId) || [];
      entries.push({ ts: purchaseTs, unitCost });
      timeline.set(productId, entries);
    }
  }

  for (const entries of timeline.values()) {
    entries.sort((a, b) => a.ts - b.ts);
  }

  return timeline;
}

function findLatestPurchaseCostBefore(timeline, productId, atTs) {
  if (!timeline || !productId || !Number.isFinite(atTs)) {
    return NaN;
  }

  const entries = timeline.get(productId);
  if (!Array.isArray(entries) || entries.length === 0) {
    return NaN;
  }

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const row = entries[index];
    if (row.ts <= atTs) {
      return round2(toNumber(row.unitCost, NaN));
    }
  }

  return NaN;
}

function resolveInvoiceItemBaseQty(item, productById) {
  const baseQty = round2(toNumber(item && item.baseQty, NaN));
  if (Number.isFinite(baseQty) && baseQty > 0) {
    return baseQty;
  }

  const qty = round2(toNumber(item && item.qty, 0));
  if (!Number.isFinite(qty) || qty <= 0) {
    return 0;
  }

  const saleUnit = toText(item && item.saleUnit).toLowerCase();
  if (saleUnit !== 'pack') {
    return qty;
  }

  const itemPackSize = Math.max(1, Math.trunc(toNumber(item && item.packSize, 1)));
  const productPackSize = Math.max(
    1,
    Math.trunc(toNumber(productById && productById.get(toText(item && item.productId))?.packSize, 1))
  );
  const packSize = itemPackSize > 1 ? itemPackSize : productPackSize;
  return round2(qty * packSize);
}

function resolveInvoiceItemCostPrice(item, context) {
  const explicit = round2(toNumber(item && item.costPrice, NaN));
  if (Number.isFinite(explicit) && explicit > 0) {
    return explicit;
  }

  const productId = toText(item && item.productId);
  const invoiceTs = Number.isFinite(context && context.invoiceTs) ? context.invoiceTs : NaN;
  const timelineCost = findLatestPurchaseCostBefore(context && context.purchaseCostTimeline, productId, invoiceTs);
  if (Number.isFinite(timelineCost) && timelineCost > 0) {
    return timelineCost;
  }

  const fallbackProductCost = round2(toNumber(context && context.productById?.get(productId)?.costPrice, NaN));
  if (Number.isFinite(fallbackProductCost) && fallbackProductCost > 0) {
    return fallbackProductCost;
  }

  return 0;
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

function sumSupplierPaymentAllocationsForPurchase(data, purchaseId) {
  const targetId = toText(purchaseId);
  if (!targetId) {
    return 0;
  }

  const payments = Array.isArray(data && data.supplierPayments) ? data.supplierPayments : [];
  let total = 0;

  for (const payment of payments) {
    const allocations = Array.isArray(payment && payment.allocations) ? payment.allocations : [];
    for (const allocation of allocations) {
      if (toText(allocation && allocation.purchaseId) !== targetId) {
        continue;
      }

      total = round2(total + round2(toNumber(allocation && allocation.amount, 0)));
    }
  }

  return total;
}

function recalculateProductCostFromPurchases(data, productId) {
  const targetId = toText(productId);
  if (!targetId) {
    return;
  }

  const product = Array.isArray(data && data.products)
    ? data.products.find((entry) => entry.id === targetId)
    : null;
  if (!product) {
    return;
  }

  let totalQty = 0;
  let totalCost = 0;
  const purchases = Array.isArray(data && data.purchases) ? data.purchases : [];
  for (const purchase of purchases) {
    const items = Array.isArray(purchase && purchase.items) ? purchase.items : [];
    for (const item of items) {
      if (toText(item && item.productId) !== targetId) {
        continue;
      }

      const qty = round2(toNumber(item && item.qty, 0));
      const unitCost = round2(toNumber(item && item.unitCost, 0));
      if (!(qty > 0) || !(unitCost > 0)) {
        continue;
      }

      totalQty = round2(totalQty + qty);
      totalCost = round2(totalCost + round2(qty * unitCost));
    }
  }

  if (totalQty > 0) {
    product.costPrice = round2(totalCost / totalQty);
  }
}

function calculateMetricsForRange(data, start, end) {
  const productById = new Map(data.products.map((product) => [product.id, product]));
  const purchaseCostTimeline = buildPurchaseCostTimeline(data.purchases);

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
    const invoiceTs = new Date(invoice.createdAt).getTime();

    for (const item of items) {
      const qty = resolveInvoiceItemBaseQty(item, productById);
      const lineCost = resolveInvoiceItemCostPrice(item, {
        productById,
        purchaseCostTimeline,
        invoiceTs
      });
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
      customerName: invoice.customerSnapshot?.name || 'Walk-in Customer',
      total: invoice.total,
      createdAt: invoice.createdAt
    })),
    recentPurchases: purchases.slice(0, 8).map((purchase) => ({
      id: purchase.id,
      purchaseNo: purchase.purchaseNo,
      supplierName: purchase.supplierSnapshot?.name || 'Unknown Supplier',
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
  let autoBackupInProgress = false;
  const openFactsLookupCache = new Map();
  const openFactsRateLimitState = new Map();

  function getLicenseStatus() {
    const data = store.get();
    return deriveLicenseStatus(data.meta.license);
  }

  function assertLicenseActive() {
    const status = getLicenseStatus();
    assert(status.isActive, 'License expired. Enter a valid 12-digit license key to continue.');
    return status;
  }

  function getBackupSettings() {
    const data = store.get();
    return normalizeBackupSettings(data.meta.backup);
  }

  function upsertBackupSettings(payload) {
    assertLicenseActive();

    const input = payload && typeof payload === 'object' ? payload : {};
    const previous = getBackupSettings();
    const merged = normalizeBackupSettings({
      ...previous,
      enabled: Object.prototype.hasOwnProperty.call(input, 'enabled') ? Boolean(input.enabled) : previous.enabled,
      folderPath: Object.prototype.hasOwnProperty.call(input, 'folderPath')
        ? normalizeBackupDirectoryPath(input.folderPath)
        : previous.folderPath,
      autoBackupEnabled: Object.prototype.hasOwnProperty.call(input, 'autoBackupEnabled')
        ? Boolean(input.autoBackupEnabled)
        : previous.autoBackupEnabled,
      autoBackupIntervalHours: Object.prototype.hasOwnProperty.call(input, 'autoBackupIntervalHours')
        ? input.autoBackupIntervalHours
        : previous.autoBackupIntervalHours,
      updatedAt: nowIso()
    });

    let persisted;
    store.mutate((data) => {
      data.meta.backup = merged;
      persisted = clone(data.meta.backup);
      return data;
    });

    return persisted;
  }

  function buildBackupExportPayload(data, triggerType) {
    const exportData = clone(data);
    if (exportData.meta) {
      exportData.meta.backup = normalizeBackupSettings(exportData.meta.backup);
    }

    return {
      app: 'ERPManiaC',
      formatVersion: 1,
      exportedAt: nowIso(),
      triggerType,
      data: exportData
    };
  }

  function validateBackupConfiguration(settings) {
    assert(settings.enabled, 'Enable backup first');
    assert(hasBackupFolderPath(settings), 'Choose backup folder first');
  }

  function normalizeBackupDirectoryPath(folderPath) {
    const raw = toText(folderPath);
    return raw ? path.resolve(raw) : '';
  }

  function ensureBackupDirectory(folderPath) {
    const resolved = normalizeBackupDirectoryPath(folderPath);
    assert(resolved, 'Choose backup folder first');

    try {
      fs.mkdirSync(resolved, { recursive: true });
      const stat = fs.statSync(resolved);
      assert(stat.isDirectory(), 'Backup path is not a folder');
    } catch (_error) {
      throw new Error('Backup folder is not accessible');
    }

    return resolved;
  }

  function listBackupFiles(folderPath) {
    const resolved = ensureBackupDirectory(folderPath);
    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && /\.json$/i.test(entry.name))
      .map((entry) => {
        const fullPath = path.join(resolved, entry.name);
        const stat = fs.statSync(fullPath);
        return {
          id: fullPath,
          name: entry.name,
          filePath: fullPath,
          modifiedAt: new Date(stat.mtimeMs || stat.mtime || Date.now()).toISOString()
        };
      })
      .sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());

    return files;
  }

  function backupFileMeta(filePath) {
    const stat = fs.statSync(filePath);
    return {
      id: filePath,
      name: path.basename(filePath),
      filePath,
      modifiedAt: new Date(stat.mtimeMs || stat.mtime || Date.now()).toISOString()
    };
  }

  function applyBackupRestoreData(currentSettings, file, restoredData) {
    assert(restoredData && typeof restoredData === 'object', 'Backup file is invalid');

    store.mutate(() => {
      const nextData = clone(restoredData);
      nextData.meta = nextData.meta && typeof nextData.meta === 'object' ? nextData.meta : {};
      nextData.meta.backup = normalizeBackupSettings({
        ...(nextData.meta.backup || {}),
        ...currentSettings,
        lastRestoreAt: nowIso(),
        lastRestoreFileId: file.id,
        lastRestoreFileName: file.name,
        lastRestoreStatus: 'success',
        lastRestoreError: '',
        updatedAt: nowIso()
      });

      return nextData;
    });
  }

  async function runLocalFolderBackup(triggerType = 'manual') {
    assertLicenseActive();

    const currentSettings = getBackupSettings();
    validateBackupConfiguration(currentSettings);
    const backupFolder = ensureBackupDirectory(currentSettings.folderPath);

    try {
      const data = store.get();
      const backupPayload = buildBackupExportPayload(data, triggerType);
      const jsonText = JSON.stringify(backupPayload, null, 2);
      const fileName = BACKUP_ROLLING_FILE_NAME;
      const filePath = path.join(backupFolder, fileName);

      fs.writeFileSync(filePath, jsonText, 'utf8');

      let persisted;
      store.mutate((nextData) => {
        const existing = normalizeBackupSettings(nextData.meta.backup);
        nextData.meta.backup = normalizeBackupSettings({
          ...existing,
          ...currentSettings,
          folderPath: backupFolder,
          lastBackupAt: nowIso(),
          lastBackupFileId: filePath,
          lastBackupFileName: fileName,
          lastBackupStatus: 'success',
          lastBackupError: '',
          updatedAt: nowIso()
        });
        persisted = clone(nextData.meta.backup);
        return nextData;
      });

      return {
        ok: true,
        triggerType,
        folderPath: backupFolder,
        fileId: filePath,
        filePath,
        fileName,
        settings: persisted
      };
    } catch (error) {
      store.mutate((nextData) => {
        const existing = normalizeBackupSettings(nextData.meta.backup);
        nextData.meta.backup = normalizeBackupSettings({
          ...existing,
          ...currentSettings,
          lastBackupStatus: 'failed',
          lastBackupError: error.message || 'Backup failed',
          updatedAt: nowIso()
        });
        return nextData;
      });
      throw error;
    }
  }

  async function restoreLatestLocalBackup() {
    assertLicenseActive();

    const currentSettings = getBackupSettings();
    validateBackupConfiguration(currentSettings);

    try {
      const backupFolder = ensureBackupDirectory(currentSettings.folderPath);
      const rollingFilePath = path.join(backupFolder, BACKUP_ROLLING_FILE_NAME);
      let latest = null;

      if (fs.existsSync(rollingFilePath)) {
        try {
          const stat = fs.statSync(rollingFilePath);
          if (stat.isFile()) {
            latest = backupFileMeta(rollingFilePath);
          }
        } catch (_error) {
          latest = null;
        }
      }

      if (!latest) {
        const files = listBackupFiles(backupFolder);
        assert(files.length > 0, 'No backup files found in selected folder');
        latest = files[0];
      }

      const fileContent = fs.readFileSync(latest.filePath, 'utf8');
      const parsed = parseJsonSafely(fileContent, null);
      assert(parsed && typeof parsed === 'object', 'Backup file content is invalid');
      const restoredData =
        parsed.data && typeof parsed.data === 'object' && parsed.data.meta ? parsed.data : parsed;

      applyBackupRestoreData(
        {
          ...currentSettings
        },
        latest,
        restoredData
      );

      return {
        restoredAt: nowIso(),
        fileId: latest.id,
        filePath: latest.filePath,
        fileName: latest.name
      };
    } catch (error) {
      store.mutate((nextData) => {
        const existing = normalizeBackupSettings(nextData.meta.backup);
        nextData.meta.backup = normalizeBackupSettings({
          ...existing,
          ...currentSettings,
          lastRestoreStatus: 'failed',
          lastRestoreError: error.message || 'Restore failed',
          updatedAt: nowIso()
        });
        return nextData;
      });
      throw error;
    }
  }

  async function runAutoBackupCheck() {
    const settings = getBackupSettings();
    if (!settings.enabled || !settings.autoBackupEnabled) {
      return {
        skipped: true,
        reason: 'disabled'
      };
    }

    if (!hasBackupFolderPath(settings)) {
      return {
        skipped: true,
        reason: 'folder-missing'
      };
    }

    const now = Date.now();
    const lastBackupAt = settings.lastBackupAt ? new Date(settings.lastBackupAt).getTime() : 0;
    const intervalMs = settings.autoBackupIntervalHours * 60 * 60 * 1000;

    if (lastBackupAt && now - lastBackupAt < intervalMs) {
      return {
        skipped: true,
        reason: 'not-due'
      };
    }

    if (autoBackupInProgress) {
      return {
        skipped: true,
        reason: 'in-progress'
      };
    }

    autoBackupInProgress = true;
    try {
      return await runLocalFolderBackup('auto');
    } finally {
      autoBackupInProgress = false;
    }
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
      gstNotes: sortByTimeDesc(Array.isArray(data.gstNotes) ? data.gstNotes : []),
      supplierPayments: sortByTimeDesc(data.supplierPayments),
      expenses: sortByTimeDesc(Array.isArray(data.expenses) ? data.expenses : []),
      dashboard: buildDashboard(data),
      business: clone(data.meta.business),
      backup: normalizeBackupSettings(data.meta.backup),
      uiSettings: clone(
        data.meta.uiSettings || {
          themeMode: 'auto',
          uiMode: 'pc',
          viewModes: {},
          setupCompleted: false,
          billingGstEnabled: false,
          billingGstRate: 0,
          thermalAutoPrintEnabled: false,
          thermalPrinterName: ''
        }
      ),
      gstFilingHistory: [...(Array.isArray(data.meta.gstFilingHistory) ? data.meta.gstFilingHistory : [])].sort(
        (a, b) => new Date(b.filedAt || 0) - new Date(a.filedAt || 0)
      ),
      gstLockedPeriods: [
        ...(Array.isArray(data.meta.gstLockedPeriods) ? data.meta.gstLockedPeriods : [])
      ]
        .filter((entry) => entry.active !== false)
        .sort((a, b) => new Date(b.lockedAt || 0) - new Date(a.lockedAt || 0)),
      licenseStatus: deriveLicenseStatus(data.meta.license)
    };
  }

  function upsertUiSettings(payload) {
    const input = payload && typeof payload === 'object' ? payload : {};
    const hasThemeMode = Object.prototype.hasOwnProperty.call(input, 'themeMode');
    const hasUiMode = Object.prototype.hasOwnProperty.call(input, 'uiMode');
    const hasViewModes = Object.prototype.hasOwnProperty.call(input, 'viewModes');
    const hasSetupCompleted = Object.prototype.hasOwnProperty.call(input, 'setupCompleted');
    const hasBillingGstEnabled = Object.prototype.hasOwnProperty.call(input, 'billingGstEnabled');
    const hasBillingGstRate = Object.prototype.hasOwnProperty.call(input, 'billingGstRate');
    const hasThermalEnabled = Object.prototype.hasOwnProperty.call(
      input,
      'thermalAutoPrintEnabled'
    );
    const hasThermalPrinterName = Object.prototype.hasOwnProperty.call(input, 'thermalPrinterName');
    const nextBillingGstRate = round2(toNumber(input.billingGstRate, NaN));
    if (hasBillingGstRate) {
      assert(
        Number.isFinite(nextBillingGstRate) && nextBillingGstRate >= 0,
        'Billing GST rate cannot be negative'
      );
    }
    let persisted;

    store.mutate((data) => {
      const current =
        data.meta.uiSettings && typeof data.meta.uiSettings === 'object'
          ? data.meta.uiSettings
          : {
              themeMode: 'auto',
              uiMode: 'pc',
              viewModes: {},
              setupCompleted: false,
              billingGstEnabled: false,
              billingGstRate: 0,
              thermalAutoPrintEnabled: false,
              thermalPrinterName: ''
            };

      data.meta.uiSettings = {
        ...current,
        themeMode: hasThemeMode ? normalizeThemeMode(input.themeMode) : normalizeThemeMode(current.themeMode),
        uiMode: hasUiMode ? normalizeUiMode(input.uiMode) : normalizeUiMode(current.uiMode),
        viewModes: hasViewModes
          ? normalizeUiViewModes(input.viewModes)
          : normalizeUiViewModes(current.viewModes),
        setupCompleted: hasSetupCompleted
          ? Boolean(input.setupCompleted)
          : Boolean(current.setupCompleted),
        billingGstEnabled: hasBillingGstEnabled
          ? Boolean(input.billingGstEnabled)
          : Boolean(current.billingGstEnabled),
        billingGstRate: hasBillingGstRate
          ? Math.max(0, nextBillingGstRate)
          : round2(Math.max(toNumber(current.billingGstRate, 0), 0)),
        thermalAutoPrintEnabled: hasThermalEnabled
          ? Boolean(input.thermalAutoPrintEnabled)
          : Boolean(current.thermalAutoPrintEnabled),
        thermalPrinterName: hasThermalPrinterName
          ? normalizeThermalPrinterName(input.thermalPrinterName)
          : normalizeThermalPrinterName(current.thermalPrinterName)
      };

      persisted = clone(data.meta.uiSettings);
      return data;
    });

    return persisted;
  }

  function upsertBusiness(payload) {
    assertLicenseActive();

    const input = payload && typeof payload === 'object' ? payload : {};
    const name = toText(input.name);
    const phone = toText(input.phone);
    const address = toText(input.address);
    const gstin = toText(input.gstin).toUpperCase();
    const hasLogoDataUrl = Object.prototype.hasOwnProperty.call(input, 'logoDataUrl');
    const rawLogoDataUrl = toText(input.logoDataUrl);
    const logoDataUrl = normalizeBusinessLogoDataUrl(rawLogoDataUrl);

    assert(name.length > 0, 'Grocery store name is required');
    if (hasLogoDataUrl && rawLogoDataUrl) {
      assert(rawLogoDataUrl.length <= MAX_BUSINESS_LOGO_DATA_URL_LENGTH, 'Store logo is too large');
      assert(Boolean(logoDataUrl), 'Store logo must be a valid image');
    }

    let persisted;

    store.mutate((data) => {
      const currentBusiness =
        data.meta.business && typeof data.meta.business === 'object' ? data.meta.business : {};

      data.meta.business = {
        name,
        phone,
        address,
        gstin,
        logoDataUrl: hasLogoDataUrl
          ? logoDataUrl
          : normalizeBusinessLogoDataUrl(currentBusiness.logoDataUrl)
      };

      persisted = clone(data.meta.business);
      return data;
    });

    return persisted;
  }

  function upsertProduct(payload) {
    assertLicenseActive();

    const id = toText(payload.id);
    const sku = toText(payload.sku).toUpperCase();
    const barcode = toText(payload.barcode);
    const hsnCode = normalizeHsnCode(payload.hsnCode);
    const name = toText(payload.name);
    const category = toText(payload.category) || 'General';
    const unit = toText(payload.unit) || 'Unit';

    const loosePrice = round2(toNumber(payload.loosePrice, payload.retailPrice));
    const retailPrice = loosePrice;
    const wholesalePrice = round2(toNumber(payload.wholesalePrice, NaN));
    const fallbackCost =
      Number.isFinite(wholesalePrice) && wholesalePrice > 0 ? wholesalePrice : retailPrice;
    const costPrice = round2(toNumber(payload.costPrice, fallbackCost));
    const packEnabled = Boolean(payload.packEnabled);
    const packSize = packEnabled ? Math.max(2, Math.trunc(toNumber(payload.packSize, NaN))) : 1;
    const packPrice = packEnabled
      ? round2(toNumber(payload.packPrice, loosePrice * packSize))
      : 0;
    const wholesaleMinQtyText = toText(payload.wholesaleMinQty);
    const wholesaleMinQty = wholesaleMinQtyText
      ? round2(toNumber(wholesaleMinQtyText, NaN))
      : 1;
    const stockMode = toText(payload.stockMode).toLowerCase();
    const stockInput = round2(toNumber(payload.stock, NaN));
    const stock = packEnabled && stockMode === 'pack' ? round2(stockInput * packSize) : stockInput;
    const reorderLevelText = toText(payload.reorderLevel);
    const reorderLevel = reorderLevelText
      ? round2(toNumber(reorderLevelText, NaN))
      : 0;

    assert(name.length > 0, 'Product name is required');
    assert(Number.isFinite(costPrice) && costPrice > 0, 'Cost price must be greater than 0');
    assert(Number.isFinite(loosePrice) && loosePrice > 0, 'Loose price must be greater than 0');
    assert(Number.isFinite(wholesalePrice) && wholesalePrice > 0, 'Wholesale price must be greater than 0');
    if (packEnabled) {
      assert(Number.isFinite(packSize) && packSize >= 2, 'Pack size must be at least 2');
      assert(Number.isFinite(packPrice) && packPrice > 0, 'Pack price must be greater than 0');
    }
    assert(
      Number.isFinite(wholesaleMinQty) && wholesaleMinQty >= 1,
      'Wholesale minimum quantity must be at least 1 when provided'
    );
    assert(Number.isFinite(stock) && stock >= 0, 'Stock cannot be negative');
    assert(Number.isFinite(reorderLevel) && reorderLevel >= 0, 'Reorder level cannot be negative');

    let persisted;

    store.mutate((data) => {
      if (sku) {
        const duplicateSku = data.products.find(
          (product) => String(product.sku || '').toUpperCase() === sku && toText(product.id) !== id
        );
        assert(!duplicateSku, `SKU ${sku} already exists`);
      }

      if (barcode) {
        const duplicateBarcode = data.products.find(
          (product) => product.barcode === barcode && toText(product.id) !== id
        );
        assert(!duplicateBarcode, `Barcode ${barcode} already exists`);
      }

      if (id) {
        const existing = data.products.find((product) => toText(product.id) === id);
        assert(existing, 'Product not found');

        if (sku) {
          existing.sku = sku;
        } else if (!toText(existing.sku)) {
          existing.sku = getNextGeneratedSku(data);
        }
        existing.barcode = barcode;
        existing.hsnCode = hsnCode;
        existing.name = name;
        existing.category = category;
        existing.unit = unit;
        existing.costPrice = costPrice;
        existing.retailPrice = retailPrice;
        existing.loosePrice = loosePrice;
        existing.packEnabled = packEnabled;
        existing.packSize = packEnabled ? packSize : 1;
        existing.packPrice = packEnabled ? packPrice : 0;
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
        sku: sku || getNextGeneratedSku(data),
        barcode,
        hsnCode,
        name,
        category,
        unit,
        costPrice,
        retailPrice,
        loosePrice,
        packEnabled,
        packSize: packEnabled ? packSize : 1,
        packPrice: packEnabled ? packPrice : 0,
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

  async function lookupOpenFoodFactsProduct(payload) {
    assertLicenseActive();

    const input = payload && typeof payload === 'object' ? payload : {};
    const barcode = normalizeBarcodeLookupInput(input.barcode || payload);
    const nowTs = Date.now();

    assert(barcode.length >= 8, 'Enter a valid barcode to fetch product details');
    assert(typeof fetch === 'function', 'Barcode lookup is not available in this build');

    const existingProduct = (store.get().products || []).find(
      (product) => normalizeBarcodeLookupInput(product.barcode) === barcode
    );
    if (existingProduct) {
      return {
        barcode,
        name: toText(existingProduct.name),
        brand: '',
        category: toText(existingProduct.category) || 'General',
        unitHint: toText(existingProduct.unit) || 'Unit',
        quantityLabel: '',
        source: 'ERPMania Catalog',
        sourceUrl: '',
        rawCategory: toText(existingProduct.category),
        cached: true,
        existingProductId: existingProduct.id
      };
    }

    const cachedLookup = openFactsLookupCache.get(barcode);
    if (cachedLookup && cachedLookup.expiresAt > nowTs) {
      return clone(cachedLookup.data);
    }

    const attempts = [];

    for (const source of OPEN_FACTS_SOURCES) {
      const result = await fetchOpenFactsSourceProduct(source, barcode, openFactsRateLimitState);
      attempts.push(result);

      if (result.status === 'success') {
        openFactsLookupCache.set(barcode, {
          data: result.data,
          expiresAt: Date.now() + OPEN_FACTS_CACHE_TTL_MS
        });
        return clone(result.data);
      }
    }

    const rateLimitedAttempts = attempts.filter((attempt) => attempt.status === 'rate_limited');
    const errorAttempt = attempts.find((attempt) => attempt.status === 'error');

    if (errorAttempt) {
      throw new Error(errorAttempt.message);
    }

    if (rateLimitedAttempts.length === attempts.length && rateLimitedAttempts.length > 0) {
      const waitSeconds = Math.max(
        1,
        Math.ceil(
          Math.max(...rateLimitedAttempts.map((attempt) => Number(attempt.retryAfterMs) || 0)) / 1000
        )
      );
      throw new Error(
        `Open Facts services are rate-limiting requests right now. Please wait about ${waitSeconds} seconds and try again.`
      );
    }

    if (rateLimitedAttempts.length > 0) {
      const waitSeconds = Math.max(
        1,
        Math.ceil(
          Math.max(...rateLimitedAttempts.map((attempt) => Number(attempt.retryAfterMs) || 0)) / 1000
        )
      );
      throw new Error(
        `Barcode not found in the available Open Facts sources right now. Some services are rate-limited; try again in about ${waitSeconds} seconds.`
      );
    }

    throw new Error('Barcode not found in Open Facts databases');
  }

  function deleteProduct(productId) {
    assertLicenseActive();

    const id = toText(productId);
    assert(id, 'Product id is required');

    store.mutate((data) => {
      const index = data.products.findIndex((product) => toText(product.id) === id);
      assert(index >= 0, 'Product not found');
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
    const paidMethod = normalizePaymentMethod(payload.paidMethod || payload.paymentMethod);
    const notes = sanitizeNarrationText(payload.notes);

    assert(discount >= 0, 'Discount cannot be negative');
    assert(gstRate >= 0, 'GST rate cannot be negative');
    assert(paidAmountInput >= 0, 'Paid amount cannot be negative');

    const rawItems = Array.isArray(payload.items) ? payload.items : [];
    assert(rawItems.length > 0, 'Add at least one invoice item');

    const itemLines = [];
    for (const item of rawItems) {
      const productId = toText(item.productId);
      const qty = round2(toNumber(item.qty, NaN));
      const saleUnit = toText(item.saleUnit).toLowerCase() === 'pack' ? 'pack' : 'loose';

      assert(productId, 'Each invoice item needs a product');
      assert(Number.isFinite(qty) && qty > 0, 'Item quantity must be greater than 0');

      itemLines.push({
        productId,
        qty,
        saleUnit
      });
    }

    let createdInvoice;

    store.mutate((data) => {
      assertGstPeriodUnlocked(
        data,
        nowIso(),
        'Creating an invoice'
      );

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
      const stockRequired = new Map();

      for (const lineInput of itemLines) {
        const product = data.products.find((entry) => entry.id === lineInput.productId);
        assert(product, 'Invoice item has an invalid product');

        const pricing = getPriceByChannel(product, channel, lineInput.qty, lineInput.saleUnit);
        const baseQty = round2(toNumber(pricing.baseQty, lineInput.qty));
        const lineTotal = round2(pricing.unitPrice * lineInput.qty);

        subtotal = round2(subtotal + lineTotal);
        const requiredQty = round2(toNumber(stockRequired.get(product.id), 0) + baseQty);
        stockRequired.set(product.id, requiredQty);

        items.push({
          productId: product.id,
          sku: product.sku,
          barcode: product.barcode,
          hsnCode: normalizeHsnCode(product.hsnCode),
          name: product.name,
          unit: pricing.unitLabel,
          qty: lineInput.qty,
          baseQty,
          saleUnit: pricing.saleUnit,
          packSize: pricing.packSize,
          looseUnit: pricing.looseUnit,
          unitPrice: pricing.unitPrice,
          costPrice: round2(toNumber(product.costPrice, product.wholesalePrice)),
          lineTotal,
          pricingMode: pricing.pricingMode
        });
      }

      for (const [productId, requiredQty] of stockRequired.entries()) {
        const product = data.products.find((entry) => entry.id === productId);
        assert(product, 'Invoice item has an invalid product');
        assert(product.stock >= requiredQty, `Insufficient stock for ${product.name}`);
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

      for (const [productId, requiredQty] of stockRequired.entries()) {
        const product = data.products.find((entry) => entry.id === productId);
        product.stock = round2(product.stock - requiredQty);
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
        paidMethod,
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

  function updateInvoice(payload) {
    assertLicenseActive();

    const invoiceId = toText(payload && (payload.id || payload.invoiceId));
    const channel = normalizeChannel(payload && payload.channel);
    const customerId = toText(payload && payload.customerId);
    const discount = round2(toNumber(payload && payload.discount, 0));
    const gstEnabled = Boolean(payload && payload.gstEnabled);
    const gstRate = gstEnabled ? round2(toNumber(payload && payload.gstRate, 0)) : 0;
    const paidAmountRaw = payload && payload.paidAmount;
    const paidMethod = normalizePaymentMethod(
      payload && (payload.paidMethod || payload.paymentMethod)
    );
    const notes = sanitizeNarrationText(payload && payload.notes);

    assert(invoiceId, 'Invoice id is required');
    assert(discount >= 0, 'Discount cannot be negative');
    assert(gstRate >= 0, 'GST rate cannot be negative');

    const rawItems = Array.isArray(payload && payload.items) ? payload.items : [];
    assert(rawItems.length > 0, 'Add at least one invoice item');

    const itemLines = [];
    for (const item of rawItems) {
      const productId = toText(item && item.productId);
      const qty = round2(toNumber(item && item.qty, NaN));
      const saleUnit = toText(item && item.saleUnit).toLowerCase() === 'pack' ? 'pack' : 'loose';
      const unitPriceInput = round2(toNumber(item && item.unitPrice, NaN));

      assert(productId, 'Each invoice item needs a product');
      assert(Number.isFinite(qty) && qty > 0, 'Item quantity must be greater than 0');

      itemLines.push({
        productId,
        qty,
        saleUnit,
        unitPrice: Number.isFinite(unitPriceInput) && unitPriceInput > 0 ? unitPriceInput : null
      });
    }

    let updatedInvoice;

    store.mutate((data) => {
      const invoice = data.invoices.find((entry) => entry.id === invoiceId);
      assert(invoice, 'Invoice not found');
      assertGstPeriodUnlocked(
        data,
        invoice.createdAt,
        'Updating an invoice in a filed period'
      );

      let customer = data.customers.find((entry) => entry.name === 'Walk-in Customer') || null;
      if (customerId) {
        const requested = data.customers.find((entry) => entry.id === customerId);
        assert(requested, 'Selected customer does not exist');
        customer = requested;
      }

      if (channel === 'wholesale' && customer && customer.type !== 'wholesale') {
        throw new Error('Wholesale invoice should use a wholesale customer');
      }

      const productById = new Map(data.products.map((product) => [product.id, product]));
      const previousItems = Array.isArray(invoice.items) ? invoice.items : [];

      for (const line of previousItems) {
        const productId = toText(line && line.productId);
        if (!productId) {
          continue;
        }

        const product = data.products.find((entry) => entry.id === productId);
        assert(product, 'Invoice item has an invalid product');
        const revertQty = round2(resolveInvoiceItemBaseQty(line, productById));
        if (!(revertQty > 0)) {
          continue;
        }

        product.stock = round2(toNumber(product.stock, 0) + revertQty);
        product.updatedAt = nowIso();
      }

      const items = [];
      let subtotal = 0;
      const stockRequired = new Map();

      for (const lineInput of itemLines) {
        const product = data.products.find((entry) => entry.id === lineInput.productId);
        assert(product, 'Invoice item has an invalid product');

        const pricing = getPriceByChannel(product, channel, lineInput.qty, lineInput.saleUnit);
        const baseQty = round2(toNumber(pricing.baseQty, lineInput.qty));
        const unitPrice =
          Number.isFinite(lineInput.unitPrice) && lineInput.unitPrice > 0
            ? round2(lineInput.unitPrice)
            : pricing.unitPrice;
        const lineTotal = round2(unitPrice * lineInput.qty);

        subtotal = round2(subtotal + lineTotal);
        const requiredQty = round2(toNumber(stockRequired.get(product.id), 0) + baseQty);
        stockRequired.set(product.id, requiredQty);

        items.push({
          productId: product.id,
          sku: product.sku,
          barcode: product.barcode,
          hsnCode: normalizeHsnCode(product.hsnCode),
          name: product.name,
          unit: pricing.unitLabel,
          qty: lineInput.qty,
          baseQty,
          saleUnit: pricing.saleUnit,
          packSize: pricing.packSize,
          looseUnit: pricing.looseUnit,
          unitPrice,
          costPrice: round2(toNumber(product.costPrice, product.wholesalePrice)),
          lineTotal,
          pricingMode: pricing.pricingMode
        });
      }

      for (const [productId, requiredQty] of stockRequired.entries()) {
        const product = data.products.find((entry) => entry.id === productId);
        assert(product, 'Invoice item has an invalid product');
        assert(product.stock >= requiredQty, `Insufficient stock for ${product.name}`);
      }

      for (const [productId, requiredQty] of stockRequired.entries()) {
        const product = data.products.find((entry) => entry.id === productId);
        product.stock = round2(product.stock - requiredQty);
        product.updatedAt = nowIso();
      }

      const taxableValue = round2(Math.max(subtotal - discount, 0));
      const gstAmount = round2(gstEnabled ? (taxableValue * gstRate) / 100 : 0);
      const total = round2(taxableValue + gstAmount);

      const history = Array.isArray(invoice.paymentHistory) ? invoice.paymentHistory : [];
      const historyPaid = round2(
        history.reduce((sum, payment) => sum + round2(toNumber(payment && payment.amount, 0)), 0)
      );

      const paidAmountMissing =
        paidAmountRaw === undefined || paidAmountRaw === null || toText(paidAmountRaw) === '';
      const fallbackPaidAmount = round2(toNumber(invoice.paidAmount, 0));
      const paidAmountInput = round2(toNumber(paidAmountRaw, fallbackPaidAmount));
      const paidAmount =
        channel === 'retail' && paidAmountMissing && historyPaid <= 0 ? total : paidAmountInput;

      assert(paidAmount >= 0, 'Paid amount cannot be negative');
      assert(paidAmount >= historyPaid, 'Paid amount cannot be less than payments already received');

      const balance = round2(Math.max(total - paidAmount, 0));
      const change = round2(Math.max(paidAmount - total, 0));

      invoice.channel = channel;
      invoice.customerId = customer ? customer.id : null;
      invoice.customerSnapshot = {
        name: customer ? customer.name : 'Walk-in Customer',
        type: customer ? customer.type : 'retail',
        phone: customer ? customer.phone : '',
        address: customer ? customer.address : '',
        gstin: customer ? customer.gstin : ''
      };
      invoice.items = items;
      invoice.subtotal = subtotal;
      invoice.discount = discount;
      invoice.taxableValue = taxableValue;
      invoice.gstEnabled = gstEnabled;
      invoice.gstRate = gstRate;
      invoice.gstAmount = gstAmount;
      invoice.total = total;
      invoice.paidAmount = paidAmount;
      invoice.paidMethod = paidMethod;
      invoice.balance = balance;
      invoice.paymentStatus = deriveInvoicePaymentStatus(total, paidAmount, balance);
      invoice.change = change;
      invoice.notes = notes;
      invoice.updatedAt = nowIso();

      updatedInvoice = clone(invoice);
      return data;
    });

    return updatedInvoice;
  }

  function createPurchase(payload) {
    assertLicenseActive();

    const supplierId = toText(payload.supplierId);
    const discount = round2(toNumber(payload.discount, 0));
    const rawGstRate = round2(toNumber(payload.gstRate, 0));
    const rawGstAmount = round2(toNumber(payload.gstAmount, NaN));
    const hasExplicitGstAmount = Number.isFinite(rawGstAmount) && rawGstAmount > 0;
    const gstEnabled = Boolean(payload.gstEnabled) || rawGstRate > 0 || hasExplicitGstAmount;
    const gstRate = gstEnabled ? rawGstRate : 0;
    const paidAmount = round2(toNumber(payload.paidAmount, 0));
    const paidMethod = normalizePaymentMethod(payload.paidMethod || payload.paymentMethod);
    const notes = sanitizeNarrationText(payload.notes);

    assert(supplierId, 'Supplier is required');
    assert(discount >= 0, 'Discount cannot be negative');
    assert(gstRate >= 0, 'GST rate cannot be negative');
    assert(!Number.isFinite(rawGstAmount) || rawGstAmount >= 0, 'GST amount cannot be negative');
    assert(paidAmount >= 0, 'Paid amount cannot be negative');

    const rawItems = Array.isArray(payload.items) ? payload.items : [];
    assert(rawItems.length > 0, 'Add at least one purchase item');

    const consolidated = new Map();
    for (const item of rawItems) {
      const productId = toText(item.productId);
      const qty = round2(toNumber(item.qty, NaN));
      const unitCost = round2(toNumber(item.unitCost ?? item.unitPrice, NaN));

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
      assertGstPeriodUnlocked(
        data,
        nowIso(),
        'Creating a purchase'
      );

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
          hsnCode: normalizeHsnCode(product.hsnCode),
          name: product.name,
          unit: product.unit,
          qty: line.qty,
          unitCost: line.unitCost,
          lineTotal
        });
      }

      const taxableValue = round2(Math.max(subtotal - discount, 0));
      const gstAmount = hasExplicitGstAmount ? rawGstAmount : round2(gstEnabled ? (taxableValue * gstRate) / 100 : 0);
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
        paidMethod,
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

  function updatePurchase(payload) {
    assertLicenseActive();

    const purchaseId = toText(payload && (payload.id || payload.purchaseId));
    const supplierId = toText(payload && payload.supplierId);
    const discount = round2(toNumber(payload && payload.discount, 0));
    const rawGstRate = round2(toNumber(payload && payload.gstRate, 0));
    const rawGstAmount = round2(toNumber(payload && payload.gstAmount, NaN));
    const hasExplicitGstAmount = Number.isFinite(rawGstAmount) && rawGstAmount > 0;
    const gstEnabled = Boolean(payload && payload.gstEnabled) || rawGstRate > 0 || hasExplicitGstAmount;
    const gstRate = gstEnabled ? rawGstRate : 0;
    const paidAmount = round2(toNumber(payload && payload.paidAmount, 0));
    const paidMethod = normalizePaymentMethod(
      payload && (payload.paidMethod || payload.paymentMethod)
    );
    const notes = sanitizeNarrationText(payload && payload.notes);

    assert(purchaseId, 'Purchase id is required');
    assert(supplierId, 'Supplier is required');
    assert(discount >= 0, 'Discount cannot be negative');
    assert(gstRate >= 0, 'GST rate cannot be negative');
    assert(!Number.isFinite(rawGstAmount) || rawGstAmount >= 0, 'GST amount cannot be negative');
    assert(paidAmount >= 0, 'Paid amount cannot be negative');

    const rawItems = Array.isArray(payload && payload.items) ? payload.items : [];
    assert(rawItems.length > 0, 'Add at least one purchase item');

    const consolidated = new Map();
    for (const item of rawItems) {
      const productId = toText(item && item.productId);
      const qty = round2(toNumber(item && item.qty, NaN));
      const unitCost = round2(toNumber(item && (item.unitCost ?? item.unitPrice), NaN));

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

    let updatedPurchase;

    store.mutate((data) => {
      const purchase = data.purchases.find((entry) => entry.id === purchaseId);
      assert(purchase, 'Purchase not found');
      assertGstPeriodUnlocked(
        data,
        purchase.createdAt,
        'Updating a purchase in a filed period'
      );

      const supplier = data.suppliers.find((entry) => entry.id === supplierId);
      assert(supplier, 'Selected supplier does not exist');

      const allocationPaid = round2(sumSupplierPaymentAllocationsForPurchase(data, purchase.id));
      if (allocationPaid > 0 && purchase.supplierId !== supplier.id) {
        throw new Error('Cannot change supplier after supplier payments are recorded');
      }

      const affectedProductIds = new Set();
      const previousItems = Array.isArray(purchase.items) ? purchase.items : [];
      for (const previousLine of previousItems) {
        const previousProductId = toText(previousLine && previousLine.productId);
        if (previousProductId) {
          affectedProductIds.add(previousProductId);
        }

        const product = data.products.find((entry) => entry.id === previousProductId);
        assert(product, 'Purchase item has an invalid product');

        const previousQty = round2(toNumber(previousLine && previousLine.qty, 0));
        if (!(previousQty > 0)) {
          continue;
        }

        const nextStock = round2(toNumber(product.stock, 0) - previousQty);
        assert(
          nextStock >= 0,
          `Cannot edit purchase because current stock is too low for ${product.name}`
        );
        product.stock = nextStock;
        product.updatedAt = nowIso();
      }

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
          hsnCode: normalizeHsnCode(product.hsnCode),
          name: product.name,
          unit: product.unit,
          qty: line.qty,
          unitCost: line.unitCost,
          lineTotal
        });

        affectedProductIds.add(product.id);
      }

      const taxableValue = round2(Math.max(subtotal - discount, 0));
      const gstAmount = hasExplicitGstAmount ? rawGstAmount : round2(gstEnabled ? (taxableValue * gstRate) / 100 : 0);
      const total = round2(taxableValue + gstAmount);
      assert(paidAmount <= total, 'Paid amount cannot exceed purchase total');

      const dueAmount = round2(Math.max(total - paidAmount, 0));
      assert(
        allocationPaid <= dueAmount,
        'Due amount cannot be less than supplier payments already recorded'
      );

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

      purchase.supplierId = supplier.id;
      purchase.supplierSnapshot = {
        name: supplier.name,
        phone: supplier.phone,
        gstin: supplier.gstin
      };
      purchase.items = items;
      purchase.subtotal = subtotal;
      purchase.discount = discount;
      purchase.taxableValue = taxableValue;
      purchase.gstEnabled = gstEnabled;
      purchase.gstRate = gstRate;
      purchase.gstAmount = gstAmount;
      purchase.total = total;
      purchase.paidAmount = paidAmount;
      purchase.paidMethod = paidMethod;
      purchase.dueAmount = dueAmount;
      purchase.balance = round2(Math.max(dueAmount - allocationPaid, 0));
      purchase.notes = notes;
      purchase.updatedAt = nowIso();

      for (const productId of affectedProductIds) {
        recalculateProductCostFromPurchases(data, productId);
      }

      updatedPurchase = clone(purchase);
      return data;
    });

    return updatedPurchase;
  }

  function createSupplierPayment(payload) {
    assertLicenseActive();

    const supplierId = toText(payload.supplierId);
    const amount = round2(toNumber(payload.amount, NaN));
    const paymentMethod = normalizePaymentMethod(payload.paymentMethod || payload.mode || payload.method);
    const notes = sanitizeNarrationText(payload.notes);

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
        paymentMethod,
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
    const paymentMethod = normalizePaymentMethod(
      payload && (payload.paymentMethod || payload.mode || payload.method)
    );
    const paidTo = toText(payload && payload.paidTo);
    const notes = sanitizeNarrationText(payload && payload.notes);
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
        paymentMethod,
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

  function updateExpense(payload) {
    assertLicenseActive();

    const expenseId = toText(payload && (payload.id || payload.expenseId));
    const category = toText(payload && payload.category) || 'Other';
    const amount = round2(toNumber(payload && payload.amount, NaN));
    const paymentMethod = normalizePaymentMethod(
      payload && (payload.paymentMethod || payload.mode || payload.method)
    );
    const paidTo = toText(payload && payload.paidTo);
    const notes = toText(payload && payload.notes);
    const expenseDate = parseLocalDateInput(payload && payload.expenseDate);

    assert(expenseId, 'Expense id is required');
    assert(Number.isFinite(amount) && amount > 0, 'Expense amount must be greater than 0');

    let updatedExpense;

    store.mutate((data) => {
      if (!Array.isArray(data.expenses)) {
        data.expenses = [];
      }

      const expense = data.expenses.find((entry) => entry.id === expenseId);
      assert(expense, 'Expense not found');

      expense.category = category;
      expense.amount = amount;
      expense.paymentMethod = paymentMethod;
      expense.paidTo = paidTo;
      expense.notes = notes;
      if (expenseDate) {
        expense.createdAt = expenseDate.toISOString();
      }
      expense.updatedAt = nowIso();

      updatedExpense = clone(expense);
      return data;
    });

    return updatedExpense;
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
          note: '',
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

  function resolveReportRange(period, focusDate) {
    if (period === 'monthly') {
      const range = monthRange(focusDate);
      return {
        range,
        periodKey: toMonthKey(range.start),
        periodLabel: formatMonthLabel(range.start)
      };
    }

    if (period === 'yearly') {
      const range = yearRange(focusDate);
      return {
        range,
        periodKey: toYearKey(range.start),
        periodLabel: toYearKey(range.start)
      };
    }

    const range = dayRange(focusDate);
    const periodKey = toDayKey(range.start);
    return {
      range,
      periodKey,
      periodLabel: periodKey
    };
  }

  function createTaxAggregate() {
    return {
      documentCount: 0,
      taxableValue: 0,
      sgst: 0,
      cgst: 0,
      gstAmount: 0,
      total: 0
    };
  }

  function addTaxAggregate(target, values) {
    if (!target || !values) {
      return target;
    }

    target.documentCount += Math.max(1, Math.trunc(toNumber(values.documentCount, 1)));
    target.taxableValue = round2(target.taxableValue + toNumber(values.taxableValue, 0));
    target.sgst = round2(target.sgst + toNumber(values.sgst, 0));
    target.cgst = round2(target.cgst + toNumber(values.cgst, 0));
    target.gstAmount = round2(
      target.gstAmount + toNumber(values.gstAmount, toNumber(values.sgst, 0) + toNumber(values.cgst, 0))
    );
    target.total = round2(
      target.total + toNumber(values.total, toNumber(values.taxableValue, 0) + toNumber(values.gstAmount, 0))
    );
    return target;
  }

  function pushRateBucket(bucketMap, rate, values) {
    const numericRate = round2(Math.max(toNumber(rate, 0), 0));
    const rateKey = numericRate.toFixed(2);
    const current =
      bucketMap.get(rateKey) || {
        rate: numericRate,
        rateLabel: `${numericRate.toFixed(2)}%`,
        documentCount: 0,
        taxableValue: 0,
        sgst: 0,
        cgst: 0,
        gstAmount: 0,
        total: 0
      };

    addTaxAggregate(current, values);
    bucketMap.set(rateKey, current);
  }

  function sortRateBuckets(bucketMap) {
    return [...bucketMap.values()].sort((left, right) => {
      if (right.rate !== left.rate) {
        return right.rate - left.rate;
      }

      return right.taxableValue - left.taxableValue;
    });
  }

  function sortDocumentsByCreatedAt(left, right) {
    return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
  }

  function addSignedTaxAggregate(target, values, multiplier = 1) {
    if (!target || !values) {
      return target;
    }

    target.documentCount += Math.max(1, Math.trunc(toNumber(values.documentCount, 1)));
    target.taxableValue = round2(target.taxableValue + multiplier * toNumber(values.taxableValue, 0));
    target.sgst = round2(target.sgst + multiplier * toNumber(values.sgst, 0));
    target.cgst = round2(target.cgst + multiplier * toNumber(values.cgst, 0));
    target.gstAmount = round2(
      target.gstAmount +
        multiplier * toNumber(values.gstAmount, toNumber(values.sgst, 0) + toNumber(values.cgst, 0))
    );
    target.total = round2(
      target.total +
        multiplier * toNumber(values.total, toNumber(values.taxableValue, 0) + toNumber(values.gstAmount, 0))
    );
    return target;
  }

  function pushRateBucketSigned(bucketMap, rate, values, multiplier = 1) {
    const numericRate = round2(Math.max(toNumber(rate, 0), 0));
    const rateKey = numericRate.toFixed(2);
    const current =
      bucketMap.get(rateKey) || {
        rate: numericRate,
        rateLabel: `${numericRate.toFixed(2)}%`,
        documentCount: 0,
        taxableValue: 0,
        sgst: 0,
        cgst: 0,
        gstAmount: 0,
        total: 0
      };

    addSignedTaxAggregate(current, values, multiplier);
    bucketMap.set(rateKey, current);
  }

  function createHsnAggregate(seed = {}) {
    return {
      hsnCode: normalizeHsnCode(seed.hsnCode) || 'UNSPECIFIED',
      description: toText(seed.description) || 'Unmapped Item',
      unit: toText(seed.unit) || 'Unit',
      quantity: 0,
      taxableValue: 0,
      sgst: 0,
      cgst: 0,
      gstAmount: 0,
      total: 0
    };
  }

  function pushHsnBucket(bucketMap, row) {
    const hsnCode = normalizeHsnCode(row && row.hsnCode) || 'UNSPECIFIED';
    const unit = toText(row && row.unit) || 'Unit';
    const key = `${hsnCode}::${unit}`;
    const current =
      bucketMap.get(key) ||
      createHsnAggregate({
        hsnCode,
        description: row && row.description,
        unit
      });

    if (current.description === 'Unmapped Item' && toText(row && row.description)) {
      current.description = toText(row.description);
    }

    current.quantity = round2(current.quantity + toNumber(row && row.quantity, 0));
    current.taxableValue = round2(current.taxableValue + toNumber(row && row.taxableValue, 0));
    current.sgst = round2(current.sgst + toNumber(row && row.sgst, 0));
    current.cgst = round2(current.cgst + toNumber(row && row.cgst, 0));
    current.gstAmount = round2(current.gstAmount + toNumber(row && row.gstAmount, 0));
    current.total = round2(current.total + toNumber(row && row.total, 0));
    bucketMap.set(key, current);
  }

  function sortHsnBuckets(bucketMap) {
    return [...bucketMap.values()].sort((left, right) => {
      const hsnCompare = left.hsnCode.localeCompare(right.hsnCode);
      if (hsnCompare !== 0) {
        return hsnCompare;
      }

      return left.description.localeCompare(right.description);
    });
  }

  function stateCodeFromGstin(gstin) {
    const code = toText(gstin).slice(0, 2);
    return /^\d{2}$/.test(code) ? code : '';
  }

  function buildGstFilingDataset(data, period, focusDate) {
    const { range, periodKey, periodLabel } = resolveReportRange(period, focusDate);
    const business = clone(data.meta.business || {});
    const businessGstin = toText(business.gstin).toUpperCase();
    const businessStateCode = stateCodeFromGstin(businessGstin);
    const customerById = new Map(
      (Array.isArray(data.customers) ? data.customers : []).map((customer) => [customer.id, customer])
    );
    const supplierById = new Map(
      (Array.isArray(data.suppliers) ? data.suppliers : []).map((supplier) => [supplier.id, supplier])
    );
    const productById = new Map(
      (Array.isArray(data.products) ? data.products : []).map((product) => [product.id, product])
    );

    const invoices = (Array.isArray(data.invoices) ? data.invoices : [])
      .filter((invoice) => isWithinRange(invoice.createdAt, range.start, range.end))
      .sort(sortDocumentsByCreatedAt);
    const purchases = (Array.isArray(data.purchases) ? data.purchases : [])
      .filter((purchase) => isWithinRange(purchase.createdAt, range.start, range.end))
      .sort(sortDocumentsByCreatedAt);
    const gstNotes = (Array.isArray(data.gstNotes) ? data.gstNotes : [])
      .filter((note) => isWithinRange(note.createdAt, range.start, range.end))
      .sort(sortDocumentsByCreatedAt);

    const outwardRateBuckets = new Map();
    const inwardRateBuckets = new Map();
    const outwardNoteRateBuckets = new Map();
    const inwardNoteRateBuckets = new Map();
    const outwardHsnBuckets = new Map();
    const inwardHsnBuckets = new Map();

    const outwardRegistered = createTaxAggregate();
    const outwardUnregistered = createTaxAggregate();
    const outwardNilRated = createTaxAggregate();
    const inwardTaxed = createTaxAggregate();
    const inwardNilRated = createTaxAggregate();
    const outwardNoteRegistered = createTaxAggregate();
    const outwardNoteUnregistered = createTaxAggregate();
    const inwardNoteAdjustments = createTaxAggregate();

    const outwardRows = [];
    const inwardRows = [];
    const outwardNoteRows = [];
    const inwardNoteRows = [];

    let taxedPurchasesMissingSupplierGstinCount = 0;
    let taxedPurchasesMissingSupplierGstinValue = 0;
    let taxedInvoicesWithoutCustomerGstinCount = 0;
    let taxedInvoicesWithoutCustomerGstinValue = 0;
    let missingHsnRowCount = 0;

    for (const invoice of invoices) {
      const fallbackCustomer = invoice.customerId ? customerById.get(invoice.customerId) || null : null;
      const snapshot =
        invoice.customerSnapshot && typeof invoice.customerSnapshot === 'object'
          ? invoice.customerSnapshot
          : fallbackCustomer || {};
      const customerName = toText(snapshot.name) || 'Walk-in';
      const customerGstin = toText(snapshot.gstin).toUpperCase();
      const taxableValue = round2(
        toNumber(invoice.taxableValue, toNumber(invoice.total, 0) - toNumber(invoice.gstAmount, 0))
      );
      const gstAmount = round2(toNumber(invoice.gstAmount, 0));
      const { primary: sgst, secondary: cgst } = splitTaxValue(gstAmount);
      const total = round2(toNumber(invoice.total, taxableValue + gstAmount));
      const gstRate =
        taxableValue > 0
          ? round2(toNumber(invoice.gstRate, (gstAmount * 100) / taxableValue))
          : round2(toNumber(invoice.gstRate, 0));

      const row = {
        id: invoice.id,
        invoiceNo:
          toText(invoice.invoiceNo) || fallbackDocumentNumber('INV', invoice.createdAt, invoice.id),
        createdAt: invoice.createdAt,
        date: toDayKey(invoice.createdAt),
        customerName,
        customerGstin,
        customerType: toText(snapshot.type) || 'retail',
        channel: normalizeChannel(invoice.channel),
        taxableValue,
        sgst,
        cgst,
        gstAmount,
        gstRate,
        total,
        paymentStatus:
          toText(invoice.paymentStatus) ||
          deriveInvoicePaymentStatus(invoice.total, invoice.paidAmount, invoice.balance)
      };

      outwardRows.push(row);

      if (gstAmount > 0) {
        pushRateBucket(outwardRateBuckets, gstRate, row);
        if (customerGstin) {
          addTaxAggregate(outwardRegistered, row);
        } else {
          addTaxAggregate(outwardUnregistered, row);
          taxedInvoicesWithoutCustomerGstinCount += 1;
          taxedInvoicesWithoutCustomerGstinValue = round2(
            taxedInvoicesWithoutCustomerGstinValue + taxableValue
          );
        }
      } else {
        addTaxAggregate(outwardNilRated, row);
      }

      const items = Array.isArray(invoice.items) ? invoice.items : [];
      const invoiceSubtotal = round2(
        toNumber(
          invoice.subtotal,
          items.reduce(
            (sum, item) =>
              sum +
              round2(
                toNumber(item && item.lineTotal, toNumber(item && item.qty, 0) * toNumber(item && item.unitPrice, 0))
              ),
            0
          )
        )
      );

      for (const item of items) {
        const lineTotal = round2(
          toNumber(item && item.lineTotal, toNumber(item && item.qty, 0) * toNumber(item && item.unitPrice, 0))
        );
        const itemTaxable = invoiceSubtotal > 0 ? round2((lineTotal / invoiceSubtotal) * taxableValue) : lineTotal;
        const itemGst = gstRate > 0 ? round2((itemTaxable * gstRate) / 100) : 0;
        const resolvedProduct = productById.get(toText(item && item.productId));
        const hsnCode = normalizeHsnCode(item && item.hsnCode) || normalizeHsnCode(resolvedProduct && resolvedProduct.hsnCode);

        if (!hsnCode) {
          missingHsnRowCount += 1;
        }

        const taxSplit = splitTaxValue(itemGst);
        pushHsnBucket(outwardHsnBuckets, {
          hsnCode,
          description: toText(item && item.name) || toText(resolvedProduct && resolvedProduct.name) || 'Unmapped Item',
          unit:
            toText(item && (item.looseUnit || item.unit)) ||
            toText(resolvedProduct && resolvedProduct.unit) ||
            'Unit',
          quantity: round2(toNumber(item && (item.baseQty ?? item.qty), 0)),
          taxableValue: itemTaxable,
          sgst: taxSplit.primary,
          cgst: taxSplit.secondary,
          gstAmount: itemGst,
          total: round2(itemTaxable + itemGst)
        });
      }
    }

    for (const purchase of purchases) {
      const fallbackSupplier = purchase.supplierId ? supplierById.get(purchase.supplierId) || null : null;
      const snapshot =
        purchase.supplierSnapshot && typeof purchase.supplierSnapshot === 'object'
          ? purchase.supplierSnapshot
          : fallbackSupplier || {};
      const supplierName = toText(snapshot.name) || 'Supplier';
      const supplierGstin = toText(snapshot.gstin).toUpperCase();
      const taxableValue = round2(
        toNumber(purchase.taxableValue, toNumber(purchase.total, 0) - toNumber(purchase.gstAmount, 0))
      );
      const gstAmount = round2(toNumber(purchase.gstAmount, 0));
      const { primary: sgst, secondary: cgst } = splitTaxValue(gstAmount);
      const total = round2(toNumber(purchase.total, taxableValue + gstAmount));
      const gstRate =
        taxableValue > 0
          ? round2(toNumber(purchase.gstRate, (gstAmount * 100) / taxableValue))
          : round2(toNumber(purchase.gstRate, 0));

      const row = {
        id: purchase.id,
        purchaseNo:
          toText(purchase.purchaseNo) || fallbackDocumentNumber('PUR', purchase.createdAt, purchase.id),
        createdAt: purchase.createdAt,
        date: toDayKey(purchase.createdAt),
        supplierName,
        supplierGstin,
        taxableValue,
        sgst,
        cgst,
        gstAmount,
        gstRate,
        total,
        paidAmount: round2(toNumber(purchase.paidAmount, 0)),
        dueAmount: round2(toNumber(purchase.balance, purchase.dueAmount))
      };

      inwardRows.push(row);

      if (gstAmount > 0) {
        pushRateBucket(inwardRateBuckets, gstRate, row);
        addTaxAggregate(inwardTaxed, row);

        if (!supplierGstin) {
          taxedPurchasesMissingSupplierGstinCount += 1;
          taxedPurchasesMissingSupplierGstinValue = round2(
            taxedPurchasesMissingSupplierGstinValue + taxableValue
          );
        }
      } else {
        addTaxAggregate(inwardNilRated, row);
      }

      const items = Array.isArray(purchase.items) ? purchase.items : [];
      const purchaseSubtotal = round2(
        toNumber(
          purchase.subtotal,
          items.reduce(
            (sum, item) =>
              sum +
              round2(
                toNumber(item && item.lineTotal, toNumber(item && item.qty, 0) * toNumber(item && item.unitCost, 0))
              ),
            0
          )
        )
      );

      for (const item of items) {
        const lineTotal = round2(
          toNumber(item && item.lineTotal, toNumber(item && item.qty, 0) * toNumber(item && item.unitCost, 0))
        );
        const itemTaxable = purchaseSubtotal > 0 ? round2((lineTotal / purchaseSubtotal) * taxableValue) : lineTotal;
        const itemGst = gstRate > 0 ? round2((itemTaxable * gstRate) / 100) : 0;
        const resolvedProduct = productById.get(toText(item && item.productId));
        const hsnCode = normalizeHsnCode(item && item.hsnCode) || normalizeHsnCode(resolvedProduct && resolvedProduct.hsnCode);

        if (!hsnCode) {
          missingHsnRowCount += 1;
        }

        const taxSplit = splitTaxValue(itemGst);
        pushHsnBucket(inwardHsnBuckets, {
          hsnCode,
          description: toText(item && item.name) || toText(resolvedProduct && resolvedProduct.name) || 'Unmapped Item',
          unit: toText(item && item.unit) || toText(resolvedProduct && resolvedProduct.unit) || 'Unit',
          quantity: round2(toNumber(item && item.qty, 0)),
          taxableValue: itemTaxable,
          sgst: taxSplit.primary,
          cgst: taxSplit.secondary,
          gstAmount: itemGst,
          total: round2(itemTaxable + itemGst)
        });
      }
    }

    for (const note of gstNotes) {
      const taxableValue = round2(toNumber(note.taxableValue, 0));
      const gstRate =
        taxableValue > 0
          ? round2(toNumber(note.gstRate, (toNumber(note.gstAmount, 0) * 100) / taxableValue))
          : round2(toNumber(note.gstRate, 0));
      const gstAmount = round2(toNumber(note.gstAmount, taxableValue > 0 ? (taxableValue * gstRate) / 100 : 0));
      const total = round2(toNumber(note.total, taxableValue + gstAmount));
      const { primary: sgst, secondary: cgst } = splitTaxValue(gstAmount);
      const multiplier = note.noteType === 'debit' ? 1 : -1;
      const row = {
        id: note.id,
        noteNo:
          toText(note.noteNo) ||
          gstNoteNumber(0, note.noteType, note.createdAt).replace('-0000', '-PENDING'),
        noteType: note.noteType === 'debit' ? 'debit' : 'credit',
        direction: note.direction === 'inward' ? 'inward' : 'outward',
        referenceType: toText(note.referenceType) || 'manual',
        referenceId: toText(note.referenceId),
        referenceNo: toText(note.referenceNo),
        partyName: toText(note.partyName) || 'Counterparty',
        partyGstin: toText(note.partyGstin).toUpperCase(),
        createdAt: note.createdAt,
        date: toDayKey(note.createdAt),
        taxableValue,
        sgst,
        cgst,
        gstAmount,
        gstRate,
        total,
        signedTaxableValue: round2(taxableValue * multiplier),
        signedSgst: round2(sgst * multiplier),
        signedCgst: round2(cgst * multiplier),
        signedGstAmount: round2(gstAmount * multiplier),
        signedTotal: round2(total * multiplier),
        impactLabel: multiplier > 0 ? 'adds tax' : 'reduces tax',
        notes: sanitizeNarrationText(note.notes)
      };

      if (row.direction === 'outward') {
        outwardNoteRows.push(row);
        pushRateBucketSigned(outwardNoteRateBuckets, gstRate, row, multiplier);
        if (row.partyGstin) {
          addSignedTaxAggregate(outwardNoteRegistered, row, multiplier);
        } else {
          addSignedTaxAggregate(outwardNoteUnregistered, row, multiplier);
        }
      } else {
        inwardNoteRows.push(row);
        pushRateBucketSigned(inwardNoteRateBuckets, gstRate, row, multiplier);
        addSignedTaxAggregate(inwardNoteAdjustments, row, multiplier);
      }
    }

    const outwardTaxed = createTaxAggregate();
    addTaxAggregate(outwardTaxed, outwardRegistered);
    addTaxAggregate(outwardTaxed, outwardUnregistered);
    addSignedTaxAggregate(outwardTaxed, outwardNoteRegistered, 1);
    addSignedTaxAggregate(outwardTaxed, outwardNoteUnregistered, 1);

    const inwardEligibleItc = createTaxAggregate();
    addTaxAggregate(inwardEligibleItc, inwardTaxed);
    addSignedTaxAggregate(inwardEligibleItc, inwardNoteAdjustments, 1);

    const payableSgst = round2(Math.max(outwardTaxed.sgst - inwardEligibleItc.sgst, 0));
    const payableCgst = round2(Math.max(outwardTaxed.cgst - inwardEligibleItc.cgst, 0));
    const carryForwardSgst = round2(Math.max(inwardEligibleItc.sgst - outwardTaxed.sgst, 0));
    const carryForwardCgst = round2(Math.max(inwardEligibleItc.cgst - outwardTaxed.cgst, 0));

    const filingHistory = [...(Array.isArray(data.meta.gstFilingHistory) ? data.meta.gstFilingHistory : [])].sort(
      (left, right) => new Date(right.filedAt || 0) - new Date(left.filedAt || 0)
    );
    const currentPeriodHistory = filingHistory.filter(
      (entry) => entry.period === period && entry.periodKey === periodKey
    );
    const currentPeriodLock =
      (Array.isArray(data.meta.gstLockedPeriods) ? data.meta.gstLockedPeriods : []).find(
        (entry) => entry.active !== false && entry.period === period && entry.periodKey === periodKey
      ) || null;

    const outwardHsnRows = sortHsnBuckets(outwardHsnBuckets);
    const inwardHsnRows = sortHsnBuckets(inwardHsnBuckets);

    const diagnostics = [
      {
        id: 'business-gstin',
        status: businessGstin ? 'ready' : 'attention',
        title: businessGstin ? 'Business GSTIN configured' : 'Business GSTIN missing',
        detail: businessGstin
          ? `GST filings will be prepared under ${businessGstin}.`
          : 'Set your business GSTIN in Settings before filing this period on the official portal.'
      },
      {
        id: 'supplier-gstin',
        status: taxedPurchasesMissingSupplierGstinCount > 0 ? 'review' : 'ready',
        title:
          taxedPurchasesMissingSupplierGstinCount > 0
            ? 'Supplier GSTIN review needed'
            : 'Supplier GSTINs look ready',
        detail:
          taxedPurchasesMissingSupplierGstinCount > 0
            ? `${taxedPurchasesMissingSupplierGstinCount} taxed purchase(s) worth ₹${taxedPurchasesMissingSupplierGstinValue.toFixed(2)} do not carry a supplier GSTIN. Review them before claiming ITC.`
            : 'All taxed purchase entries in this range include supplier GSTIN details.'
      },
      {
        id: 'b2c-outward',
        status: taxedInvoicesWithoutCustomerGstinCount > 0 ? 'info' : 'ready',
        title:
          taxedInvoicesWithoutCustomerGstinCount > 0
            ? 'B2C outward supplies present'
            : 'All taxed outward supplies are GSTIN-tagged',
        detail:
          taxedInvoicesWithoutCustomerGstinCount > 0
            ? `${taxedInvoicesWithoutCustomerGstinCount} taxed invoice(s) worth ₹${taxedInvoicesWithoutCustomerGstinValue.toFixed(2)} will be treated as B2C outward supplies in this workspace.`
            : 'Every taxed outward supply in this range has a customer GSTIN, so they will appear under B2B outward supplies.'
      },
      {
        id: 'hsn-coverage',
        status: missingHsnRowCount > 0 ? 'review' : 'ready',
        title: missingHsnRowCount > 0 ? 'Some items are missing HSN codes' : 'HSN coverage looks good',
        detail:
          missingHsnRowCount > 0
            ? `${missingHsnRowCount} invoice/purchase item row(s) in this period do not have an HSN code. Update the product master for a cleaner HSN summary.`
            : 'Every invoice and purchase item in this range resolves to an HSN code for summary export.'
      },
      {
        id: 'period-lock',
        status: currentPeriodLock ? 'attention' : 'ready',
        title: currentPeriodLock ? 'This filing period is locked' : 'This filing period is open',
        detail: currentPeriodLock
          ? `${periodLabel} is locked from edits because it has been marked as filed. Unlock it here before changing invoices, purchases, or GST notes.`
          : `${periodLabel} is currently open for invoices, purchases, and GST note adjustments.`
      }
    ];

    const portalExport = {
      schemaVersion: '4.1.0',
      generatedAt: nowIso(),
      taxpayer: {
        name: toText(business.name) || 'ERPMania',
        gstin: businessGstin,
        stateCode: businessStateCode
      },
      filingPeriod: {
        period,
        periodKey,
        periodLabel,
        from: toDayKey(range.start),
        to: toDayKey(new Date(range.end.getTime() - 1))
      },
      gstr1: {
        b2b: outwardRows.filter((row) => row.customerGstin).map((row) => ({
          ctin: row.customerGstin,
          inv_no: row.invoiceNo,
          inv_dt: row.date,
          val: row.total,
          pos: businessStateCode,
          taxable_value: row.taxableValue,
          sgst: row.sgst,
          cgst: row.cgst,
          gst_rate: row.gstRate
        })),
        b2c: outwardRows.filter((row) => !row.customerGstin).map((row) => ({
          inv_no: row.invoiceNo,
          inv_dt: row.date,
          val: row.total,
          pos: businessStateCode,
          taxable_value: row.taxableValue,
          sgst: row.sgst,
          cgst: row.cgst,
          gst_rate: row.gstRate
        })),
        cdnr: outwardNoteRows.filter((row) => row.partyGstin).map((row) => ({
          ctin: row.partyGstin,
          nt_num: row.noteNo,
          nt_dt: row.date,
          nt_ty: row.noteType,
          p_gst: row.partyGstin,
          taxable_value: row.signedTaxableValue,
          sgst: row.signedSgst,
          cgst: row.signedCgst,
          gst_rate: row.gstRate,
          ref_doc: row.referenceNo
        })),
        cdnur: outwardNoteRows.filter((row) => !row.partyGstin).map((row) => ({
          nt_num: row.noteNo,
          nt_dt: row.date,
          nt_ty: row.noteType,
          taxable_value: row.signedTaxableValue,
          sgst: row.signedSgst,
          cgst: row.signedCgst,
          gst_rate: row.gstRate,
          ref_doc: row.referenceNo
        })),
        hsn: outwardHsnRows.map((row) => ({
          hsn_sc: row.hsnCode,
          desc: row.description,
          uqc: row.unit,
          qty: row.quantity,
          taxable_value: row.taxableValue,
          sgst: row.sgst,
          cgst: row.cgst,
          total_value: row.total
        }))
      },
      gstr3b: {
        outward_taxable_supplies: {
          taxable_value: outwardTaxed.taxableValue,
          sgst: outwardTaxed.sgst,
          cgst: outwardTaxed.cgst,
          total_tax: outwardTaxed.gstAmount
        },
        outward_nil_rated_supplies: clone(outwardNilRated),
        inward_eligible_itc: {
          taxable_value: inwardEligibleItc.taxableValue,
          sgst: inwardEligibleItc.sgst,
          cgst: inwardEligibleItc.cgst,
          total_tax: inwardEligibleItc.gstAmount
        },
        inward_non_gst: clone(inwardNilRated),
        setoff: {
          payable_sgst: payableSgst,
          payable_cgst: payableCgst,
          payable_total: round2(payableSgst + payableCgst),
          carry_forward_sgst: carryForwardSgst,
          carry_forward_cgst: carryForwardCgst,
          carry_forward_total: round2(carryForwardSgst + carryForwardCgst)
        }
      },
      inward_register: {
        purchases: inwardRows.map((row) => ({
          purchase_no: row.purchaseNo,
          date: row.date,
          supplier_name: row.supplierName,
          supplier_gstin: row.supplierGstin,
          taxable_value: row.taxableValue,
          sgst: row.sgst,
          cgst: row.cgst,
          gst_rate: row.gstRate,
          total: row.total
        })),
        notes: inwardNoteRows.map((row) => ({
          note_no: row.noteNo,
          date: row.date,
          supplier_name: row.partyName,
          supplier_gstin: row.partyGstin,
          note_type: row.noteType,
          taxable_value: row.signedTaxableValue,
          sgst: row.signedSgst,
          cgst: row.signedCgst,
          gst_rate: row.gstRate,
          ref_doc: row.referenceNo
        })),
        hsn: inwardHsnRows.map((row) => ({
          hsn_sc: row.hsnCode,
          desc: row.description,
          uqc: row.unit,
          qty: row.quantity,
          taxable_value: row.taxableValue,
          sgst: row.sgst,
          cgst: row.cgst,
          total_value: row.total
        }))
      },
      filingStatus: {
        isLocked: Boolean(currentPeriodLock),
        history: currentPeriodHistory.map((entry) => ({
          id: entry.id,
          filedAt: entry.filedAt,
          returnTypes: entry.returnTypes,
          acknowledgementNo: entry.acknowledgementNo,
          locked: Boolean(entry.locked)
        }))
      }
    };

    return {
      period,
      inputDate: toDayKey(focusDate),
      periodKey,
      periodLabel,
      rangeStart: range.start.toISOString(),
      rangeEnd: range.end.toISOString(),
      generatedAt: nowIso(),
      business: {
        name: toText(business.name) || 'ERPMania',
        gstin: businessGstin,
        stateCode: businessStateCode
      },
      summary: {
        outwardTaxableValue: outwardTaxed.taxableValue,
        outwardTax: {
          sgst: outwardTaxed.sgst,
          cgst: outwardTaxed.cgst,
          total: outwardTaxed.gstAmount
        },
        outwardAdjustments: {
          registered: clone(outwardNoteRegistered),
          unregistered: clone(outwardNoteUnregistered)
        },
        inwardTaxableValue: inwardEligibleItc.taxableValue,
        inputCredit: {
          sgst: inwardEligibleItc.sgst,
          cgst: inwardEligibleItc.cgst,
          total: inwardEligibleItc.gstAmount
        },
        inwardAdjustments: clone(inwardNoteAdjustments),
        netPayable: {
          sgst: payableSgst,
          cgst: payableCgst,
          total: round2(payableSgst + payableCgst)
        },
        carryForwardCredit: {
          sgst: carryForwardSgst,
          cgst: carryForwardCgst,
          total: round2(carryForwardSgst + carryForwardCgst)
        }
      },
      gstr1: {
        registered: outwardRegistered,
        unregistered: outwardUnregistered,
        nilRated: outwardNilRated,
        noteRegistered: outwardNoteRegistered,
        noteUnregistered: outwardNoteUnregistered,
        invoiceRows: outwardRows,
        noteRows: outwardNoteRows,
        rateRows: sortRateBuckets(outwardRateBuckets),
        noteRateRows: sortRateBuckets(outwardNoteRateBuckets)
      },
      gstr3b: {
        outwardTaxableSupplies: outwardTaxed,
        outwardNilRatedSupplies: outwardNilRated,
        inwardEligibleItc,
        inwardNonGstPurchases: inwardNilRated,
        setoff: {
          outputSgst: outwardTaxed.sgst,
          outputCgst: outwardTaxed.cgst,
          inputSgst: inwardEligibleItc.sgst,
          inputCgst: inwardEligibleItc.cgst,
          payableSgst,
          payableCgst,
          payableTotal: round2(payableSgst + payableCgst),
          carryForwardSgst,
          carryForwardCgst,
          carryForwardTotal: round2(carryForwardSgst + carryForwardCgst)
        }
      },
      inwardRegister: {
        taxed: inwardTaxed,
        adjustedTaxed: inwardEligibleItc,
        noteAdjustments: inwardNoteAdjustments,
        nilRated: inwardNilRated,
        purchaseRows: inwardRows,
        noteRows: inwardNoteRows,
        rateRows: sortRateBuckets(inwardRateBuckets),
        noteRateRows: sortRateBuckets(inwardNoteRateBuckets)
      },
      hsnSummary: {
        outwardRows: outwardHsnRows,
        inwardRows: inwardHsnRows
      },
      filingStatus: {
        isLocked: Boolean(currentPeriodLock),
        activeLock: currentPeriodLock ? clone(currentPeriodLock) : null,
        currentPeriodHistory: currentPeriodHistory.map((entry) => clone(entry)),
        allHistory: filingHistory.map((entry) => clone(entry))
      },
      diagnostics,
      portalExport
    };
  }

  function getGstFilingData(payload) {
    assertLicenseActive();

    const data = store.get();
    const reportInput =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? payload
        : { inputDate: payload };
    const period = normalizeReportPeriod(reportInput.period);
    const focusDate = resolveReportFocusDate(reportInput.inputDate);

    return buildGstFilingDataset(data, period, focusDate);
  }

  function getGstPortalExport(payload) {
    assertLicenseActive();

    const data = store.get();
    const reportInput =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? payload
        : { inputDate: payload };
    const period = normalizeReportPeriod(reportInput.period);
    const focusDate = resolveReportFocusDate(reportInput.inputDate);

    return buildGstFilingDataset(data, period, focusDate).portalExport;
  }

  function upsertGstNote(payload) {
    assertLicenseActive();

    const input = payload && typeof payload === 'object' ? payload : {};
    const id = toText(input.id);
    const noteType = toText(input.noteType).toLowerCase() === 'debit' ? 'debit' : 'credit';
    const direction = toText(input.direction).toLowerCase() === 'inward' ? 'inward' : 'outward';
    const referenceType = (() => {
      const value = toText(input.referenceType).toLowerCase();
      return value === 'invoice' || value === 'purchase' || value === 'manual' ? value : 'manual';
    })();
    const referenceId = toText(input.referenceId);
    const taxableValue = round2(toNumber(input.taxableValue, NaN));
    const gstRate = round2(Math.max(toNumber(input.gstRate, 0), 0));
    const rawGstAmount = round2(toNumber(input.gstAmount, NaN));
    const gstAmount = Number.isFinite(rawGstAmount)
      ? rawGstAmount
      : taxableValue > 0
        ? round2((taxableValue * gstRate) / 100)
        : 0;
    const total = round2(toNumber(input.total, taxableValue + gstAmount));
    const manualPartyName = toText(input.partyName);
    const manualPartyGstin = toText(input.partyGstin).toUpperCase();
    const manualReferenceNo = toText(input.referenceNo);
    const notes = sanitizeNarrationText(input.notes);
    const createdAt =
      normalizeIsoOrNull(input.createdAt) ||
      normalizeIsoOrNull(input.noteDate || input.inputDate) ||
      nowIso();

    assert(Number.isFinite(taxableValue) && taxableValue > 0, 'Taxable value must be greater than 0');
    assert(Number.isFinite(gstRate) && gstRate >= 0, 'GST rate cannot be negative');
    assert(Number.isFinite(gstAmount) && gstAmount >= 0, 'GST amount cannot be negative');
    if (referenceType === 'invoice') {
      assert(direction === 'outward', 'Invoice-linked GST notes must be outward');
      assert(referenceId, 'Select the related invoice for this GST note');
    }
    if (referenceType === 'purchase') {
      assert(direction === 'inward', 'Purchase-linked GST notes must be inward');
      assert(referenceId, 'Select the related purchase for this GST note');
    }

    let persisted;

    store.mutate((data) => {
      const existing = id ? data.gstNotes.find((entry) => entry.id === id) : null;
      if (id) {
        assert(existing, 'GST note not found');
        assertGstPeriodUnlocked(data, existing.createdAt, 'Updating a GST note');
      } else {
        assertGstPeriodUnlocked(data, createdAt, 'Creating a GST note');
      }

      let referenceNo = manualReferenceNo;
      let partyName = manualPartyName;
      let partyGstin = manualPartyGstin;

      if (referenceType === 'invoice') {
        const invoice = data.invoices.find((entry) => entry.id === referenceId);
        assert(invoice, 'Referenced invoice not found');
        referenceNo =
          toText(invoice.invoiceNo) || fallbackDocumentNumber('INV', invoice.createdAt, invoice.id);
        partyName =
          toText(invoice.customerSnapshot && invoice.customerSnapshot.name) || 'Walk-in Customer';
        partyGstin = toText(invoice.customerSnapshot && invoice.customerSnapshot.gstin).toUpperCase();
      } else if (referenceType === 'purchase') {
        const purchase = data.purchases.find((entry) => entry.id === referenceId);
        assert(purchase, 'Referenced purchase not found');
        referenceNo =
          toText(purchase.purchaseNo) || fallbackDocumentNumber('PUR', purchase.createdAt, purchase.id);
        partyName =
          toText(purchase.supplierSnapshot && purchase.supplierSnapshot.name) || 'Supplier';
        partyGstin = toText(purchase.supplierSnapshot && purchase.supplierSnapshot.gstin).toUpperCase();
      }

      assert(partyName, 'Party name is required for the GST note');

      const noteNo =
        toText(input.noteNo) ||
        (existing && toText(existing.noteNo)) ||
        gstNoteNumber(detectNextGstNoteCounter(data), noteType, createdAt);

      const nextNote = {
        id: existing ? existing.id : randomUUID(),
        noteNo,
        noteType,
        direction,
        referenceType,
        referenceId: referenceType === 'manual' ? '' : referenceId,
        referenceNo,
        partyName,
        partyGstin,
        taxableValue,
        gstRate,
        gstAmount,
        total,
        notes,
        createdAt: existing ? existing.createdAt : createdAt,
        updatedAt: nowIso()
      };

      if (existing) {
        Object.assign(existing, nextNote);
        persisted = clone(existing);
      } else {
        data.gstNotes.push(nextNote);
        persisted = clone(nextNote);
      }

      return data;
    });

    return persisted;
  }

  function deleteGstNote(noteId) {
    assertLicenseActive();

    const id = toText(noteId);
    assert(id, 'GST note id is required');

    store.mutate((data) => {
      const noteIndex = data.gstNotes.findIndex((entry) => entry.id === id);
      assert(noteIndex >= 0, 'GST note not found');
      assertGstPeriodUnlocked(data, data.gstNotes[noteIndex].createdAt, 'Deleting a GST note');
      data.gstNotes.splice(noteIndex, 1);
      return data;
    });

    return { deleted: true };
  }

  function recordGstFiling(payload) {
    assertLicenseActive();

    const input = payload && typeof payload === 'object' ? payload : {};
    const period = normalizeReportPeriod(input.period);
    const focusDate = resolveReportFocusDate(input.inputDate);
    const returnTypes = normalizeReturnTypes(input.returnTypes || input.returnType);
    const acknowledgementNo = toText(input.acknowledgementNo || input.portalReference);
    const notes = sanitizeNarrationText(input.notes);
    const shouldLock = input.lockPeriod !== false;

    assert(returnTypes.length > 0, 'Select at least one GST return type');

    let savedEntry;

    store.mutate((data) => {
      const dataset = buildGstFilingDataset(data, period, focusDate);
      const existingIndex = (Array.isArray(data.meta.gstFilingHistory) ? data.meta.gstFilingHistory : []).findIndex(
        (entry) => entry.period === period && entry.periodKey === dataset.periodKey
      );

      const nextEntry = {
        id:
          existingIndex >= 0
            ? data.meta.gstFilingHistory[existingIndex].id
            : randomUUID(),
        period,
        periodKey: dataset.periodKey,
        periodLabel: dataset.periodLabel,
        rangeStart: dataset.rangeStart,
        rangeEnd: dataset.rangeEnd,
        returnTypes,
        acknowledgementNo,
        portalReference: acknowledgementNo,
        notes,
        filedAt: nowIso(),
        locked: shouldLock,
        summary: clone(dataset.summary)
      };

      if (existingIndex >= 0) {
        data.meta.gstFilingHistory[existingIndex] = nextEntry;
      } else {
        data.meta.gstFilingHistory.push(nextEntry);
      }

      const activeLockIndex = (Array.isArray(data.meta.gstLockedPeriods) ? data.meta.gstLockedPeriods : []).findIndex(
        (entry) => entry.active !== false && entry.period === period && entry.periodKey === dataset.periodKey
      );

      if (shouldLock) {
        const lockEntry = {
          id:
            activeLockIndex >= 0
              ? data.meta.gstLockedPeriods[activeLockIndex].id
              : randomUUID(),
          period,
          periodKey: dataset.periodKey,
          periodLabel: dataset.periodLabel,
          rangeStart: dataset.rangeStart,
          rangeEnd: dataset.rangeEnd,
          lockedAt: nowIso(),
          unlockedAt: null,
          filingHistoryId: nextEntry.id,
          acknowledgementNo,
          notes,
          active: true
        };

        if (activeLockIndex >= 0) {
          data.meta.gstLockedPeriods[activeLockIndex] = lockEntry;
        } else {
          data.meta.gstLockedPeriods.push(lockEntry);
        }
      } else if (activeLockIndex >= 0) {
        data.meta.gstLockedPeriods[activeLockIndex].active = false;
        data.meta.gstLockedPeriods[activeLockIndex].unlockedAt = nowIso();
      }

      savedEntry = clone(nextEntry);
      return data;
    });

    return savedEntry;
  }

  function unlockGstPeriod(payload) {
    assertLicenseActive();

    const input = payload && typeof payload === 'object' ? payload : {};
    const lockId = toText(input.lockId);
    const period = normalizeReportPeriod(input.period);
    const focusDate = resolveReportFocusDate(input.inputDate);
    const { periodKey } = resolveReportRange(period, focusDate);

    let unlocked;

    store.mutate((data) => {
      const locks = Array.isArray(data.meta.gstLockedPeriods) ? data.meta.gstLockedPeriods : [];
      const lock = lockId
        ? locks.find((entry) => entry.id === lockId && entry.active !== false)
        : locks.find((entry) => entry.active !== false && entry.period === period && entry.periodKey === periodKey);
      assert(lock, 'Locked GST period not found');

      lock.active = false;
      lock.unlockedAt = nowIso();

      const history = Array.isArray(data.meta.gstFilingHistory) ? data.meta.gstFilingHistory : [];
      const historyEntry = history.find((entry) => entry.id === lock.filingHistoryId);
      if (historyEntry) {
        historyEntry.locked = false;
      }

      unlocked = clone(lock);
      return data;
    });

    return unlocked;
  }

  function getTrialBalance(payload) {
    assertLicenseActive();

    const data = store.get();
    const productById = new Map(data.products.map((product) => [product.id, product]));
    const purchaseCostTimeline = buildPurchaseCostTimeline(data.purchases);
    const reportInput =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? payload
        : { inputDate: payload };

    const period = normalizeReportPeriod(reportInput.period);
    const focusDate = resolveReportFocusDate(reportInput.inputDate);
    const { range, periodKey, periodLabel } = resolveReportRange(period, focusDate);
    const cutoff = range.end;

    const balances = new Map();
    const post = (account, debitValue, creditValue) => {
      const debit = round2(Math.max(toNumber(debitValue, 0), 0));
      const credit = round2(Math.max(toNumber(creditValue, 0), 0));
      if (debit <= 0 && credit <= 0) {
        return;
      }

      const current = round2(toNumber(balances.get(account), 0));
      balances.set(account, round2(current + debit - credit));
    };

    const isBeforeCutoff = (inputDate) => {
      const dt = new Date(inputDate);
      return !Number.isNaN(dt.getTime()) && dt < cutoff;
    };

    const invoices = data.invoices.filter((invoice) => isBeforeCutoff(invoice.createdAt));
    for (const invoice of invoices) {
      const taxableValue = round2(
        toNumber(invoice.taxableValue, toNumber(invoice.total, 0) - toNumber(invoice.gstAmount, 0))
      );
      const gstAmount = round2(toNumber(invoice.gstAmount, 0));
      const { primary: outputSgst, secondary: outputCgst } = splitTaxValue(gstAmount);
      const total = round2(toNumber(invoice.total, taxableValue + gstAmount));

      const paymentHistory = Array.isArray(invoice.paymentHistory) ? invoice.paymentHistory : [];
      const historyTotal = round2(
        paymentHistory.reduce((sum, payment) => sum + round2(toNumber(payment.amount, 0)), 0)
      );
      const paidAmount = round2(toNumber(invoice.paidAmount, Math.max(total - toNumber(invoice.balance, 0), 0)));
      const initialPaid = round2(Math.max(paidAmount - historyTotal, 0));
      const initialReceivable = round2(Math.max(total - initialPaid, 0));
      const initialPaymentAccount = paymentAccountForMethod(invoice.paidMethod);

      post(initialPaymentAccount, initialPaid, 0);
      post('Accounts Receivable', initialReceivable, 0);
      post('Sales', 0, taxableValue);
      post('Output SGST', 0, outputSgst);
      post('Output CGST', 0, outputCgst);

      const items = Array.isArray(invoice.items) ? invoice.items : [];
      let cogs = 0;
      const invoiceTs = new Date(invoice.createdAt).getTime();
      for (const item of items) {
        const qty = resolveInvoiceItemBaseQty(item, productById);
        const costPrice = resolveInvoiceItemCostPrice(item, {
          productById,
          purchaseCostTimeline,
          invoiceTs
        });
        cogs += qty * costPrice;
      }
      cogs = round2(cogs);

      post('Cost of Goods Sold', cogs, 0);
      post('Inventory', 0, cogs);

      for (const payment of paymentHistory) {
        if (!isBeforeCutoff(payment.createdAt || invoice.createdAt)) {
          continue;
        }

        const amount = round2(toNumber(payment.amount, 0));
        const paymentAccount = paymentAccountForMethod(payment.paymentMethod);
        post(paymentAccount, amount, 0);
        post('Accounts Receivable', 0, amount);
      }
    }

    const purchases = data.purchases.filter((purchase) => isBeforeCutoff(purchase.createdAt));
    for (const purchase of purchases) {
      const taxableValue = round2(
        toNumber(purchase.taxableValue, toNumber(purchase.total, 0) - toNumber(purchase.gstAmount, 0))
      );
      const gstAmount = round2(toNumber(purchase.gstAmount, 0));
      const { primary: inputSgst, secondary: inputCgst } = splitTaxValue(gstAmount);
      const paidAmount = round2(toNumber(purchase.paidAmount, 0));
      const dueAmount = round2(toNumber(purchase.dueAmount, Math.max(toNumber(purchase.total, 0) - paidAmount, 0)));
      const paidAccount = paymentAccountForMethod(purchase.paidMethod);

      post('Inventory', taxableValue, 0);
      post('Input SGST', inputSgst, 0);
      post('Input CGST', inputCgst, 0);
      post(paidAccount, 0, paidAmount);
      post('Accounts Payable', 0, dueAmount);
    }

    const supplierPayments = data.supplierPayments.filter((payment) => isBeforeCutoff(payment.createdAt));
    for (const payment of supplierPayments) {
      const amount = round2(toNumber(payment.amount, 0));
      const paymentAccount = paymentAccountForMethod(payment.paymentMethod);
      post('Accounts Payable', amount, 0);
      post(paymentAccount, 0, amount);
    }

    const expenses = (Array.isArray(data.expenses) ? data.expenses : []).filter((expense) =>
      isBeforeCutoff(expense.createdAt)
    );
    for (const expense of expenses) {
      const amount = round2(toNumber(expense.amount, 0));
      const expenseAccount = paymentAccountForMethod(expense.paymentMethod);
      post('Operating Expenses', amount, 0);
      post(expenseAccount, 0, amount);
    }

    const accountOrder = [
      'Cash in Hand',
      'Bank / Digital',
      'Accounts Receivable',
      'Inventory',
      'Input SGST',
      'Input CGST',
      'Cost of Goods Sold',
      'Operating Expenses',
      'Accounts Payable',
      'Output SGST',
      'Output CGST',
      'Sales'
    ];

    const extraAccounts = [...balances.keys()]
      .filter((account) => !accountOrder.includes(account))
      .sort((a, b) => a.localeCompare(b));
    const orderedAccounts = [...accountOrder, ...extraAccounts];

    const rows = orderedAccounts.map((account) => {
      const balance = round2(toNumber(balances.get(account), 0));
      return {
        account,
        debit: balance > 0 ? balance : 0,
        credit: balance < 0 ? Math.abs(balance) : 0
      };
    });

    const totals = rows.reduce(
      (sum, row) => ({
        debit: round2(sum.debit + row.debit),
        credit: round2(sum.credit + row.credit)
      }),
      { debit: 0, credit: 0 }
    );
    const difference = round2(Math.abs(totals.debit - totals.credit));

    return {
      period,
      inputDate: toDayKey(focusDate),
      periodKey,
      periodLabel,
      asOf: toDayKey(new Date(range.end.getTime() - 1)),
      rows,
      totals: {
        debit: totals.debit,
        credit: totals.credit,
        difference
      },
      isBalanced: difference <= 0.01
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
    const { range, periodKey, periodLabel } = resolveReportRange(period, focusDate);

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
    const note = sanitizeNarrationText(payload && payload.note);
    const paymentMethod = normalizePaymentMethod(
      payload && (payload.paymentMethod || payload.mode || payload.method)
    );

    assert(invoiceId, 'Invoice id is required');
    assert(Number.isFinite(amount) && amount > 0, 'Payment amount must be greater than 0');

    let updatedInvoice;

    store.mutate((data) => {
      const invoice = data.invoices.find((entry) => entry.id === invoiceId);
      assert(invoice, 'Invoice not found');

      const totalValue = round2(toNumber(invoice.total, 0));
      const currentPaid = round2(toNumber(invoice.paidAmount, 0));
      const fallbackBalance = round2(Math.max(totalValue - currentPaid, 0));
      const currentBalance = round2(Math.max(toNumber(invoice.balance, fallbackBalance), 0));
      assert(currentBalance > 0, 'Invoice is already fully paid');
      assert(amount <= currentBalance, 'Payment cannot exceed pending balance');

      const nextPaidAmount = round2(currentPaid + amount);
      const nextBalance = round2(Math.max(totalValue - nextPaidAmount, 0));

      invoice.paidAmount = nextPaidAmount;
      invoice.balance = nextBalance;
      invoice.paymentStatus = deriveInvoicePaymentStatus(invoice.total, nextPaidAmount, nextBalance);
      invoice.updatedAt = nowIso();

      const history = Array.isArray(invoice.paymentHistory) ? invoice.paymentHistory : [];
      history.push({
        id: randomUUID(),
        amount,
        note,
        paymentMethod,
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
    const customer =
      invoice.customerId ? data.customers.find((entry) => entry.id === invoice.customerId) || null : null;
    const subtotal = round2(
      toNumber(
        invoice.subtotal,
        (Array.isArray(invoice.items) ? invoice.items : []).reduce(
          (sum, item) =>
            sum + round2(toNumber(item.lineTotal, toNumber(item.qty, 0) * toNumber(item.unitPrice, 0))),
          0
        )
      )
    );

    return {
      invoice: {
        ...invoice,
        invoiceNo: toText(invoice.invoiceNo) || fallbackDocumentNumber('INV', invoice.createdAt, invoice.id),
        subtotal,
        customerSnapshot:
          invoice.customerSnapshot && toText(invoice.customerSnapshot.name)
            ? invoice.customerSnapshot
            : customer
              ? {
                  name: customer.name,
                  type: customer.type,
                  phone: customer.phone,
                  address: customer.address,
                  gstin: customer.gstin
                }
              : {
                  name: 'Walk-in Customer',
                  type: 'retail',
                  phone: '',
                  address: '',
                  gstin: ''
                }
      },
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
    getBackupSettings,
    upsertBackupSettings,
    runLocalFolderBackup,
    restoreLatestLocalBackup,
    runAutoBackupCheck,
    upsertProduct,
    lookupOpenFoodFactsProduct,
    deleteProduct,
    upsertCustomer,
    deleteCustomer,
    upsertSupplier,
    deleteSupplier,
    createInvoice,
    updateInvoice,
    recordInvoicePayment,
    createPurchase,
    updatePurchase,
    upsertGstNote,
    deleteGstNote,
    recordGstFiling,
    unlockGstPeriod,
    createSupplierPayment,
    createExpense,
    updateExpense,
    extractEnglishOcr,
    getCustomerLedger,
    getSupplierLedger,
    getGstFilingData,
    getGstPortalExport,
    getTrialBalance,
    getDailyProfitLoss,
    getInvoice,
    getInvoiceForPrint,
    getStockListForPrint
  };
}

module.exports = {
  createErpService
};
