import { useEffect, useState } from 'react';
import { Edit, FileText, PlusCircle, Search, Users } from 'lucide-react';
import { useApp } from '../AppContext';

function formatMoney(value) {
  return `₹${(Number(value) || 0).toFixed(2)}`;
}

function entryTypeLabel(type) {
  return type === 'payment' ? 'Payment Received' : 'Sale Invoice';
}

export default function CustomersView() {
  const { data, mutateAndRefresh } = useApp();
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [ledgerCustId, setLedgerCustId] = useState(null);
  const [ledgerData, setLedgerData] = useState(null);
  const [isLedgerLoading, setLedgerLoading] = useState(false);
  const [isPaymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentForm, setPaymentForm] = useState({
    invoiceId: '',
    amount: '',
    paymentMethod: 'cash'
  });

  const [form, setForm] = useState({
    name: '',
    phone: '',
    address: '',
    gstin: '',
    type: 'retail'
  });

  const filteredCustomers = data.customers.filter(
    (customer) =>
      customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (customer.phone && customer.phone.includes(searchTerm))
  );

  useEffect(() => {
    let cancelled = false;

    async function loadLedger() {
      if (!ledgerCustId || !window.erpApi) {
        setLedgerData(null);
        return;
      }

      setLedgerLoading(true);
      try {
        const res = await window.erpApi.getCustomerLedger(ledgerCustId);
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
  }, [ledgerCustId, data.customers, data.invoices]);

  const handleSave = async (e) => {
    e.preventDefault();
    if (window.erpApi) {
      await mutateAndRefresh(
        window.erpApi.upsertCustomer(editingId ? { id: editingId, ...form } : form)
      );
    }
    setModalOpen(false);
    resetForm();
  };

  const openEdit = (customer) => {
    setEditingId(customer.id);
    setForm({ ...customer });
    setModalOpen(true);
  };

  const resetForm = () => {
    setEditingId(null);
    setForm({ name: '', phone: '', address: '', gstin: '', type: 'retail' });
  };

  const openLedger = (id) => setLedgerCustId(id);

  const activeLedgerCustomer =
    ledgerData?.customer || (ledgerCustId ? data.customers.find((customer) => customer.id === ledgerCustId) : null);
  const ledgerEntries = [...(ledgerData?.ledgerEntries || [])].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );
  const openInvoices = ledgerData?.openInvoices || [];
  const totalLedgerBalance =
    ledgerData?.outstanding ??
    (ledgerCustId
      ? data.invoices
          .filter((invoice) => invoice.customerId === ledgerCustId)
          .reduce((sum, invoice) => sum + (Number(invoice.balance) || 0), 0)
      : 0);

  const openReceivePayment = () => {
    if (!openInvoices.length) {
      return;
    }

    const firstInvoice = openInvoices[0];
    setPaymentForm({
      invoiceId: firstInvoice.id,
      amount: String((Number(firstInvoice.balance) || 0).toFixed(2)),
      paymentMethod: 'cash'
    });
    setPaymentModalOpen(true);
  };

  const handleReceivePayment = async (e) => {
    e.preventDefault();
    if (!window.erpApi) {
      return;
    }

    await mutateAndRefresh(
      window.erpApi.recordInvoicePayment({
        invoiceId: paymentForm.invoiceId,
        amount: Number(paymentForm.amount) || 0,
        paymentMethod: paymentForm.paymentMethod
      })
    );

    setPaymentModalOpen(false);
    setPaymentForm({ invoiceId: '', amount: '', paymentMethod: 'cash' });
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
          New Customer
        </button>
      </div>

      <div className="flex min-h-0 flex-1 gap-6 overflow-hidden">
        <div className={`glass-panel table-shell flex flex-col overflow-hidden transition-all duration-300 ${ledgerCustId ? 'w-1/2' : 'w-full'}`}>
          <div className="w-full overflow-y-auto p-0">
            <table className="w-full border-collapse text-left">
              <thead className="table-head sticky top-0 z-10">
                <tr>
                  <th className="table-header-cell">Customer</th>
                  {!ledgerCustId && <th className="table-header-cell">Type</th>}
                  {!ledgerCustId && <th className="table-header-cell">Phone</th>}
                  <th className="table-header-cell text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="table-body divide-y divide-[rgba(70,96,103,0.08)]">
                {filteredCustomers.map((customer) => {
                  const customerBalance = data.invoices
                    .filter((invoice) => invoice.customerId === customer.id)
                    .reduce((sum, invoice) => sum + (Number(invoice.balance) || 0), 0);

                  return (
                    <tr
                      key={customer.id}
                      onClick={() => openLedger(customer.id)}
                      className={`table-row cursor-pointer group ${ledgerCustId === customer.id ? 'table-row-selected' : ''}`}
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary-100 text-primary-700">
                            <Users size={20} />
                          </div>
                          <div>
                            <p className="text-lg font-bold text-[var(--ink)]">{customer.name}</p>
                            {customerBalance > 0 ? (
                              <p className="text-xs font-bold text-[var(--rose-text)]">Due: {formatMoney(customerBalance)}</p>
                            ) : (
                              <p className="text-xs font-medium text-[var(--ink-soft)]">{customer.phone || 'No phone'}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      {!ledgerCustId && (
                        <td className="px-6 py-4">
                          <span className={`badge capitalize ${customer.type === 'wholesale' ? 'badge-blue' : 'badge-amber'}`}>
                            {customer.type}
                          </span>
                        </td>
                      )}
                      {!ledgerCustId && <td className="px-6 py-4 text-sm font-medium text-[var(--ink-soft)]">{customer.phone || '-'}</td>}
                      <td className="px-6 py-4 text-right">
                        <div className="flex flex-row-reverse items-center justify-start gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openEdit(customer);
                            }}
                            className="rounded-xl p-2 text-[var(--ink-soft)] transition-colors hover:bg-primary-100 hover:text-primary-700"
                          >
                            <Edit size={18} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openLedger(customer.id);
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
                {filteredCustomers.length === 0 && (
                  <tr>
                    <td colSpan="4" className="py-20 text-center font-medium text-[var(--ink-soft)]">
                      No customers found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {ledgerCustId && activeLedgerCustomer && (
          <div className="glass-panel flex w-1/2 flex-col overflow-hidden animate-in slide-in-from-right-8 duration-300">
            <div className="dashboard-hero rounded-none p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-4xl font-semibold text-white">{activeLedgerCustomer.name}</h3>
                  <p className="mt-1 text-sm font-medium text-white/72">
                    {activeLedgerCustomer.phone || 'No Phone'} • {activeLedgerCustomer.gstin || 'No GSTIN'}
                  </p>
                </div>
                <div className="text-right">
                  <p className="hero-label mb-1">Total Outstanding</p>
                  <p className={`text-2xl font-black ${totalLedgerBalance > 0 ? 'text-amber-200' : 'text-emerald-200'}`}>
                    {formatMoney(totalLedgerBalance)}
                  </p>
                </div>
              </div>

              <div className="mt-5 flex justify-end">
                {openInvoices.length > 0 && (
                  <button type="button" onClick={openReceivePayment} className="theme-button-secondary px-4 py-2 text-sm" style={{ background: '#fffdfa', color: 'var(--ink)' }}>
                    Receive Payment
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
                <div className="py-10 text-center font-medium text-[var(--ink-soft)]">No transaction history.</div>
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
              <h3 className="modal-title">{editingId ? 'Edit Customer' : 'Add New Customer'}</h3>
              <button type="button" onClick={() => setModalOpen(false)} className="text-2xl text-[var(--ink-soft)] transition hover:text-[var(--ink)]">
                &times;
              </button>
            </div>
            <form onSubmit={handleSave} className="p-6 overflow-y-auto">
              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Customer Name</label>
                  <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="theme-input" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Type</label>
                    <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="theme-select">
                      <option value="retail">Retail</option>
                      <option value="wholesale">Wholesale</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Phone</label>
                    <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="theme-input" />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Address</label>
                  <textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} rows={2} className="theme-textarea" />
                </div>
              </div>
              <div className="mt-8 flex justify-end gap-3">
                <button type="button" onClick={() => setModalOpen(false)} className="theme-button-ghost px-5 py-2.5">
                  Cancel
                </button>
                <button type="submit" className="theme-button-primary px-6 py-2.5">
                  Save Customer
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
              <h3 className="modal-title">Receive Payment</h3>
              <button type="button" onClick={() => setPaymentModalOpen(false)} className="text-2xl text-[var(--ink-soft)] transition hover:text-[var(--ink)]">
                &times;
              </button>
            </div>
            <form onSubmit={handleReceivePayment} className="p-6 space-y-4">
              <div>
                <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Invoice</label>
                <select
                  value={paymentForm.invoiceId}
                  onChange={(e) => {
                    const nextInvoice = openInvoices.find((invoice) => invoice.id === e.target.value);
                    setPaymentForm({
                      ...paymentForm,
                      invoiceId: e.target.value,
                      amount: nextInvoice ? String((Number(nextInvoice.balance) || 0).toFixed(2)) : paymentForm.amount
                    });
                  }}
                  className="theme-select"
                >
                  {openInvoices.map((invoice) => (
                    <option key={invoice.id} value={invoice.id}>
                      {invoice.invoiceNo || invoice.id} • Due {formatMoney(invoice.balance)}
                    </option>
                  ))}
                </select>
              </div>
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
                  Save Receipt
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
