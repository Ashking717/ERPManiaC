const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('erpApi', {
  getBootstrap: () => ipcRenderer.invoke('erp:get-bootstrap'),
  getLicenseStatus: () => ipcRenderer.invoke('erp:get-license-status'),
  activateLicenseKey: (payload) => ipcRenderer.invoke('erp:activate-license-key', payload),
  upsertBusiness: (payload) => ipcRenderer.invoke('erp:upsert-business', payload),

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
  getSupplierLedger: (supplierId) => ipcRenderer.invoke('erp:get-supplier-ledger', supplierId),
  getDailyProfitLoss: (inputDate) => ipcRenderer.invoke('erp:get-daily-pnl', inputDate),
  getInvoice: (invoiceId) => ipcRenderer.invoke('erp:get-invoice', invoiceId),
  previewInvoice: (invoiceId) => ipcRenderer.invoke('erp:preview-invoice', invoiceId),
  printInvoice: (invoiceId) => ipcRenderer.invoke('erp:print-invoice', invoiceId)
});
