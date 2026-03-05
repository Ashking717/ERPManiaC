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
  draftItems: [],
  purchaseDraftItems: [],
  supplierLedger: null,
  pnlReport: null,
  licenseStatus: null,
  invoicePaidTouched: false,
  currentView: 'dashboard',
  invoiceSearch: '',
  purchaseSearch: '',
  billingProductSearch: '',
  expenseSearch: '',
  selectedLedgerSupplierId: ''
};

const dom = {};
let toastTimer = null;
const BARCODE_SCAN_IDLE_MS = 120;
let billingBarcodeTimer = null;
let purchaseBarcodeTimer = null;

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

function processBillingBarcodeScan() {
  const barcode = dom.barcodeInput.value.trim();
  if (!barcode) {
    return;
  }

  const product = findProductByBarcodeOrSku(barcode);
  if (!product) {
    showToast(`No product found for barcode ${barcode}`, 'error');
    dom.barcodeInput.value = '';
    dom.barcodeInput.focus();
    return;
  }

  const qty = toNumber(dom.draftQty.value, 1);
  const added = addDraftItem(product.id, qty);
  if (added) {
    showToast(`Added ${product.name}`);
  }

  dom.barcodeInput.value = '';
  dom.barcodeInput.focus();
}

function processPurchaseBarcodeScan() {
  const barcode = dom.purchaseBarcodeInput.value.trim();
  if (!barcode) {
    return;
  }

  const product = findProductByBarcodeOrSku(barcode);
  if (!product) {
    showToast(`No product found for barcode ${barcode}`, 'error');
    dom.purchaseBarcodeInput.value = '';
    dom.purchaseBarcodeInput.focus();
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

function setStatus(text) {
  dom.statusPill.textContent = text;
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
  dom.businessSaveBtn = document.getElementById('business-save-btn');

  dom.productForm = document.getElementById('product-form');
  dom.productBody = document.getElementById('products-body');
  dom.productSaveBtn = document.getElementById('product-save-btn');
  dom.productResetBtn = document.getElementById('product-reset-btn');

  dom.customerForm = document.getElementById('customer-form');
  dom.customerBody = document.getElementById('customers-body');
  dom.customerSaveBtn = document.getElementById('customer-save-btn');
  dom.customerResetBtn = document.getElementById('customer-reset-btn');

  dom.supplierForm = document.getElementById('supplier-form');
  dom.supplierBody = document.getElementById('suppliers-body');
  dom.supplierSaveBtn = document.getElementById('supplier-save-btn');
  dom.supplierResetBtn = document.getElementById('supplier-reset-btn');
  dom.ledgerSupplierSelect = document.getElementById('ledger-supplier-select');
  dom.supplierOutstanding = document.getElementById('supplier-outstanding');
  dom.supplierPaymentAmount = document.getElementById('supplier-payment-amount');
  dom.supplierPaymentNotes = document.getElementById('supplier-payment-notes');
  dom.supplierPaymentBtn = document.getElementById('supplier-payment-btn');
  dom.supplierLedgerBody = document.getElementById('supplier-ledger-body');

  dom.purchaseForm = document.getElementById('purchase-form');
  dom.purchaseSupplier = document.getElementById('purchase-supplier');
  dom.purchaseGstEnabled = document.getElementById('purchase-gst-enabled');
  dom.purchaseGstRate = document.getElementById('purchase-gst-rate');
  dom.purchaseDiscount = document.getElementById('purchase-discount');
  dom.purchasePaid = document.getElementById('purchase-paid');
  dom.purchaseNotes = document.getElementById('purchase-notes');
  dom.purchaseBarcodeInput = document.getElementById('purchase-barcode-input');

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
  dom.purchaseSearch = document.getElementById('purchase-search');
  dom.purchasesBody = document.getElementById('purchases-body');

  dom.purchaseSupplierForm = document.getElementById('purchase-supplier-form');
  dom.purchaseSupplierName = document.getElementById('purchase-supplier-name');
  dom.purchaseSupplierPhone = document.getElementById('purchase-supplier-phone');
  dom.purchaseSupplierGstin = document.getElementById('purchase-supplier-gstin');
  dom.purchaseSupplierAddress = document.getElementById('purchase-supplier-address');
  dom.purchaseSupplierSaveBtn = document.getElementById('purchase-supplier-save-btn');

  dom.purchaseProductForm = document.getElementById('purchase-product-form');
  dom.purchaseProductName = document.getElementById('purchase-product-name');
  dom.purchaseProductBarcode = document.getElementById('purchase-product-barcode');
  dom.purchaseProductCategory = document.getElementById('purchase-product-category');
  dom.purchaseProductUnit = document.getElementById('purchase-product-unit');
  dom.purchaseProductCostPrice = document.getElementById('purchase-product-cost-price');
  dom.purchaseProductRetailPrice = document.getElementById('purchase-product-retail-price');
  dom.purchaseProductWholesalePrice = document.getElementById('purchase-product-wholesale-price');
  dom.purchaseProductWholesaleMinQty = document.getElementById('purchase-product-wholesale-min-qty');
  dom.purchaseProductReorderLevel = document.getElementById('purchase-product-reorder-level');
  dom.purchaseProductSaveBtn = document.getElementById('purchase-product-save-btn');

  dom.expenseForm = document.getElementById('expense-form');
  dom.expenseCategory = document.getElementById('expense-category');
  dom.expenseAmount = document.getElementById('expense-amount');
  dom.expenseDate = document.getElementById('expense-date');
  dom.expensePaidTo = document.getElementById('expense-paid-to');
  dom.expenseNotes = document.getElementById('expense-notes');
  dom.expenseSubmitBtn = document.getElementById('expense-submit-btn');
  dom.expenseSearch = document.getElementById('expense-search');
  dom.expensesBody = document.getElementById('expenses-body');

  dom.invoiceForm = document.getElementById('invoice-form');
  dom.invoiceChannel = document.getElementById('invoice-channel');
  dom.invoiceCustomer = document.getElementById('invoice-customer');
  dom.invoiceGstEnabled = document.getElementById('invoice-gst-enabled');
  dom.invoiceGstRate = document.getElementById('invoice-gst-rate');
  dom.invoiceDiscount = document.getElementById('invoice-discount');
  dom.invoicePaid = document.getElementById('invoice-paid');
  dom.invoiceNotes = document.getElementById('invoice-notes');
  dom.billingCustomerForm = document.getElementById('billing-customer-form');
  dom.billingCustomerName = document.getElementById('billing-customer-name');
  dom.billingCustomerType = document.getElementById('billing-customer-type');
  dom.billingCustomerPhone = document.getElementById('billing-customer-phone');
  dom.billingCustomerGstin = document.getElementById('billing-customer-gstin');
  dom.billingCustomerAddress = document.getElementById('billing-customer-address');
  dom.billingCustomerSaveBtn = document.getElementById('billing-customer-save-btn');

  dom.barcodeInput = document.getElementById('barcode-input');
  dom.billingProductSearch = document.getElementById('billing-product-search');
  dom.draftProductId = document.getElementById('draft-product-id');
  dom.draftQty = document.getElementById('draft-qty');
  dom.addItemBtn = document.getElementById('add-item-btn');
  dom.draftItemsBody = document.getElementById('draft-items-body');

  dom.subtotalValue = document.getElementById('subtotal-value');
  dom.discountValue = document.getElementById('discount-value');
  dom.gstValue = document.getElementById('gst-value');
  dom.totalValue = document.getElementById('total-value');
  dom.balanceValue = document.getElementById('balance-value');
  dom.invoiceSubmitBtn = document.getElementById('invoice-submit-btn');

  dom.invoiceSearch = document.getElementById('invoice-search');
  dom.invoicesBody = document.getElementById('invoices-body');

  dom.reportDate = document.getElementById('report-date');
  dom.reportRefreshBtn = document.getElementById('report-refresh-btn');
  dom.reportCards = document.getElementById('report-cards');
  dom.pnlHistoryBody = document.getElementById('pnl-history-body');
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
    Digit2: 'store',
    Digit3: 'products',
    Digit4: 'customers',
    Digit5: 'suppliers',
    Digit6: 'purchases',
    Digit0: 'expenses',
    Digit7: 'billing',
    Digit8: 'invoices',
    Digit9: 'reports'
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

function bindBusiness() {
  dom.businessName.addEventListener('input', () => {
    dom.businessInvoicePrefix.value = invoicePrefixPreview(dom.businessName.value);
  });

  dom.businessForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const payload = {
      name: dom.businessName.value,
      phone: dom.businessPhone.value,
      gstin: dom.businessGstin.value,
      address: dom.businessAddress.value
    };

    try {
      setStatus('Saving store details...');
      await invoke('upsertBusiness', payload);
      await reloadData();
      showToast('Store details updated');
      setStatus('Live');
    } catch (error) {
      setStatus('Live');
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
        retailPrice: dom.productForm.querySelector('#product-retail-price').value,
        wholesalePrice: dom.productForm.querySelector('#product-wholesale-price').value,
        wholesaleMinQty: dom.productForm.querySelector('#product-wholesale-min-qty').value,
        stock: dom.productForm.querySelector('#product-stock').value,
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
    const product = state.products.find((entry) => entry.id === id);

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
        await reloadData();
        showToast('Customer deleted');
        setStatus('Live');
      } catch (error) {
        setStatus('Live');
        showToast(error.message, 'error');
      }
    }
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
        notes
      });

      dom.supplierPaymentAmount.value = '';
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
      notes: dom.purchaseNotes.value,
      items: state.purchaseDraftItems.map((item) => ({
        productId: item.productId,
        qty: item.qty,
        unitCost: item.unitCost
      }))
    };

    try {
      setStatus('Creating purchase...');
      const purchase = await invoke('createPurchase', payload);
      clearPurchaseDraft();
      await reloadData();
      showToast(`Purchase ${purchase.purchaseNo} created`);
      setStatus('Live');
    } catch (error) {
      setStatus('Live');
      showToast(error.message, 'error');
    }
  });

  dom.purchaseSearch.addEventListener('input', () => {
    state.purchaseSearch = dom.purchaseSearch.value.trim().toLowerCase();
    renderPurchases();
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

    const payload = {
      name: dom.purchaseProductName.value,
      barcode: dom.purchaseProductBarcode.value,
      category: dom.purchaseProductCategory.value,
      unit: dom.purchaseProductUnit.value,
      costPrice: dom.purchaseProductCostPrice.value,
      retailPrice: dom.purchaseProductRetailPrice.value,
      wholesalePrice: dom.purchaseProductWholesalePrice.value,
      wholesaleMinQty: dom.purchaseProductWholesaleMinQty.value,
      stock: 0,
      reorderLevel: dom.purchaseProductReorderLevel.value
    };

    try {
      setStatus('Saving new product...');
      const product = await invoke('upsertProduct', payload);
      await reloadData();

      dom.purchaseDraftProductId.value = product.id;
      dom.purchaseDraftCost.value = round2(toNumber(product.costPrice, product.wholesalePrice));
      resetPurchaseProductForm();

      showToast(`Product ${product.name} added with stock 0`);
      setStatus('Ready');
      dom.purchaseDraftQty.focus();
    } catch (error) {
      setStatus('Ready');
      showToast(error.message, 'error');
    }
  });
}

function bindExpenses() {
  dom.expenseForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const payload = {
      category: dom.expenseCategory.value,
      amount: dom.expenseAmount.value,
      expenseDate: dom.expenseDate.value,
      paidTo: dom.expensePaidTo.value,
      notes: dom.expenseNotes.value
    };

    try {
      setStatus('Recording expense...');
      const expense = await invoke('createExpense', payload);

      dom.expenseAmount.value = '';
      dom.expensePaidTo.value = '';
      dom.expenseNotes.value = '';
      dom.expenseDate.value = todayKey();

      await reloadData();
      showToast(`Expense ${expense.expenseNo} recorded`);
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
}

function bindBilling() {
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
    const nextQty = round2(toNumber(input.value, NaN));

    if (Number.isNaN(index) || !state.draftItems[index]) {
      return;
    }

    if (!Number.isFinite(nextQty) || nextQty <= 0) {
      showToast('Quantity must be greater than 0', 'error');
      renderDraftItems();
      return;
    }

    const line = state.draftItems[index];
    const product = state.products.find((entry) => entry.id === line.productId);
    if (!product) {
      showToast('Invalid product in draft', 'error');
      return;
    }

    if (nextQty > product.stock) {
      showToast(`Only ${product.stock} stock available for ${product.name}`, 'error');
      renderDraftItems();
      return;
    }

    line.qty = nextQty;
    renderDraftItems();
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
      notes: dom.invoiceNotes.value,
      items: state.draftItems.map((item) => ({
        productId: item.productId,
        qty: item.qty
      }))
    };

    try {
      setStatus('Creating invoice...');
      const invoice = await invoke('createInvoice', payload);

      clearInvoiceDraft();
      await reloadData();
      showToast(`Invoice ${invoice.invoiceNo} created successfully`);
      dom.barcodeInput.focus();
      setStatus('Live');
    } catch (error) {
      setStatus('Live');
      showToast(error.message, 'error');
    }
  });
}

function bindInvoices() {
  dom.invoiceSearch.addEventListener('input', () => {
    state.invoiceSearch = dom.invoiceSearch.value.trim().toLowerCase();
    renderInvoices();
  });

  dom.invoicesBody.addEventListener('click', async (event) => {
    const paymentBtn = event.target.closest('button[data-pay-id]');
    if (paymentBtn) {
      const invoiceId = paymentBtn.dataset.payId;
      const invoice = state.invoices.find((entry) => entry.id === invoiceId);
      if (!invoice) {
        showToast('Invoice not found', 'error');
        return;
      }

      const maxAmount = round2(toNumber(invoice.balance, 0));
      if (maxAmount <= 0) {
        showToast('Invoice is alLive paid', 'info');
        return;
      }

      const promptValue = window.prompt(
        `Enter payment amount for ${invoice.invoiceNo} (Pending: ${formatMoney(maxAmount)})`,
        String(maxAmount)
      );

      if (promptValue === null) {
        return;
      }

      const amount = round2(toNumber(promptValue, NaN));
      if (!Number.isFinite(amount) || amount <= 0) {
        showToast('Enter a valid payment amount', 'error');
        return;
      }

      if (amount > maxAmount) {
        showToast('Payment cannot exceed pending balance', 'error');
        return;
      }

      try {
        setStatus('Recording invoice payment...');
        const updated = await invoke('recordInvoicePayment', {
          invoiceId,
          amount
        });
        await reloadData();
        showToast(`${updated.invoiceNo} payment updated`);
        setStatus('Live');
      } catch (error) {
        setStatus('Live');
        showToast(error.message, 'error');
      }
      return;
    }

    const previewBtn = event.target.closest('button[data-preview-id]');
    if (previewBtn) {
      try {
        setStatus('Opening invoice preview...');
        await invoke('previewInvoice', previewBtn.dataset.previewId);
        showToast('Invoice preview opened');
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
    await loadDailyPnl(dom.reportDate.value);
  });

  dom.reportDate.addEventListener('change', async () => {
    await loadDailyPnl(dom.reportDate.value);
  });
}

function switchView(view) {
  state.currentView = view;

  document.querySelectorAll('.view').forEach((section) => {
    section.classList.toggle('active', section.id === `view-${view}`);
  });

  document.querySelectorAll('.nav-btn').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === view);
  });

  const titles = {
    dashboard: 'Dashboard',
    store: 'Store Details',
    products: 'Products',
    customers: 'Customers',
    suppliers: 'Suppliers',
    purchases: 'Purchases',
    expenses: 'Expenses',
    billing: 'Billing',
    invoices: 'Invoices',
    reports: 'Reports'
  };

  dom.viewTitle.textContent = titles[view] || 'ERPManiaC';

  if (view === 'billing') {
    dom.barcodeInput.focus();
  } else if (view === 'purchases') {
    dom.purchaseBarcodeInput.focus();
  } else if (view === 'expenses') {
    dom.expenseAmount.focus();
  }
}

function resetProductForm() {
  dom.productForm.reset();
  dom.productForm.querySelector('#product-id').value = '';
  dom.productForm.querySelector('#product-sku').value = '';
  setSelectValueWithFallback(dom.productForm.querySelector('#product-category'), 'General');
  setSelectValueWithFallback(dom.productForm.querySelector('#product-unit'), 'Unit');
  dom.productSaveBtn.textContent = 'Save Product';
}

function resetPurchaseProductForm() {
  dom.purchaseProductForm.reset();
  setSelectValueWithFallback(dom.purchaseProductCategory, 'General');
  setSelectValueWithFallback(dom.purchaseProductUnit, 'Unit');
  dom.purchaseProductWholesaleMinQty.value = '';
  dom.purchaseProductReorderLevel.value = '';
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

function fillProductForm(product) {
  dom.productForm.querySelector('#product-id').value = product.id;
  dom.productForm.querySelector('#product-sku').value = product.sku;
  dom.productForm.querySelector('#product-barcode').value = product.barcode || '';
  dom.productForm.querySelector('#product-name').value = product.name;
  setSelectValueWithFallback(dom.productForm.querySelector('#product-category'), product.category);
  setSelectValueWithFallback(dom.productForm.querySelector('#product-unit'), product.unit);
  dom.productForm.querySelector('#product-cost-price').value = product.costPrice;
  dom.productForm.querySelector('#product-retail-price').value = product.retailPrice;
  dom.productForm.querySelector('#product-wholesale-price').value = product.wholesalePrice;
  dom.productForm.querySelector('#product-wholesale-min-qty').value = product.wholesaleMinQty;
  dom.productForm.querySelector('#product-stock').value = product.stock;
  dom.productForm.querySelector('#product-reorder-level').value = product.reorderLevel;
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

function renderBusiness() {
  const business = state.business || {
    name: '',
    phone: '',
    address: '',
    gstin: ''
  };

  dom.businessName.value = business.name || '';
  dom.businessPhone.value = business.phone || '';
  dom.businessGstin.value = business.gstin || '';
  dom.businessAddress.value = business.address || '';
  dom.businessInvoicePrefix.value = invoicePrefixPreview(business.name || '');
  dom.brandShopName.textContent = business.name || 'Grocery Offline ERP';
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
      (product) => `
        <tr>
          <td>${product.name}</td>
          <td>${product.sku}</td>
          <td>${product.barcode || '-'}</td>
          <td>${product.stock}</td>
          <td>${formatMoney(product.costPrice)}</td>
          <td>${formatMoney(product.retailPrice)}</td>
          <td>${formatMoney(product.wholesalePrice)} / min ${product.wholesaleMinQty}</td>
          <td>
            <button class="btn small ghost" data-action="edit" data-id="${product.id}">Edit</button>
            <button class="btn small warn" data-action="delete" data-id="${product.id}">Delete</button>
          </td>
        </tr>
      `
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

  const existing = state.purchaseDraftItems.find((item) => item.productId === productId);
  if (existing) {
    const totalQty = round2(existing.qty + cleanQty);
    existing.unitCost = round2((existing.qty * existing.unitCost + cleanQty * cleanCost) / totalQty);
    existing.qty = totalQty;
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

function clearPurchaseDraft() {
  state.purchaseDraftItems = [];
  dom.purchaseForm.reset();
  dom.purchaseGstEnabled.checked = false;
  dom.purchaseGstRate.value = '0';
  dom.purchaseGstRate.disabled = true;
  dom.purchaseDiscount.value = '0';
  dom.purchasePaid.value = '0';
  dom.purchaseNotes.value = '';
  dom.purchaseBarcodeInput.value = '';
  dom.purchaseDraftQty.value = '1';

  renderSupplierOptions();
  renderPurchaseProductOptions();
  renderPurchaseDraftItems();
}

function renderPurchases() {
  const search = state.purchaseSearch;

  let purchases = [...state.purchases];
  if (search) {
    purchases = purchases.filter((purchase) => {
      const text = `${purchase.purchaseNo} ${purchase.supplierSnapshot.name}`.toLowerCase();
      return text.includes(search);
    });
  }

  if (!purchases.length) {
    dom.purchasesBody.innerHTML = '<tr><td colspan="7" class="empty">No purchases found</td></tr>';
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
          <td>${formatMoney(purchase.paidAmount)}</td>
          <td>${formatMoney(purchase.balance)}</td>
          <td>${purchase.gstEnabled ? `${purchase.gstRate}%` : 'No GST'}</td>
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
      const text = `${expense.expenseNo} ${expense.category} ${expense.paidTo || ''} ${expense.notes || ''}`.toLowerCase();
      return text.includes(search);
    });
  }

  if (!expenses.length) {
    dom.expensesBody.innerHTML = '<tr><td colspan="6" class="empty">No expenses recorded</td></tr>';
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
          <td>${formatMoney(expense.amount)}</td>
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
    return;
  }

  dom.draftProductId.innerHTML = productsWithStock
    .map(
      (product) => `
        <option value="${product.id}">
          ${product.name} (${product.sku}) - stock ${product.stock}
        </option>
      `
    )
    .join('');

  if (productsWithStock.some((product) => product.id === selectedProductId)) {
    dom.draftProductId.value = selectedProductId;
  } else {
    dom.draftProductId.value = productsWithStock[0].id;
  }
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
}

function getUnitPrice(product, channel, qty) {
  if (channel === 'wholesale') {
    if (qty >= product.wholesaleMinQty) {
      return { unitPrice: product.wholesalePrice, mode: 'wholesale' };
    }

    return { unitPrice: product.retailPrice, mode: 'retail-fallback' };
  }

  return { unitPrice: product.retailPrice, mode: 'retail' };
}

function addDraftItem(productId, qty) {
  const product = state.products.find((entry) => entry.id === productId);
  if (!product) {
    showToast('Invalid product selected', 'error');
    return false;
  }

  const cleanQty = round2(toNumber(qty, NaN));
  if (!Number.isFinite(cleanQty) || cleanQty <= 0) {
    showToast('Quantity must be greater than 0', 'error');
    return false;
  }

  const existing = state.draftItems.find((item) => item.productId === productId);
  const totalQty = existing ? round2(existing.qty + cleanQty) : cleanQty;

  if (totalQty > product.stock) {
    showToast(`Only ${product.stock} stock available for ${product.name}`, 'error');
    return false;
  }

  if (existing) {
    existing.qty = totalQty;
  } else {
    state.draftItems.push({ productId, qty: cleanQty });
  }

  renderDraftItems();
  return true;
}

function addSelectedProductToDraft() {
  const productId = dom.draftProductId.value;
  const qty = dom.draftQty.value;

  if (!productId) {
    showToast('Select a product first', 'error');
    return;
  }

  const added = addDraftItem(productId, qty);
  if (added) {
    dom.draftQty.value = '1';
    dom.barcodeInput.focus();
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

      const pricing = getUnitPrice(product, channel, item.qty);
      const lineTotal = round2(pricing.unitPrice * item.qty);

      return {
        product,
        qty: item.qty,
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
}

function renderDraftItems() {
  const lines = resolveDraftLines();

  if (!lines.length) {
    dom.draftItemsBody.innerHTML = '<tr><td colspan="5" class="empty">No items added yet</td></tr>';
    renderDraftTotals();
    return;
  }

  dom.draftItemsBody.innerHTML = lines
    .map(
      (line, index) => `
        <tr>
          <td>
            <strong>${line.product.name}</strong>
            <div class="muted">${line.product.sku} ${
              line.mode === 'retail-fallback' ? '(Retail rate: min wholesale qty not met)' : ''
            }</div>
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
}

function clearInvoiceDraft() {
  state.draftItems = [];
  state.invoicePaidTouched = false;

  dom.invoiceForm.reset();
  dom.invoiceChannel.value = 'retail';
  dom.invoiceGstEnabled.checked = false;
  dom.invoiceGstRate.value = '0';
  dom.invoiceGstRate.disabled = true;
  dom.invoiceDiscount.value = '0';
  dom.invoicePaid.value = '';
  dom.invoiceNotes.value = '';
  state.billingProductSearch = '';
  dom.billingProductSearch.value = '';
  dom.draftQty.value = '1';
  dom.barcodeInput.value = '';

  renderBillingCustomerOptions();
  resetBillingCustomerForm();
  renderDraftItems();
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
      const paymentLabel =
        paymentStatus === 'paid'
          ? 'Paid'
          : paymentStatus === 'partial'
            ? 'Partial'
            : 'Unpaid';

      const receiveDisabled = round2(toNumber(invoice.balance, 0)) <= 0 ? 'disabled' : '';

      return `
        <tr>
          <td>${invoice.invoiceNo}</td>
          <td>${formatDate(invoice.createdAt)}</td>
          <td><span class="tag ${invoice.channel}">${invoice.channel}</span></td>
          <td>${invoice.customerSnapshot.name}</td>
          <td>${formatMoney(invoice.total)}</td>
          <td>${formatMoney(invoice.balance)}</td>
          <td><span class="tag payment-${paymentStatus}">${paymentLabel}</span></td>
          <td>${invoice.gstEnabled ? `${invoice.gstRate}%` : 'No GST'}</td>
          <td>
            <button class="btn small subtle" data-pay-id="${invoice.id}" ${receiveDisabled}>Receive</button>
            <button class="btn small subtle" data-preview-id="${invoice.id}">View</button>
            <button class="btn small ghost" data-print-id="${invoice.id}">Print</button>
          </td>
        </tr>
      `
    })
    .join('');
}

async function loadDailyPnl(inputDate, silent = false) {
  try {
    const dateKey = inputDate || todayKey();
    const report = await invoke('getDailyProfitLoss', dateKey);
    state.pnlReport = report;
    if (dom.reportDate.value !== report.date) {
      dom.reportDate.value = report.date;
    }
    renderReports();
  } catch (error) {
    if (!silent) {
      showToast(error.message, 'error');
    }
  }
}

function renderReports() {
  const report = state.pnlReport || {
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
    recentDays: []
  };

  const metrics = report.metrics || {};

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

  if (!report.recentDays || !report.recentDays.length) {
    dom.pnlHistoryBody.innerHTML = '<tr><td colspan="9" class="empty">No report data</td></tr>';
    return;
  }

  dom.pnlHistoryBody.innerHTML = report.recentDays
    .map(
      (row) => `
        <tr>
          <td>${row.date}</td>
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

function renderAll() {
  renderDashboard();
  renderBusiness();
  renderProducts();
  renderCustomers();
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
  state.licenseStatus = bootstrap.licenseStatus || null;

  if (
    state.selectedLedgerSupplierId &&
    !state.suppliers.some((supplier) => supplier.id === state.selectedLedgerSupplierId)
  ) {
    state.selectedLedgerSupplierId = '';
  }

  renderAll();
  await loadSupplierLedger(true);
  await loadDailyPnl(dom.reportDate.value || todayKey(), true);
}

async function initializeApp() {
  cacheDom();
  bindLicense();
  bindNavigation();
  bindSidebarShortcuts();
  bindBusiness();
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
  dom.reportDate.value = todayKey();
  dom.expenseDate.value = todayKey();
  state.billingProductSearch = '';
  dom.billingProductSearch.value = '';
  resetPurchaseSupplierForm();
  resetPurchaseProductForm();
  resetBillingCustomerForm();

  try {
    setStatus('Loading data...');
    await reloadData();
    if (state.licenseStatus?.isActive) {
      setStatus('Live');
      dom.barcodeInput.focus();
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
