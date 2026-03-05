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

function renderInvoiceHtml({ invoice, business }) {
  const itemRows = invoice.items
    .map(
      (item, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>
            <div class="item-name">${escapeHtml(item.name)}</div>
            <div class="item-meta">SKU: ${escapeHtml(item.sku)}${
              item.barcode ? ` | Barcode: ${escapeHtml(item.barcode)}` : ''
            }</div>
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
      background: #f5f5ef;
      color: #18271f;
    }

    .sheet {
      max-width: 820px;
      margin: 0 auto;
      padding: 26px;
      background: #ffffff;
      border: 1px solid #d7e0d2;
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
      color: #2d4e39;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    h2 {
      margin: 0 0 6px;
      font-size: 16px;
      color: #324837;
      text-transform: uppercase;
      letter-spacing: 0.05em;
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
      border: 1px solid #dce5d6;
      padding: 9px;
      text-align: left;
      font-size: 12px;
    }

    thead th {
      background: #ecf3e9;
      color: #284736;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      font-size: 11px;
    }

    .item-name {
      font-weight: 600;
      margin-bottom: 2px;
    }

    .item-meta {
      color: #596c60;
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
      background: #f6f9f4;
      width: 52%;
    }

    .totals tr.total td {
      font-size: 14px;
      font-weight: 700;
      background: #f1f7ed;
      color: #1f5037;
    }

    .footer {
      margin-top: 22px;
      border-top: 1px dashed #bfd0bc;
      padding-top: 12px;
      font-size: 12px;
      color: #4a5f53;
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

module.exports = {
  renderInvoiceHtml
};
