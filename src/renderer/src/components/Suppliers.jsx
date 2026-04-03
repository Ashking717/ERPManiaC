import { useEffect, useState } from 'react';
import { Edit, FileText, PlusCircle, Search, Truck } from 'lucide-react';
import { useApp } from '../AppContext';

function formatMoney(value) {
  return `₹${(Number(value) || 0).toFixed(2)}`;
}

function entryTypeLabel(type) {
  return type === 'payment' ? 'Payment Made' : 'Purchase Entry';
}

export default function SuppliersView() {
  const { data, mutateAndRefresh } = useApp();
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [ledgerSupId, setLedgerSupId] = useState(null);
  const [ledgerData, setLedgerData] = useState(null);
  const [isLedgerLoading, setLedgerLoading] = useState(false);
  const [isPaymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    paymentMethod: 'cash'
  });

  const [form, setForm] = useState({
    name: '',
    phone: '',
    address: '',
    gstin: ''
  });

  const filteredSuppliers = data.suppliers.filter(
    (supplier) =>
      supplier.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (supplier.phone && supplier.phone.includes(searchTerm))
  );

  useEffect(() => {
    let cancelled = false;

    async function loadLedger() {
      if (!ledgerSupId || !window.erpApi) {
        setLedgerData(null);
        return;
      }

      setLedgerLoading(true);
      try {
        const res = await window.erpApi.getSupplierLedger(ledgerSupId);
        if (!cancelled) {
          setLedgerData(res?.data || res || null);
        }
      } finally {
        if (!cancelled) {
          setLedgerLoading(false);
        }
      }
    }

    loadLedger();
    return () => {
      cancelled = true;
    };
  }, [ledgerSupId, data.suppliers, data.purchases, data.supplierPayments]);

  const handleSave = async (e) => {
    e.preventDefault();
    if (window.erpApi) {
      await mutateAndRefresh(
        window.erpApi.upsertSupplier(editingId ? { id: editingId, ...form } : form)
      );
    }
    setModalOpen(false);
    resetForm();
  };

  const openEdit = (supplier) => {
    setEditingId(supplier.id);
    setForm({ ...supplier });
    setModalOpen(true);
  };

  const resetForm = () => {
    setEditingId(null);
    setForm({ name: '', phone: '', address: '', gstin: '' });
  };

  const openLedger = (id) => setLedgerSupId(id);

  const activeLedgerSupplier =
    ledgerData?.supplier || (ledgerSupId ? data.suppliers.find((supplier) => supplier.id === ledgerSupId) : null);
  const ledgerEntries = [...(ledgerData?.ledgerEntries || [])].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );
  const totalLedgerBalance =
    ledgerData?.outstanding ??
    (ledgerSupId
      ? data.purchases
          .filter((purchase) => purchase.supplierId === ledgerSupId)
          .reduce((sum, purchase) => sum + (Number(purchase.balance) || 0), 0)
      : 0);

  const openRecordPayment = () => {
    setPaymentForm({
      amount: String((Number(totalLedgerBalance) || 0).toFixed(2)),
      paymentMethod: 'cash'
    });
    setPaymentModalOpen(true);
  };

  const handleRecordPayment = async (e) => {
    e.preventDefault();
    if (!window.erpApi || !ledgerSupId) {
      return;
    }

    await mutateAndRefresh(
      window.erpApi.createSupplierPayment({
        supplierId: ledgerSupId,
        amount: Number(paymentForm.amount) || 0,
        paymentMethod: paymentForm.paymentMethod
      })
    );

    setPaymentModalOpen(false);
    setPaymentForm({ amount: '', paymentMethod: 'cash' });
  };

  return (
    <div className="flex h-full flex-col animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mb-8 flex items-center justify-between">
        <div className="theme-search w-96">
          <Search size={20} className="text-[var(--ink-soft)]" />
          <input
            type="text"
            placeholder="Search by name or phone..."
            className="theme-search-input"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <button type="button" onClick={() => { resetForm(); setModalOpen(true); }} className="theme-button-primary">
          <PlusCircle size={20} />
          New Supplier
        </button>
      </div>

      <div className="flex min-h-0 flex-1 gap-6 overflow-hidden">
        <div className={`glass-panel table-shell flex flex-col overflow-hidden transition-all duration-300 ${ledgerSupId ? 'w-1/2' : 'w-full'}`}>
          <div className="w-full overflow-y-auto p-0">
            <table className="w-full border-collapse text-left">
              <thead className="table-head sticky top-0 z-10">
                <tr>
                  <th className="table-header-cell">Supplier</th>
                  {!ledgerSupId && <th className="table-header-cell">Phone</th>}
                  {!ledgerSupId && <th className="table-header-cell">GSTIN</th>}
                  <th className="table-header-cell text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="table-body divide-y divide-[rgba(70,96,103,0.08)]">
                {filteredSuppliers.map((supplier) => {
                  const supplierBalance = data.purchases
                    .filter((purchase) => purchase.supplierId === supplier.id)
                    .reduce((sum, purchase) => sum + (Number(purchase.balance) || 0), 0);

                  return (
                    <tr
                      key={supplier.id}
                      onClick={() => openLedger(supplier.id)}
                      className={`table-row cursor-pointer group ${ledgerSupId === supplier.id ? 'table-row-selected' : ''}`}
                    >
                      <td className="px-6 py-4 w-1/3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary-100 text-primary-700">
                            <Truck size={20} />
                          </div>
                          <div>
                            <p className="text-lg font-bold text-[var(--ink)]">{supplier.name}</p>
                            {supplierBalance > 0 ? (
                              <p className="text-xs font-bold text-[var(--rose-text)]">Pending Pay: {formatMoney(supplierBalance)}</p>
                            ) : (
                              <p className="text-xs font-medium text-[var(--ink-soft)]">{supplier.phone || 'No phone'}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      {!ledgerSupId && <td className="px-6 py-4 text-sm font-medium text-[var(--ink-soft)]">{supplier.phone || '-'}</td>}
                      {!ledgerSupId && <td className="px-6 py-4 text-sm font-medium text-[var(--ink-soft)]">{supplier.gstin || '-'}</td>}
                      <td className="px-6 py-4 text-right">
                        <div className="flex flex-row-reverse items-center justify-start gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openEdit(supplier);
                            }}
                            className="rounded-xl p-2 text-[var(--ink-soft)] transition-colors hover:bg-primary-100 hover:text-primary-700"
                          >
                            <Edit size={18} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openLedger(supplier.id);
                            }}
                            className="rounded-xl p-2 text-[var(--ink-soft)] transition-colors hover:bg-emerald-100 hover:text-emerald-700"
                            title="View Ledger"
                          >
                            <FileText size={18} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredSuppliers.length === 0 && (
                  <tr>
                    <td colSpan="4" className="py-20 text-center font-medium text-[var(--ink-soft)]">
                      No suppliers found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {ledgerSupId && activeLedgerSupplier && (
          <div className="glass-panel flex w-1/2 flex-col overflow-hidden animate-in slide-in-from-right-8 duration-300">
            <div className="dashboard-hero rounded-none p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-4xl font-semibold text-white">{activeLedgerSupplier.name}</h3>
                  <p className="mt-1 text-sm font-medium text-white/72">
                    {activeLedgerSupplier.phone || 'No Phone'} • {activeLedgerSupplier.gstin || 'No GSTIN'}
                  </p>
                </div>
                <div className="text-right">
                  <p className="hero-label mb-1">Total Payable</p>
                  <p className={`text-2xl font-black ${totalLedgerBalance > 0 ? 'text-amber-200' : 'text-emerald-200'}`}>
                    {formatMoney(totalLedgerBalance)}
                  </p>
                </div>
              </div>

              <div className="mt-5 flex justify-end">
                {totalLedgerBalance > 0 && (
                  <button type="button" onClick={openRecordPayment} className="theme-button-secondary px-4 py-2 text-sm" style={{ background: '#fffdfa', color: 'var(--ink)' }}>
                    Record Payment
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <div className="mb-4 flex items-center justify-between px-2">
                <h4 className="text-lg font-bold tracking-tight text-[var(--ink)]">Ledger Entries</h4>
                {isLedgerLoading && <span className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--ink-soft)]">Loading</span>}
              </div>

              {ledgerEntries.length === 0 ? (
                <div className="py-10 text-center font-medium text-[var(--ink-soft)]">No purchase history.</div>
              ) : (
                <div className="space-y-3">
                  {ledgerEntries.map((entry) => {
                    const amount = entry.type === 'payment' ? Number(entry.credit) || 0 : Number(entry.debit) || 0;
                    return (
                      <div key={entry.id} className="section-card flex items-center justify-between gap-4 p-4 transition-transform hover:-translate-y-0.5">
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-bold text-[var(--ink)]">{entry.reference || '-'}</p>
                            <span className={`badge ${entry.type === 'payment' ? 'badge-green' : 'badge-blue'}`}>
                              {entryTypeLabel(entry.type)}
                            </span>
                          </div>
                          <p className="mt-1 text-sm font-medium text-[var(--ink-soft)]">
                            {new Date(entry.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className={`text-lg font-black ${entry.type === 'payment' ? 'text-[var(--success-text)]' : 'text-[var(--ink)]'}`}>
                            {entry.type === 'payment' ? '-' : '+'}{formatMoney(amount)}
                          </p>
                          <p className="mt-1 text-xs font-bold text-[var(--ink-soft)]">
                            Balance: {formatMoney(entry.runningBalance)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="modal-backdrop animate-in fade-in">
          <div className="modal-panel max-w-lg">
            <div className="modal-header">
              <h3 className="modal-title">{editingId ? 'Edit Supplier' : 'Add New Supplier'}</h3>
              <button type="button" onClick={() => setModalOpen(false)} className="text-2xl text-[var(--ink-soft)] transition hover:text-[var(--ink)]">
                &times;
              </button>
            </div>
            <form onSubmit={handleSave} className="p-6 overflow-y-auto">
              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Supplier Name</label>
                  <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="theme-input" />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Phone</label>
                  <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="theme-input" />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Address</label>
                  <textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} rows={2} className="theme-textarea" />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">GSTIN</label>
                  <input value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} className="theme-input" />
                </div>
              </div>
              <div className="mt-8 flex justify-end gap-3">
                <button type="button" onClick={() => setModalOpen(false)} className="theme-button-ghost px-5 py-2.5">
                  Cancel
                </button>
                <button type="submit" className="theme-button-primary px-6 py-2.5">
                  Save Supplier
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isPaymentModalOpen && (
        <div className="modal-backdrop animate-in fade-in">
          <div className="modal-panel max-w-md">
            <div className="modal-header">
              <h3 className="modal-title">Record Supplier Payment</h3>
              <button type="button" onClick={() => setPaymentModalOpen(false)} className="text-2xl text-[var(--ink-soft)] transition hover:text-[var(--ink)]">
                &times;
              </button>
            </div>
            <form onSubmit={handleRecordPayment} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Amount</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={paymentForm.amount}
                    onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                    className="theme-input"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Method</label>
                  <select
                    value={paymentForm.paymentMethod}
                    onChange={(e) => setPaymentForm({ ...paymentForm, paymentMethod: e.target.value })}
                    className="theme-select"
                  >
                    <option value="cash">Cash</option>
                    <option value="upi">UPI</option>
                    <option value="card">Card</option>
                    <option value="bank">Bank</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setPaymentModalOpen(false)} className="theme-button-ghost px-5 py-2.5">
                  Cancel
                </button>
                <button type="submit" className="theme-button-primary px-5 py-2.5">
                  Save Payment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
