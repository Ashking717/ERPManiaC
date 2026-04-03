import { useEffect, useState } from 'react';
import {
  Activity,
  AlertCircle,
  Download,
  FileLock2,
  FileText,
  History,
  PieChart,
  Receipt,
  ShieldCheck,
  TrendingUp
} from 'lucide-react';
import { useApp } from '../AppContext';
import PeriodSelector from './PeriodSelector';
import { filterRecordsByPeriod, formatPeriodLabel, getTodayDateInput } from '../utils/dateFilters';

const formatCurrency = (value) => `₹${(Number(value) || 0).toFixed(2)}`;
const formatPercent = (value) => `${(Number(value) || 0).toFixed(2)}%`;
const formatSignedCurrency = (value) => {
  const numericValue = Number(value) || 0;
  return `${numericValue > 0 ? '+' : numericValue < 0 ? '-' : ''}₹${Math.abs(numericValue).toFixed(2)}`;
};

function createDefaultNoteForm(direction = 'outward', noteDate = getTodayDateInput()) {
  return {
    direction,
    noteType: 'credit',
    referenceType: direction === 'outward' ? 'invoice' : 'purchase',
    referenceId: '',
    noteDate,
    referenceNo: '',
    partyName: '',
    partyGstin: '',
    taxableValue: '',
    gstRate: '',
    notes: ''
  };
}

function createDefaultFilingForm() {
  return {
    gstr1: true,
    gstr3b: true,
    acknowledgementNo: '',
    notes: '',
    lockPeriod: true
  };
}

function formatStatusTone(status) {
  if (status === 'attention') {
    return 'border-amber-200 bg-amber-50/80 text-amber-900';
  }

  if (status === 'review') {
    return 'border-sky-200 bg-sky-50/80 text-sky-900';
  }

  if (status === 'info') {
    return 'border-violet-200 bg-violet-50/80 text-violet-900';
  }

  return 'border-emerald-200 bg-emerald-50/80 text-emerald-900';
}

function escapeCsvValue(value) {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function buildCsvContent(headers, rows) {
  return [headers, ...rows]
    .map((row) => row.map((value) => escapeCsvValue(value)).join(','))
    .join('\n');
}

async function saveExportFile({ fileName, content, extension, mimeType, title }) {
  if (window.erpApi?.saveExportFile) {
    const response = await window.erpApi.saveExportFile({
      fileName,
      content,
      extension,
      title
    });

    if (response && typeof response === 'object' && Object.prototype.hasOwnProperty.call(response, 'ok')) {
      if (!response.ok) {
        throw new Error(response.error || 'Failed to save export');
      }

      return response.data;
    }

    return response;
  }

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
  return { saved: true, browserDownload: true };
}

function toLocalMiddayIso(dateInput) {
  const safeDate = String(dateInput || '').trim();
  if (!safeDate) {
    return null;
  }

  const parsed = new Date(`${safeDate}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function ExportButton({ label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="gst-export-button theme-button-secondary rounded-full px-4 py-2 text-sm"
    >
      <Download size={16} /> {label}
    </button>
  );
}

function ReportMetricCard({ title, value, detail }) {
  return (
    <div className="stat-card">
      <h3 className="muted-kicker mb-2">{title}</h3>
      <p className="text-3xl font-black text-[var(--ink)]">{value}</p>
      <p className="mt-2 text-sm text-[var(--ink-soft)]">{detail}</p>
    </div>
  );
}

function CompactTaxCard({ title, aggregate, description, signed = false }) {
  return (
    <div className="gst-summary-card section-card">
      <p className="muted-kicker mb-1">{title}</p>
      <div className="gst-summary-copy">
        <p className="gst-summary-value font-black text-[var(--ink)]">
          {signed ? formatSignedCurrency(aggregate?.taxableValue) : formatCurrency(aggregate?.taxableValue)}
        </p>
        <p className="gst-summary-description font-semibold text-[var(--ink-soft)]">
          {description}
        </p>
      </div>
      <div className="gst-summary-metrics text-sm font-semibold text-[var(--ink-soft)]">
        <div className="gst-summary-metric-box">
          <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--ink-soft)]">Docs</p>
          <p className="gst-summary-metric-value font-black text-[var(--ink)]">{aggregate?.documentCount || 0}</p>
        </div>
        <div className="gst-summary-metric-box">
          <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--ink-soft)]">GST</p>
          <p className="gst-summary-metric-value font-black text-[var(--ink)]">
            {signed ? formatSignedCurrency(aggregate?.gstAmount) : formatCurrency(aggregate?.gstAmount)}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function ReportsView() {
  const { data, mutateAndRefresh } = useApp();
  const [activeReport, setActiveReport] = useState('overview');
  const [reportPeriod, setReportPeriod] = useState('monthly');
  const [reportFocusDate, setReportFocusDate] = useState(getTodayDateInput);
  const [trialBalance, setTrialBalance] = useState([]);
  const [pnlData, setPnlData] = useState(null);
  const [gstFilingData, setGstFilingData] = useState(null);
  const [reportError, setReportError] = useState('');
  const [noteForm, setNoteForm] = useState(() => createDefaultNoteForm('outward', getTodayDateInput()));
  const [filingForm, setFilingForm] = useState(createDefaultFilingForm());
  const [isFetching, setIsFetching] = useState(false);
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [isSavingFiling, setIsSavingFiling] = useState(false);
  const [isUnlockingPeriod, setIsUnlockingPeriod] = useState(false);

  const safeInvoices = filterRecordsByPeriod(data?.invoices || [], reportPeriod, reportFocusDate);
  const safePurchases = filterRecordsByPeriod(data?.purchases || [], reportPeriod, reportFocusDate);
  const safeExpenses = filterRecordsByPeriod(data?.expenses || [], reportPeriod, reportFocusDate);
  const periodLabel = formatPeriodLabel(reportPeriod, reportFocusDate);
  const isGstEnabled = Boolean(data?.uiSettings?.billingGstEnabled);

  const totalSales = safeInvoices.reduce((sum, invoice) => sum + (Number(invoice?.total) || 0), 0);
  const totalReceived = safeInvoices.reduce((sum, invoice) => sum + (Number(invoice?.paidAmount) || 0), 0);
  const pendingCollection = safeInvoices.reduce((sum, invoice) => sum + (Number(invoice?.balance) || 0), 0);
  const totalPurchases = safePurchases.reduce((sum, purchase) => sum + (Number(purchase?.total) || 0), 0);
  const totalExpenses = safeExpenses.reduce((sum, expense) => sum + (Number(expense?.amount) || 0), 0);

  const currentPeriodLocked = Boolean(gstFilingData?.filingStatus?.isLocked);
  const activeLock = gstFilingData?.filingStatus?.activeLock || null;
  const outwardReferenceOptions = gstFilingData?.gstr1?.invoiceRows || [];
  const inwardReferenceOptions = gstFilingData?.inwardRegister?.purchaseRows || [];
  const noteReferenceOptions =
    noteForm.direction === 'outward' ? outwardReferenceOptions : inwardReferenceOptions;

  useEffect(() => {
    if (!isGstEnabled && activeReport === 'gst-filing') {
      setActiveReport('overview');
    }
  }, [isGstEnabled, activeReport]);

  useEffect(() => {
    async function load() {
      setIsFetching(true);
      setReportError('');
      try {
        if (activeReport === 'trial-balance') {
          if (!window.erpApi?.getTrialBalance) {
            throw new Error('Restart the app to load the latest Trial Balance module.');
          }
          const res = await window.erpApi?.getTrialBalance({
            period: reportPeriod,
            inputDate: reportFocusDate
          });
          if (!res?.ok) {
            throw new Error(res?.error || 'Failed to load trial balance');
          }
          setTrialBalance(res.data?.rows || []);
          setPnlData(null);
          setGstFilingData(null);
        } else if (activeReport === 'pnl') {
          if (!window.erpApi?.getDailyProfitLoss) {
            throw new Error('Restart the app to load the latest P&L module.');
          }
          const res = await window.erpApi?.getDailyProfitLoss({
            period: reportPeriod,
            inputDate: reportFocusDate
          });
          if (!res?.ok) {
            throw new Error(res?.error || 'Failed to load P&L data');
          }
          setPnlData(res.data?.metrics || null);
          setTrialBalance([]);
          setGstFilingData(null);
        } else if (activeReport === 'gst-filing') {
          if (!window.erpApi?.getGstFilingData) {
            throw new Error('Restart the app to load the GST filing workspace.');
          }
          const res = await window.erpApi?.getGstFilingData({
            period: reportPeriod,
            inputDate: reportFocusDate
          });
          if (!res?.ok) {
            throw new Error(res?.error || 'Failed to load GST filing data');
          }
          setGstFilingData(res.data || null);
          setTrialBalance([]);
          setPnlData(null);
        } else {
          setTrialBalance([]);
          setPnlData(null);
          setGstFilingData(null);
        }
      } catch (error) {
        console.warn('Failed internal report fetch', error);
        setReportError(error?.message || 'Failed to load the selected report.');
        if (activeReport === 'trial-balance') {
          setTrialBalance([]);
        }
        if (activeReport === 'pnl') {
          setPnlData(null);
        }
        if (activeReport === 'gst-filing') {
          setGstFilingData(null);
        }
      } finally {
        setIsFetching(false);
      }
    }

    if (window.erpApi && activeReport !== 'overview') {
      load();
    }
  }, [activeReport, reportPeriod, reportFocusDate, data]);

  useEffect(() => {
    setNoteForm(createDefaultNoteForm('outward', reportFocusDate));
    setFilingForm(createDefaultFilingForm());
  }, [reportPeriod, reportFocusDate]);

  const handleExportGstr1 = async () => {
    if (!gstFilingData) {
      return;
    }

    const fileName = `ERPManiaC-GSTR1-${gstFilingData.periodKey}.csv`;
    const content = buildCsvContent(
      ['Invoice No', 'Date', 'Customer', 'Customer GSTIN', 'Type', 'Tax Rate', 'Taxable Value', 'SGST', 'CGST', 'GST Total', 'Invoice Total'],
      (gstFilingData.gstr1?.invoiceRows || []).map((row) => [
        row.invoiceNo,
        row.date,
        row.customerName,
        row.customerGstin || '',
        row.customerGstin ? 'B2B' : row.gstAmount > 0 ? 'B2C' : 'Nil Rated',
        formatPercent(row.gstRate),
        row.taxableValue.toFixed(2),
        row.sgst.toFixed(2),
        row.cgst.toFixed(2),
        row.gstAmount.toFixed(2),
        row.total.toFixed(2)
      ])
    );

    try {
      await saveExportFile({
        fileName,
        content,
        extension: 'csv',
        mimeType: 'text/csv;charset=utf-8;',
        title: 'Save GSTR-1 CSV'
      });
    } catch (error) {
      alert(error.message || 'Failed to export GSTR-1 CSV');
    }
  };

  const handleExportGstr3b = async () => {
    if (!gstFilingData) {
      return;
    }

    const outward = gstFilingData.gstr3b?.outwardTaxableSupplies || {};
    const nilRated = gstFilingData.gstr3b?.outwardNilRatedSupplies || {};
    const inward = gstFilingData.gstr3b?.inwardEligibleItc || {};
    const inwardNonGst = gstFilingData.gstr3b?.inwardNonGstPurchases || {};
    const setoff = gstFilingData.gstr3b?.setoff || {};

    const fileName = `ERPManiaC-GSTR3B-${gstFilingData.periodKey}.csv`;
    const content = buildCsvContent(
      ['Section', 'Taxable Value', 'SGST', 'CGST', 'GST Total', 'Document Count'],
      [
        ['Outward Taxable Supplies', outward.taxableValue?.toFixed?.(2) || '0.00', outward.sgst?.toFixed?.(2) || '0.00', outward.cgst?.toFixed?.(2) || '0.00', outward.gstAmount?.toFixed?.(2) || '0.00', outward.documentCount || 0],
        ['Outward Nil Rated Supplies', nilRated.taxableValue?.toFixed?.(2) || '0.00', nilRated.sgst?.toFixed?.(2) || '0.00', nilRated.cgst?.toFixed?.(2) || '0.00', nilRated.gstAmount?.toFixed?.(2) || '0.00', nilRated.documentCount || 0],
        ['Eligible ITC on Purchases', inward.taxableValue?.toFixed?.(2) || '0.00', inward.sgst?.toFixed?.(2) || '0.00', inward.cgst?.toFixed?.(2) || '0.00', inward.gstAmount?.toFixed?.(2) || '0.00', inward.documentCount || 0],
        ['Non GST Purchases', inwardNonGst.taxableValue?.toFixed?.(2) || '0.00', inwardNonGst.sgst?.toFixed?.(2) || '0.00', inwardNonGst.cgst?.toFixed?.(2) || '0.00', inwardNonGst.gstAmount?.toFixed?.(2) || '0.00', inwardNonGst.documentCount || 0],
        ['Net SGST Payable', '0.00', setoff.payableSgst?.toFixed?.(2) || '0.00', '0.00', setoff.payableSgst?.toFixed?.(2) || '0.00', ''],
        ['Net CGST Payable', '0.00', '0.00', setoff.payableCgst?.toFixed?.(2) || '0.00', setoff.payableCgst?.toFixed?.(2) || '0.00', ''],
        ['Carry Forward ITC', '0.00', setoff.carryForwardSgst?.toFixed?.(2) || '0.00', setoff.carryForwardCgst?.toFixed?.(2) || '0.00', setoff.carryForwardTotal?.toFixed?.(2) || '0.00', '']
      ]
    );

    try {
      await saveExportFile({
        fileName,
        content,
        extension: 'csv',
        mimeType: 'text/csv;charset=utf-8;',
        title: 'Save GSTR-3B CSV'
      });
    } catch (error) {
      alert(error.message || 'Failed to export GSTR-3B CSV');
    }
  };

  const handleExportPurchases = async () => {
    if (!gstFilingData) {
      return;
    }

    const fileName = `ERPManiaC-Input-GST-${gstFilingData.periodKey}.csv`;
    const content = buildCsvContent(
      ['Purchase No', 'Date', 'Supplier', 'Supplier GSTIN', 'Tax Rate', 'Taxable Value', 'SGST', 'CGST', 'GST Total', 'Bill Total', 'Paid', 'Due'],
      (gstFilingData.inwardRegister?.purchaseRows || []).map((row) => [
        row.purchaseNo,
        row.date,
        row.supplierName,
        row.supplierGstin || '',
        formatPercent(row.gstRate),
        row.taxableValue.toFixed(2),
        row.sgst.toFixed(2),
        row.cgst.toFixed(2),
        row.gstAmount.toFixed(2),
        row.total.toFixed(2),
        row.paidAmount.toFixed(2),
        row.dueAmount.toFixed(2)
      ])
    );

    try {
      await saveExportFile({
        fileName,
        content,
        extension: 'csv',
        mimeType: 'text/csv;charset=utf-8;',
        title: 'Save Purchase ITC CSV'
      });
    } catch (error) {
      alert(error.message || 'Failed to export purchase ITC CSV');
    }
  };

  const handleExportPortalJson = async () => {
    if (!gstFilingData?.portalExport) {
      return;
    }

    try {
      await saveExportFile({
        fileName: `ERPManiaC-GST-Portal-${gstFilingData.periodKey}.json`,
        content: JSON.stringify(gstFilingData.portalExport, null, 2),
        extension: 'json',
        mimeType: 'application/json;charset=utf-8;',
        title: 'Save GST Portal JSON'
      });
    } catch (error) {
      alert(error.message || 'Failed to export GST portal JSON');
    }
  };

  const handleNoteDirectionChange = (direction) => {
    setNoteForm(createDefaultNoteForm(direction, noteForm.noteDate || reportFocusDate));
  };

  const handleReferenceTypeChange = (referenceType) => {
    setNoteForm((current) => ({
      ...current,
      referenceType,
      referenceId: '',
      noteDate: current.noteDate,
      referenceNo: '',
      partyName: '',
      partyGstin: '',
      taxableValue: '',
      gstRate: ''
    }));
  };

  const handleReferenceSelect = (referenceId) => {
    const selectedReference = noteReferenceOptions.find((entry) => entry.id === referenceId) || null;

    if (!selectedReference) {
      setNoteForm((current) => ({
        ...current,
        referenceId,
        referenceNo: '',
        partyName: '',
        partyGstin: ''
      }));
      return;
    }

    if (noteForm.direction === 'outward') {
      setNoteForm((current) => ({
        ...current,
        referenceId,
        referenceNo: selectedReference.invoiceNo,
        partyName: selectedReference.customerName,
        partyGstin: selectedReference.customerGstin || '',
        taxableValue: selectedReference.taxableValue.toFixed(2),
        gstRate: selectedReference.gstRate.toFixed(2)
      }));
      return;
    }

    setNoteForm((current) => ({
      ...current,
      referenceId,
      referenceNo: selectedReference.purchaseNo,
      partyName: selectedReference.supplierName,
      partyGstin: selectedReference.supplierGstin || '',
      taxableValue: selectedReference.taxableValue.toFixed(2),
      gstRate: selectedReference.gstRate.toFixed(2)
    }));
  };

  const handleSaveNote = async () => {
    if (!window.erpApi) {
      return;
    }

    const payload = {
      direction: noteForm.direction,
      noteType: noteForm.noteType,
      referenceType: noteForm.referenceType,
      referenceId: noteForm.referenceType === 'manual' ? '' : noteForm.referenceId,
      inputDate: noteForm.noteDate,
      createdAt: toLocalMiddayIso(noteForm.noteDate),
      referenceNo: noteForm.referenceNo,
      partyName: noteForm.partyName,
      partyGstin: noteForm.partyGstin,
      taxableValue: Number(noteForm.taxableValue || 0),
      gstRate: Number(noteForm.gstRate || 0),
      notes: noteForm.notes
    };

    try {
      setIsSavingNote(true);
      await mutateAndRefresh(window.erpApi.upsertGstNote(payload));
      setNoteForm(createDefaultNoteForm(noteForm.direction, noteForm.noteDate || reportFocusDate));
    } catch (error) {
      alert(error.message || 'Failed to save GST note');
    } finally {
      setIsSavingNote(false);
    }
  };

  const handleDeleteNote = async (noteId) => {
    if (!window.erpApi || !window.confirm('Delete this GST note?')) {
      return;
    }

    try {
      await mutateAndRefresh(window.erpApi.deleteGstNote(noteId));
    } catch (error) {
      alert(error.message || 'Failed to delete GST note');
    }
  };

  const handleRecordFiling = async () => {
    if (!window.erpApi) {
      return;
    }

    const returnTypes = [];
    if (filingForm.gstr1) {
      returnTypes.push('GSTR-1');
    }
    if (filingForm.gstr3b) {
      returnTypes.push('GSTR-3B');
    }

    try {
      setIsSavingFiling(true);
      await mutateAndRefresh(
        window.erpApi.recordGstFiling({
          period: reportPeriod,
          inputDate: reportFocusDate,
          returnTypes,
          acknowledgementNo: filingForm.acknowledgementNo,
          notes: filingForm.notes,
          lockPeriod: filingForm.lockPeriod
        })
      );
      setFilingForm(createDefaultFilingForm());
    } catch (error) {
      alert(error.message || 'Failed to record GST filing');
    } finally {
      setIsSavingFiling(false);
    }
  };

  const handleUnlockPeriod = async () => {
    if (!window.erpApi || !activeLock) {
      return;
    }

    try {
      setIsUnlockingPeriod(true);
      await mutateAndRefresh(
        window.erpApi.unlockGstPeriod({
          lockId: activeLock.id,
          period: reportPeriod,
          inputDate: reportFocusDate
        })
      );
    } catch (error) {
      alert(error.message || 'Failed to unlock GST period');
    } finally {
      setIsUnlockingPeriod(false);
    }
  };

  return (
    <div className="flex h-full flex-col animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h2 className="text-5xl font-semibold text-[var(--ink)]">Financial Reports & Accounting</h2>
          <p className="mt-3 text-sm leading-6 text-[var(--ink-soft)]">
            Review summaries and accounting views for {periodLabel}.
          </p>
        </div>
      </div>

      <div className="mb-6">
        <PeriodSelector
          period={reportPeriod}
          focusDate={reportFocusDate}
          onPeriodChange={setReportPeriod}
          onFocusDateChange={setReportFocusDate}
          label="Report Range"
          summary={`Running the selected report for ${periodLabel}.`}
        />
      </div>

      <div className="mb-6 flex flex-wrap gap-4">
        <button type="button" onClick={() => setActiveReport('overview')} className={`${activeReport === 'overview' ? 'theme-button-primary' : 'theme-button-secondary'} rounded-full px-6 py-2.5`}>
          <PieChart size={18} /> Financial Overview
        </button>
        <button type="button" onClick={() => setActiveReport('trial-balance')} className={`${activeReport === 'trial-balance' ? 'theme-button-primary' : 'theme-button-secondary'} rounded-full px-6 py-2.5`}>
          <FileText size={18} /> Trial Balance
        </button>
        <button type="button" onClick={() => setActiveReport('pnl')} className={`${activeReport === 'pnl' ? 'theme-button-primary' : 'theme-button-secondary'} rounded-full px-6 py-2.5`}>
          <Activity size={18} /> P&amp;L Analysis
        </button>
        {isGstEnabled && (
          <button type="button" onClick={() => setActiveReport('gst-filing')} className={`${activeReport === 'gst-filing' ? 'theme-button-primary' : 'theme-button-secondary'} rounded-full px-6 py-2.5`}>
            <Receipt size={18} /> GST Filing
          </button>
        )}
      </div>

      {activeReport === 'overview' && (
        <div className="animate-in space-y-8 fade-in zoom-in-95 duration-500">
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <ReportMetricCard title="Sales In Period" value={formatCurrency(totalSales)} detail={`${safeInvoices.length} invoice(s) in ${periodLabel}`} />
            <ReportMetricCard title="Aggregate Outflow" value={formatCurrency(totalPurchases + totalExpenses)} detail="Purchases plus expenses posted in the selected range" />
            <ReportMetricCard title="Pending Collection" value={formatCurrency(pendingCollection)} detail={`Received ${formatCurrency(totalReceived)} against the filtered invoices`} />
          </div>

          <div className="glass-panel p-8">
            <h3 className="mb-2 flex items-center gap-2 text-3xl font-semibold text-[var(--ink)]">
              <TrendingUp size={24} className="text-emerald-600" />
              Core System Logs
            </h3>
            <p className="font-medium text-[var(--ink-soft)]">
              Use the balance, P&amp;L, and GST Filing tabs above to calculate accounting views for {periodLabel} with the same period selector.
            </p>
          </div>
        </div>
      )}

      {activeReport === 'trial-balance' && (
        <div className="glass-panel flex flex-1 flex-col overflow-hidden p-0 animate-in slide-in-from-right-8 duration-300">
          <div className="panel-header">
            <div>
              <h3 className="panel-title">Trial Balance Sheet</h3>
              <p className="panel-subtitle">Ledger balances as of {periodLabel}.</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="theme-pill theme-pill-accent">{periodLabel}</span>
              {isFetching && <span className="animate-pulse text-sm font-bold text-[var(--ink-soft)]">Running calculations...</span>}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            <table className="w-full text-left">
              <thead className="table-head sticky top-0 z-10">
                <tr>
                  <th className="table-header-cell">Account Name</th>
                  <th className="table-header-cell text-right text-emerald-700">Debit Balance (₹)</th>
                  <th className="table-header-cell text-right text-rose-700">Credit Balance (₹)</th>
                </tr>
              </thead>
              <tbody className="table-body divide-y divide-[rgba(70,96,103,0.08)]">
                {trialBalance.length === 0 && !isFetching && (
                  <tr>
                    <td colSpan="3" className="py-20 text-center font-medium text-[var(--ink-soft)]">
                      No trial balance records computed for this period.
                    </td>
                  </tr>
                )}
                {trialBalance.map((row) => (
                  <tr key={row.account} className="table-row">
                    <td className="px-6 py-4 font-bold text-[var(--ink)]">{row.account}</td>
                    <td className="px-6 py-4 text-right font-bold text-emerald-600">{row.debit > 0 ? row.debit.toFixed(2) : '-'}</td>
                    <td className="px-6 py-4 text-right font-bold text-rose-600">{row.credit > 0 ? row.credit.toFixed(2) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeReport === 'pnl' && (
        <div className="glass-panel flex flex-1 flex-col overflow-hidden p-6 animate-in slide-in-from-left-8 duration-300">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="flex items-center gap-2 text-4xl font-semibold text-[var(--ink)]">Net Value Tracking</h3>
              <p className="mt-2 text-sm text-[var(--ink-soft)]">Margin and cashflow for {periodLabel}.</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="theme-pill theme-pill-accent">{periodLabel}</span>
              {isFetching && <span className="animate-pulse text-sm font-bold text-[var(--ink-soft)]">Running tracking algorithms...</span>}
            </div>
          </div>

          {pnlData ? (
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-6 border-b border-[rgba(70,96,103,0.08)] pb-6 xl:grid-cols-2">
                <div className="section-card p-6">
                  <p className="muted-kicker mb-1">Cost Of Goods Sold</p>
                  <p className="text-3xl font-black text-[var(--ink)]">{formatCurrency(pnlData.cogs)}</p>
                  <p className="mt-2 text-xs font-semibold text-[var(--ink-soft)]">Inventory baseline cost for items sold in the selected period.</p>
                </div>
                <div className="section-card bg-emerald-50/70 p-6">
                  <p className="muted-kicker mb-1 text-emerald-700">Gross Profit</p>
                  <p className="text-3xl font-black text-emerald-700">{formatCurrency(pnlData.grossProfit)}</p>
                  <p className="mt-2 text-xs font-semibold text-emerald-700/70">Margin above recorded unit costs for this range.</p>
                </div>
              </div>

              <div className="dashboard-hero flex items-center justify-between rounded-[1.75rem] p-8 shadow-xl">
                <div>
                  <p className="hero-label mb-1">Final Net Cashflow</p>
                  <p className="mt-1 max-w-sm text-xs font-semibold text-white/60">
                    Deducts outward cash and operating expenses from actual collections in {periodLabel}.
                  </p>
                </div>
                <div className="text-right">
                  <p className={`text-5xl font-black tracking-tight ${pnlData.netCashflow >= 0 ? 'text-emerald-200' : 'text-amber-200'}`}>
                    {pnlData.netCashflow >= 0 ? '+' : ''}{formatCurrency(pnlData.netCashflow)}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center text-[var(--ink-soft)]">
              <AlertCircle size={48} className="mb-4 opacity-50" />
              <p className="text-lg font-bold">No tracking data found for this period.</p>
            </div>
          )}
        </div>
      )}

      {isGstEnabled && activeReport === 'gst-filing' && (
        <div className="gst-workspace animate-in fade-in duration-300">
          <div className="glass-panel gst-hero">
            <div className="gst-hero-grid">
              <div>
                <h3 className="flex items-center gap-2 text-4xl font-semibold text-[var(--ink)]">
                  <Receipt size={24} className="text-emerald-700" />
                  GST Filing Workspace
                </h3>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-soft)]">
                  Prepare GSTR-1 and GSTR-3B working summaries from ERPMania invoices, purchases, HSN groupings, and credit/debit notes for {periodLabel}. Final submission should still be completed through the official GST portal or your authorized GSP workflow.
                </p>
                {gstFilingData && (
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-xs font-bold uppercase tracking-[0.22em] text-[var(--ink-soft)]">
                    <span>Business GSTIN: {gstFilingData.business?.gstin || 'Not configured'}</span>
                    <span>{currentPeriodLocked ? 'Locked' : 'Open'}</span>
                  </div>
                )}
              </div>

              <div className="gst-export-grid">
                <ExportButton label="Export GSTR-1 CSV" onClick={handleExportGstr1} />
                <ExportButton label="Export GSTR-3B CSV" onClick={handleExportGstr3b} />
                <ExportButton label="Export Purchase ITC CSV" onClick={handleExportPurchases} />
                <ExportButton label="Export Portal JSON" onClick={handleExportPortalJson} />
              </div>
            </div>
          </div>

          {gstFilingData ? (
            <>
              <div className="grid grid-cols-1 gap-5 xl:grid-cols-4">
                <ReportMetricCard title="Outward Taxable Value" value={formatCurrency(gstFilingData.summary?.outwardTaxableValue)} detail="Taxable outward supplies after note adjustments" />
                <ReportMetricCard title="Output GST" value={formatCurrency(gstFilingData.summary?.outwardTax?.total)} detail={`SGST ${formatCurrency(gstFilingData.summary?.outwardTax?.sgst)} + CGST ${formatCurrency(gstFilingData.summary?.outwardTax?.cgst)}`} />
                <ReportMetricCard title="Eligible ITC" value={formatCurrency(gstFilingData.summary?.inputCredit?.total)} detail={`SGST ${formatCurrency(gstFilingData.summary?.inputCredit?.sgst)} + CGST ${formatCurrency(gstFilingData.summary?.inputCredit?.cgst)}`} />
                <ReportMetricCard title="Net GST Payable" value={formatCurrency(gstFilingData.summary?.netPayable?.total)} detail={`Carry forward credit ${formatCurrency(gstFilingData.summary?.carryForwardCredit?.total)}`} />
              </div>

              <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
                {(gstFilingData.diagnostics || []).map((item) => (
                  <div key={item.id} className={`gst-diagnostic-card section-card border ${formatStatusTone(item.status)}`}>
                    <p className="text-[11px] font-black uppercase tracking-[0.22em]">{item.status}</p>
                    <h4 className="mt-2 text-xl font-semibold">{item.title}</h4>
                    <p className="mt-2 text-sm leading-6 opacity-80">{item.detail}</p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(24rem,0.85fr)]">
                <div className="glass-panel gst-card-pad">
                  <div className="mb-5 flex items-center justify-between gap-3">
                    <div>
                      <h4 className="flex items-center gap-2 text-3xl font-semibold text-[var(--ink)]">
                        <ShieldCheck size={22} className="text-emerald-700" />
                        Filing Controls
                      </h4>
                      <p className="mt-2 text-sm text-[var(--ink-soft)]">Record when this GST period was filed and optionally lock it from further transaction edits.</p>
                    </div>
                    <span className={`theme-pill ${currentPeriodLocked ? 'theme-pill-warning' : 'theme-pill-accent'}`}>
                      {currentPeriodLocked ? 'Locked' : 'Open'}
                    </span>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="section-card flex items-center gap-3 p-4">
                      <input
                        type="checkbox"
                        checked={filingForm.gstr1}
                        onChange={(event) => setFilingForm((current) => ({ ...current, gstr1: event.target.checked }))}
                        className="h-4 w-4 rounded border-slate-300 text-primary-600"
                      />
                      <div>
                        <p className="font-semibold text-[var(--ink)]">GSTR-1</p>
                        <p className="text-sm text-[var(--ink-soft)]">Outward supply return prepared for this period</p>
                      </div>
                    </label>
                    <label className="section-card flex items-center gap-3 p-4">
                      <input
                        type="checkbox"
                        checked={filingForm.gstr3b}
                        onChange={(event) => setFilingForm((current) => ({ ...current, gstr3b: event.target.checked }))}
                        className="h-4 w-4 rounded border-slate-300 text-primary-600"
                      />
                      <div>
                        <p className="font-semibold text-[var(--ink)]">GSTR-3B</p>
                        <p className="text-sm text-[var(--ink-soft)]">Monthly summary return prepared for this period</p>
                      </div>
                    </label>
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Portal Acknowledgement / ARN</label>
                      <input
                        value={filingForm.acknowledgementNo}
                        onChange={(event) => setFilingForm((current) => ({ ...current, acknowledgementNo: event.target.value }))}
                        placeholder="Optional reference no."
                        className="theme-input"
                      />
                    </div>
                    <label className="section-card flex items-center gap-3 p-4 self-end">
                      <input
                        type="checkbox"
                        checked={filingForm.lockPeriod}
                        onChange={(event) => setFilingForm((current) => ({ ...current, lockPeriod: event.target.checked }))}
                        className="h-4 w-4 rounded border-slate-300 text-primary-600"
                      />
                      <div>
                        <p className="font-semibold text-[var(--ink)]">Lock Filed Period</p>
                        <p className="text-sm text-[var(--ink-soft)]">Prevents invoice, purchase, and GST note changes in this period</p>
                      </div>
                    </label>
                  </div>

                  <div className="mt-4">
                    <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Filing Notes</label>
                    <textarea
                      rows={3}
                      value={filingForm.notes}
                      onChange={(event) => setFilingForm((current) => ({ ...current, notes: event.target.value }))}
                      className="theme-input min-h-[6rem]"
                      placeholder="Optional filing notes"
                    />
                  </div>

                  <div className="mt-5 flex flex-wrap gap-3">
                    <button type="button" onClick={handleRecordFiling} disabled={isSavingFiling} className="theme-button-primary px-5 py-2.5 disabled:cursor-not-allowed disabled:opacity-60">
                      <FileLock2 size={18} /> {isSavingFiling ? 'Saving...' : 'Record Filing'}
                    </button>
                    {currentPeriodLocked && (
                      <button type="button" onClick={handleUnlockPeriod} disabled={isUnlockingPeriod} className="theme-button-secondary px-5 py-2.5 disabled:cursor-not-allowed disabled:opacity-60">
                        {isUnlockingPeriod ? 'Unlocking...' : 'Unlock Period'}
                      </button>
                    )}
                  </div>
                </div>

                <div className="glass-panel gst-card-pad">
                  <div className="mb-5 flex items-center gap-2">
                    <History size={20} className="text-[var(--ink-soft)]" />
                    <h4 className="text-3xl font-semibold text-[var(--ink)]">Filing History</h4>
                  </div>
                  <div className="space-y-3">
                    {(gstFilingData.filingStatus?.allHistory || []).length === 0 && (
                      <div className="section-card p-4 text-sm font-medium text-[var(--ink-soft)]">
                        No GST filing history recorded yet.
                      </div>
                    )}
                    {(gstFilingData.filingStatus?.allHistory || []).slice(0, 8).map((entry) => (
                      <div key={entry.id} className="section-card p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-black uppercase tracking-[0.18em] text-[var(--ink-soft)]">{entry.periodLabel}</p>
                            <p className="mt-1 text-lg font-semibold text-[var(--ink)]">{(entry.returnTypes || []).join(' + ') || 'GST Filing'}</p>
                            <p className="mt-2 text-sm text-[var(--ink-soft)]">
                              Filed on {new Date(entry.filedAt).toLocaleString('en-IN')}
                            </p>
                          </div>
                          <span className={`theme-pill ${entry.locked ? 'theme-pill-warning' : 'theme-pill-accent'}`}>
                            {entry.locked ? 'Locked' : 'Unlocked'}
                          </span>
                        </div>
                        {(entry.acknowledgementNo || entry.notes) && (
                          <div className="mt-3 space-y-1 text-sm text-[var(--ink-soft)]">
                            {entry.acknowledgementNo && <p><span className="font-semibold text-[var(--ink)]">ARN:</span> {entry.acknowledgementNo}</p>}
                            {entry.notes && <p className="whitespace-pre-wrap">{entry.notes}</p>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                <div className="glass-panel gst-card-pad">
                  <div className="mb-5 flex items-center justify-between gap-3">
                    <div>
                      <h4 className="text-3xl font-semibold text-[var(--ink)]">GSTR-1 Outward Summary</h4>
                      <p className="mt-2 text-sm text-[var(--ink-soft)]">B2B, B2C, nil-rated, and note-adjusted outward supply totals.</p>
                    </div>
                    <span className="theme-pill theme-pill-accent">{gstFilingData.gstr1?.invoiceRows?.length || 0} docs</span>
                  </div>

                  <div className="gst-summary-grid">
                    <CompactTaxCard title="B2B" aggregate={gstFilingData.gstr1?.registered} description="Invoices with customer GSTIN" />
                    <CompactTaxCard title="B2C" aggregate={gstFilingData.gstr1?.unregistered} description="Taxed invoices without customer GSTIN" />
                    <CompactTaxCard title="Nil Rated" aggregate={gstFilingData.gstr1?.nilRated} description="Sales posted without GST" />
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                    <CompactTaxCard title="Registered Notes" aggregate={gstFilingData.gstr1?.noteRegistered} description="Credit/debit notes linked to GSTIN parties" signed />
                    <CompactTaxCard title="Unregistered Notes" aggregate={gstFilingData.gstr1?.noteUnregistered} description="Credit/debit notes for B2C / walk-in outward supplies" signed />
                  </div>
                </div>

                <div className="glass-panel gst-card-pad">
                  <div className="mb-5 flex items-center justify-between gap-3">
                    <div>
                      <h4 className="text-3xl font-semibold text-[var(--ink)]">GSTR-3B Set-Off</h4>
                      <p className="mt-2 text-sm text-[var(--ink-soft)]">Output tax versus purchase ITC after inward note adjustments.</p>
                    </div>
                    <span className="theme-pill theme-pill-accent">{gstFilingData.periodLabel}</span>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="section-card p-5">
                      <p className="muted-kicker mb-1">Output SGST</p>
                      <p className="text-3xl font-black text-[var(--ink)]">{formatCurrency(gstFilingData.gstr3b?.setoff?.outputSgst)}</p>
                      <p className="mt-2 text-sm font-semibold text-[var(--ink-soft)]">Input SGST used: {formatCurrency(gstFilingData.gstr3b?.setoff?.inputSgst)}</p>
                    </div>
                    <div className="section-card p-5">
                      <p className="muted-kicker mb-1">Output CGST</p>
                      <p className="text-3xl font-black text-[var(--ink)]">{formatCurrency(gstFilingData.gstr3b?.setoff?.outputCgst)}</p>
                      <p className="mt-2 text-sm font-semibold text-[var(--ink-soft)]">Input CGST used: {formatCurrency(gstFilingData.gstr3b?.setoff?.inputCgst)}</p>
                    </div>
                    <div className="section-card bg-amber-50/70 p-5">
                      <p className="muted-kicker mb-1 text-amber-700">Net Payable</p>
                      <p className="text-3xl font-black text-amber-700">{formatCurrency(gstFilingData.gstr3b?.setoff?.payableTotal)}</p>
                      <p className="mt-2 text-sm font-semibold text-amber-700/80">SGST {formatCurrency(gstFilingData.gstr3b?.setoff?.payableSgst)} + CGST {formatCurrency(gstFilingData.gstr3b?.setoff?.payableCgst)}</p>
                    </div>
                    <div className="section-card bg-emerald-50/70 p-5">
                      <p className="muted-kicker mb-1 text-emerald-700">Carry Forward ITC</p>
                      <p className="text-3xl font-black text-emerald-700">{formatCurrency(gstFilingData.gstr3b?.setoff?.carryForwardTotal)}</p>
                      <p className="mt-2 text-sm font-semibold text-emerald-700/80">SGST {formatCurrency(gstFilingData.gstr3b?.setoff?.carryForwardSgst)} + CGST {formatCurrency(gstFilingData.gstr3b?.setoff?.carryForwardCgst)}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div className="glass-panel gst-card-pad">
                  <div className="mb-5">
                    <h4 className="text-3xl font-semibold text-[var(--ink)]">Credit / Debit Notes</h4>
                    <p className="mt-2 text-sm text-[var(--ink-soft)]">Record GST note adjustments that should affect outward tax or input credit for this period.</p>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Direction</label>
                      <select value={noteForm.direction} onChange={(event) => handleNoteDirectionChange(event.target.value)} className="theme-select">
                        <option value="outward">Outward</option>
                        <option value="inward">Inward</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Note Type</label>
                      <select value={noteForm.noteType} onChange={(event) => setNoteForm((current) => ({ ...current, noteType: event.target.value }))} className="theme-select">
                        <option value="credit">Credit Note</option>
                        <option value="debit">Debit Note</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Reference Type</label>
                      <select value={noteForm.referenceType} onChange={(event) => handleReferenceTypeChange(event.target.value)} className="theme-select">
                        <option value={noteForm.direction === 'outward' ? 'invoice' : 'purchase'}>
                          {noteForm.direction === 'outward' ? 'Invoice' : 'Purchase'}
                        </option>
                        <option value="manual">Manual</option>
                      </select>
                    </div>
                    {noteForm.referenceType !== 'manual' && (
                      <div>
                        <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Reference Document</label>
                        <select value={noteForm.referenceId} onChange={(event) => handleReferenceSelect(event.target.value)} className="theme-select">
                          <option value="">Select document</option>
                          {noteReferenceOptions.map((entry) => (
                            <option key={entry.id} value={entry.id}>
                              {noteForm.direction === 'outward'
                                ? `${entry.invoiceNo} • ${entry.customerName}`
                                : `${entry.purchaseNo} • ${entry.supplierName}`}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div>
                      <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Note Date</label>
                      <input
                        type="date"
                        value={noteForm.noteDate}
                        onChange={(event) => setNoteForm((current) => ({ ...current, noteDate: event.target.value }))}
                        className="theme-input"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Reference No</label>
                      <input value={noteForm.referenceNo} onChange={(event) => setNoteForm((current) => ({ ...current, referenceNo: event.target.value }))} className="theme-input" />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Party Name</label>
                      <input value={noteForm.partyName} onChange={(event) => setNoteForm((current) => ({ ...current, partyName: event.target.value }))} className="theme-input" />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Party GSTIN</label>
                      <input value={noteForm.partyGstin} onChange={(event) => setNoteForm((current) => ({ ...current, partyGstin: event.target.value }))} className="theme-input uppercase" />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Taxable Value</label>
                      <input type="number" min="0" step="0.01" value={noteForm.taxableValue} onChange={(event) => setNoteForm((current) => ({ ...current, taxableValue: event.target.value }))} className="theme-input" />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">GST Rate (%)</label>
                      <input type="number" min="0" step="0.01" value={noteForm.gstRate} onChange={(event) => setNoteForm((current) => ({ ...current, gstRate: event.target.value }))} className="theme-input" />
                    </div>
                  </div>

                  <div className="mt-4">
                    <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Note</label>
                    <textarea rows={3} value={noteForm.notes} onChange={(event) => setNoteForm((current) => ({ ...current, notes: event.target.value }))} className="theme-input min-h-[6rem]" />
                  </div>

                  <div className="mt-5 flex flex-wrap gap-3">
                    <button type="button" onClick={handleSaveNote} disabled={isSavingNote || currentPeriodLocked} className="theme-button-primary px-5 py-2.5 disabled:cursor-not-allowed disabled:opacity-60">
                      {isSavingNote ? 'Saving...' : currentPeriodLocked ? 'Period Locked' : 'Save GST Note'}
                    </button>
                    <button type="button" onClick={() => setNoteForm(createDefaultNoteForm(noteForm.direction, reportFocusDate))} className="theme-button-secondary px-5 py-2.5">
                      Reset
                    </button>
                  </div>
                </div>

                <div className="glass-panel overflow-hidden p-0">
                  <div className="panel-header">
                    <div>
                      <h4 className="panel-title">GST Note Register</h4>
                      <p className="panel-subtitle">Outward and inward credit/debit notes affecting this filing period.</p>
                    </div>
                  </div>
                  <div className="gst-table-pad">
                    <div className="max-h-[30rem] overflow-auto rounded-[1.2rem]">
                    <table className="w-full text-left">
                      <thead className="table-head sticky top-0 z-10">
                        <tr>
                          <th className="table-header-cell">Note</th>
                          <th className="table-header-cell">Party</th>
                          <th className="table-header-cell text-right">Impact</th>
                          <th className="table-header-cell text-right">GST</th>
                          <th className="table-header-cell text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="table-body divide-y divide-[rgba(70,96,103,0.08)]">
                        {[...(gstFilingData.gstr1?.noteRows || []), ...(gstFilingData.inwardRegister?.noteRows || [])].length === 0 && (
                          <tr>
                            <td colSpan="5" className="px-6 py-10 text-center font-medium text-[var(--ink-soft)]">
                              No GST notes recorded for this period.
                            </td>
                          </tr>
                        )}
                        {[...(gstFilingData.gstr1?.noteRows || []), ...(gstFilingData.inwardRegister?.noteRows || [])]
                          .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
                          .map((row) => (
                            <tr key={row.id} className="table-row">
                              <td className="px-6 py-4 align-top">
                                <p className="font-semibold text-[var(--ink)]">{row.noteNo}</p>
                                <p className="mt-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
                                  {row.direction} {row.noteType}
                                </p>
                                <p className="mt-1 text-xs text-[var(--ink-soft)]">{row.date}</p>
                              </td>
                              <td className="px-6 py-4 align-top">
                                <p className="font-semibold text-[var(--ink)]">{row.partyName}</p>
                                <p className="mt-1 text-xs text-[var(--ink-soft)]">
                                  {row.partyGstin || 'GSTIN not provided'}{row.referenceNo ? ` • ${row.referenceNo}` : ''}
                                </p>
                              </td>
                              <td className={`px-6 py-4 text-right font-black ${row.signedTaxableValue < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                                {formatSignedCurrency(row.signedTaxableValue)}
                              </td>
                              <td className={`px-6 py-4 text-right font-black ${row.signedGstAmount < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                                {formatSignedCurrency(row.signedGstAmount)}
                              </td>
                              <td className="px-6 py-4 text-right">
                                <button type="button" onClick={() => handleDeleteNote(row.id)} disabled={currentPeriodLocked} className="text-sm font-bold text-rose-600 disabled:cursor-not-allowed disabled:text-slate-300">
                                  Delete
                                </button>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                <div className="glass-panel overflow-hidden p-0">
                  <div className="panel-header">
                    <div>
                      <h4 className="panel-title">HSN Summary Outward</h4>
                      <p className="panel-subtitle">Item-wise outward supply totals grouped by HSN code.</p>
                    </div>
                  </div>
                  <div className="gst-table-pad">
                    <div className="max-h-[24rem] overflow-auto rounded-[1.2rem]">
                    <table className="w-full text-left">
                      <thead className="table-head sticky top-0 z-10">
                        <tr>
                          <th className="table-header-cell">HSN</th>
                          <th className="table-header-cell">Description</th>
                          <th className="table-header-cell text-right">Qty</th>
                          <th className="table-header-cell text-right">Taxable</th>
                          <th className="table-header-cell text-right">GST</th>
                        </tr>
                      </thead>
                      <tbody className="table-body divide-y divide-[rgba(70,96,103,0.08)]">
                        {(gstFilingData.hsnSummary?.outwardRows || []).length === 0 && (
                          <tr>
                            <td colSpan="5" className="px-6 py-8 text-center font-medium text-[var(--ink-soft)]">
                              No outward HSN data found for this period.
                            </td>
                          </tr>
                        )}
                        {(gstFilingData.hsnSummary?.outwardRows || []).map((row) => (
                          <tr key={`outward-hsn-${row.hsnCode}-${row.unit}`} className="table-row">
                            <td className="px-6 py-4 font-bold text-[var(--ink)]">{row.hsnCode}</td>
                            <td className="px-6 py-4">
                              <p className="font-semibold text-[var(--ink)]">{row.description}</p>
                              <p className="mt-1 text-xs text-[var(--ink-soft)]">{row.unit}</p>
                            </td>
                            <td className="px-6 py-4 text-right font-semibold text-[var(--ink)]">{Number(row.quantity || 0).toFixed(2)}</td>
                            <td className="px-6 py-4 text-right font-bold text-[var(--ink)]">{formatCurrency(row.taxableValue)}</td>
                            <td className="px-6 py-4 text-right font-semibold text-[var(--ink-soft)]">{formatCurrency(row.gstAmount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                  </div>
                </div>

                <div className="glass-panel overflow-hidden p-0">
                  <div className="panel-header">
                    <div>
                      <h4 className="panel-title">HSN Summary Inward</h4>
                      <p className="panel-subtitle">Item-wise purchase totals grouped by HSN code.</p>
                    </div>
                  </div>
                  <div className="gst-table-pad">
                    <div className="max-h-[24rem] overflow-auto rounded-[1.2rem]">
                    <table className="w-full text-left">
                      <thead className="table-head sticky top-0 z-10">
                        <tr>
                          <th className="table-header-cell">HSN</th>
                          <th className="table-header-cell">Description</th>
                          <th className="table-header-cell text-right">Qty</th>
                          <th className="table-header-cell text-right">Taxable</th>
                          <th className="table-header-cell text-right">GST</th>
                        </tr>
                      </thead>
                      <tbody className="table-body divide-y divide-[rgba(70,96,103,0.08)]">
                        {(gstFilingData.hsnSummary?.inwardRows || []).length === 0 && (
                          <tr>
                            <td colSpan="5" className="px-6 py-8 text-center font-medium text-[var(--ink-soft)]">
                              No inward HSN data found for this period.
                            </td>
                          </tr>
                        )}
                        {(gstFilingData.hsnSummary?.inwardRows || []).map((row) => (
                          <tr key={`inward-hsn-${row.hsnCode}-${row.unit}`} className="table-row">
                            <td className="px-6 py-4 font-bold text-[var(--ink)]">{row.hsnCode}</td>
                            <td className="px-6 py-4">
                              <p className="font-semibold text-[var(--ink)]">{row.description}</p>
                              <p className="mt-1 text-xs text-[var(--ink-soft)]">{row.unit}</p>
                            </td>
                            <td className="px-6 py-4 text-right font-semibold text-[var(--ink)]">{Number(row.quantity || 0).toFixed(2)}</td>
                            <td className="px-6 py-4 text-right font-bold text-[var(--ink)]">{formatCurrency(row.taxableValue)}</td>
                            <td className="px-6 py-4 text-right font-semibold text-[var(--ink-soft)]">{formatCurrency(row.gstAmount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                <div className="glass-panel overflow-hidden p-0">
                  <div className="panel-header">
                    <div>
                      <h4 className="panel-title">Outward Tax Rate Summary</h4>
                      <p className="panel-subtitle">Grouped by invoice GST rate for the selected filing period.</p>
                    </div>
                  </div>
                  <div className="gst-table-pad">
                    <div className="overflow-x-auto rounded-[1.2rem]">
                    <table className="w-full text-left">
                      <thead className="table-head">
                        <tr>
                          <th className="table-header-cell">Rate</th>
                          <th className="table-header-cell text-right">Docs</th>
                          <th className="table-header-cell text-right">Taxable</th>
                          <th className="table-header-cell text-right">SGST</th>
                          <th className="table-header-cell text-right">CGST</th>
                        </tr>
                      </thead>
                      <tbody className="table-body divide-y divide-[rgba(70,96,103,0.08)]">
                        {(gstFilingData.gstr1?.rateRows || []).length === 0 && (
                          <tr>
                            <td colSpan="5" className="px-6 py-8 text-center font-medium text-[var(--ink-soft)]">
                              No taxed outward supplies found for this range.
                            </td>
                          </tr>
                        )}
                        {(gstFilingData.gstr1?.rateRows || []).map((row) => (
                          <tr key={`outward-rate-${row.rateLabel}`} className="table-row">
                            <td className="px-6 py-4 font-bold text-[var(--ink)]">{row.rateLabel}</td>
                            <td className="px-6 py-4 text-right font-semibold text-[var(--ink-soft)]">{row.documentCount}</td>
                            <td className="px-6 py-4 text-right font-bold text-[var(--ink)]">{formatCurrency(row.taxableValue)}</td>
                            <td className="px-6 py-4 text-right font-semibold text-[var(--ink-soft)]">{formatCurrency(row.sgst)}</td>
                            <td className="px-6 py-4 text-right font-semibold text-[var(--ink-soft)]">{formatCurrency(row.cgst)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                  </div>
                </div>

                <div className="glass-panel overflow-hidden p-0">
                  <div className="panel-header">
                    <div>
                      <h4 className="panel-title">Purchase ITC Rate Summary</h4>
                      <p className="panel-subtitle">Grouped by purchase GST rate to support input tax review.</p>
                    </div>
                  </div>
                  <div className="gst-table-pad">
                    <div className="overflow-x-auto rounded-[1.2rem]">
                    <table className="w-full text-left">
                      <thead className="table-head">
                        <tr>
                          <th className="table-header-cell">Rate</th>
                          <th className="table-header-cell text-right">Docs</th>
                          <th className="table-header-cell text-right">Taxable</th>
                          <th className="table-header-cell text-right">SGST</th>
                          <th className="table-header-cell text-right">CGST</th>
                        </tr>
                      </thead>
                      <tbody className="table-body divide-y divide-[rgba(70,96,103,0.08)]">
                        {(gstFilingData.inwardRegister?.rateRows || []).length === 0 && (
                          <tr>
                            <td colSpan="5" className="px-6 py-8 text-center font-medium text-[var(--ink-soft)]">
                              No taxed purchase entries found for this range.
                            </td>
                          </tr>
                        )}
                        {(gstFilingData.inwardRegister?.rateRows || []).map((row) => (
                          <tr key={`inward-rate-${row.rateLabel}`} className="table-row">
                            <td className="px-6 py-4 font-bold text-[var(--ink)]">{row.rateLabel}</td>
                            <td className="px-6 py-4 text-right font-semibold text-[var(--ink-soft)]">{row.documentCount}</td>
                            <td className="px-6 py-4 text-right font-bold text-[var(--ink)]">{formatCurrency(row.taxableValue)}</td>
                            <td className="px-6 py-4 text-right font-semibold text-[var(--ink-soft)]">{formatCurrency(row.sgst)}</td>
                            <td className="px-6 py-4 text-right font-semibold text-[var(--ink-soft)]">{formatCurrency(row.cgst)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                <div className="glass-panel overflow-hidden p-0">
                  <div className="panel-header">
                    <div>
                      <h4 className="panel-title">Outward Register</h4>
                      <p className="panel-subtitle">Invoice-by-invoice GST working data for GSTR-1 preparation.</p>
                    </div>
                  </div>
                  <div className="gst-table-pad">
                    <div className="max-h-[26rem] overflow-auto rounded-[1.2rem]">
                    <table className="w-full text-left">
                      <thead className="table-head sticky top-0 z-10">
                        <tr>
                          <th className="table-header-cell">Invoice</th>
                          <th className="table-header-cell">Party</th>
                          <th className="table-header-cell text-right">Taxable</th>
                          <th className="table-header-cell text-right">GST</th>
                          <th className="table-header-cell text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody className="table-body divide-y divide-[rgba(70,96,103,0.08)]">
                        {(gstFilingData.gstr1?.invoiceRows || []).length === 0 && (
                          <tr>
                            <td colSpan="5" className="px-6 py-8 text-center font-medium text-[var(--ink-soft)]">
                              No invoices found for this filing range.
                            </td>
                          </tr>
                        )}
                        {(gstFilingData.gstr1?.invoiceRows || []).map((row) => (
                          <tr key={row.id} className="table-row">
                            <td className="px-6 py-4 align-top">
                              <p className="font-bold text-[var(--ink)]">{row.invoiceNo}</p>
                              <p className="mt-1 text-xs font-semibold text-[var(--ink-soft)]">{row.date}</p>
                            </td>
                            <td className="px-6 py-4 align-top">
                              <p className="font-semibold text-[var(--ink)]">{row.customerName}</p>
                              <p className="mt-1 text-xs font-semibold text-[var(--ink-soft)]">
                                {row.customerGstin || 'B2C / Walk-in'} • {formatPercent(row.gstRate)}
                              </p>
                            </td>
                            <td className="px-6 py-4 text-right font-bold text-[var(--ink)]">{formatCurrency(row.taxableValue)}</td>
                            <td className="px-6 py-4 text-right font-semibold text-[var(--ink-soft)]">{formatCurrency(row.gstAmount)}</td>
                            <td className="px-6 py-4 text-right font-bold text-[var(--ink)]">{formatCurrency(row.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                  </div>
                </div>

                <div className="glass-panel overflow-hidden p-0">
                  <div className="panel-header">
                    <div>
                      <h4 className="panel-title">Purchase Register</h4>
                      <p className="panel-subtitle">Purchase-side ITC working data with supplier GSTIN visibility.</p>
                    </div>
                  </div>
                  <div className="gst-table-pad">
                    <div className="max-h-[26rem] overflow-auto rounded-[1.2rem]">
                    <table className="w-full text-left">
                      <thead className="table-head sticky top-0 z-10">
                        <tr>
                          <th className="table-header-cell">Purchase</th>
                          <th className="table-header-cell">Supplier</th>
                          <th className="table-header-cell text-right">Taxable</th>
                          <th className="table-header-cell text-right">GST</th>
                          <th className="table-header-cell text-right">Due</th>
                        </tr>
                      </thead>
                      <tbody className="table-body divide-y divide-[rgba(70,96,103,0.08)]">
                        {(gstFilingData.inwardRegister?.purchaseRows || []).length === 0 && (
                          <tr>
                            <td colSpan="5" className="px-6 py-8 text-center font-medium text-[var(--ink-soft)]">
                              No purchases found for this filing range.
                            </td>
                          </tr>
                        )}
                        {(gstFilingData.inwardRegister?.purchaseRows || []).map((row) => (
                          <tr key={row.id} className="table-row">
                            <td className="px-6 py-4 align-top">
                              <p className="font-bold text-[var(--ink)]">{row.purchaseNo}</p>
                              <p className="mt-1 text-xs font-semibold text-[var(--ink-soft)]">{row.date}</p>
                            </td>
                            <td className="px-6 py-4 align-top">
                              <p className="font-semibold text-[var(--ink)]">{row.supplierName}</p>
                              <p className="mt-1 text-xs font-semibold text-[var(--ink-soft)]">
                                {row.supplierGstin || 'GSTIN missing'} • {formatPercent(row.gstRate)}
                              </p>
                            </td>
                            <td className="px-6 py-4 text-right font-bold text-[var(--ink)]">{formatCurrency(row.taxableValue)}</td>
                            <td className="px-6 py-4 text-right font-semibold text-[var(--ink-soft)]">{formatCurrency(row.gstAmount)}</td>
                            <td className="px-6 py-4 text-right font-bold text-[var(--ink)]">{formatCurrency(row.dueAmount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="gst-empty-state glass-panel flex flex-1 flex-col items-center justify-center gap-4 text-center text-[var(--ink-soft)]">
              <AlertCircle size={48} className={`${isFetching ? 'animate-pulse' : ''} opacity-60`} />
              <div>
                <p className="text-lg font-bold text-[var(--ink)]">
                  {isFetching
                    ? 'Preparing GST filing data...'
                    : reportError
                      ? 'GST filing workspace could not be loaded.'
                      : 'No GST filing data found for this range.'}
                </p>
                <p className="mt-2 max-w-xl text-sm leading-6">
                  {reportError ||
                    'Try a different period, or create invoices and purchases first so ERPMania has transaction data to build the GST workspace.'}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
