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

function renderStockListHtml({ business, products, generatedAt }) {
  const safeProducts = Array.isArray(products) ? products : [];
  const generatedLabel = formatDate(generatedAt || new Date().toISOString());
  const totalStockValue = safeProducts.reduce(
    (sum, product) => sum + (Number(product.stock) || 0) * (Number(product.costPrice) || 0),
    0
  );

  const rows = safeProducts
    .map((product, index) => {
      const stock = Number(product.stock) || 0;
      const costPrice = Number(product.costPrice) || 0;
      const reorderLevel = Number(product.reorderLevel) || 0;
      const lineValue = stock * costPrice;
      const lowStock = stock <= reorderLevel;

      return `
        <tr>
          <td>${index + 1}</td>
          <td>
            <div class="item-name">${escapeHtml(product.name)}</div>
            <div class="item-meta">${escapeHtml(product.category || 'General')}</div>
          </td>
          <td>${escapeHtml(product.sku || '-')}</td>
          <td>${escapeHtml(product.barcode || '-')}</td>
          <td>${escapeHtml(product.unit || 'Unit')}</td>
          <td class="${lowStock ? 'low' : ''}">${stock}</td>
          <td>${reorderLevel}</td>
          <td>${money(costPrice)}</td>
          <td>${money(lineValue)}</td>
        </tr>
      `;
    })
    .join('');

  const emptyRow =
    '<tr><td colspan="9" class="empty">No products available</td></tr>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Stock List</title>
  <style>
    * {
      box-sizing: border-box;
      font-family: "Avenir Next", "Trebuchet MS", sans-serif;
    }

    body {
      margin: 0;
      padding: 24px;
      background: #f5f5ef;
      color: #18271f;
    }

    .sheet {
      max-width: 1000px;
      margin: 0 auto;
      padding: 22px;
      background: #ffffff;
      border: 1px solid #d7e0d2;
      border-radius: 12px;
    }

    .header {
      display: flex;
      justify-content: space-between;
      gap: 20px;
      margin-bottom: 14px;
    }

    h1 {
      margin: 0;
      font-size: 24px;
      color: #2d4e39;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    p {
      margin: 4px 0;
      font-size: 12px;
      line-height: 1.35;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
    }

    th,
    td {
      border: 1px solid #dce5d6;
      padding: 8px;
      text-align: left;
      font-size: 11px;
      vertical-align: top;
    }

    thead th {
      background: #ecf3e9;
      color: #284736;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      font-size: 10px;
    }

    .item-name {
      font-weight: 600;
    }

    .item-meta {
      color: #566c5f;
      margin-top: 2px;
    }

    .low {
      color: #b13232;
      font-weight: 700;
    }

    .empty {
      text-align: center;
      color: #5a6b60;
    }

    .summary {
      margin-top: 12px;
      display: flex;
      justify-content: flex-end;
      gap: 20px;
      font-size: 12px;
    }

    .summary strong {
      color: #1f5037;
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
    <section class="header">
      <div>
        <h1>Stock List</h1>
        <p><strong>Generated:</strong> ${escapeHtml(generatedLabel)}</p>
      </div>
      <div>
        <p><strong>${escapeHtml((business && business.name) || 'Grocery Store')}</strong></p>
        <p>${escapeHtml((business && business.address) || '')}</p>
        <p><strong>Phone:</strong> ${escapeHtml((business && business.phone) || '-')}</p>
        <p><strong>GSTIN:</strong> ${escapeHtml((business && business.gstin) || '-')}</p>
      </div>
    </section>

    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Product</th>
          <th>SKU</th>
          <th>Barcode</th>
          <th>Unit</th>
          <th>Stock</th>
          <th>Reorder</th>
          <th>Cost</th>
          <th>Value</th>
        </tr>
      </thead>
      <tbody>
        ${rows || emptyRow}
      </tbody>
    </table>

    <section class="summary">
      <p><strong>Total Products:</strong> ${safeProducts.length}</p>
      <p><strong>Total Inventory Value:</strong> ${money(totalStockValue)}</p>
    </section>
  </main>
</body>
</html>`;
}

module.exports = {
  renderStockListHtml
};
