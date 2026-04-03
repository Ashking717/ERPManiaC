export const DEFAULT_PRODUCT_CATEGORIES = [
  'General',
  'Grocery',
  'Beverages',
  'Snacks',
  'Dairy',
  'Bakery',
  'Fruits & Vegetables',
  'Rice & Grains',
  'Spices',
  'Frozen Foods',
  'Household',
  'Personal Care',
  'Cleaning',
  'Stationery'
];

function normalizeCategory(value) {
  return String(value || '').trim();
}

export function buildProductCategoryOptions(products = []) {
  const options = [];
  const seen = new Set();

  const pushOption = (value) => {
    const normalized = normalizeCategory(value);
    if (!normalized) {
      return;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    options.push(normalized);
  };

  DEFAULT_PRODUCT_CATEGORIES.forEach(pushOption);
  products.forEach((product) => pushOption(product?.category));

  return options;
}

export function resolveCategorySelectValue(value, categoryOptions = []) {
  const normalizedValue = normalizeCategory(value).toLowerCase();
  const matchedCategory = categoryOptions.find(
    (option) => normalizeCategory(option).toLowerCase() === normalizedValue
  );

  return matchedCategory || '__custom__';
}
