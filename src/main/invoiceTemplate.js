function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function money(amount) {
  const parsed = Number(amount) || 0;
  return `Rs ${parsed.toFixed(2)}`;
}

function formatDate(value) {
  const dt = new Date(value);
  return dt.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function paymentModeLabel(value) {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'cash') {
    return 'Cash';
  }
  if (text === 'bank') {
    return 'Bank';
  }
  if (text === 'upi') {
    return 'UPI';
  }
  if (text === 'card') {
    return 'Card';
  }
  if (text === 'other') {
    return 'Other';
  }
  return 'Cash';
}

function normalizeBusinessLogoDataUrl(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }

  if (!/^data:image\//i.test(text)) {
    return '';
  }

  if (text.length > 2800000) {
    return '';
  }

  return text;
}

function renderA4InvoiceHtml({ invoice, business }) {
  const storeLogoDataUrl = normalizeBusinessLogoDataUrl(business && business.logoDataUrl);
  const itemRows = invoice.items
    .map(
      (item, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>
            <div class="item-name">${escapeHtml(item.name)}</div>
            ${item.barcode ? `<div class="item-meta">Barcode: ${escapeHtml(item.barcode)}</div>` : ''}
          </td>
          <td>${item.qty}</td>
          <td>${escapeHtml(item.unit)}</td>
          <td>${money(item.unitPrice)}</td>
          <td>${money(item.lineTotal)}</td>
        </tr>
      `
    )
    .join('');

  const gstLabel = invoice.gstEnabled
    ? `GST (${invoice.gstRate.toFixed(2)}%)`
    : 'GST (Not Applied)';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(invoice.invoiceNo)}</title>
  <style>
    * {
      box-sizing: border-box;
      font-family: "Avenir Next", "Trebuchet MS", sans-serif;
    }

    body {
      margin: 0;
      padding: 28px;
      background: #ffffff;
      color: #111111;
    }

    .sheet {
      max-width: 820px;
      margin: 0 auto;
      padding: 26px;
      background: #ffffff;
      border: 1px solid #bbbbbb;
      border-radius: 12px;
    }

    .row {
      display: flex;
      justify-content: space-between;
      gap: 20px;
      margin-bottom: 18px;
    }

    h1 {
      margin: 0;
      font-size: 28px;
      color: #111111;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    h2 {
      margin: 0 0 6px;
      font-size: 16px;
      color: #111111;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .store-logo {
      max-width: 150px;
      max-height: 82px;
      object-fit: contain;
      display: block;
      margin: 0 0 8px auto;
      filter: grayscale(1) contrast(1.8) brightness(0.55);
    }

    p {
      margin: 4px 0;
      font-size: 13px;
      line-height: 1.4;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 8px;
    }

    th,
    td {
      border: 1px solid #c9c9c9;
      padding: 9px;
      text-align: left;
      font-size: 12px;
    }

    thead th {
      background: #f2f2f2;
      color: #111111;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      font-size: 11px;
    }

    .item-name {
      font-weight: 600;
      margin-bottom: 2px;
    }

    .item-meta {
      color: #444444;
      font-size: 11px;
    }

    .totals {
      width: 360px;
      margin-left: auto;
      margin-top: 18px;
    }

    .totals td {
      padding: 8px 10px;
      font-size: 12px;
    }

    .totals td:first-child {
      background: #f5f5f5;
      width: 52%;
    }

    .totals tr.total td {
      font-size: 14px;
      font-weight: 700;
      background: #efefef;
      color: #111111;
    }

    .footer {
      margin-top: 22px;
      border-top: 1px dashed #999999;
      padding-top: 12px;
      font-size: 12px;
      color: #333333;
    }

    @media print {
      body {
        background: #fff;
        padding: 0;
      }

      .sheet {
        border: 0;
        border-radius: 0;
        padding: 0;
      }
    }
  </style>
</head>
<body>
  <main class="sheet">
    <section class="row">
      <div>
        <h1>Invoice</h1>
        <p><strong>Invoice No:</strong> ${escapeHtml(invoice.invoiceNo)}</p>
        <p><strong>Date:</strong> ${escapeHtml(formatDate(invoice.createdAt))}</p>
        <p><strong>Type:</strong> ${escapeHtml(invoice.channel.toUpperCase())}</p>
      </div>
      <div>
        ${storeLogoDataUrl ? `<img class="store-logo" src="${escapeHtml(storeLogoDataUrl)}" alt="Store Logo" />` : ''}
        <h2>${escapeHtml(business.name || 'Grocery Store')}</h2>
        <p>${escapeHtml(business.address || '')}</p>
        <p><strong>Phone:</strong> ${escapeHtml(business.phone || '-')}</p>
        <p><strong>GSTIN:</strong> ${escapeHtml(business.gstin || '-')}</p>
      </div>
    </section>

    <section class="row">
      <div>
        <h2>Bill To</h2>
        <p><strong>${escapeHtml(invoice.customerSnapshot.name)}</strong></p>
        <p>${escapeHtml(invoice.customerSnapshot.address || '')}</p>
        <p><strong>Phone:</strong> ${escapeHtml(invoice.customerSnapshot.phone || '-')}</p>
        <p><strong>GSTIN:</strong> ${escapeHtml(invoice.customerSnapshot.gstin || '-')}</p>
      </div>
      <div>
        <h2>Payment</h2>
        <p><strong>Paid:</strong> ${money(invoice.paidAmount)}</p>
        <p><strong>Paid Via:</strong> ${escapeHtml(paymentModeLabel(invoice.paidMethod))}</p>
        <p><strong>Balance:</strong> ${money(invoice.balance)}</p>
        <p><strong>Change:</strong> ${money(invoice.change)}</p>
      </div>
    </section>

    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Item</th>
          <th>Qty</th>
          <th>Unit</th>
          <th>Rate</th>
          <th>Amount</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
      </tbody>
    </table>

    <table class="totals">
      <tbody>
        <tr>
          <td>Sub Total</td>
          <td>${money(invoice.subtotal)}</td>
        </tr>
        <tr>
          <td>Discount</td>
          <td>${money(invoice.discount)}</td>
        </tr>
        <tr>
          <td>${gstLabel}</td>
          <td>${money(invoice.gstAmount)}</td>
        </tr>
        <tr class="total">
          <td>Net Total</td>
          <td>${money(invoice.total)}</td>
        </tr>
      </tbody>
    </table>

    <div class="footer">
      <p><strong></strong> ${escapeHtml(invoice.notes || '-')}</p>
      <p>Computer Generated Invoice.</p>
    </div>
  </main>
</body>
</html>`;
}

function renderThermalInvoiceHtml({ invoice, business }) {
  const storeLogoDataUrl = normalizeBusinessLogoDataUrl(business && business.logoDataUrl);
  const itemRows = invoice.items
    .map(
      (item) => `
        <tr>
          <td class="item">${escapeHtml(item.name)}</td>
          <td class="num">${item.qty}</td>
          <td class="num">${money(item.unitPrice)}</td>
          <td class="num">${money(item.lineTotal)}</td>
        </tr>
      `
    )
    .join('');

  const gstLabel = invoice.gstEnabled ? `GST ${invoice.gstRate.toFixed(2)}%` : 'GST';
  const customerName = escapeHtml((invoice.customerSnapshot && invoice.customerSnapshot.name) || 'Walk-in');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(invoice.invoiceNo)} Receipt</title>
  <style>
    @page {
      size: 80mm auto;
      margin: 3mm;
    }

    * {
      box-sizing: border-box;
      font-family: "Courier New", monospace;
    }

    body {
      margin: 0;
      padding: 0;
      background: #fff;
      color: #111;
      font-size: 11px;
      line-height: 1.3;
    }

    .receipt {
      width: 74mm;
      margin: 0 auto;
      padding: 2mm 1mm;
    }

    .center {
      text-align: center;
    }

    .store-name {
      font-size: 15px;
      font-weight: 700;
      margin-bottom: 1px;
      text-transform: uppercase;
    }

    .thermal-logo {
      max-width: 43mm;
      max-height: 18mm;
      object-fit: contain;
      display: block;
      margin: 0 auto 3px;
      filter: grayscale(1) contrast(1.9) brightness(0.5);
    }

    .muted {
      color: #333;
      font-size: 10px;
    }

    .line {
      border-top: 1px dashed #222;
      margin: 6px 0;
    }

    .meta-row {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      margin: 1px 0;
    }

    .meta-label {
      color: #333;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 4px;
    }

    th,
    td {
      padding: 2px 0;
      font-size: 10px;
      vertical-align: top;
    }

    th {
      border-bottom: 1px solid #111;
      text-align: left;
    }

    .item {
      width: 46%;
      padding-right: 3px;
      word-break: break-word;
    }

    .num {
      text-align: right;
      white-space: nowrap;
    }

    .totals {
      margin-top: 4px;
    }

    .totals .meta-row {
      margin: 2px 0;
    }

    .totals .meta-row strong {
      font-size: 12px;
    }
  </style>
</head>
<body>
  <main class="receipt">
    <section class="center">
      ${storeLogoDataUrl ? `<img class="thermal-logo" src="${escapeHtml(storeLogoDataUrl)}" alt="Store Logo" />` : ''}
      <div class="store-name">${escapeHtml(business.name || 'Grocery Store')}</div>
      <div class="muted">${escapeHtml(business.address || '-')}</div>
      <div class="muted">Phone: ${escapeHtml(business.phone || '-')}</div>
      <div class="muted">GSTIN: ${escapeHtml(business.gstin || '-')}</div>
    </section>

    <div class="line"></div>

    <section>
      <div class="meta-row"><span class="meta-label">Invoice</span><span>${escapeHtml(invoice.invoiceNo)}</span></div>
      <div class="meta-row"><span class="meta-label">Date</span><span>${escapeHtml(formatDate(invoice.createdAt))}</span></div>
      <div class="meta-row"><span class="meta-label">Type</span><span>${escapeHtml(invoice.channel.toUpperCase())}</span></div>
      <div class="meta-row"><span class="meta-label">Customer</span><span>${customerName}</span></div>
    </section>

    <div class="line"></div>

    <table>
      <thead>
        <tr>
          <th>Item</th>
          <th class="num">Qty</th>
          <th class="num">Rate</th>
          <th class="num">Amt</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
      </tbody>
    </table>

    <div class="line"></div>

    <section class="totals">
      <div class="meta-row"><span>Sub Total</span><span>${money(invoice.subtotal)}</span></div>
      <div class="meta-row"><span>Discount</span><span>${money(invoice.discount)}</span></div>
      <div class="meta-row"><span>${gstLabel}</span><span>${money(invoice.gstAmount)}</span></div>
      <div class="meta-row"><strong>Net Total</strong><strong>${money(invoice.total)}</strong></div>
      <div class="meta-row"><span>Paid (${escapeHtml(paymentModeLabel(invoice.paidMethod))})</span><span>${money(invoice.paidAmount)}</span></div>
      <div class="meta-row"><span>Balance</span><span>${money(invoice.balance)}</span></div>
    </section>

    <div class="line"></div>

    <section class="center muted">
      <div>${escapeHtml(invoice.notes || 'Thank you for your purchase')}</div>
      <div>Computer Generated Invoice</div>
    </section>
  </main>
</body>
</html>`;
}

function renderInvoiceHtml(payload, options = {}) {
  const mode = String(options && options.mode ? options.mode : 'a4')
    .trim()
    .toLowerCase();

  if (mode === 'thermal') {
    return renderThermalInvoiceHtml(payload);
  }

  return renderA4InvoiceHtml(payload);
}

module.exports = {
  renderInvoiceHtml
};
