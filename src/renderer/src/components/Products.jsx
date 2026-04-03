import { useRef, useState } from 'react';
import { useApp } from '../AppContext';
import { Package, Search, PlusCircle, Trash2, Edit } from 'lucide-react';
import { focusElement, handleSequentialEnter, handleShortcutKey } from '../utils/keyboardNavigation';
import { buildProductCategoryOptions, resolveCategorySelectValue } from '../utils/productCategories';

function getIpcErrorMessage(response, fallback) {
  const raw = String(response?.error || fallback || 'Unexpected error').trim();
  return raw.split('\n')[0].trim() || fallback;
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

export default function ProductsView() {
  const { data, mutateAndRefresh } = useApp();
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [activeProductId, setActiveProductId] = useState(null);
  const [isFetchingBarcodeLookup, setIsFetchingBarcodeLookup] = useState(false);
  const [barcodeLookupMessage, setBarcodeLookupMessage] = useState('');
  const modalFormRef = useRef(null);
  const packToggleRef = useRef(null);
  const packSizeRef = useRef(null);
  const saveButtonRef = useRef(null);

  const [form, setForm] = useState({
    name: '', sku: '', barcode: '', hsnCode: '', category: 'General', 
    unit: 'Unit', costPrice: '', retailPrice: '', wholesalePrice: '', stock: '',
    packEnabled: false, packSize: '', packPrice: ''
  });

  const filteredProducts = [...data.products]
    .filter(p => 
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
      p.sku.toLowerCase().includes(searchTerm.toLowerCase())
    )
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const categoryOptions = buildProductCategoryOptions(data.products);
  const categorySelectValue = resolveCategorySelectValue(form.category, categoryOptions);
  const activeProduct = activeProductId
    ? data.products.find((product) => product.id === activeProductId) || null
    : null;
  const activeProductSales = activeProduct
    ? data.invoices
        .flatMap((invoice) =>
          (invoice.items || [])
            .filter((item) => item.productId === activeProduct.id)
            .map((item) => ({
              id: `${invoice.id}-${item.productId}-${item.qty}-${item.lineTotal}`,
              invoiceId: invoice.id,
              reference: invoice.invoiceNo || invoice.id,
              createdAt: invoice.createdAt,
              customerName:
                data.customers.find((customer) => customer.id === invoice.customerId)?.name ||
                invoice.customerSnapshot?.name ||
                'Walk-in Customer',
              qty: item.qty,
              unitPrice: item.unitPrice,
              lineTotal: item.lineTotal
            }))
        )
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 8)
    : [];
  const activeProductPurchases = activeProduct
    ? data.purchases
        .flatMap((purchase) =>
          (purchase.items || [])
            .filter((item) => item.productId === activeProduct.id)
            .map((item) => ({
              id: `${purchase.id}-${item.productId}-${item.qty}-${item.lineTotal}`,
              purchaseId: purchase.id,
              reference: purchase.purchaseNo || purchase.id,
              createdAt: purchase.createdAt,
              supplierName:
                data.suppliers.find((supplier) => supplier.id === purchase.supplierId)?.name ||
                purchase.supplierSnapshot?.name ||
                'Unknown Supplier',
              qty: item.qty,
              unitCost: item.unitCost,
              lineTotal: item.lineTotal
            }))
        )
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 8)
    : [];
  const currentInventoryValue = activeProduct
    ? Number(activeProduct.stock || 0) * Number(activeProduct.costPrice || 0)
    : 0;

  const resetForm = () => {
    setEditingId(null);
    setBarcodeLookupMessage('');
    setForm({ 
       name: '', sku: '', barcode: '', hsnCode: '', category: 'General', unit: 'Unit', 
       costPrice: '', retailPrice: '', wholesalePrice: '', stock: '',
       packEnabled: false, packSize: '', packPrice: ''
    });
  };

  const applyLookupToForm = (lookup) => {
    setForm((current) => ({
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

  const handleFetchBarcodeDetails = async () => {
    if (!window.erpApi?.lookupOpenFoodFactsProduct) {
      alert('Restart the app to load Open Facts barcode lookup.');
      return;
    }

    try {
      setIsFetchingBarcodeLookup(true);
      setBarcodeLookupMessage('');
      const response = await window.erpApi.lookupOpenFoodFactsProduct({ barcode: form.barcode });
      if (!response?.ok) {
        throw new Error(getIpcErrorMessage(response, 'Barcode lookup failed'));
      }

      applyLookupToForm(response.data);
      const sourceLabel = response.data?.source || 'product lookup';
      setBarcodeLookupMessage(
        `${sourceLabel}${response.data?.quantityLabel ? ` • ${response.data.quantityLabel}` : ''}`
      );
    } catch (error) {
      setBarcodeLookupMessage('');
      alert(error.message || 'Failed to fetch product details from Open Facts');
    } finally {
      setIsFetchingBarcodeLookup(false);
    }
  };

  const submitProduct = async () => {
    if (window.erpApi) {
      try {
        const payload = {
           ...form,
           costPrice: Number(form.costPrice) || 0,
           retailPrice: Number(form.retailPrice) || 0,
           wholesalePrice: Number(form.wholesalePrice) || 0,
           stock: Number(form.stock) || 0,
           packSize: form.packEnabled ? (Number(form.packSize) || 1) : 1,
           packPrice: form.packEnabled ? (Number(form.packPrice) || 0) : 0,
           loosePrice: Number(form.retailPrice) || 0 // Explicitly map loosePrice defensively
        };

        const res = await window.erpApi.upsertProduct(editingId ? { id: editingId, ...payload } : payload);
        if (res && res.error) {
           alert(res.error);
           return false;
        }
        await mutateAndRefresh(res);
        setModalOpen(false);
        resetForm();
        return true;
      } catch (err) {
        alert(err.message || 'Failed to save product');
      }
    }

    return false;
  };

  const handleSave = async (e) => {
    e.preventDefault();
    await submitProduct();
  };

  const handleDelete = async (id) => {
    if (confirm("Are you sure you want to delete this product?") && window.erpApi) {
       try {
         await mutateAndRefresh(window.erpApi.deleteProduct(id));
       } catch (err) {
         alert(err.message || 'Failed to delete product');
       }
    }
  };

  const openEdit = (prod) => {
    setEditingId(prod.id);
    setBarcodeLookupMessage('');
    setForm({ ...prod });
    setModalOpen(true);
  };

  const handleProductRowKeyDown = (event, productId) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();
    setActiveProductId(productId);
  };

  const handleProductFormKeyDown = (event) => {
    if (
      handleShortcutKey(event, {
        onSubmit: () => void submitProduct(),
        onEscape: () => setModalOpen(false)
      })
    ) {
      return;
    }

    handleSequentialEnter(event, modalFormRef);
  };

  const handleUnitKeyDown = (event) => {
    if (
      handleShortcutKey(event, {
        onSubmit: () => void submitProduct(),
        onEscape: () => setModalOpen(false)
      })
    ) {
      return;
    }

    if (event.key === 'Enter' && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      event.preventDefault();
      focusElement(packToggleRef.current);
    }
  };

  const handlePackToggleKeyDown = (event) => {
    if (
      handleShortcutKey(event, {
        onSubmit: () => void submitProduct(),
        onEscape: () => setModalOpen(false)
      })
    ) {
      return;
    }

    if (event.key !== 'Enter' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }

    event.preventDefault();
    const nextEnabled = !form.packEnabled;
    setForm((current) => ({ ...current, packEnabled: nextEnabled }));

    requestAnimationFrame(() => {
      focusElement(nextEnabled ? packSizeRef.current : saveButtonRef.current);
    });
  };

  return (
    <div className="flex flex-col h-full animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      <div className="flex items-center justify-between mb-8">
        <div className="theme-search w-96">
          <Search size={20} className="text-[var(--ink-soft)]" />
          <input 
            type="text" 
            placeholder="Search by name or SKU..." 
            className="theme-search-input"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="toolbar-chip">
          <span>Total: {data.products.length}</span>
          <span>|</span>
          <span className="text-primary-700">Showing: {filteredProducts.length}</span>
        </div>

        <div className="flex items-center gap-3">
          <button 
            onClick={() => { resetForm(); setModalOpen(true); }}
            className="theme-button-primary"
          >
            <PlusCircle size={20} />
            New Product
          </button>
          <button 
            onClick={async () => {
               const res = await window.erpApi?.exportStockListPdf();
               if (res?.success) alert("PDF Export Successfully saved!");
            }}
            className="theme-button-secondary"
          >
            Export PDF
          </button>
        </div>
      </div>

      <div className="glass-panel table-shell flex-1 flex flex-col overflow-hidden">
         <div className="overflow-y-auto w-full p-0">
           <table className="w-full text-left border-collapse">
             <thead className="table-head sticky top-0 z-10">
               <tr>
                 <th className="table-header-cell">Product</th>
                 <th className="table-header-cell">SKU</th>
                 <th className="table-header-cell">Stock</th>
                 <th className="table-header-cell">Retail Price</th>
                 <th className="table-header-cell">Actions</th>
               </tr>
             </thead>
             <tbody className="table-body divide-y divide-[rgba(70,96,103,0.08)]">
               {filteredProducts.map(prod => (
                 <tr
                   key={prod.id}
                   role="button"
                   tabIndex={0}
                   onClick={() => setActiveProductId(prod.id)}
                   onKeyDown={(event) => handleProductRowKeyDown(event, prod.id)}
                   className="table-row group cursor-pointer focus:outline-none focus:bg-[rgba(241,247,245,0.88)]"
                 >
                   <td className="px-6 py-4 w-1/3">
                     <div className="flex items-center gap-3">
                       <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-primary-100 text-primary-700">
                         <Package size={20} />
                       </div>
                       <div>
                         <p className="font-semibold text-[var(--ink)]">{prod.name}</p>
                         <p className="text-xs font-medium text-[var(--ink-soft)]">{prod.category}</p>
                       </div>
                     </div>
                   </td>
                   <td className="px-6 py-4 text-sm font-medium text-[var(--ink-soft)]">{prod.sku}</td>
                   <td className="px-6 py-4">
                     <span className={`badge ${prod.stock <= prod.reorderLevel ? 'badge-red' : 'badge-green'}`}>
                       {prod.stock} {prod.unit}
                     </span>
                   </td>
                   <td className="px-6 py-4 text-sm font-bold text-[var(--ink)]">₹{parseFloat(prod.retailPrice).toFixed(2)}</td>
                   <td className="px-6 py-4">
                     <div className="flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                       <button onClick={(event) => { event.stopPropagation(); openEdit(prod); }} className="rounded-xl p-2 text-[var(--ink-soft)] transition-colors hover:bg-primary-100 hover:text-primary-700"><Edit size={18} /></button>
                       <button onClick={(event) => { event.stopPropagation(); handleDelete(prod.id); }} className="rounded-xl p-2 text-[var(--ink-soft)] transition-colors hover:bg-rose-100 hover:text-rose-700"><Trash2 size={18} /></button>
                     </div>
                   </td>
                 </tr>
               ))}
               {filteredProducts.length === 0 && (
                 <tr>
                   <td colSpan="5" className="py-20 text-center font-medium text-[var(--ink-soft)]">No products found.</td>
                 </tr>
               )}
             </tbody>
           </table>
         </div>
      </div>

      {isModalOpen && (
        <div className="modal-backdrop animate-in fade-in">
          <div className="modal-panel max-w-2xl">
            <div className="modal-header">
              <h3 className="modal-title">{editingId ? 'Edit Product' : 'Add New Product'}</h3>
              <button type="button" onClick={() => setModalOpen(false)} className="text-2xl text-[var(--ink-soft)] transition hover:text-[var(--ink)]">&times;</button>
            </div>
            <form
              ref={modalFormRef}
              data-enter-nav-root
              onSubmit={handleSave}
              onKeyDown={handleProductFormKeyDown}
              className="flex-1 overflow-y-auto p-6"
            >
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Product Name</label>
                  <input data-enter-nav required value={form.name} autoFocus onChange={e => setForm({...form, name: e.target.value})} className="theme-input" />
                </div>
                <div className="col-span-2 md:col-span-1">
                  <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Barcode (Click to Scan)</label>
                  <input data-enter-nav value={form.barcode} placeholder="Scan or type..." onChange={e => setForm({...form, barcode: e.target.value})} className="theme-input font-bold tracking-widest text-primary-700" />
                  <div className="mt-2 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={handleFetchBarcodeDetails}
                      disabled={isFetchingBarcodeLookup}
                      className="theme-button-secondary px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Search size={16} />
                      {isFetchingBarcodeLookup ? 'Fetching...' : 'Fetch From Open Facts'}
                    </button>
                    {barcodeLookupMessage && (
                      <p className="text-xs font-semibold text-[var(--ink-soft)]">{barcodeLookupMessage}</p>
                    )}
                  </div>
                </div>
                <div className="col-span-2 md:col-span-1">
                  <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">SKU (Auto-Generated if blank)</label>
                  <input data-enter-nav value={form.sku} placeholder="e.g. 10001" onChange={e => setForm({...form, sku: e.target.value})} className="theme-input text-[var(--ink-soft)]" />
                </div>
                <div className="col-span-2 md:col-span-1">
                  <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">HSN Code</label>
                  <input data-enter-nav value={form.hsnCode || ''} placeholder="e.g. 1905" onChange={e => setForm({...form, hsnCode: e.target.value})} className="theme-input text-[var(--ink-soft)] uppercase" />
                </div>
                <div className="col-span-2 md:col-span-1">
                  <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Category</label>
                  <select
                    data-enter-nav
                    value={categorySelectValue}
                    onChange={e => setForm({ ...form, category: e.target.value === '__custom__' ? '' : e.target.value })}
                    className="theme-select"
                  >
                    {categoryOptions.map((category) => (
                      <option key={category} value={category}>{category}</option>
                    ))}
                    <option value="__custom__">Custom Category</option>
                  </select>
                </div>
                <div className="col-span-2 md:col-span-1">
                  <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Custom Category</label>
                  <input
                    data-enter-nav
                    value={categorySelectValue === '__custom__' ? form.category : ''}
                    placeholder="Type custom category"
                    disabled={categorySelectValue !== '__custom__'}
                    onChange={e => setForm({ ...form, category: e.target.value })}
                    className="theme-input disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Cost Price (₹)</label>
                  <input data-enter-nav type="number" required value={form.costPrice} onChange={e => setForm({...form, costPrice: e.target.value})} className="theme-input" />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Retail Price (₹)</label>
                  <input data-enter-nav type="number" required value={form.retailPrice} onChange={e => setForm({...form, retailPrice: e.target.value})} className="theme-input" />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Wholesale Price (₹)</label>
                  <input data-enter-nav type="number" required value={form.wholesalePrice} onChange={e => setForm({...form, wholesalePrice: e.target.value})} className="theme-input" />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Opening Stock</label>
                  <input data-enter-nav type="number" required value={form.stock} onChange={e => setForm({...form, stock: e.target.value})} className="theme-input" />
                </div>
                <div className="col-span-2">
                  <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Sale Unit Classification</label>
                  <select data-enter-nav value={form.unit} onChange={e => setForm({...form, unit: e.target.value})} onKeyDown={handleUnitKeyDown} className="theme-select">
                    <option>Unit</option><option>Piece</option><option>Kg</option><option>Litre</option><option>Pack</option>
                  </select>
                </div>

                {/* Pack Logic */}
                <div className="col-span-2 mt-2 border-t border-[rgba(70,96,103,0.08)] pt-4">
                   <label className="flex w-max shrink-0 cursor-pointer items-center gap-3 rounded-2xl border border-primary-200 bg-primary-50 px-4 py-2 font-bold text-primary-700">
                      <input ref={packToggleRef} type="checkbox" checked={form.packEnabled} onChange={e => setForm({...form, packEnabled: e.target.checked})} onKeyDown={handlePackToggleKeyDown} className="w-5 h-5 rounded text-indigo-600" />
                      Enable Pack Structure?
                   </label>
                   
                   {form.packEnabled && (
                      <div className="grid grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-2">
                         <div>
                           <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Items Per Pack (Size)</label>
                           <input ref={packSizeRef} data-enter-nav type="number" required={form.packEnabled} value={form.packSize} onChange={e => setForm({...form, packSize: e.target.value})} className="theme-input" />
                         </div>
                         <div>
                           <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Pack Total Price (₹)</label>
                           <input data-enter-nav type="number" required={form.packEnabled} value={form.packPrice} onChange={e => setForm({...form, packPrice: e.target.value})} className="theme-input" />
                         </div>
                      </div>
                   )}
                </div>
              </div>
              <div className="mt-8 flex justify-end gap-3">
                <button type="button" onClick={() => setModalOpen(false)} className="theme-button-ghost px-5 py-2.5">Cancel</button>
                <button ref={saveButtonRef} data-enter-nav type="submit" className="theme-button-primary px-5 py-2.5">Save Product</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {activeProduct && (
        <div className="modal-backdrop">
          <div className="modal-panel max-w-5xl">
            <div className="modal-header">
              <div>
                <h3 className="modal-title">Product Details</h3>
                <p className="mt-1 text-sm font-medium text-[var(--ink-soft)]">
                  {activeProduct.sku || activeProduct.barcode || activeProduct.id}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveProductId(null)}
                className="text-2xl text-[var(--ink-soft)] transition hover:text-[var(--ink)]"
              >
                &times;
              </button>
            </div>

            <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="space-y-6">
                <div className="section-card p-5">
                  <p className="muted-kicker">Product</p>
                  <h4 className="mt-2 text-4xl font-semibold text-[var(--ink)]">{activeProduct.name}</h4>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--ink-soft)]">Category</p>
                      <p className="mt-2 text-lg font-semibold text-[var(--ink)]">{activeProduct.category || 'General'}</p>
                    </div>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--ink-soft)]">Unit</p>
                      <p className="mt-2 text-lg font-semibold text-[var(--ink)]">{activeProduct.unit || 'Unit'}</p>
                    </div>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--ink-soft)]">Barcode</p>
                      <p className="mt-2 text-lg font-semibold text-[var(--ink)]">{activeProduct.barcode || '-'}</p>
                    </div>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--ink-soft)]">HSN Code</p>
                      <p className="mt-2 text-lg font-semibold text-[var(--ink)]">{activeProduct.hsnCode || '-'}</p>
                    </div>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--ink-soft)]">Added On</p>
                      <p className="mt-2 text-lg font-semibold text-[var(--ink)]">{formatDateTime(activeProduct.createdAt)}</p>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="section-card p-4">
                    <p className="muted-kicker">Cost Price</p>
                    <p className="mt-2 text-3xl font-black text-[var(--ink)]">₹{Number(activeProduct.costPrice || 0).toFixed(2)}</p>
                  </div>
                  <div className="section-card p-4">
                    <p className="muted-kicker">Retail Price</p>
                    <p className="mt-2 text-3xl font-black text-primary-700">₹{Number(activeProduct.retailPrice || 0).toFixed(2)}</p>
                  </div>
                  <div className="section-card p-4">
                    <p className="muted-kicker">Wholesale Price</p>
                    <p className="mt-2 text-3xl font-black text-[var(--ink)]">₹{Number(activeProduct.wholesalePrice || 0).toFixed(2)}</p>
                  </div>
                  <div className="section-card p-4">
                    <p className="muted-kicker">Inventory Value</p>
                    <p className="mt-2 text-3xl font-black text-emerald-700">₹{currentInventoryValue.toFixed(2)}</p>
                  </div>
                </div>

                <div className="section-card p-5">
                  <p className="muted-kicker">Stock & Pack</p>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--ink-soft)]">Current Stock</p>
                      <p className="mt-2 text-2xl font-black text-[var(--ink)]">
                        {Number(activeProduct.stock || 0).toFixed(2)} {activeProduct.unit || ''}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--ink-soft)]">Reorder Level</p>
                      <p className="mt-2 text-2xl font-black text-[var(--ink)]">
                        {Number(activeProduct.reorderLevel || 0).toFixed(2)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--ink-soft)]">Pack Enabled</p>
                      <p className="mt-2 text-lg font-semibold text-[var(--ink)]">{activeProduct.packEnabled ? 'Yes' : 'No'}</p>
                    </div>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--ink-soft)]">Pack Details</p>
                      <p className="mt-2 text-lg font-semibold text-[var(--ink)]">
                        {activeProduct.packEnabled
                          ? `${Number(activeProduct.packSize || 0).toFixed(0)} pcs @ ₹${Number(activeProduct.packPrice || 0).toFixed(2)}`
                          : '-'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <div className="section-card overflow-hidden">
                  <div className="border-b border-[rgba(70,96,103,0.08)] px-5 py-4">
                    <h4 className="text-2xl font-semibold text-[var(--ink)]">Recent Sales</h4>
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {activeProductSales.length === 0 ? (
                      <div className="px-5 py-8 text-sm font-medium text-[var(--ink-soft)]">No sales recorded for this product yet.</div>
                    ) : (
                      <table className="w-full border-collapse text-left">
                        <thead className="table-head sticky top-0 z-10">
                          <tr>
                            <th className="table-header-cell">Invoice</th>
                            <th className="table-header-cell">Customer</th>
                            <th className="table-header-cell text-right">Qty</th>
                            <th className="table-header-cell text-right">Line Total</th>
                          </tr>
                        </thead>
                        <tbody className="table-body divide-y divide-[rgba(70,96,103,0.08)]">
                          {activeProductSales.map((sale) => (
                            <tr key={sale.id} className="table-row">
                              <td className="px-5 py-4">
                                <p className="font-semibold text-[var(--ink)]">{sale.reference}</p>
                                <p className="mt-1 text-xs text-[var(--ink-soft)]">{formatDateTime(sale.createdAt)}</p>
                              </td>
                              <td className="px-5 py-4 text-sm font-medium text-[var(--ink-soft)]">{sale.customerName}</td>
                              <td className="px-5 py-4 text-right font-semibold text-[var(--ink)]">{Number(sale.qty || 0).toFixed(2)}</td>
                              <td className="px-5 py-4 text-right font-black text-primary-700">₹{Number(sale.lineTotal || 0).toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>

                <div className="section-card overflow-hidden">
                  <div className="border-b border-[rgba(70,96,103,0.08)] px-5 py-4">
                    <h4 className="text-2xl font-semibold text-[var(--ink)]">Recent Purchases</h4>
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {activeProductPurchases.length === 0 ? (
                      <div className="px-5 py-8 text-sm font-medium text-[var(--ink-soft)]">No purchase history recorded for this product yet.</div>
                    ) : (
                      <table className="w-full border-collapse text-left">
                        <thead className="table-head sticky top-0 z-10">
                          <tr>
                            <th className="table-header-cell">Purchase</th>
                            <th className="table-header-cell">Supplier</th>
                            <th className="table-header-cell text-right">Qty</th>
                            <th className="table-header-cell text-right">Line Total</th>
                          </tr>
                        </thead>
                        <tbody className="table-body divide-y divide-[rgba(70,96,103,0.08)]">
                          {activeProductPurchases.map((purchase) => (
                            <tr key={purchase.id} className="table-row">
                              <td className="px-5 py-4">
                                <p className="font-semibold text-[var(--ink)]">{purchase.reference}</p>
                                <p className="mt-1 text-xs text-[var(--ink-soft)]">{formatDateTime(purchase.createdAt)}</p>
                              </td>
                              <td className="px-5 py-4 text-sm font-medium text-[var(--ink-soft)]">{purchase.supplierName}</td>
                              <td className="px-5 py-4 text-right font-semibold text-[var(--ink)]">{Number(purchase.qty || 0).toFixed(2)}</td>
                              <td className="px-5 py-4 text-right font-black text-primary-700">₹{Number(purchase.lineTotal || 0).toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
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
