import { useState, useRef } from 'react';
import { useApp } from '../AppContext';
import { Truck, PlusCircle, Trash2, Search, Plus, Minus } from 'lucide-react';
import { focusElement, handleSequentialEnter, handleShortcutKey } from '../utils/keyboardNavigation';
import { buildProductCategoryOptions, resolveCategorySelectValue } from '../utils/productCategories';

function getIpcErrorMessage(response, fallback) {
  const raw = String(response?.error || fallback || 'Unexpected error').trim();
  return raw.split('\n')[0].trim() || fallback;
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

export default function PurchasesView() {
  const { data, mutateAndRefresh } = useApp();
  const [isModalOpen, setModalOpen] = useState(false);
  const [activePurchaseId, setActivePurchaseId] = useState(null);
  const [form, setForm] = useState({ supplierId: '', paidAmount: 0, itemsJson: '', gstEnabled: false, gstRate: '' });
  const [draftItems, setDraftItems] = useState([]);
  
  // Search state for Purchase items
  const [searchInput, setSearchInput] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightedSuggestionIndex, setHighlightedSuggestionIndex] = useState(-1);
  const searchRef = useRef(null);
  const purchaseModalRef = useRef(null);
  const lineItemGridRef = useRef(null);
  const footerActionsRef = useRef(null);
  const quickProductModalRef = useRef(null);
  const supplierSelectRef = useRef(null);
  const gstCheckboxRef = useRef(null);
  const gstRateRef = useRef(null);
  const paidAmountRef = useRef(null);
  const savePurchaseButtonRef = useRef(null);
  const purchaseDetailModalRef = useRef(null);

  const searchSuggestions = searchInput.trim().length > 1 ? data.products.filter(p => 
    p.name.toLowerCase().includes(searchInput.toLowerCase()) || 
    p.barcode === searchInput || 
    (p.sku && p.sku.toLowerCase().includes(searchInput.toLowerCase()))
  ).slice(0, 8) : [];

  const activePurchase = activePurchaseId
    ? data.purchases.find((purchase) => purchase.id === activePurchaseId) || null
    : null;
  const activeSupplier = activePurchase
    ? data.suppliers.find((supplier) => supplier.id === activePurchase.supplierId) || null
    : null;
  const activeSupplierName =
    activeSupplier?.name ||
    activePurchase?.supplierSnapshot?.name ||
    'Walk-in Vendor';
  const activeSupplierPhone = activeSupplier?.phone || activePurchase?.supplierSnapshot?.phone || '';
  const activeSupplierGstin = activeSupplier?.gstin || activePurchase?.supplierSnapshot?.gstin || '';
  const activeSupplierAddress = activeSupplier?.address || activePurchase?.supplierSnapshot?.address || '';
  const activePurchaseBalance = activePurchase
    ? roundCurrency(activePurchase.balance || activePurchase.dueAmount || 0)
    : 0;
  const activePurchaseTaxableValue = activePurchase
    ? roundCurrency(activePurchase.taxableValue || Math.max((activePurchase.subtotal || 0) - (activePurchase.discount || 0), 0))
    : 0;
  const activePurchaseGstRate = activePurchase ? roundCurrency(activePurchase.gstRate || 0) : 0;
  const activePurchaseGstAmount = activePurchase ? roundCurrency(activePurchase.gstAmount || 0) : 0;
  const { primary: activePurchaseSgstRate, secondary: activePurchaseCgstRate } = splitTaxValue(activePurchaseGstRate);
  const { primary: activePurchaseSgstAmount, secondary: activePurchaseCgstAmount } = splitTaxValue(activePurchaseGstAmount);

  const searchSuggestionCount = searchSuggestions.length;

  const addProductToDraft = (product) => {
    const existing = draftItems.find(item => item.productId === product.id);
    if (existing) {
      setDraftItems(draftItems.map(item => 
        item.productId === product.id ? { ...item, qty: item.qty + 1 } : item
      ));
    } else {
      setDraftItems([...draftItems, { 
        productId: product.id, 
        name: product.name, 
        price: product.costPrice > 0 ? product.costPrice : product.wholesalePrice || product.retailPrice, 
        qty: 1,
        unit: product.unit
      }]);
    }
    setSearchInput('');
    setShowSuggestions(false);
    setHighlightedSuggestionIndex(-1);
    searchRef.current?.focus();
  };

  const handleSearchKeyDown = (event) => {
    if (event.key === 'ArrowDown' && searchSuggestionCount > 0) {
      event.preventDefault();
      setShowSuggestions(true);
      setHighlightedSuggestionIndex((current) => (current + 1 + searchSuggestionCount) % searchSuggestionCount);
      return;
    }

    if (event.key === 'ArrowUp' && searchSuggestionCount > 0) {
      event.preventDefault();
      setShowSuggestions(true);
      setHighlightedSuggestionIndex((current) => (current <= 0 ? searchSuggestionCount - 1 : current - 1));
      return;
    }

    if (event.key === 'Escape' && showSuggestions) {
      event.preventDefault();
      setShowSuggestions(false);
      setHighlightedSuggestionIndex(-1);
    }
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (!searchInput) return;
    
    const product = searchSuggestions[highlightedSuggestionIndex] || searchSuggestions.find(p => 
      p.barcode === searchInput || (p.sku && p.sku.toLowerCase() === searchInput.toLowerCase())
    ) || searchSuggestions[0];

    if (product) {
      addProductToDraft(product);
    } else {
      alert("Product not found.");
    }
  };

  const updateItemQty = (productId, nextQty) => {
    setDraftItems(draftItems.map(item => {
      if (item.productId === productId) {
        const parsedQty = Number(nextQty);
        return { ...item, qty: Number.isFinite(parsedQty) && parsedQty > 0 ? parsedQty : 1 };
      }
      return item;
    }));
  };

  const updateItemPrice = (productId, newPrice) => {
    setDraftItems(draftItems.map(item => {
      if (item.productId === productId) {
         return { ...item, price: Number(newPrice) || 0 };
      }
      return item;
    }));
  }

  const removeItem = (productId) => setDraftItems(draftItems.filter(item => item.productId !== productId));

  const subtotal = roundCurrency(draftItems.reduce((sum, item) => sum + (item.price * item.qty), 0));
  const gstRate = form.gstEnabled ? Math.max(0, Number(form.gstRate || 0)) : 0;
  const gstAmount = form.gstEnabled ? roundCurrency((subtotal * gstRate) / 100) : 0;
  const { primary: sgstRate, secondary: cgstRate } = splitTaxValue(gstRate);
  const { primary: sgstAmount, secondary: cgstAmount } = splitTaxValue(gstAmount);
  const totalBill = roundCurrency(subtotal + gstAmount);

  const submitPurchase = async () => {
    if (draftItems.length === 0 && !form.itemsJson) {
       return alert("Please add items or scan an OCR bill to save the purchase.");
    }

    if (window.erpApi) {
       try {
         const finalSubtotal = subtotal;
         const finalGstAmount = gstAmount;
         const finalTotal = totalBill;
         const balance = Math.max(0, finalTotal - Number(form.paidAmount || 0));
         
         await mutateAndRefresh(window.erpApi.createPurchase({
            ...form,
            notes: form.itemsJson,
            items: draftItems.map(item => ({
              productId: item.productId,
              qty: item.qty,
              unitCost: Number(item.price) || 0,
              lineTotal: item.price * item.qty,
              purchaseUnit: item.unit
            })),
            subtotal: finalSubtotal,
            total: finalTotal,
            taxableValue: finalSubtotal,
            gstRate,
            gstAmount: finalGstAmount,
            balance: balance,
            dueAmount: balance,
            paidMethod: 'cash'
         }));
       } catch (err) {
         alert(err.message || 'Failed to save purchase');
         return false;
       }
    }
    setModalOpen(false);
    setDraftItems([]);
    setForm({ supplierId: '', paidAmount: 0, itemsJson: '', gstEnabled: false, gstRate: '' });
    return true;
  };

  const handleSave = async (e) => {
    e.preventDefault();
    await submitPurchase();
  };

  const [isProdModalOpen, setProdModalOpen] = useState(false);
  const [isFetchingQuickBarcodeLookup, setIsFetchingQuickBarcodeLookup] = useState(false);
  const [quickBarcodeLookupMessage, setQuickBarcodeLookupMessage] = useState('');
  const [prodForm, setProdForm] = useState({
    name: '', sku: '', barcode: '', hsnCode: '', category: 'General', unit: 'Unit',
    costPrice: '', retailPrice: '', wholesalePrice: '', stock: '',
    packEnabled: false, packSize: '', packPrice: ''
  });
  const productCategoryOptions = buildProductCategoryOptions(data.products);
  const quickAddCategorySelectValue = resolveCategorySelectValue(prodForm.category, productCategoryOptions);

  const submitQuickAddProduct = async () => {
    if (window.erpApi) {
      try {
        const retailPrice = Number(prodForm.retailPrice) || 0;
        const costPrice = Number(prodForm.costPrice) || 0;
        const payload = {
           ...prodForm,
           costPrice,
           retailPrice,
           wholesalePrice: Number(prodForm.wholesalePrice) || retailPrice || costPrice,
           stock: Number(prodForm.stock) || 0,
           packSize: prodForm.packEnabled ? (Number(prodForm.packSize) || 1) : 1,
           packPrice: prodForm.packEnabled ? (Number(prodForm.packPrice) || 0) : 0,
           loosePrice: retailPrice
        };
        const createdProduct = await mutateAndRefresh(window.erpApi.upsertProduct(payload));
        if (createdProduct) {
          addProductToDraft(createdProduct);
        }
        setProdModalOpen(false);
        setQuickBarcodeLookupMessage('');
        setProdForm({ 
          name: '', sku: '', barcode: '', hsnCode: '', category: 'General', unit: 'Unit',
          costPrice: '', retailPrice: '', wholesalePrice: '', stock: '',
          packEnabled: false, packSize: '', packPrice: ''
        });
      } catch (error) {
        alert(error.message || 'Failed to save product');
      }
    }
  };

  const applyLookupToQuickProductForm = (lookup) => {
    setProdForm((current) => ({
      ...current,
      barcode: lookup?.barcode || current.barcode,
      name: current.name || lookup?.name || current.name,
      category:
        !current.category || current.category === 'General'
          ? lookup?.category || current.category
          : current.category,
      unit:
        !current.unit || current.unit === 'Unit'
          ? lookup?.unitHint || current.unit
          : current.unit
    }));
  };

  const handleFetchQuickBarcodeDetails = async () => {
    if (!window.erpApi?.lookupOpenFoodFactsProduct) {
      alert('Restart the app to load Open Facts barcode lookup.');
      return;
    }

    try {
      setIsFetchingQuickBarcodeLookup(true);
      setQuickBarcodeLookupMessage('');
      const response = await window.erpApi.lookupOpenFoodFactsProduct({ barcode: prodForm.barcode });
      if (!response?.ok) {
        throw new Error(getIpcErrorMessage(response, 'Barcode lookup failed'));
      }

      applyLookupToQuickProductForm(response.data);
      const sourceLabel = response.data?.source || 'product lookup';
      setQuickBarcodeLookupMessage(
        `${sourceLabel}${response.data?.quantityLabel ? ` • ${response.data.quantityLabel}` : ''}`
      );
    } catch (error) {
      setQuickBarcodeLookupMessage('');
      alert(error.message || 'Failed to fetch product details from Open Facts');
    } finally {
      setIsFetchingQuickBarcodeLookup(false);
    }
  };

  const handleQuickAddProduct = async (e) => {
    e.preventDefault();
    await submitQuickAddProduct();
  };

  const handleSupplierKeyDown = (event) => {
    if (handleShortcutKey(event, { onSubmit: () => void submitPurchase(), onEscape: () => setModalOpen(false) })) {
      return;
    }

    if (event.key === 'Enter' && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      event.preventDefault();
      focusElement(searchRef.current);
    }
  };

  const handleLineItemKeyDown = (event) => {
    if (handleShortcutKey(event, { onSubmit: () => void submitPurchase(), onEscape: () => setModalOpen(false) })) {
      return;
    }

    handleSequentialEnter(event, lineItemGridRef, { onComplete: () => focusElement(searchRef.current) });
  };

  const handleFooterKeyDown = (event) => {
    if (handleShortcutKey(event, { onSubmit: () => void submitPurchase(), onEscape: () => setModalOpen(false) })) {
      return;
    }

    handleSequentialEnter(event, footerActionsRef);
  };

  const handlePurchaseModalKeyDown = (event) => {
    if (isProdModalOpen) {
      return;
    }

    handleShortcutKey(event, {
      onSubmit: () => void submitPurchase(),
      onEscape: () => setModalOpen(false)
    });
  };

  const handleGstCheckboxKeyDown = (event) => {
    if (handleShortcutKey(event, { onSubmit: () => void submitPurchase(), onEscape: () => setModalOpen(false) })) {
      return;
    }

    if (event.key !== 'Enter' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }

    event.preventDefault();
    const nextEnabled = !form.gstEnabled;
    setForm((current) => ({
      ...current,
      gstEnabled: nextEnabled,
      gstRate: nextEnabled ? current.gstRate : ''
    }));

    requestAnimationFrame(() => {
      focusElement(nextEnabled ? gstRateRef.current : paidAmountRef.current);
    });
  };

  const handleQuickProductModalKeyDown = (event) => {
    if (
      handleShortcutKey(event, {
        onSubmit: () => void submitQuickAddProduct(),
        onEscape: () => setProdModalOpen(false)
      })
    ) {
      return;
    }

    handleSequentialEnter(event, quickProductModalRef);
  };

  const handlePurchaseRowKeyDown = (event, purchaseId) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();
    setActivePurchaseId(purchaseId);
  };

  const handlePurchaseDetailKeyDown = (event) => {
    handleShortcutKey(event, {
      onEscape: () => setActivePurchaseId(null)
    });
  };

  return (
    <div className="flex flex-col h-full animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-2xl font-bold text-slate-800">Purchases Ledger</h2>
        <button onClick={() => setModalOpen(true)} className="flex items-center gap-2 px-5 py-2.5 bg-primary-600 text-white font-semibold rounded-xl hover:bg-primary-700 transition shadow-sm">
          <PlusCircle size={20} /> Record Purchase
        </button>
      </div>

      <div className="flex-1 glass-panel overflow-y-auto">
        <table className="w-full text-left border-collapse">
          <thead className="bg-slate-50/80 sticky top-0 backdrop-blur-md border-b border-slate-200">
            <tr>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Supplier</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Date</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Total (₹)</th>
              <th className="px-6 py-4 text-xs font-bold text-emerald-600 uppercase tracking-wider text-right">Paid (₹)</th>
              <th className="px-6 py-4 text-xs font-bold text-rose-500 uppercase tracking-wider text-right">Balance (₹)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.purchases.length === 0 && (
               <tr><td colSpan="5" className="text-center py-20 text-slate-400 font-medium">No purchases recorded yet.</td></tr>
            )}
            {data.purchases.map(p => {
               const sup = data.suppliers.find(s => s.id === p.supplierId);
               return (
                <tr
                  key={p.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setActivePurchaseId(p.id)}
                  onKeyDown={(event) => handlePurchaseRowKeyDown(event, p.id)}
                  className="cursor-pointer hover:bg-slate-50 transition-colors focus:outline-none focus:bg-slate-50"
                >
                  <td className="px-6 py-4 font-bold text-slate-800">{sup?.name || 'Walk-in Vendor'}</td>
                  <td className="px-6 py-4 font-medium text-slate-500">{new Date(p.createdAt).toLocaleDateString()}</td>
                  <td className="px-6 py-4 font-black text-slate-700 text-right">{p.total.toFixed(2)}</td>
                  <td className="px-6 py-4 font-bold text-emerald-600 text-right">{p.paidAmount.toFixed(2)}</td>
                  <td className="px-6 py-4 font-black text-rose-500 text-right">{p.balance > 0 ? p.balance.toFixed(2) : '-'}</td>
                </tr>
               )
            })}
          </tbody>
        </table>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-[2px] p-4">
          <div
            ref={purchaseModalRef}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl p-0 flex flex-col max-h-[90vh] overflow-hidden"
            onKeyDown={handlePurchaseModalKeyDown}
          >
             
             <div className="p-6 bg-slate-50 flex justify-between items-center border-b border-slate-100">
                <h3 className="text-xl font-bold text-slate-800">Record Purchase Entry</h3>
                <button
                  type="button"
                  onClick={() => {
                    setQuickBarcodeLookupMessage('');
                    setProdModalOpen(true);
                  }}
                  className="text-sm font-bold text-primary-600 hover:text-primary-700 bg-white border border-primary-100 px-3 py-1.5 rounded-lg flex items-center gap-1 shadow-sm"
                >
                  <PlusCircle size={14}/> Add New Product
                </button>
             </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div className="flex gap-4">
                <div className="w-1/3">
                  <label className="block text-sm font-bold text-slate-600 mb-1">Supplier <span className="text-rose-500">*</span></label>
                  <select
                    ref={supplierSelectRef}
                    value={form.supplierId}
                    required
                    onChange={e => setForm({...form, supplierId: e.target.value})}
                    onKeyDown={handleSupplierKeyDown}
                    className="w-full px-4 py-2 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-primary-500/20 font-medium"
                  >
                     <option value="">Walk-in Vendor</option>
                     {data.suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                
                <div className="flex-1">
                  <label className="block text-sm font-bold text-slate-600 mb-1">Search Products to Add</label>
                  <form onSubmit={handleSearchSubmit} className="relative">
                    <div className="flex items-center gap-3 bg-white px-4 py-2 rounded-xl border border-slate-200 focus-within:ring-2 ring-primary-500/20 shadow-sm">
                      <Search size={18} className="text-slate-400" />
                      <input 
                        ref={searchRef}
                        autoFocus
                        placeholder="Scan Barcode or type Name/SKU..." 
                        className="w-full outline-none bg-transparent text-slate-800 font-medium"
                        value={searchInput}
                        onChange={e => {
                          setSearchInput(e.target.value);
                          setShowSuggestions(true);
                          setHighlightedSuggestionIndex(0);
                        }}
                        onKeyDown={handleSearchKeyDown}
                        onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                      />
                    </div>
                    {showSuggestions && searchSuggestions.length > 0 && (
                      <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-xl border border-slate-100 overflow-hidden z-50">
                        {searchSuggestions.map((s, index) => (
                          <div
                            key={s.id}
                            onClick={() => addProductToDraft(s)}
                            onMouseEnter={() => setHighlightedSuggestionIndex(index)}
                            className={`px-4 py-3 hover:bg-slate-50 cursor-pointer border-b border-slate-50 flex justify-between items-center ${
                              index === highlightedSuggestionIndex ? 'suggestion-item-active' : ''
                            }`}
                          >
                            <div>
                              <p className="font-bold text-slate-800">{s.name}</p>
                            </div>
                            <p className="font-bold text-slate-500">Stock: {s.stock}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </form>
                </div>
              </div>

              {/* Line Items Grid */}
              <div ref={lineItemGridRef} data-enter-nav-root className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">
                <table className="w-full text-left">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase">Item Name</th>
                      <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase text-center w-32">Qty</th>
                      <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase text-right w-32">Cost Price (₹)</th>
                      <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase text-right w-32">Line Total</th>
                      <th className="px-4 py-3 w-12"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {draftItems.length === 0 ? (
                      <tr><td colSpan="5" className="text-center py-8 text-slate-400 font-medium">Search mapping above or append OCR fallback.</td></tr>
                    ) : draftItems.map(item => (
                      <tr key={item.productId} className="hover:bg-slate-50/50">
                        <td className="px-4 py-3 font-bold text-slate-800">{item.name}</td>
                        <td className="px-4 py-3">
                           <div className="flex items-center justify-center gap-2">
                             <button onClick={() => updateItemQty(item.productId, item.qty - 1)} className="p-1 text-slate-400 hover:bg-slate-200 rounded"><Minus size={14}/></button>
                             <input
                               data-enter-nav
                               type="number"
                               min="0.01"
                               step="0.01"
                               value={item.qty}
                               onChange={e => updateItemQty(item.productId, e.target.value)}
                               onKeyDown={handleLineItemKeyDown}
                               className="w-16 rounded-md border border-slate-200 bg-white px-2 py-1 text-center font-bold text-slate-800 outline-none focus:border-primary-500"
                             />
                             <button onClick={() => updateItemQty(item.productId, item.qty + 1)} className="p-1 text-slate-400 hover:bg-slate-200 rounded"><Plus size={14}/></button>
                           </div>
                        </td>
                        <td className="px-4 py-3">
                           <input
                             data-enter-nav
                             type="number"
                             step="0.01"
                             value={item.price}
                             onChange={e => updateItemPrice(item.productId, e.target.value)}
                             onKeyDown={handleLineItemKeyDown}
                             className="w-full text-right bg-transparent outline-none font-medium border-b border-dashed border-slate-300 focus:border-primary-500"
                           />
                        </td>
                        <td className="px-4 py-3 font-bold text-slate-800 text-right">{(item.price * item.qty).toFixed(2)}</td>
                        <td className="px-4 py-3 text-right">
                           <button onClick={() => removeItem(item.productId)} className="text-slate-400 hover:text-rose-500"><Trash2 size={16} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="bg-blue-50/50 p-4 border border-blue-100 rounded-xl">
                 <div className="flex justify-between items-center mb-2">
                    <label className="block text-sm font-bold text-slate-600">Smart OCR Extract Notes</label>
                    <input type="file" id="ocrInput" accept="image/png, image/jpeg" className="hidden" onChange={async (e) => {
                       const file = e.target.files[0];
                       if (!file) return;
                       try {
                         const rawRes = await window.erpApi?.extractEnglishOcr({ imagePath: file.path });
                         if (rawRes?.success) {
                           setForm({ ...form, itemsJson: form.itemsJson ? form.itemsJson + "\n" + rawRes.text : rawRes.text });
                           alert('OCR text extracted to notes!');
                         } else {
                           alert('OCR failed: ' + (rawRes?.error || 'Unknown error'));
                         }
                       } catch {
                         alert('OCR module not loaded successfully.');
                       }
                    }} />
                    <button type="button" onClick={() => document.getElementById('ocrInput').click()} className="text-xs font-bold bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700 shadow-sm">Scan physical invoice</button>
                 </div>
                 <textarea placeholder="Line items not added locally can be left as OCR fallback notes for compliance..." value={form.itemsJson || ''} onChange={e => setForm({...form, itemsJson: e.target.value})} rows={2} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 ring-primary-500/20" />
              </div>
            </div>

            <div ref={footerActionsRef} data-enter-nav-root className="p-6 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
              <div className="flex flex-wrap items-end gap-6">
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
                  <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
                    <input
                      ref={gstCheckboxRef}
                      type="checkbox"
                      checked={Boolean(form.gstEnabled)}
                      onChange={e => setForm({ ...form, gstEnabled: e.target.checked, gstRate: e.target.checked ? form.gstRate : '' })}
                      onKeyDown={handleGstCheckboxKeyDown}
                      className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500/20"
                    />
                    Add GST (split as SGST + CGST)
                  </label>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">Total GST Rate (%)</p>
                  <input
                    ref={gstRateRef}
                    data-enter-nav
                    type="number"
                    min="0"
                    step="0.01"
                    disabled={!form.gstEnabled}
                    value={form.gstRate || ''}
                    onChange={e => setForm({ ...form, gstRate: e.target.value })}
                    onKeyDown={handleFooterKeyDown}
                    className="w-28 px-3 py-1 border border-slate-200 rounded-lg font-bold text-primary-700 text-lg outline-none focus:ring-2 focus:ring-primary-500/20 bg-white disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                  />
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">Subtotal (₹)</p>
                  <p className="text-2xl font-black text-slate-800">{subtotal.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">{`SGST (${sgstRate.toFixed(2)}%)`}</p>
                  <p className="text-2xl font-black text-primary-700">{sgstAmount.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">{`CGST (${cgstRate.toFixed(2)}%)`}</p>
                  <p className="text-2xl font-black text-primary-700">{cgstAmount.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">Total Bill (₹)</p>
                  <p className="text-2xl font-black text-slate-800">{totalBill.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">Amount Paid (₹)</p>
                  <input
                    ref={paidAmountRef}
                    data-enter-nav
                    type="number"
                    value={form.paidAmount || ''}
                    onChange={e => setForm({...form, paidAmount: e.target.value})}
                    onKeyDown={handleFooterKeyDown}
                    className="w-32 px-3 py-1 border border-slate-200 rounded-lg font-bold text-emerald-600 text-xl outline-none focus:ring-2 focus:ring-emerald-500/20 bg-white"
                  />
                </div>
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => setModalOpen(false)} className="px-6 py-2.5 font-semibold text-slate-500 hover:bg-slate-200 rounded-xl transition">Cancel</button>
                <button
                  ref={savePurchaseButtonRef}
                  data-enter-nav
                  onKeyDown={handleFooterKeyDown}
                  onClick={handleSave}
                  className="px-6 py-2.5 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-bold shadow-lg shadow-primary-600/30 transition active:scale-95"
                >
                  Save Purchase Ledger
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {activePurchase && (
        <div className="modal-backdrop">
          <div
            ref={purchaseDetailModalRef}
            onKeyDown={handlePurchaseDetailKeyDown}
            className="modal-panel max-w-5xl"
          >
            <div className="modal-header">
              <div>
                <h3 className="modal-title">Purchase Details</h3>
                <p className="mt-1 text-sm font-medium text-[var(--ink-soft)]">
                  {activePurchase.purchaseNo || activePurchase.id}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActivePurchaseId(null)}
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
                      <p className="muted-kicker">Supplier</p>
                      <h4 className="mt-2 text-3xl font-semibold text-[var(--ink)]">{activeSupplierName}</h4>
                      <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">
                        {activeSupplierAddress || 'No saved address'}
                      </p>
                    </div>
                    <div className="space-y-2 text-right text-sm text-[var(--ink-soft)]">
                      <p><span className="font-semibold text-[var(--ink)]">Phone:</span> {activeSupplierPhone || '-'}</p>
                      <p><span className="font-semibold text-[var(--ink)]">GSTIN:</span> {activeSupplierGstin || '-'}</p>
                      <p><span className="font-semibold text-[var(--ink)]">Date:</span> {formatDateTime(activePurchase.createdAt)}</p>
                      <p><span className="font-semibold text-[var(--ink)]">Paid Via:</span> {(activePurchase.paidMethod || 'cash').toUpperCase()}</p>
                    </div>
                  </div>
                </div>

                <div className="section-card overflow-hidden">
                  <div className="border-b border-[rgba(70,96,103,0.08)] px-5 py-4">
                    <h4 className="text-2xl font-semibold text-[var(--ink)]">Purchase Items</h4>
                    <p className="mt-1 text-sm text-[var(--ink-soft)]">
                      {Array.isArray(activePurchase.items) ? activePurchase.items.length : 0} item(s) recorded in this purchase.
                    </p>
                  </div>
                  <div className="max-h-[28rem] overflow-y-auto">
                    <table className="w-full border-collapse text-left">
                      <thead className="table-head sticky top-0 z-10">
                        <tr>
                          <th className="table-header-cell">Item</th>
                          <th className="table-header-cell">SKU / Barcode</th>
                          <th className="table-header-cell text-right">Qty</th>
                          <th className="table-header-cell text-right">Cost</th>
                          <th className="table-header-cell text-right">Line Total</th>
                        </tr>
                      </thead>
                      <tbody className="table-body divide-y divide-[rgba(70,96,103,0.08)]">
                        {(activePurchase.items || []).map((item, index) => (
                          <tr key={`${item.productId || index}-${index}`} className="table-row">
                            <td className="px-5 py-4">
                              <p className="font-semibold text-[var(--ink)]">{item.name || 'Unnamed Item'}</p>
                              <p className="mt-1 text-xs font-medium uppercase tracking-[0.14em] text-[var(--ink-soft)]">
                                {item.unit || item.purchaseUnit || 'Unit'}
                              </p>
                            </td>
                            <td className="px-5 py-4 text-sm font-medium text-[var(--ink-soft)]">
                              {item.sku || item.barcode || '-'}
                            </td>
                            <td className="px-5 py-4 text-right font-semibold text-[var(--ink)]">
                              {Number(item.qty || 0).toFixed(2)}
                            </td>
                            <td className="px-5 py-4 text-right font-semibold text-[var(--ink)]">
                              ₹{Number(item.unitCost || 0).toFixed(2)}
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

                {activePurchase.notes && (
                  <div className="section-card p-5">
                    <p className="muted-kicker">Notes</p>
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[var(--ink)]">
                      {activePurchase.notes}
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
                      <span className="text-lg font-bold text-[var(--ink)]">₹{Number(activePurchase.subtotal || 0).toFixed(2)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="font-medium">Discount</span>
                      <span className="text-lg font-bold text-[var(--ink)]">₹{Number(activePurchase.discount || 0).toFixed(2)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="font-medium">Taxable Value</span>
                      <span className="text-lg font-bold text-[var(--ink)]">₹{activePurchaseTaxableValue.toFixed(2)}</span>
                    </div>
                    {activePurchase.gstEnabled && (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{`SGST (${activePurchaseSgstRate.toFixed(2)}%)`}</span>
                          <span className="text-lg font-bold text-primary-700">₹{activePurchaseSgstAmount.toFixed(2)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{`CGST (${activePurchaseCgstRate.toFixed(2)}%)`}</span>
                          <span className="text-lg font-bold text-primary-700">₹{activePurchaseCgstAmount.toFixed(2)}</span>
                        </div>
                      </>
                    )}
                    <div className="h-px w-full bg-[rgba(70,96,103,0.08)]" />
                    <div className="flex items-center justify-between">
                      <span className="text-base font-bold text-[var(--ink)]">Grand Total</span>
                      <span className="text-[1.6rem] font-black text-primary-700">₹{Number(activePurchase.total || 0).toFixed(2)}</span>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
                  <div className="section-card p-4">
                    <p className="muted-kicker">Paid</p>
                    <p className="mt-2 text-3xl font-black text-emerald-700">₹{Number(activePurchase.paidAmount || 0).toFixed(2)}</p>
                  </div>
                  <div className="section-card p-4">
                    <p className="muted-kicker">Balance</p>
                    <p className={`mt-2 text-3xl font-black ${activePurchaseBalance > 0 ? 'text-rose-600' : 'text-[var(--ink)]'}`}>
                      ₹{activePurchaseBalance.toFixed(2)}
                    </p>
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setActivePurchaseId(null)}
                    className="theme-button-primary px-5 py-3"
                  >
                    Close Details
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Embedded Products Modal */}
      {isProdModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-[2px] p-4 animate-in fade-in">
          <div
            ref={quickProductModalRef}
            data-enter-nav-root
            onKeyDown={handleQuickProductModalKeyDown}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden flex flex-col max-h-[90vh]"
          >
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="text-lg font-bold text-slate-800">Quick Add Product</h3>
              <button onClick={() => setProdModalOpen(false)} className="text-slate-400 hover:text-slate-600">&times;</button>
            </div>
            <form onSubmit={handleQuickAddProduct} className="p-6 overflow-y-auto">
              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-bold text-slate-600 mb-1">Product Name <span className="text-rose-500">*</span></label>
                  <input data-enter-nav required value={prodForm.name} onChange={e => setProdForm({...prodForm, name: e.target.value})} className="w-full px-4 py-2 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-primary-500/20 font-medium" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-slate-600 mb-1">SKU Code</label>
                    <input data-enter-nav value={prodForm.sku} onChange={e => setProdForm({...prodForm, sku: e.target.value})} placeholder="Auto-generated if blank" className="w-full px-4 py-2 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-primary-500/20 font-medium" />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-600 mb-1">Barcode</label>
                    <input data-enter-nav value={prodForm.barcode} onChange={e => setProdForm({...prodForm, barcode: e.target.value})} className="w-full px-4 py-2 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-primary-500/20 font-medium" />
                    <div className="mt-2 flex items-center gap-3">
                      <button
                        type="button"
                        onClick={handleFetchQuickBarcodeDetails}
                        disabled={isFetchingQuickBarcodeLookup}
                        className="theme-button-secondary px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Search size={16} />
                        {isFetchingQuickBarcodeLookup ? 'Fetching...' : 'Fetch From Open Facts'}
                      </button>
                      {quickBarcodeLookupMessage && (
                        <p className="text-xs font-semibold text-slate-500">{quickBarcodeLookupMessage}</p>
                      )}
                    </div>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-600 mb-1">HSN Code</label>
                  <input data-enter-nav value={prodForm.hsnCode || ''} onChange={e => setProdForm({...prodForm, hsnCode: e.target.value})} placeholder="e.g. 1905" className="w-full px-4 py-2 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-primary-500/20 font-medium uppercase" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-slate-600 mb-1">Category</label>
                    <select
                      data-enter-nav
                      value={quickAddCategorySelectValue}
                      onChange={e => setProdForm({ ...prodForm, category: e.target.value === '__custom__' ? '' : e.target.value })}
                      className="w-full px-4 py-2 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-primary-500/20 font-medium bg-white"
                    >
                      {productCategoryOptions.map((category) => (
                        <option key={category} value={category}>{category}</option>
                      ))}
                      <option value="__custom__">Custom Category</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-600 mb-1">Custom Category</label>
                    <input
                      data-enter-nav
                      value={quickAddCategorySelectValue === '__custom__' ? prodForm.category : ''}
                      placeholder="Type custom category"
                      disabled={quickAddCategorySelectValue !== '__custom__'}
                      onChange={e => setProdForm({ ...prodForm, category: e.target.value })}
                      className="w-full px-4 py-2 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-primary-500/20 font-medium disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                    />
                  </div>
                </div>
                <div className="bg-slate-50 p-4 rounded-xl space-y-4 border border-slate-100">
                  <h4 className="font-bold text-slate-700 text-sm uppercase tracking-wider mb-2">Pricing & Logistics</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-bold text-slate-600 mb-1">Cost Price (₹)</label>
                      <input data-enter-nav type="number" required value={prodForm.costPrice} onChange={e => setProdForm({...prodForm, costPrice: e.target.value})} className="w-full px-3 py-2 border border-slate-200 rounded-lg outline-none font-bold" />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-slate-600 mb-1">Retail Price (₹) <span className="text-rose-500">*</span></label>
                      <input data-enter-nav type="number" required value={prodForm.retailPrice} onChange={e => setProdForm({...prodForm, retailPrice: e.target.value})} className="w-full px-3 py-2 border border-slate-200 rounded-lg outline-none font-bold text-primary-600" />
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-8 flex justify-end gap-3">
                <button type="button" onClick={() => setProdModalOpen(false)} className="px-5 py-2 font-semibold text-slate-500 hover:bg-slate-100 rounded-xl transition">Cancel</button>
                <button data-enter-nav type="submit" className="px-6 py-2.5 font-bold bg-primary-600 hover:bg-primary-700 text-white rounded-xl shadow-lg transition">Save New Product</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
