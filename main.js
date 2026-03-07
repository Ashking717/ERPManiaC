const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { createErpService } = require('./src/main/erpService');
const { renderInvoiceHtml } = require('./src/main/invoiceTemplate');
const { renderStockListHtml } = require('./src/main/stockListTemplate');

let mainWindow;
let erpService;
let autoBackupTimer = null;
const previewWindows = new Set();
const APP_ICON_PATH = path.join(__dirname, 'assets', 'logo', 'erpmaniac-logo-256.png');

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1160,
    minHeight: 760,
    show: false,
    backgroundColor: '#eef3ea',
    icon: APP_ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src/renderer/index.html'));
  mainWindow.once('ready-to-show', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    mainWindow.maximize();
    mainWindow.show();
  });
}

function withResponse(handler) {
  return async (_event, ...args) => {
    try {
      const data = await handler(...args);
      return { ok: true, data };
    } catch (error) {
      return { ok: false, error: error.message || 'Unexpected error' };
    }
  };
}

async function printInvoice(invoiceId) {
  const html = await getInvoiceHtml(invoiceId, { mode: 'a4' });

  const printWindow = new BrowserWindow({
    show: false,
    width: 900,
    height: 700,
    webPreferences: {
      sandbox: true
    }
  });

  await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

  const result = await new Promise((resolve) => {
    printWindow.webContents.print(
      {
        silent: false,
        printBackground: true,
        margins: {
          marginType: 'printableArea'
        }
      },
      (success, failureReason) => {
        if (!success) {
          resolve({ printed: false, reason: failureReason || 'Print cancelled' });
          return;
        }

        resolve({ printed: true });
      }
    );
  });

  if (!printWindow.isDestroyed()) {
    printWindow.close();
  }

  return result;
}

function normalizePrinterName(value) {
  return String(value || '').trim();
}

async function runSilentPrint(webContents, options) {
  return new Promise((resolve) => {
    webContents.print(options, (success, failureReason) => {
      if (!success) {
        resolve({
          printed: false,
          reason: failureReason || 'Thermal print failed'
        });
        return;
      }

      resolve({
        printed: true
      });
    });
  });
}

async function getAvailablePrinters() {
  const targetWindow =
    mainWindow && !mainWindow.isDestroyed() ? mainWindow : BrowserWindow.getAllWindows()[0];

  if (!targetWindow || targetWindow.isDestroyed()) {
    return [];
  }

  const printers = await targetWindow.webContents.getPrintersAsync();
  return printers.map((printer) => ({
    name: String(printer.name || ''),
    displayName: String(printer.displayName || printer.name || ''),
    description: String(printer.description || ''),
    status: Number(printer.status || 0),
    isDefault: Boolean(printer.isDefault)
  }));
}

async function printInvoiceThermal(payload) {
  const invoiceId = String(payload && payload.invoiceId ? payload.invoiceId : '').trim();
  if (!invoiceId) {
    throw new Error('Invoice id is required');
  }

  const printerName = normalizePrinterName(payload && payload.printerName);
  const html = await getInvoiceHtml(invoiceId, { mode: 'thermal' });

  const printWindow = new BrowserWindow({
    show: false,
    width: 420,
    height: 820,
    webPreferences: {
      sandbox: true
    }
  });

  let result;
  try {
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

    const baseOptions = {
      silent: true,
      printBackground: true,
      margins: {
        marginType: 'none'
      },
      ...(printerName ? { deviceName: printerName } : {})
    };

    result = await runSilentPrint(printWindow.webContents, {
      ...baseOptions,
      pageSize: {
        width: 80000,
        height: 297000
      }
    });

    if (!result.printed) {
      result = await runSilentPrint(printWindow.webContents, baseOptions);
    }

    if (result.printed) {
      result.printerName = printerName || 'default';
    }
  } finally {
    if (!printWindow.isDestroyed()) {
      printWindow.close();
    }
  }

  if (!result.printed) {
    throw new Error(result.reason || 'Thermal print failed');
  }

  return result;
}

async function getInvoiceHtml(invoiceId, options = {}) {
  const invoicePayload = erpService.getInvoiceForPrint(invoiceId);
  return renderInvoiceHtml(invoicePayload, options);
}

function normalizePreviewMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return mode === 'thermal' ? 'thermal' : 'a4';
}

async function previewInvoice(invoiceId, options = {}) {
  const mode = normalizePreviewMode(options.mode);
  const html = await getInvoiceHtml(invoiceId, { mode });
  const previewWindow = new BrowserWindow({
    show: true,
    width: mode === 'thermal' ? 460 : 980,
    height: mode === 'thermal' ? 900 : 780,
    autoHideMenuBar: true,
    title: mode === 'thermal' ? 'Thermal Receipt Preview' : 'Invoice Preview',
    icon: APP_ICON_PATH,
    webPreferences: {
      sandbox: true
    }
  });

  previewWindows.add(previewWindow);
  previewWindow.on('closed', () => {
    previewWindows.delete(previewWindow);
  });

  await previewWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  return { opened: true, mode };
}

function toSafeFilePart(value, fallback = 'ERPManiaC') {
  const cleaned = String(value || '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || fallback;
}

async function pickBackupFolder(currentPath = '') {
  const normalizedCurrent = typeof currentPath === 'string' ? currentPath.trim() : '';
  const fallbackPath = app.getPath('documents');
  const defaultPath = normalizedCurrent || fallbackPath;

  const result = await dialog.showOpenDialog(mainWindow || undefined, {
    title: 'Select Backup Folder',
    defaultPath,
    properties: ['openDirectory', 'createDirectory']
  });

  if (result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length === 0) {
    return {
      selected: false,
      folderPath: ''
    };
  }

  return {
    selected: true,
    folderPath: result.filePaths[0]
  };
}

async function exportStockListPdf() {
  const payload = erpService.getStockListForPrint();
  const html = renderStockListHtml(payload);
  const dateKey = new Date().toISOString().slice(0, 10);
  const baseName = toSafeFilePart(payload.business && payload.business.name, 'ERPManiaC');
  const defaultFileName = `${baseName} Stock List ${dateKey}.pdf`;
  const defaultPath = path.join(app.getPath('documents'), defaultFileName);

  const saveResult = await dialog.showSaveDialog(mainWindow || undefined, {
    title: 'Save Stock List PDF',
    defaultPath,
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
  });

  if (saveResult.canceled || !saveResult.filePath) {
    return { saved: false, canceled: true };
  }

  const pdfWindow = new BrowserWindow({
    show: false,
    width: 1100,
    height: 800,
    webPreferences: {
      sandbox: true
    }
  });

  try {
    await pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const pdfData = await pdfWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: {
        marginType: 'printableArea'
      }
    });

    fs.writeFileSync(saveResult.filePath, pdfData);
    return { saved: true, filePath: saveResult.filePath };
  } finally {
    if (!pdfWindow.isDestroyed()) {
      pdfWindow.close();
    }
  }
}

function registerIpc() {
  ipcMain.handle('erp:get-bootstrap', withResponse(() => erpService.getBootstrap()));
  ipcMain.handle('erp:get-license-status', withResponse(() => erpService.getLicenseStatus()));
  ipcMain.handle(
    'erp:activate-license-key',
    withResponse((payload) => erpService.activateLicenseKey(payload))
  );
  ipcMain.handle(
    'erp:upsert-ui-settings',
    withResponse((payload) => erpService.upsertUiSettings(payload))
  );
  ipcMain.handle('erp:upsert-business', withResponse((payload) => erpService.upsertBusiness(payload)));
  ipcMain.handle('erp:get-backup-settings', withResponse(() => erpService.getBackupSettings()));
  ipcMain.handle(
    'erp:upsert-backup-settings',
    withResponse((payload) => erpService.upsertBackupSettings(payload))
  );
  ipcMain.handle('erp:pick-backup-folder', withResponse((currentPath) => pickBackupFolder(currentPath)));
  ipcMain.handle('erp:run-local-backup', withResponse(() => erpService.runLocalFolderBackup('manual')));
  ipcMain.handle(
    'erp:restore-latest-local-backup',
    withResponse(() => erpService.restoreLatestLocalBackup())
  );

  ipcMain.handle('erp:upsert-product', withResponse((payload) => erpService.upsertProduct(payload)));
  ipcMain.handle('erp:delete-product', withResponse((productId) => erpService.deleteProduct(productId)));

  ipcMain.handle('erp:upsert-customer', withResponse((payload) => erpService.upsertCustomer(payload)));
  ipcMain.handle('erp:delete-customer', withResponse((customerId) => erpService.deleteCustomer(customerId)));

  ipcMain.handle('erp:upsert-supplier', withResponse((payload) => erpService.upsertSupplier(payload)));
  ipcMain.handle('erp:delete-supplier', withResponse((supplierId) => erpService.deleteSupplier(supplierId)));

  ipcMain.handle('erp:create-invoice', withResponse((payload) => erpService.createInvoice(payload)));
  ipcMain.handle(
    'erp:record-invoice-payment',
    withResponse((payload) => erpService.recordInvoicePayment(payload))
  );
  ipcMain.handle('erp:create-purchase', withResponse((payload) => erpService.createPurchase(payload)));
  ipcMain.handle(
    'erp:create-supplier-payment',
    withResponse((payload) => erpService.createSupplierPayment(payload))
  );
  ipcMain.handle('erp:create-expense', withResponse((payload) => erpService.createExpense(payload)));
  ipcMain.handle(
    'erp:extract-english-ocr',
    withResponse((payload) => erpService.extractEnglishOcr(payload))
  );
  ipcMain.handle(
    'erp:get-customer-ledger',
    withResponse((customerId) => erpService.getCustomerLedger(customerId))
  );
  ipcMain.handle(
    'erp:get-supplier-ledger',
    withResponse((supplierId) => erpService.getSupplierLedger(supplierId))
  );
  ipcMain.handle(
    'erp:get-trial-balance',
    withResponse((payload) => erpService.getTrialBalance(payload))
  );
  ipcMain.handle(
    'erp:get-daily-pnl',
    withResponse((inputDate) => erpService.getDailyProfitLoss(inputDate))
  );
  ipcMain.handle('erp:get-printers', withResponse(() => getAvailablePrinters()));
  ipcMain.handle(
    'erp:auto-print-invoice-thermal',
    withResponse((payload) => printInvoiceThermal(payload))
  );
  ipcMain.handle('erp:get-invoice', withResponse((invoiceId) => erpService.getInvoice(invoiceId)));
  ipcMain.handle(
    'erp:preview-invoice',
    withResponse((invoiceId, options) => previewInvoice(invoiceId, options))
  );
  ipcMain.handle('erp:print-invoice', withResponse((invoiceId) => printInvoice(invoiceId)));
  ipcMain.handle('erp:export-stock-list-pdf', withResponse(() => exportStockListPdf()));
}

function startAutoBackupLoop() {
  if (autoBackupTimer) {
    clearInterval(autoBackupTimer);
    autoBackupTimer = null;
  }

  const runAutoCheck = async () => {
    if (!erpService) {
      return;
    }

    try {
      await erpService.runAutoBackupCheck();
    } catch (error) {
      console.error('Auto backup check failed:', error && error.message ? error.message : error);
    }
  };

  autoBackupTimer = setInterval(runAutoCheck, 5 * 60 * 1000);
  setTimeout(runAutoCheck, 30 * 1000);
}

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(APP_ICON_PATH);
  }

  erpService = createErpService();
  registerIpc();
  createMainWindow();
  startAutoBackupLoop();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (autoBackupTimer) {
    clearInterval(autoBackupTimer);
    autoBackupTimer = null;
  }
});
