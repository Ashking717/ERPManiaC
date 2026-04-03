import { useState } from 'react';
import { Edit, FileText, Minus, Plus, Printer, Search, Trash2 } from 'lucide-react';
import { useApp } from '../AppContext';
import PeriodSelector from './PeriodSelector';
import { filterRecordsByPeriod, formatPeriodLabel, getTodayDateInput } from '../utils/dateFilters';

function unwrapIpcResponse(response) {
  if (response && typeof response === 'object' && Object.prototype.hasOwnProperty.call(response, 'ok')) {
    if (!response.ok) {
      throw new Error(response.error || 'Unexpected error');
    }

    return response.data;
  }

  return response;
}

function roundCurrency(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function splitTaxValue(value) {
  const totalValue = roundCurrency(value);
  const primaryAmount = roundCurrency(totalValue / 2);

  return {
    primary: primaryAmount,
    secondary: roundCurrency(totalValue - primaryAmount)
  };
}

function formatDateTime(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return '-';
  }

  return parsed.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function createInvoiceEditDraft(invoice, products) {
  const safeInvoice = invoice && typeof invoice === 'object' ? invoice : {};
  const productMap = new Map((Array.isArray(products) ? products : []).map((product) => [product.id, product]));
  const items = Array.isArray(safeInvoice.items)
    ? safeInvoice.items.map((item, index) => {
        const product = productMap.get(item.productId) || null;
        const packSize = Math.max(
          1,
          Number(product?.packSize || item.packSize || 1) || 1
        );
        const hasPackOption = Boolean(product?.packEnabled) || packSize > 1 || item.saleUnit === 'pack';
        const loosePrice = roundCurrency(
          Number(
            product?.loosePrice ||
              product?.retailPrice ||
              (item.saleUnit === 'pack' && packSize > 0 ? Number(item.unitPrice || 0) / packSize : item.unitPrice) ||
              0
          )
        );
        const packPrice = roundCurrency(
          Number(
            product?.packPrice ||
              (item.saleUnit === 'pack' ? item.unitPrice : loosePrice * packSize) ||
              loosePrice * packSize
          )
        );
        const saleUnit =
          item.saleUnit === 'pack' && hasPackOption
            ? 'pack'
            : 'loose';
        const price = roundCurrency(
          Number(item.unitPrice || (saleUnit === 'pack' ? packPrice : loosePrice) || 0)
        );

        return {
          key: `${item.productId || 'line'}-${index}`,
          productId: item.productId,
          name: item.name || product?.name || 'Unnamed Item',
          sku: item.sku || product?.sku || '',
          barcode: item.barcode || product?.barcode || '',
          qty: Number(item.qty || 1) || 1,
          saleUnit,
          hasPackOption,
          packSize,
          loosePrice,
          packPrice,
          price,
          unit: product?.unit || item.looseUnit || item.unit || 'Unit',
          productMissing: !product
        };
      })
    : [];

  return {
    id: safeInvoice.id,
    customerId: safeInvoice.customerId || '',
    channel: safeInvoice.channel || 'retail',
    discount: String(Number(safeInvoice.discount || 0)),
    gstEnabled: Boolean(safeInvoice.gstEnabled),
    gstRate: String(Number(safeInvoice.gstRate || 0)),
    paidAmount: String(Number(safeInvoice.paidAmount || 0)),
    paidMethod: safeInvoice.paidMethod || 'cash',
    notes: safeInvoice.notes || '',
    items
  };
}

export default function InvoicesView() {
  const { data, mutateAndRefresh } = useApp();
  const [searchTerm, setSearchTerm] = useState('');
  const [invoicePeriod, setInvoicePeriod] = useState('monthly');
  const [invoiceFocusDate, setInvoiceFocusDate] = useState(getTodayDateInput);
  const [activeInvoiceId, setActiveInvoiceId] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const [editSearchInput, setEditSearchInput] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const periodLabel = formatPeriodLabel(invoicePeriod, invoiceFocusDate);
  const scopedInvoices = filterRecordsByPeriod(data.invoices || [], invoicePeriod, invoiceFocusDate);
  const sortedInvoices = [...scopedInvoices].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const filteredInvoices = sortedInvoices.filter((invoice) => {
    const invoiceNumber = String(invoice.invoiceNo || invoice.id || '').toLowerCase();
    const customerName = (data.customers.find((customer) => customer.id === invoice.customerId)?.name || '').toLowerCase();
    const search = searchTerm.toLowerCase();

    return invoiceNumber.includes(search) || customerName.includes(search);
  });
  const activeInvoice = activeInvoiceId
    ? data.invoices.find((invoice) => invoice.id === activeInvoiceId) || null
    : null;
  const activeCustomer = activeInvoice
    ? data.customers.find((customer) => customer.id === activeInvoice.customerId) || null
    : null;
  const activeCustomerSnapshot = activeInvoice
    ? activeCustomer || activeInvoice.customerSnapshot || null
    : null;
  const activeInvoiceGstRate = activeInvoice ? roundCurrency(activeInvoice.gstRate || 0) : 0;
  const activeInvoiceGstAmount = activeInvoice ? roundCurrency(activeInvoice.gstAmount || 0) : 0;
  const activeInvoiceTaxableValue = activeInvoice
    ? roundCurrency(
        activeInvoice.taxableValue || Math.max((activeInvoice.subtotal || 0) - (activeInvoice.discount || 0), 0)
      )
    : 0;
  const { primary: activeInvoiceSgstRate, secondary: activeInvoiceCgstRate } = splitTaxValue(activeInvoiceGstRate);
  const { primary: activeInvoiceSgstAmount, secondary: activeInvoiceCgstAmount } = splitTaxValue(activeInvoiceGstAmount);
  const editSuggestions =
    editSearchInput.trim().length > 1
      ? data.products
          .filter(
            (product) =>
              product.name.toLowerCase().includes(editSearchInput.toLowerCase()) ||
              product.barcode === editSearchInput ||
              product.sku.toLowerCase().includes(editSearchInput.toLowerCase())
          )
          .slice(0, 8)
      : [];
  const editSubtotal = roundCurrency(
    (editDraft?.items || []).reduce(
      (sum, item) => sum + roundCurrency(Number(item.price || 0) * Number(item.qty || 0)),
      0
    )
  );
  const editDiscount = roundCurrency(Number(editDraft?.discount || 0));
  const editTaxableValue = roundCurrency(Math.max(editSubtotal - editDiscount, 0));
  const editGstRate = editDraft?.gstEnabled ? roundCurrency(Number(editDraft?.gstRate || 0)) : 0;
  const editGstAmount = roundCurrency(editDraft?.gstEnabled ? (editTaxableValue * editGstRate) / 100 : 0);
  const editTotal = roundCurrency(editTaxableValue + editGstAmount);
  const { primary: editSgstRate, secondary: editCgstRate } = splitTaxValue(editGstRate);
  const { primary: editSgstAmount, secondary: editCgstAmount } = splitTaxValue(editGstAmount);

  const printInvoice = async (id) => {
    if (!window.erpApi) {
      alert('Print functionality requires the desktop application.');
      return;
    }

    try {
      const result = unwrapIpcResponse(await window.erpApi.printInvoice(id));
      if (!result?.printed) {
        alert(result?.reason || 'Print cancelled.');
      }
    } catch (error) {
      alert(error.message || 'Failed to print invoice.');
    }
  };

  const handleInvoiceRowKeyDown = (event, invoiceId) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();
    setActiveInvoiceId(invoiceId);
  };

  const printThermal = async (id) => {
    if (!window.erpApi) {
      return;
    }

    const uiSettings = data.uiSettings || {};
    const thermalEnabled = Boolean(uiSettings.thermalAutoPrintEnabled);
    const selectedPrinterName = String(uiSettings.thermalPrinterName || '').trim();

    if (!thermalEnabled) {
      window.erpApi.previewInvoice(id, { mode: 'thermal' });
      return;
    }

    try {
      const printers = unwrapIpcResponse(await window.erpApi.getPrinters());
      const availablePrinters = Array.isArray(printers) ? printers : [];

      if (availablePrinters.length === 0) {
        alert('No thermal printer detected. Opening POS preview instead.');
        window.erpApi.previewInvoice(id, { mode: 'thermal' });
        return;
      }

      if (
        selectedPrinterName &&
        !availablePrinters.some((printer) => String(printer?.name || '').trim() === selectedPrinterName)
      ) {
        alert('Saved thermal printer is not connected. Opening POS preview instead.');
        window.erpApi.previewInvoice(id, { mode: 'thermal' });
        return;
      }

      await unwrapIpcResponse(
        await window.erpApi.autoPrintInvoiceThermal({
          invoiceId: id,
          printerName: selectedPrinterName
        })
      );
    } catch (error) {
      alert(error.message || 'Thermal print failed. Opening POS preview instead.');
      window.erpApi.previewInvoice(id, { mode: 'thermal' });
    }
  };

  const openEditInvoice = (invoice) => {
    setEditDraft(createInvoiceEditDraft(invoice, data.products));
    setEditSearchInput('');
  };

  const closeEditInvoice = () => {
    setEditDraft(null);
    setEditSearchInput('');
  };

  const addProductToEditDraft = (product) => {
    if (!editDraft) {
      return;
    }

    const existingItem = editDraft.items.find((item) => item.productId === product.id);
    const packSize = Math.max(1, Number(product.packSize || 1) || 1);
    const hasPackOption = Boolean(product.packEnabled) || packSize > 1;
    const loosePrice = roundCurrency(Number(product.loosePrice || product.retailPrice || 0));
    const packPrice = roundCurrency(
      Number(product.packPrice || (loosePrice > 0 ? loosePrice * packSize : 0))
    );

    if (existingItem) {
      setEditDraft((current) => ({
        ...current,
        items: current.items.map((item) =>
          item.productId === product.id ? { ...item, qty: Number(item.qty || 0) + 1 } : item
        )
      }));
    } else {
      setEditDraft((current) => ({
        ...current,
        items: [
          ...current.items,
          {
            key: `${product.id}-${Date.now()}`,
            productId: product.id,
            name: product.name,
            sku: product.sku || '',
            barcode: product.barcode || '',
            qty: 1,
            saleUnit: 'loose',
            hasPackOption,
            packSize,
            loosePrice,
            packPrice,
            price: loosePrice,
            unit: product.unit || 'Unit',
            productMissing: false
          }
        ]
      }));
    }

    setEditSearchInput('');
  };

  const updateEditItem = (productId, updater) => {
    setEditDraft((current) => ({
      ...current,
      items: current.items.map((item) => (item.productId === productId ? updater(item) : item))
    }));
  };

  const updateEditItemQty = (productId, nextQty) => {
    const normalizedQty = Math.max(1, Number(nextQty || 0) || 1);
    updateEditItem(productId, (item) => ({ ...item, qty: normalizedQty }));
  };

  const updateEditItemPrice = (productId, nextPrice) => {
    const normalizedPrice = Math.max(0, Number(nextPrice || 0) || 0);
    updateEditItem(productId, (item) => ({ ...item, price: normalizedPrice }));
  };

  const toggleEditItemUnit = (productId) => {
    updateEditItem(productId, (item) => {
      if (!item.hasPackOption) {
        return item;
      }

      const nextSaleUnit = item.saleUnit === 'pack' ? 'loose' : 'pack';
      return {
        ...item,
        saleUnit: nextSaleUnit,
        price: nextSaleUnit === 'pack' ? item.packPrice : item.loosePrice
      };
    });
  };

  const removeEditItem = (productId) => {
    setEditDraft((current) => ({
      ...current,
      items: current.items.filter((item) => item.productId !== productId)
    }));
  };

  const saveInvoiceEdit = async () => {
    if (!window.erpApi || !editDraft) {
      return;
    }

    if ((editDraft.items || []).length === 0) {
      alert('Add at least one invoice item.');
      return;
    }

    try {
      setIsSavingEdit(true);
      const updatedInvoice = await mutateAndRefresh(
        window.erpApi.updateInvoice({
          id: editDraft.id,
          customerId: editDraft.customerId || null,
          channel: editDraft.channel,
          items: editDraft.items.map((item) => ({
            productId: item.productId,
            qty: Number(item.qty || 0),
            saleUnit: item.saleUnit,
            unitPrice: Number(item.price || 0)
          })),
          discount: Number(editDraft.discount || 0),
          gstEnabled: Boolean(editDraft.gstEnabled),
          gstRate: Number(editDraft.gstRate || 0),
          paidAmount: Number(editDraft.paidAmount || 0),
          paidMethod: editDraft.paidMethod,
          notes: editDraft.notes
        })
      );
      closeEditInvoice();
      if (updatedInvoice?.id) {
        setActiveInvoiceId(updatedInvoice.id);
      }
      alert('Invoice updated successfully.');
    } catch (error) {
      alert(error.message || 'Failed to update invoice.');
    } finally {
      setIsSavingEdit(false);
    }
  };

  return (
    <div className="flex h-full flex-col animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h2 className="text-5xl font-semibold text-[var(--ink)]">Invoice Ledger</h2>
          <p className="mt-3 text-sm leading-6 text-[var(--ink-soft)]">
            Browse invoices created in {periodLabel}, then refine further with search.
          </p>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_23rem]">
        <PeriodSelector
          period={invoicePeriod}
          focusDate={invoiceFocusDate}
          onPeriodChange={setInvoicePeriod}
          onFocusDateChange={setInvoiceFocusDate}
          label="Invoice Range"
          summary={`Showing ${filteredInvoices.length} invoice(s) for ${periodLabel}.`}
        />

        <div className="theme-search h-fit xl:self-end">
          <Search size={20} className="text-[var(--ink-soft)]" />
          <input
            type="text"
            placeholder="Search by invoice no or customer..."
            className="theme-search-input"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </div>
      </div>

      <div className="glass-panel table-shell flex flex-1 flex-col overflow-hidden">
        <div className="overflow-y-auto w-full p-0">
          <table className="w-full border-collapse text-left">
            <thead className="table-head sticky top-0 z-10">
              <tr>
                <th className="table-header-cell">Invoice Date</th>
                <th className="table-header-cell">Invoice No</th>
                <th className="table-header-cell">Customer</th>
                <th className="table-header-cell">Total</th>
                <th className="table-header-cell">Status</th>
                <th className="table-header-cell text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="table-body divide-y divide-[rgba(70,96,103,0.08)]">
              {filteredInvoices.map((invoice) => {
                const customer = data.customers.find((entry) => entry.id === invoice.customerId);

                return (
                  <tr
                    key={invoice.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setActiveInvoiceId(invoice.id)}
                    onKeyDown={(event) => handleInvoiceRowKeyDown(event, invoice.id)}
                    className="table-row group cursor-pointer focus:outline-none focus:bg-[rgba(241,247,245,0.88)]"
                  >
                    <td className="px-6 py-4 font-semibold text-[var(--ink)]">
                      {new Date(invoice.createdAt).toLocaleDateString('en-IN')}
                    </td>
                    <td className="px-6 py-4 text-sm font-bold text-[var(--ink)]">{invoice.invoiceNo || invoice.id}</td>
                    <td className="px-6 py-4 font-medium text-[var(--ink-soft)]">
                      {customer ? customer.name : <span className="italic text-[var(--ink-soft)]">Walk-in</span>}
                    </td>
                    <td className="px-6 py-4 text-lg font-black text-[var(--ink)]">₹{invoice.total.toFixed(2)}</td>
                    <td className="px-6 py-4">
                      {invoice.balance > 0 ? (
                        <span className="badge badge-amber">Due: ₹{invoice.balance.toFixed(2)}</span>
                      ) : (
                        <span className="badge badge-green">Paid</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex flex-row-reverse items-center justify-start gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            openEditInvoice(invoice);
                          }}
                          className="flex items-center gap-1 rounded-xl p-2 text-sm font-bold text-[var(--ink-soft)] transition-colors hover:bg-[rgba(230,238,236,0.9)] hover:text-[var(--ink)]"
                          title="Edit Invoice"
                        >
                          <Edit size={18} /> Edit
                        </button>
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            printInvoice(invoice.id);
                          }}
                          className="flex items-center gap-1 rounded-xl p-2 text-sm font-bold text-[var(--ink-soft)] transition-colors hover:bg-primary-100 hover:text-primary-700"
                          title="A4 Print"
                        >
                          <Printer size={18} /> A4
                        </button>
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            printThermal(invoice.id);
                          }}
                          className="flex items-center gap-1 rounded-xl p-2 text-sm font-bold text-[var(--ink-soft)] transition-colors hover:bg-[rgba(230,238,236,0.9)] hover:text-[var(--ink)]"
                          title="Thermal Print"
                        >
                          <FileText size={18} /> POS
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filteredInvoices.length === 0 && (
                <tr>
                  <td colSpan="6" className="py-20 text-center font-medium text-[var(--ink-soft)]">
                    No invoices found for {periodLabel}. Try a different period or search term.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editDraft && (
        <div className="modal-backdrop">
          <div className="modal-panel max-w-6xl">
            <div className="modal-header">
              <div>
                <h3 className="modal-title">Edit Invoice</h3>
                <p className="mt-1 text-sm font-medium text-[var(--ink-soft)]">
                  {editDraft.id}
                </p>
              </div>
              <button
                type="button"
                onClick={closeEditInvoice}
                className="text-2xl text-[var(--ink-soft)] transition hover:text-[var(--ink)]"
              >
                &times;
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(23rem,0.85fr)]">
                <div className="space-y-6">
                  <div className="section-card p-5">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Invoice Type</label>
                        <select
                          value={editDraft.channel}
                          onChange={(event) => setEditDraft((current) => ({ ...current, channel: event.target.value }))}
                          className="theme-select"
                        >
                          <option value="retail">Retail</option>
                          <option value="wholesale">Wholesale</option>
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Customer</label>
                        <select
                          value={editDraft.customerId}
                          onChange={(event) => setEditDraft((current) => ({ ...current, customerId: event.target.value }))}
                          className="theme-select"
                        >
                          <option value="">Walk-in Customer</option>
                          {data.customers
                            .filter((customer) => editDraft.channel === 'retail' || customer.type === 'wholesale')
                            .map((customer) => (
                              <option key={customer.id} value={customer.id}>
                                {customer.name}
                              </option>
                            ))}
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Discount (₹)</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={editDraft.discount}
                          onChange={(event) => setEditDraft((current) => ({ ...current, discount: event.target.value }))}
                          className="theme-input"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Amount Paid (₹)</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={editDraft.paidAmount}
                          onChange={(event) => setEditDraft((current) => ({ ...current, paidAmount: event.target.value }))}
                          className="theme-input"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Payment Method</label>
                        <select
                          value={editDraft.paidMethod}
                          onChange={(event) => setEditDraft((current) => ({ ...current, paidMethod: event.target.value }))}
                          className="theme-select"
                        >
                          <option value="cash">Cash</option>
                          <option value="bank">Bank</option>
                          <option value="upi">UPI</option>
                          <option value="card">Card</option>
                          <option value="other">Other</option>
                        </select>
                      </div>
                      <div className="flex items-center rounded-[1rem] border border-[rgba(70,96,103,0.1)] bg-white/70 px-4">
                        <label className="flex items-center gap-3 text-sm font-bold text-[var(--ink)]">
                          <input
                            type="checkbox"
                            checked={editDraft.gstEnabled}
                            onChange={(event) =>
                              setEditDraft((current) => ({
                                ...current,
                                gstEnabled: event.target.checked,
                                gstRate: event.target.checked ? current.gstRate : '0'
                              }))
                            }
                            className="h-4 w-4 rounded"
                          />
                          Enable GST
                        </label>
                      </div>
                      {editDraft.gstEnabled && (
                        <div>
                          <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">GST Rate (%)</label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={editDraft.gstRate}
                            onChange={(event) => setEditDraft((current) => ({ ...current, gstRate: event.target.value }))}
                            className="theme-input"
                          />
                        </div>
                      )}
                      <div className="md:col-span-2">
                        <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Notes</label>
                        <textarea
                          rows={3}
                          value={editDraft.notes}
                          onChange={(event) => setEditDraft((current) => ({ ...current, notes: event.target.value }))}
                          className="theme-textarea"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="section-card p-5">
                    <label className="mb-2 block text-sm font-bold text-[var(--ink-soft)]">Add Product</label>
                    <div className="theme-search relative">
                      <Search size={20} className="text-[var(--ink-soft)]" />
                      <input
                        type="text"
                        placeholder="Search product by name, barcode, or SKU..."
                        className="theme-search-input"
                        value={editSearchInput}
                        onChange={(event) => setEditSearchInput(event.target.value)}
                      />
                    </div>
                    {editSuggestions.length > 0 && (
                      <div className="mt-3 overflow-hidden rounded-[1.2rem] border border-[rgba(70,96,103,0.1)]">
                        {editSuggestions.map((product) => (
                          <button
                            key={product.id}
                            type="button"
                            onClick={() => addProductToEditDraft(product)}
                            className="flex w-full items-center justify-between border-b border-[rgba(70,96,103,0.06)] px-4 py-3 text-left transition last:border-b-0 hover:bg-primary-50"
                          >
                            <div>
                              <p className="font-semibold text-[var(--ink)]">{product.name}</p>
                              <p className="text-xs font-medium text-[var(--ink-soft)]">{product.sku || product.barcode || 'No SKU'}</p>
                            </div>
                            <p className="font-black text-primary-700">₹{Number(product.loosePrice || product.retailPrice || 0).toFixed(2)}</p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="section-card overflow-hidden">
                    <div className="border-b border-[rgba(70,96,103,0.08)] px-5 py-4">
                      <h4 className="text-2xl font-semibold text-[var(--ink)]">Invoice Items</h4>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-left">
                        <thead className="table-head">
                          <tr>
                            <th className="table-header-cell">Item</th>
                            <th className="table-header-cell text-center">Qty</th>
                            <th className="table-header-cell text-right">Rate</th>
                            <th className="table-header-cell text-right">Total</th>
                            <th className="table-header-cell text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="table-body divide-y divide-[rgba(70,96,103,0.08)]">
                          {(editDraft.items || []).map((item) => (
                            <tr key={item.key} className="table-row">
                              <td className="px-5 py-4">
                                <p className="font-semibold text-[var(--ink)]">{item.name}</p>
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                  <p className="text-xs font-medium text-[var(--ink-soft)]">{item.sku || item.barcode || 'No SKU'}</p>
                                  {item.hasPackOption && (
                                    <button
                                      type="button"
                                      onClick={() => toggleEditItemUnit(item.productId)}
                                      className={`badge ${item.saleUnit === 'pack' ? 'badge-blue' : 'badge-amber'}`}
                                    >
                                      {item.saleUnit === 'pack' ? `Pack (${item.packSize})` : 'Loose'}
                                    </button>
                                  )}
                                  {item.productMissing && (
                                    <span className="badge badge-red">Product Missing</span>
                                  )}
                                </div>
                              </td>
                              <td className="px-5 py-4">
                                <div className="flex items-center justify-center gap-2">
                                  <button type="button" onClick={() => updateEditItemQty(item.productId, Number(item.qty || 0) - 1)} className="rounded-lg p-1 text-[var(--ink-soft)] hover:bg-slate-100">
                                    <Minus size={14} />
                                  </button>
                                  <input
                                    type="number"
                                    min="1"
                                    step="0.01"
                                    value={item.qty}
                                    onChange={(event) => updateEditItemQty(item.productId, event.target.value)}
                                    className="w-18 rounded-lg border border-slate-200 bg-white px-2 py-1 text-center font-bold text-[var(--ink)] outline-none"
                                  />
                                  <button type="button" onClick={() => updateEditItemQty(item.productId, Number(item.qty || 0) + 1)} className="rounded-lg p-1 text-[var(--ink-soft)] hover:bg-slate-100">
                                    <Plus size={14} />
                                  </button>
                                </div>
                              </td>
                              <td className="px-5 py-4">
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={item.price}
                                  onChange={(event) => updateEditItemPrice(item.productId, event.target.value)}
                                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-right font-bold text-[var(--ink)] outline-none"
                                />
                              </td>
                              <td className="px-5 py-4 text-right font-black text-primary-700">
                                ₹{roundCurrency(Number(item.price || 0) * Number(item.qty || 0)).toFixed(2)}
                              </td>
                              <td className="px-5 py-4 text-right">
                                <button type="button" onClick={() => removeEditItem(item.productId)} className="rounded-xl p-2 text-[var(--ink-soft)] transition-colors hover:bg-rose-100 hover:text-rose-700">
                                  <Trash2 size={18} />
                                </button>
                              </td>
                            </tr>
                          ))}
                          {(editDraft.items || []).length === 0 && (
                            <tr>
                              <td colSpan="5" className="px-5 py-10 text-center font-medium text-[var(--ink-soft)]">
                                No items in this invoice.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="section-card p-5">
                    <p className="muted-kicker">Updated Summary</p>
                    <div className="mt-4 space-y-3 text-sm text-[var(--ink-soft)]">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">Subtotal</span>
                        <span className="text-lg font-bold text-[var(--ink)]">₹{editSubtotal.toFixed(2)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="font-medium">Discount</span>
                        <span className="text-lg font-bold text-[var(--ink)]">₹{editDiscount.toFixed(2)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="font-medium">Taxable Value</span>
                        <span className="text-lg font-bold text-[var(--ink)]">₹{editTaxableValue.toFixed(2)}</span>
                      </div>
                      {editDraft.gstEnabled && (
                        <>
                          <div className="flex items-center justify-between">
                            <span className="font-medium">{`SGST (${editSgstRate.toFixed(2)}%)`}</span>
                            <span className="text-lg font-bold text-primary-700">₹{editSgstAmount.toFixed(2)}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="font-medium">{`CGST (${editCgstRate.toFixed(2)}%)`}</span>
                            <span className="text-lg font-bold text-primary-700">₹{editCgstAmount.toFixed(2)}</span>
                          </div>
                        </>
                      )}
                      <div className="h-px w-full bg-[rgba(70,96,103,0.08)]" />
                      <div className="flex items-center justify-between">
                        <span className="text-base font-bold text-[var(--ink)]">Grand Total</span>
                        <span className="text-[1.6rem] font-black text-primary-700">₹{editTotal.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="section-card p-5">
                    <p className="muted-kicker">Actions</p>
                    <div className="mt-4 flex flex-wrap gap-3">
                      <button type="button" onClick={closeEditInvoice} className="theme-button-secondary px-5 py-3">
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={saveInvoiceEdit}
                        disabled={isSavingEdit}
                        className="theme-button-primary px-5 py-3 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isSavingEdit ? 'Saving...' : 'Save Changes'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeInvoice && (
        <div className="modal-backdrop">
          <div className="modal-panel max-w-5xl">
            <div className="modal-header">
              <div>
                <h3 className="modal-title">Invoice Details</h3>
                <p className="mt-1 text-sm font-medium text-[var(--ink-soft)]">
                  {activeInvoice.invoiceNo || activeInvoice.id}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveInvoiceId(null)}
                className="text-2xl text-[var(--ink-soft)] transition hover:text-[var(--ink)]"
              >
                &times;
              </button>
            </div>

            <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
              <div className="space-y-6">
                <div className="section-card p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="muted-kicker">Customer</p>
                      <h4 className="mt-2 text-3xl font-semibold text-[var(--ink)]">
                        {activeCustomerSnapshot?.name || 'Walk-in Customer'}
                      </h4>
                      <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">
                        {activeCustomerSnapshot?.address || 'No saved address'}
                      </p>
                    </div>
                    <div className="space-y-2 text-right text-sm text-[var(--ink-soft)]">
                      <p><span className="font-semibold text-[var(--ink)]">Phone:</span> {activeCustomerSnapshot?.phone || '-'}</p>
                      <p><span className="font-semibold text-[var(--ink)]">GSTIN:</span> {activeCustomerSnapshot?.gstin || '-'}</p>
                      <p><span className="font-semibold text-[var(--ink)]">Date:</span> {formatDateTime(activeInvoice.createdAt)}</p>
                      <p><span className="font-semibold text-[var(--ink)]">Type:</span> {(activeInvoice.channel || 'retail').toUpperCase()}</p>
                    </div>
                  </div>
                </div>

                <div className="section-card overflow-hidden">
                  <div className="border-b border-[rgba(70,96,103,0.08)] px-5 py-4">
                    <h4 className="text-2xl font-semibold text-[var(--ink)]">Invoice Items</h4>
                    <p className="mt-1 text-sm text-[var(--ink-soft)]">
                      {Array.isArray(activeInvoice.items) ? activeInvoice.items.length : 0} item(s) recorded in this invoice.
                    </p>
                  </div>
                  <div className="max-h-[28rem] overflow-y-auto">
                    <table className="w-full border-collapse text-left">
                      <thead className="table-head sticky top-0 z-10">
                        <tr>
                          <th className="table-header-cell">Item</th>
                          <th className="table-header-cell">SKU / Barcode</th>
                          <th className="table-header-cell text-right">Qty</th>
                          <th className="table-header-cell text-right">Rate</th>
                          <th className="table-header-cell text-right">Line Total</th>
                        </tr>
                      </thead>
                      <tbody className="table-body divide-y divide-[rgba(70,96,103,0.08)]">
                        {(activeInvoice.items || []).map((item, index) => (
                          <tr key={`${item.productId || index}-${index}`} className="table-row">
                            <td className="px-5 py-4">
                              <p className="font-semibold text-[var(--ink)]">{item.name || 'Unnamed Item'}</p>
                              <p className="mt-1 text-xs font-medium uppercase tracking-[0.14em] text-[var(--ink-soft)]">
                                {item.unit || item.saleUnit || 'Unit'}
                              </p>
                            </td>
                            <td className="px-5 py-4 text-sm font-medium text-[var(--ink-soft)]">
                              {item.sku || item.barcode || '-'}
                            </td>
                            <td className="px-5 py-4 text-right font-semibold text-[var(--ink)]">
                              {Number(item.qty || 0).toFixed(2)}
                            </td>
                            <td className="px-5 py-4 text-right font-semibold text-[var(--ink)]">
                              ₹{Number(item.unitPrice || 0).toFixed(2)}
                            </td>
                            <td className="px-5 py-4 text-right font-black text-primary-700">
                              ₹{Number(item.lineTotal || 0).toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {activeInvoice.notes && (
                  <div className="section-card p-5">
                    <p className="muted-kicker">Notes</p>
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[var(--ink)]">
                      {activeInvoice.notes}
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <div className="section-card p-5">
                  <p className="muted-kicker">Summary</p>
                  <div className="mt-4 space-y-3 text-sm text-[var(--ink-soft)]">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">Subtotal</span>
                      <span className="text-lg font-bold text-[var(--ink)]">₹{Number(activeInvoice.subtotal || 0).toFixed(2)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="font-medium">Discount</span>
                      <span className="text-lg font-bold text-[var(--ink)]">₹{Number(activeInvoice.discount || 0).toFixed(2)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="font-medium">Taxable Value</span>
                      <span className="text-lg font-bold text-[var(--ink)]">₹{activeInvoiceTaxableValue.toFixed(2)}</span>
                    </div>
                    {activeInvoice.gstEnabled && (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{`SGST (${activeInvoiceSgstRate.toFixed(2)}%)`}</span>
                          <span className="text-lg font-bold text-primary-700">₹{activeInvoiceSgstAmount.toFixed(2)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{`CGST (${activeInvoiceCgstRate.toFixed(2)}%)`}</span>
                          <span className="text-lg font-bold text-primary-700">₹{activeInvoiceCgstAmount.toFixed(2)}</span>
                        </div>
                      </>
                    )}
                    <div className="h-px w-full bg-[rgba(70,96,103,0.08)]" />
                    <div className="flex items-center justify-between">
                      <span className="text-base font-bold text-[var(--ink)]">Grand Total</span>
                      <span className="text-[1.6rem] font-black text-primary-700">₹{Number(activeInvoice.total || 0).toFixed(2)}</span>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
                  <div className="section-card p-4">
                    <p className="muted-kicker">Paid</p>
                    <p className="mt-2 text-3xl font-black text-emerald-700">₹{Number(activeInvoice.paidAmount || 0).toFixed(2)}</p>
                  </div>
                  <div className="section-card p-4">
                    <p className="muted-kicker">Balance</p>
                    <p className={`mt-2 text-3xl font-black ${Number(activeInvoice.balance || 0) > 0 ? 'text-amber-700' : 'text-[var(--ink)]'}`}>
                      ₹{Number(activeInvoice.balance || 0).toFixed(2)}
                    </p>
                  </div>
                </div>

                <div className="section-card p-5">
                  <p className="muted-kicker">Actions</p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => openEditInvoice(activeInvoice)}
                      className="theme-button-secondary px-5 py-3"
                    >
                      <Edit size={18} />
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => printInvoice(activeInvoice.id)}
                      className="theme-button-primary px-5 py-3"
                    >
                      <Printer size={18} />
                      A4 Print
                    </button>
                    <button
                      type="button"
                      onClick={() => printThermal(activeInvoice.id)}
                      className="theme-button-secondary px-5 py-3"
                    >
                      <FileText size={18} />
                      POS Print
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
