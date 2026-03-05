const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { createErpService } = require('./src/main/erpService');
const { renderInvoiceHtml } = require('./src/main/invoiceTemplate');

let mainWindow;
let erpService;
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
  const html = await getInvoiceHtml(invoiceId);

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

async function getInvoiceHtml(invoiceId) {
  const invoicePayload = erpService.getInvoiceForPrint(invoiceId);
  return renderInvoiceHtml(invoicePayload);
}

async function previewInvoice(invoiceId) {
  const html = await getInvoiceHtml(invoiceId);
  const previewWindow = new BrowserWindow({
    show: true,
    width: 980,
    height: 780,
    autoHideMenuBar: true,
    title: 'Invoice Preview',
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
  return { opened: true };
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
    'erp:get-supplier-ledger',
    withResponse((supplierId) => erpService.getSupplierLedger(supplierId))
  );
  ipcMain.handle(
    'erp:get-daily-pnl',
    withResponse((inputDate) => erpService.getDailyProfitLoss(inputDate))
  );
  ipcMain.handle('erp:get-invoice', withResponse((invoiceId) => erpService.getInvoice(invoiceId)));
  ipcMain.handle('erp:preview-invoice', withResponse((invoiceId) => previewInvoice(invoiceId)));
  ipcMain.handle('erp:print-invoice', withResponse((invoiceId) => printInvoice(invoiceId)));
}

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(APP_ICON_PATH);
  }

  erpService = createErpService();
  registerIpc();
  createMainWindow();

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
