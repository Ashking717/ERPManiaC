const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { app } = require('electron');

// Note: To run this as a standalone script easily if electron is not mounted:
// execute with: const appPath = process.env.APPDATA_PATH || path.join(require('os').homedir(), 'Library', 'Application Support', 'com.erpmania.grocery');
let dataDir;
try {
  dataDir = path.join(app.getPath('userData'), 'data');
} catch (error) {
  // Fallback for standalone script
  const home = require('os').homedir();
  dataDir = path.join(home, 'Library', 'Application Support', 'erpmania-grocery-erp', 'data');
}

const jsonFile = path.join(dataDir, 'erpmania-data.json');
const dbFile = path.join(dataDir, 'erpmania-data.sqlite');

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      sku TEXT,
      barcode TEXT,
      name TEXT,
      category TEXT,
      unit TEXT,
      costPrice REAL,
      retailPrice REAL,
      loosePrice REAL,
      packEnabled INTEGER,
      packSize REAL,
      packPrice REAL,
      wholesalePrice REAL,
      wholesaleMinQty REAL,
      stock REAL,
      reorderLevel REAL,
      createdAt TEXT,
      updatedAt TEXT
    );
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT,
      type TEXT,
      phone TEXT,
      address TEXT,
      gstin TEXT,
      createdAt TEXT,
      updatedAt TEXT
    );
    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY,
      name TEXT,
      phone TEXT,
      address TEXT,
      gstin TEXT,
      createdAt TEXT,
      updatedAt TEXT
    );
    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      customerId TEXT,
      discount REAL,
      taxableValue REAL,
      gstEnabled INTEGER,
      gstRate REAL,
      gstAmount REAL,
      total REAL,
      paidAmount REAL,
      balance REAL,
      paidMethod TEXT,
      paymentStatus TEXT,
      createdAt TEXT,
      updatedAt TEXT,
      itemsJson TEXT,
      paymentHistoryJson TEXT
    );
  `);
}

function migrate() {
  if (!fs.existsSync(jsonFile)) {
    console.error('No JSON file found at:', jsonFile);
    return;
  }
  
  console.log('Connecting to SQLite DB:', dbFile);
  const db = new Database(dbFile);
  initSchema(db);

  console.log('Reading JSON file:', jsonFile);
  const data = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));

  const insertMeta = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
  insertMeta.run('invoiceCounter', String(data.meta?.invoiceCounter || 0));
  insertMeta.run('skuCounter', String(data.meta?.skuCounter || 10000));
  insertMeta.run('business', JSON.stringify(data.meta?.business || {}));
  insertMeta.run('uiSettings', JSON.stringify(data.meta?.uiSettings || {}));

  console.log('Migrating products...');
  const insertProduct = db.prepare(`
    INSERT OR REPLACE INTO products (
      id, sku, barcode, name, category, unit, costPrice, retailPrice, loosePrice, packEnabled, packSize, packPrice, wholesalePrice, wholesaleMinQty, stock, reorderLevel, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  data.products?.forEach(p => {
    insertProduct.run(
      p.id, p.sku, p.barcode, p.name, p.category, p.unit, p.costPrice, p.retailPrice, p.loosePrice,
      p.packEnabled ? 1 : 0, p.packSize, p.packPrice, p.wholesalePrice, p.wholesaleMinQty, p.stock, p.reorderLevel, p.createdAt, p.updatedAt
    );
  });

  console.log('Migrating customers...');
  const insertCustomer = db.prepare(`
    INSERT OR REPLACE INTO customers (id, name, type, phone, address, gstin, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  data.customers?.forEach(c => {
    insertCustomer.run(c.id, c.name, c.type, c.phone, c.address, c.gstin, c.createdAt, c.updatedAt);
  });

  console.log('Migrating suppliers...');
  const insertSupplier = db.prepare(`
    INSERT OR REPLACE INTO suppliers (id, name, phone, address, gstin, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  data.suppliers?.forEach(s => {
    insertSupplier.run(s.id, s.name, s.phone, s.address, s.gstin, s.createdAt, s.updatedAt);
  });

  console.log('Migrating invoices...');
  const insertInvoice = db.prepare(`
    INSERT OR REPLACE INTO invoices (
      id, customerId, discount, taxableValue, gstEnabled, gstRate, gstAmount, total, paidAmount, balance, paidMethod, paymentStatus, createdAt, updatedAt, itemsJson, paymentHistoryJson
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  data.invoices?.forEach(inv => {
    insertInvoice.run(
      inv.id, inv.customerId, inv.discount, inv.taxableValue, inv.gstEnabled ? 1 : 0, inv.gstRate, inv.gstAmount,
      inv.total, inv.paidAmount, inv.balance, inv.paidMethod, inv.paymentStatus, inv.createdAt, inv.updatedAt,
      JSON.stringify(inv.items || []), JSON.stringify(inv.paymentHistory || [])
    );
  });

  console.log('Migrating purchases...');
  const insertPurchase = db.prepare(`
    INSERT OR REPLACE INTO purchases (
      id, supplierId, discount, taxableValue, gstEnabled, gstRate, gstAmount, total, paidAmount, dueAmount, balance, paidMethod, createdAt, updatedAt, itemsJson
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  data.purchases?.forEach(p => {
    insertPurchase.run(
      p.id, p.supplierId, p.discount, p.taxableValue, p.gstEnabled ? 1 : 0, p.gstRate, p.gstAmount,
      p.total, p.paidAmount, p.dueAmount, p.balance, p.paidMethod, p.createdAt, p.updatedAt,
      JSON.stringify(p.items || [])
    );
  });

  console.log('Migrating supplier payments...');
  const insertSupplierPayment = db.prepare(`
    INSERT OR REPLACE INTO supplierPayments (id, supplierId, amount, paymentMethod, createdAt, updatedAt, allocationsJson)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  data.supplierPayments?.forEach(sp => {
    insertSupplierPayment.run(sp.id, sp.supplierId, sp.amount, sp.paymentMethod, sp.createdAt, sp.updatedAt, JSON.stringify(sp.allocations || []));
  });

  console.log('Migrating expenses...');
  const insertExpense = db.prepare(`
    INSERT OR REPLACE INTO expenses (id, expenseNo, category, amount, paymentMethod, paidTo, notes, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  data.expenses?.forEach(e => {
    insertExpense.run(e.id, e.expenseNo, e.category, e.amount, e.paymentMethod, e.paidTo, e.notes, e.createdAt, e.updatedAt);
  });
  
  console.log('Migration completed successfully!');
}

migrate();
