import { useState } from 'react';
import { useApp } from '../AppContext';
import { PlusCircle, IndianRupee } from 'lucide-react';

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

export default function ExpensesView() {
  const { data, mutateAndRefresh } = useApp();
  const [isModalOpen, setModalOpen] = useState(false);
  const [activeExpenseId, setActiveExpenseId] = useState(null);
  const [form, setForm] = useState({ category: 'Other', amount: '', paymentMethod: 'cash', paidTo: '', notes: '', expenseDate: '' });

  const categories = [
    'Rent or Lease', 'Electricity', 'Water', 'Internet / Phone',
    'Salaries', 'Travel & Fuel', 'Maintenance', 'Office Supplies',
    'Bank Fees', 'Marketing', 'Taxes', 'Other'
  ];

  const handleSave = async (e) => {
    e.preventDefault();
    if (window.erpApi) {
      await mutateAndRefresh(window.erpApi.createExpense({
         ...form,
         amount: Number(form.amount) || 0
      }));
       setModalOpen(false);
       setForm({ category: 'Other', amount: '', paymentMethod: 'cash', paidTo: '', notes: '', expenseDate: '' });
    }
  };

  const expenses = data.expenses || [];
  const sortedExpenses = [...expenses].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const activeExpense = activeExpenseId
    ? expenses.find((expense) => expense.id === activeExpenseId) || null
    : null;

  const handleExpenseRowKeyDown = (event, expenseId) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();
    setActiveExpenseId(expenseId);
  };

  return (
    <div className="flex flex-col h-full animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between mb-8">
        <div>
           <h2 className="text-5xl font-semibold text-[var(--ink)] tracking-tight">Operating Expenses</h2>
           <p className="font-medium text-[var(--ink-soft)]">Overhead and miscellaneous costs impacting your Net P&amp;L.</p>
        </div>
        <button onClick={() => setModalOpen(true)} className="theme-button-danger">
          <PlusCircle size={20} /> Record Expense
        </button>
      </div>

      <div className="glass-panel table-shell flex-1 overflow-y-auto">
        <table className="w-full text-left border-collapse">
          <thead className="table-head sticky top-0">
            <tr>
              <th className="table-header-cell">Date</th>
              <th className="table-header-cell">Expense No</th>
              <th className="table-header-cell">Category</th>
              <th className="table-header-cell">Paid To</th>
              <th className="table-header-cell">Mode</th>
              <th className="table-header-cell text-right text-rose-700">Amount (₹)</th>
            </tr>
          </thead>
          <tbody className="table-body divide-y divide-[rgba(70,96,103,0.08)]">
            {expenses.length === 0 ? (
               <tr><td colSpan="6" className="py-20 text-center font-medium text-[var(--ink-soft)]">No recorded expenses yet.</td></tr>
            ) : sortedExpenses.map(e => (
                <tr
                  key={e.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setActiveExpenseId(e.id)}
                  onKeyDown={(event) => handleExpenseRowKeyDown(event, e.id)}
                  className="table-row cursor-pointer focus:outline-none focus:bg-[rgba(241,247,245,0.88)]"
                >
                  <td className="px-6 py-4 font-semibold text-[var(--ink)]">{new Date(e.createdAt).toLocaleDateString()}</td>
                  <td className="px-6 py-4 font-bold text-[var(--ink-soft)]">{e.expenseNo}</td>
                  <td className="px-6 py-4 font-bold text-[var(--ink)]">{e.category}</td>
                  <td className="px-6 py-4 font-medium text-[var(--ink-soft)]">{e.paidTo || '-'}</td>
                  <td className="px-6 py-4 text-xs font-bold uppercase text-[var(--ink-soft)]">{e.paymentMethod}</td>
                  <td className="px-6 py-4 font-black text-rose-500 text-right">{Number(e.amount).toFixed(2)}</td>
                </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isModalOpen && (
        <div className="modal-backdrop animate-in fade-in">
          <div className="modal-panel max-w-lg overflow-hidden flex flex-col">
            <div className="modal-header">
              <h3 className="modal-title flex items-center gap-2"><IndianRupee size={18}/> Log Overhead Expense</h3>
              <button onClick={() => setModalOpen(false)} className="text-2xl text-[var(--ink-soft)] transition hover:text-[var(--ink)]">&times;</button>
            </div>
            
            <form onSubmit={handleSave} className="p-6 space-y-5">
               <div className="grid grid-cols-2 gap-4">
                 <div>
                    <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Expense Category <span className="text-rose-500">*</span></label>
                    <select value={form.category} required onChange={e => setForm({...form, category: e.target.value})} className="theme-select">
                       {categories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                 </div>
                 <div>
                    <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Amount (₹) <span className="text-rose-500">*</span></label>
                    <input type="number" required value={form.amount} onChange={e => setForm({...form, amount: e.target.value})} className="theme-input font-bold text-rose-600" />
                 </div>
               </div>

               <div>
                 <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Who did you pay? (Optional)</label>
                 <input placeholder="E.g. Building Manager, Petrol Bunk..." value={form.paidTo} onChange={e => setForm({...form, paidTo: e.target.value})} className="theme-input" />
               </div>

               <div className="grid grid-cols-2 gap-4">
                 <div>
                    <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Payment Method</label>
                    <select value={form.paymentMethod} onChange={e => setForm({...form, paymentMethod: e.target.value})} className="theme-select tracking-wide">
                       <option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option>
                    </select>
                 </div>
                 <div>
                    <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Custom Date (Optional)</label>
                    <input type="date" value={form.expenseDate} onChange={e => setForm({...form, expenseDate: e.target.value})} className="theme-input uppercase text-sm text-[var(--ink-soft)]" />
                 </div>
               </div>

               <div>
                 <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Extra Notes</label>
                 <textarea placeholder="Any context regarding this expense..." value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} rows={2} className="theme-textarea" />
               </div>
               
               <div className="mt-8 flex justify-end gap-3 border-t border-[rgba(70,96,103,0.08)] pt-4">
                 <button type="button" onClick={() => setModalOpen(false)} className="theme-button-ghost px-5 py-2.5">Cancel</button>
                 <button type="submit" className="theme-button-danger px-6 py-2.5">Record Output</button>
               </div>
            </form>
          </div>
        </div>
      )}

      {activeExpense && (
        <div className="modal-backdrop">
          <div className="modal-panel max-w-3xl">
            <div className="modal-header">
              <div>
                <h3 className="modal-title">Expense Details</h3>
                <p className="mt-1 text-sm font-medium text-[var(--ink-soft)]">{activeExpense.expenseNo}</p>
              </div>
              <button
                type="button"
                onClick={() => setActiveExpenseId(null)}
                className="text-2xl text-[var(--ink-soft)] transition hover:text-[var(--ink)]"
              >
                &times;
              </button>
            </div>

            <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]">
              <div className="space-y-6">
                <div className="section-card p-5">
                  <p className="muted-kicker">Expense Info</p>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--ink-soft)]">Category</p>
                      <p className="mt-2 text-2xl font-semibold text-[var(--ink)]">{activeExpense.category}</p>
                    </div>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--ink-soft)]">Date</p>
                      <p className="mt-2 text-lg font-semibold text-[var(--ink)]">{formatDateTime(activeExpense.createdAt)}</p>
                    </div>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--ink-soft)]">Paid To</p>
                      <p className="mt-2 text-lg font-semibold text-[var(--ink)]">{activeExpense.paidTo || '-'}</p>
                    </div>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--ink-soft)]">Payment Method</p>
                      <p className="mt-2 text-lg font-semibold uppercase text-[var(--ink)]">{activeExpense.paymentMethod || 'cash'}</p>
                    </div>
                  </div>
                </div>

                {activeExpense.notes && (
                  <div className="section-card p-5">
                    <p className="muted-kicker">Notes</p>
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[var(--ink)]">
                      {activeExpense.notes}
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <div className="section-card p-5">
                  <p className="muted-kicker">Amount</p>
                  <p className="mt-3 text-5xl font-black text-rose-600">₹{Number(activeExpense.amount || 0).toFixed(2)}</p>
                  <p className="mt-3 text-sm leading-6 text-[var(--ink-soft)]">
                    Logged as an operating expense and reflected in the accounts reports.
                  </p>
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setActiveExpenseId(null)}
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
    </div>
  );
}
