import { useEffect, useRef, useState } from 'react';
import { Minus, Plus, Printer, Receipt, Search, Trash2 } from 'lucide-react';
import { useApp } from '../AppContext';
import { focusElement, handleSequentialEnter, handleShortcutKey } from '../utils/keyboardNavigation';

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

export default function BillingView() {
  const { data, mutateAndRefresh } = useApp();
  const [draftItems, setDraftItems] = useState([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [discount, setDiscount] = useState(0);
  const [paidAmount, setPaidAmount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [barcodeInput, setBarcodeInput] = useState('');
  const [isCustomerModalOpen, setCustomerModalOpen] = useState(false);
  const [customerForm, setCustomerForm] = useState({ name: '', phone: '', address: '', type: 'retail', gstin: '' });
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightedSuggestionIndex, setHighlightedSuggestionIndex] = useState(-1);
  const barcodeRef = useRef(null);
  const billingDetailsRef = useRef(null);
  const customerModalRef = useRef(null);

  const searchSuggestions =
    barcodeInput.trim().length > 1
      ? data.products
          .filter(
            (product) =>
              product.name.toLowerCase().includes(barcodeInput.toLowerCase()) ||
              product.barcode === barcodeInput ||
              product.sku.toLowerCase().includes(barcodeInput.toLowerCase())
          )
          .slice(0, 8)
      : [];

  const uiSettings = data.uiSettings || {};
  const billingGstEnabled = Boolean(uiSettings.billingGstEnabled);
  const billingGstRateRaw = Number(uiSettings.billingGstRate || 0);
  const billingGstRate =
    billingGstEnabled && Number.isFinite(billingGstRateRaw) ? Math.max(0, billingGstRateRaw) : 0;
  const subtotal = roundCurrency(draftItems.reduce((acc, item) => acc + item.price * item.qty, 0));
  const discountValue = roundCurrency(parseFloat(discount || 0) || 0);
  const taxableValue = roundCurrency(Math.max(0, subtotal - discountValue));
  const gstAmount = roundCurrency(billingGstEnabled ? (taxableValue * billingGstRate) / 100 : 0);
  const { primary: sgstRate, secondary: cgstRate } = splitTaxValue(billingGstRate);
  const { primary: sgstAmount, secondary: cgstAmount } = splitTaxValue(gstAmount);
  const total = roundCurrency(taxableValue + gstAmount);

  useEffect(() => {
    setPaidAmount(total);
  }, [total]);

  useEffect(() => {
    if (!showSuggestions || searchSuggestions.length === 0) {
      setHighlightedSuggestionIndex(-1);
      return;
    }

    setHighlightedSuggestionIndex((current) =>
      current >= 0 && current < searchSuggestions.length ? current : 0
    );
  }, [searchSuggestions.length, showSuggestions]);

  const addProductToCart = (product) => {
    const existing = draftItems.find((item) => item.productId === product.id);
    if (existing) {
      setDraftItems(
        draftItems.map((item) => (item.productId === product.id ? { ...item, qty: item.qty + 1 } : item))
      );
    } else {
      const packSize = Math.max(1, Number(product.packSize) || 1);
      const hasPackOption = Boolean(product.packEnabled) || packSize > 1;
      const loosePrice = Number(product.loosePrice || product.retailPrice) || 0;
      const packPrice = hasPackOption ? Number(product.packPrice) || loosePrice * packSize : loosePrice;

      setDraftItems([
        ...draftItems,
        {
          productId: product.id,
          name: product.name,
          loosePrice,
          packPrice,
          price: loosePrice,
          saleUnit: 'loose',
          hasPackOption,
          packSize,
          qty: 1,
          unit: product.unit
        }
      ]);
    }

    setBarcodeInput('');
    setShowSuggestions(false);
    setHighlightedSuggestionIndex(-1);
    barcodeRef.current?.focus();
  };

  const handleBarcodeSubmit = (e) => {
    e.preventDefault();
    if (!barcodeInput) return;

    const product =
      searchSuggestions[highlightedSuggestionIndex] ||
      searchSuggestions.find(
        (entry) => entry.barcode === barcodeInput || entry.sku.toLowerCase() === barcodeInput.toLowerCase()
      ) || searchSuggestions[0];

    if (product) {
      addProductToCart(product);
    } else {
      alert('Product not found with this barcode/SKU.');
      barcodeRef.current?.focus();
    }
  };

  const handleBarcodeKeyDown = (event) => {
    if (event.key === 'ArrowDown' && searchSuggestions.length > 0) {
      event.preventDefault();
      setShowSuggestions(true);
      setHighlightedSuggestionIndex((current) => (current + 1 + searchSuggestions.length) % searchSuggestions.length);
      return;
    }

    if (event.key === 'ArrowUp' && searchSuggestions.length > 0) {
      event.preventDefault();
      setShowSuggestions(true);
      setHighlightedSuggestionIndex((current) =>
        current <= 0 ? searchSuggestions.length - 1 : current - 1
      );
      return;
    }

    if (event.key === 'Escape' && showSuggestions) {
      event.preventDefault();
      setShowSuggestions(false);
      setHighlightedSuggestionIndex(-1);
    }
  };

  const submitQuickAddCustomer = async () => {
    if (!window.erpApi) return;

    const createdCustomer = await mutateAndRefresh(window.erpApi.upsertCustomer(customerForm));
    if (createdCustomer?.id) setSelectedCustomerId(createdCustomer.id);

    setCustomerModalOpen(false);
    setCustomerForm({ name: '', phone: '', address: '', type: 'retail', gstin: '' });
    focusElement(barcodeRef.current);
  };

  const handleQuickAddCustomer = async (e) => {
    e.preventDefault();
    await submitQuickAddCustomer();
  };

  const updateItemQty = (productId, delta) => {
    setDraftItems(
      draftItems.map((item) =>
        item.productId === productId ? { ...item, qty: Math.max(1, item.qty + delta) } : item
      )
    );
  };

  const removeItem = (productId) => {
    setDraftItems(draftItems.filter((item) => item.productId !== productId));
  };

  const toggleItemUnit = (productId) => {
    setDraftItems(
      draftItems.map((item) => {
        if (item.productId !== productId) return item;
        const nextUnit = item.saleUnit === 'loose' ? 'pack' : 'loose';
        return {
          ...item,
          saleUnit: nextUnit,
          price: nextUnit === 'pack' ? item.packPrice : item.loosePrice
        };
      })
    );
  };

  const autoPrintThermalReceipt = async (invoiceId) => {
    if (!uiSettings.thermalAutoPrintEnabled || !window.erpApi || !invoiceId) {
      return { status: 'disabled' };
    }

    const selectedPrinterName = String(uiSettings.thermalPrinterName || '').trim();

    try {
      const printers = unwrapIpcResponse(await window.erpApi.getPrinters());
      const availablePrinters = Array.isArray(printers) ? printers : [];

      if (availablePrinters.length === 0) {
        return { status: 'unavailable', message: 'No thermal printer detected.' };
      }

      if (
        selectedPrinterName &&
        !availablePrinters.some((printer) => String(printer?.name || '').trim() === selectedPrinterName)
      ) {
        return {
          status: 'unavailable',
          message: 'Selected thermal printer is not connected.'
        };
      }

      await unwrapIpcResponse(
        await window.erpApi.autoPrintInvoiceThermal({
          invoiceId,
          printerName: selectedPrinterName
        })
      );

      return { status: 'printed' };
    } catch (error) {
      return {
        status: 'failed',
        message: error.message || 'Thermal print failed.'
      };
    }
  };

  const handleCreateInvoice = async () => {
    if (draftItems.length === 0) {
      alert('Please add items to bill.');
      return;
    }

    const finalPaid = parseFloat(paidAmount || 0);
    const finalBalance = Math.max(0, total - finalPaid);
    const payload = {
      customerId: selectedCustomerId || null,
      items: draftItems.map((item) => ({
        productId: item.productId,
        qty: item.qty,
        unitPrice: item.price,
        lineTotal: item.price * item.qty,
        saleUnit: item.saleUnit
      })),
      discount: parseFloat(discount || 0),
      subtotal,
      taxableValue,
      gstEnabled: billingGstEnabled,
      gstRate: billingGstRate,
      total,
      paidAmount: finalPaid,
      balance: finalBalance,
      paidMethod: paymentMethod
    };

    if (!window.erpApi) return;

    try {
      const result = await mutateAndRefresh(window.erpApi.createInvoice(payload));
      setDraftItems([]);
      setDiscount(0);
      setPaidAmount(0);
      setSelectedCustomerId('');

      if (result?.id) {
        const thermalResult = await autoPrintThermalReceipt(result.id);

        if (thermalResult.status === 'printed') {
          alert('Invoice created and POS receipt printed automatically.');
          return;
        }

        if (thermalResult.status === 'unavailable') {
          alert(`Invoice created successfully. ${thermalResult.message}`);
          return;
        }

        if (thermalResult.status === 'failed') {
          alert(`Invoice created, but thermal print failed: ${thermalResult.message}`);
          return;
        }
      }

      alert('Invoice created successfully!');
    } catch {
      alert('Failed to create Invoice.');
    }
  };

  const handleBillingDetailsKeyDown = (event) => {
    if (handleShortcutKey(event, { onSubmit: () => void handleCreateInvoice() })) {
      return;
    }

    handleSequentialEnter(event, billingDetailsRef);
  };

  const handleCustomerModalKeyDown = (event) => {
    if (
      handleShortcutKey(event, {
        onSubmit: () => void submitQuickAddCustomer(),
        onEscape: () => setCustomerModalOpen(false)
      })
    ) {
      return;
    }

    handleSequentialEnter(event, customerModalRef);
  };

  return (
    <div className="flex h-full min-h-0 gap-4 overflow-hidden p-1 animate-in fade-in zoom-in-95 duration-500">
      <div className="glass-panel flex min-h-0 min-w-0 flex-[0.96] flex-col overflow-hidden">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Current Order</h2>
            <p className="panel-subtitle">Scan, search, and refine the bill before printing.</p>
          </div>
        </div>

        <div className="border-b border-[rgba(70,96,103,0.08)] px-5 pb-5">
          <form onSubmit={handleBarcodeSubmit} className="flex gap-4">
            <div className="theme-search relative flex-1">
              <Search size={20} className="text-[var(--ink-soft)]" />
              <input
                ref={barcodeRef}
                autoFocus
                placeholder="Scan barcode or type name/SKU..."
                className="theme-search-input text-lg"
                value={barcodeInput}
                onChange={(e) => {
                  setBarcodeInput(e.target.value);
                  setShowSuggestions(true);
                  setHighlightedSuggestionIndex(0);
                }}
                onKeyDown={handleBarcodeKeyDown}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
              />

              {showSuggestions && searchSuggestions.length > 0 && (
                <div className="absolute left-0 right-0 top-full z-50 mt-2 max-h-64 overflow-y-auto rounded-[1.2rem] border border-[rgba(70,96,103,0.12)] bg-[rgba(255,252,246,0.98)] shadow-2xl">
                  {searchSuggestions.map((suggestion, index) => (
                    <div
                      key={suggestion.id}
                      onClick={() => addProductToCart(suggestion)}
                      onMouseEnter={() => setHighlightedSuggestionIndex(index)}
                      className={`flex cursor-pointer items-center justify-between border-b border-[rgba(70,96,103,0.06)] px-4 py-3 transition-colors hover:bg-primary-50 ${
                        index === highlightedSuggestionIndex ? 'suggestion-item-active' : ''
                      }`}
                    >
                      <div>
                        <p className="font-bold text-[var(--ink)]">{suggestion.name}</p>
                        <p className="text-xs font-semibold text-[var(--ink-soft)]">{suggestion.sku || suggestion.barcode || 'No SKU'}</p>
                      </div>
                      <p className="font-black text-emerald-700">₹{suggestion.retailPrice.toFixed(2)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button type="submit" className="theme-button-primary min-w-28">
              Add
            </button>
          </form>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {draftItems.length === 0 ? (
            <div className="empty-state h-full">
              <Receipt size={64} className="opacity-50" />
              <p className="text-xl font-bold text-[var(--ink)]">Scan an item to begin billing</p>
              <p className="max-w-sm text-sm">Your line items, quantity changes, and price adjustments will appear here.</p>
            </div>
          ) : (
            <table className="w-full border-collapse text-left">
              <thead className="table-head sticky top-0 z-10">
                <tr>
                  <th className="table-header-cell">Item</th>
                  <th className="table-header-cell text-center">Qty</th>
                  <th className="table-header-cell text-right">Price</th>
                  <th className="table-header-cell text-right">Total</th>
                  <th className="table-header-cell" />
                </tr>
              </thead>
              <tbody className="table-body divide-y divide-[rgba(70,96,103,0.08)]">
                {draftItems.map((item) => (
                  <tr key={item.productId} className="table-row">
                    <td className="px-5 py-3.5">
                      <div className="text-lg font-semibold text-[var(--ink)]">{item.name}</div>
                      {item.hasPackOption && (
                        <div className="mt-2 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => toggleItemUnit(item.productId)}
                            className={`badge ${item.saleUnit === 'pack' ? 'badge-blue' : 'badge-amber'}`}
                          >
                            {item.saleUnit === 'pack' ? `Pack (${item.packSize})` : 'Loose'}
                          </button>
                          <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--ink-soft)]">Tap to switch</span>
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-center gap-3">
                        <button type="button" onClick={() => updateItemQty(item.productId, -1)} className="rounded-xl p-1.5 text-[var(--ink-soft)] transition hover:bg-[rgba(226,235,233,0.9)]">
                          <Minus size={16} />
                        </button>
                        <span className="w-6 text-center text-lg font-bold text-[var(--ink)]">{item.qty}</span>
                        <button type="button" onClick={() => updateItemQty(item.productId, 1)} className="rounded-xl p-1.5 text-[var(--ink-soft)] transition hover:bg-[rgba(226,235,233,0.9)]">
                          <Plus size={16} />
                        </button>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-right font-medium text-[var(--ink-soft)]">₹{item.price.toFixed(2)}</td>
                    <td className="px-5 py-3.5 text-right text-lg font-bold text-primary-700">₹{(item.price * item.qty).toFixed(2)}</td>
                    <td className="px-5 py-3.5 text-right">
                      <button type="button" onClick={() => removeItem(item.productId)} className="rounded-xl p-2 text-[var(--ink-soft)] transition hover:bg-rose-100 hover:text-rose-700">
                        <Trash2 size={20} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div
        ref={billingDetailsRef}
        data-enter-nav-root
        onKeyDown={handleBillingDetailsKeyDown}
        className="glass-panel flex min-h-0 w-[376px] shrink-0 flex-col overflow-hidden p-3.5 xl:w-[408px] xl:p-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[1.75rem] font-semibold leading-none text-[var(--ink)] xl:text-[1.9rem]">Invoice Details</h3>
            <p className="mt-1 text-xs text-[var(--ink-soft)]">Choose a customer, collect payment, then print the final bill.</p>
          </div>
          
        </div>

        <div className="mt-3 flex min-h-0 flex-1 flex-col justify-between gap-2.5 overflow-y-auto pr-1">
          <div className="space-y-2.5">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--ink-soft)]">Customer</label>
              <button type="button" onClick={() => setCustomerModalOpen(true)} className="badge badge-blue">
                Quick Add
              </button>
            </div>
            <select
              data-enter-nav
              value={selectedCustomerId}
              onChange={(e) => setSelectedCustomerId(e.target.value)}
              className="theme-select py-3"
            >
              <option value="">Walk-in Customer</option>
              {data.customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name} {customer.phone ? `(${customer.phone})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="h-px w-full bg-[rgba(70,96,103,0.08)]" />

          <div className="flex items-center justify-between text-[var(--ink-soft)]">
            <span className="text-sm font-medium">Subtotal</span>
            <span className="text-lg font-bold text-[var(--ink)]">₹{subtotal.toFixed(2)}</span>
          </div>

          <div className="flex items-center justify-between gap-4">
            <span className="text-sm font-medium text-[var(--ink-soft)]">Discount (₹)</span>
            <input
              data-enter-nav
              type="number"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
              className="theme-input w-24 px-3 py-2 text-right text-sm font-bold"
            />
          </div>

          {billingGstEnabled && (
            <>
              <div className="flex items-center justify-between text-[var(--ink-soft)]">
                <span className="text-sm font-medium">Taxable Value</span>
                <span className="text-lg font-bold text-[var(--ink)]">₹{taxableValue.toFixed(2)}</span>
              </div>

              <div className="flex items-center justify-between text-[var(--ink-soft)]">
                <span className="text-sm font-medium">{`SGST (${sgstRate.toFixed(2)}%)`}</span>
                <span className="text-lg font-bold text-primary-700">₹{sgstAmount.toFixed(2)}</span>
              </div>

              <div className="flex items-center justify-between text-[var(--ink-soft)]">
                <span className="text-sm font-medium">{`CGST (${cgstRate.toFixed(2)}%)`}</span>
                <span className="text-lg font-bold text-primary-700">₹{cgstAmount.toFixed(2)}</span>
              </div>
            </>
          )}

          <div className="h-px w-full bg-[rgba(70,96,103,0.08)]" />

          <div className="rounded-[1.15rem] border border-primary-200 bg-primary-50 px-3.5 py-3">
            <div className="flex items-center justify-between">
              <span className="text-base font-bold text-primary-800">Net Total</span>
              <span className="text-[1.55rem] font-black tracking-tight text-primary-700">₹{total.toFixed(2)}</span>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-[var(--ink-soft)]">Amount Tendered</span>
              <input
                data-enter-nav
                type="number"
                value={paidAmount}
                onChange={(e) => setPaidAmount(e.target.value)}
                className="theme-input w-28 px-3 py-2 text-right text-base font-bold text-emerald-700"
              />
            </div>

            <div className="flex flex-wrap justify-end gap-1.5">
              {[50, 100, 500, 2000, 'Exact'].map((amount) => (
                <button
                  key={amount}
                  type="button"
                  onClick={() => setPaidAmount(amount === 'Exact' ? total : Number(paidAmount) + amount)}
                  className="theme-button-ghost px-2.5 py-1 text-[10px] uppercase tracking-[0.12em]"
                >
                  {amount === 'Exact' ? 'Exact Total' : `+₹${amount}`}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-[var(--ink-soft)]">Payment Mode</span>
            <select
              data-enter-nav
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className="theme-select w-28 px-3 py-2 text-sm"
            >
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
              <option value="card">Card</option>
            </select>
          </div>

          <div className="flex items-center justify-between rounded-[1.05rem] border border-[rgba(70,96,103,0.08)] bg-[rgba(245,248,245,0.82)] px-3.5 py-3 text-[var(--ink-soft)]">
            <span className="text-sm font-medium">{Number(paidAmount) > total ? 'Change Return' : 'Balance / Due'}</span>
            <span className={`text-lg font-bold ${Number(paidAmount) > total ? 'text-amber-700' : 'text-[var(--ink)]'}`}>
              ₹{Math.abs(Number(paidAmount) - total).toFixed(2)}
            </span>
          </div>
          </div>
        </div>

        <div className="mt-3 shrink-0">
          <button
            data-enter-nav
            type="button"
            onClick={handleCreateInvoice}
            className="theme-button-primary w-full py-3.5 text-base"
          >
            <Printer size={20} />
            Generate Invoice
          </button>
        </div>
      </div>

      {isCustomerModalOpen && (
        <div className="modal-backdrop">
          <div className="modal-panel max-w-sm p-6">
            <h3 className="mb-4 text-4xl font-semibold text-[var(--ink)]">Quick Add Customer</h3>
            <form
              ref={customerModalRef}
              data-enter-nav-root
              onSubmit={handleQuickAddCustomer}
              onKeyDown={handleCustomerModalKeyDown}
              className="space-y-4"
            >
              <div>
                <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Name</label>
                <input
                  data-enter-nav
                  autoFocus
                  required
                  value={customerForm.name}
                  onChange={(e) => setCustomerForm({ ...customerForm, name: e.target.value })}
                  className="theme-input"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Phone</label>
                <input
                  data-enter-nav
                  value={customerForm.phone}
                  onChange={(e) => setCustomerForm({ ...customerForm, phone: e.target.value })}
                  className="theme-input"
                />
              </div>
              <div className="mt-6 flex justify-end gap-3">
                <button type="button" onClick={() => setCustomerModalOpen(false)} className="theme-button-ghost px-5 py-2.5">
                  Cancel
                </button>
                <button data-enter-nav type="submit" className="theme-button-primary px-5 py-2.5">
                  Add
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
