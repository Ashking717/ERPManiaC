const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('erpApi', {
  getBootstrap: () => ipcRenderer.invoke('erp:get-bootstrap'),
  getLicenseStatus: () => ipcRenderer.invoke('erp:get-license-status'),
  activateLicenseKey: (payload) => ipcRenderer.invoke('erp:activate-license-key', payload),
  upsertUiSettings: (payload) => ipcRenderer.invoke('erp:upsert-ui-settings', payload),
  upsertBusiness: (payload) => ipcRenderer.invoke('erp:upsert-business', payload),
  getBackupSettings: () => ipcRenderer.invoke('erp:get-backup-settings'),
  upsertBackupSettings: (payload) => ipcRenderer.invoke('erp:upsert-backup-settings', payload),
  pickBackupFolder: (currentPath) => ipcRenderer.invoke('erp:pick-backup-folder', currentPath),
  runLocalBackup: () => ipcRenderer.invoke('erp:run-local-backup'),
  restoreLatestLocalBackup: () => ipcRenderer.invoke('erp:restore-latest-local-backup'),

  upsertProduct: (payload) => ipcRenderer.invoke('erp:upsert-product', payload),
  deleteProduct: (productId) => ipcRenderer.invoke('erp:delete-product', productId),

  upsertCustomer: (payload) => ipcRenderer.invoke('erp:upsert-customer', payload),
  deleteCustomer: (customerId) => ipcRenderer.invoke('erp:delete-customer', customerId),

  upsertSupplier: (payload) => ipcRenderer.invoke('erp:upsert-supplier', payload),
  deleteSupplier: (supplierId) => ipcRenderer.invoke('erp:delete-supplier', supplierId),

  createInvoice: (payload) => ipcRenderer.invoke('erp:create-invoice', payload),
  recordInvoicePayment: (payload) => ipcRenderer.invoke('erp:record-invoice-payment', payload),
  createPurchase: (payload) => ipcRenderer.invoke('erp:create-purchase', payload),
  createSupplierPayment: (payload) => ipcRenderer.invoke('erp:create-supplier-payment', payload),
  createExpense: (payload) => ipcRenderer.invoke('erp:create-expense', payload),
  extractEnglishOcr: (payload) => ipcRenderer.invoke('erp:extract-english-ocr', payload),
  getCustomerLedger: (customerId) => ipcRenderer.invoke('erp:get-customer-ledger', customerId),
  getSupplierLedger: (supplierId) => ipcRenderer.invoke('erp:get-supplier-ledger', supplierId),
  getTrialBalance: (payload) => ipcRenderer.invoke('erp:get-trial-balance', payload),
  getDailyProfitLoss: (inputDate) => ipcRenderer.invoke('erp:get-daily-pnl', inputDate),
  getPrinters: () => ipcRenderer.invoke('erp:get-printers'),
  autoPrintInvoiceThermal: (payload) => ipcRenderer.invoke('erp:auto-print-invoice-thermal', payload),
  getInvoice: (invoiceId) => ipcRenderer.invoke('erp:get-invoice', invoiceId),
  previewInvoice: (invoiceId, options) => ipcRenderer.invoke('erp:preview-invoice', invoiceId, options),
  printInvoice: (invoiceId) => ipcRenderer.invoke('erp:print-invoice', invoiceId),
  exportStockListPdf: () => ipcRenderer.invoke('erp:export-stock-list-pdf')
});
