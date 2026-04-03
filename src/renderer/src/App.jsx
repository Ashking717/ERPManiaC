import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Clock,
  CreditCard,
  FileText,
  IndianRupee,
  LayoutDashboard,
  Package,
  PieChart,
  Receipt,
  Settings,
  ShoppingBag,
  TrendingDown,
  Truck,
  Users
} from 'lucide-react';
import BillingView from './components/Billing';
import CustomersView from './components/Customers';
import ExpensesView from './components/Expenses';
import InitialSetupWizard from './components/InitialSetupWizard';
import InvoicesView from './components/Invoices';
import ProductsView from './components/Products';
import PurchasesView from './components/Purchases';
import ReportsView from './components/Reports';
import SettingsView from './components/Settings';
import SuppliersView from './components/Suppliers';
import PeriodSelector from './components/PeriodSelector';
import { useApp } from './AppContext';
import { filterRecordsByPeriod, formatPeriodLabel, getTodayDateInput } from './utils/dateFilters';
import appLogo from '../../../assets/logo/icon.png';
import './index.css';

const NAV_GROUPS = [
  {
    label: 'Menu',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { id: 'products', label: 'Products', icon: ShoppingBag },
      { id: 'customers', label: 'Customers', icon: Users },
      { id: 'suppliers', label: 'Suppliers', icon: Truck }
    ]
  },
  {
    label: 'Transactions',
    items: [
      { id: 'billing', label: 'Billing POS', icon: Receipt },
      { id: 'invoices', label: 'Invoices', icon: FileText },
      { id: 'purchases', label: 'Purchases', icon: CreditCard },
      { id: 'expenses', label: 'Expenses', icon: TrendingDown }
    ]
  },
  {
    label: 'Insights',
    items: [
      { id: 'reports', label: 'Reports', icon: PieChart },
      { id: 'settings', label: 'Settings', icon: Settings }
    ]
  }
];

const DASHBOARD_STAT_ICONS = [IndianRupee, FileText, AlertTriangle, CreditCard];
const DASHBOARD_STAT_TONES = ['#456f79', '#6e8f88', '#a27a39', '#8a6371'];

const formatCurrency = (value) => `₹${(Number(value) || 0).toFixed(2)}`;

function getSidebarBrandNameClass(name) {
  const length = String(name || '').trim().length;

  if (length > 28) {
    return 'brand-name brand-name-dense';
  }

  if (length > 18) {
    return 'brand-name brand-name-compact';
  }

  return 'brand-name';
}

function isLikelyFreshInstall(data) {
  const business = data?.business || {};
  const products = Array.isArray(data?.products) ? data.products : [];
  const suppliers = Array.isArray(data?.suppliers) ? data.suppliers : [];
  const invoices = Array.isArray(data?.invoices) ? data.invoices : [];
  const purchases = Array.isArray(data?.purchases) ? data.purchases : [];
  const expenses = Array.isArray(data?.expenses) ? data.expenses : [];
  const supplierPayments = Array.isArray(data?.supplierPayments) ? data.supplierPayments : [];
  const gstNotes = Array.isArray(data?.gstNotes) ? data.gstNotes : [];
  const customers = Array.isArray(data?.customers)
    ? data.customers.filter((customer) => String(customer?.name || '').trim().toLowerCase() !== 'walk-in customer')
    : [];

  const normalizedName = String(business.name || '').trim();
  const normalizedPhone = String(business.phone || '').trim();
  const normalizedAddress = String(business.address || '').trim();
  const normalizedGstin = String(business.gstin || '').trim();
  const normalizedLogo = String(business.logoDataUrl || '').trim();

  const hasBusinessCustomization =
    Boolean(normalizedGstin) ||
    Boolean(normalizedLogo) ||
    (normalizedName && normalizedName !== 'Grocery Store') ||
    (normalizedPhone && normalizedPhone !== '+91 90000 00000') ||
    (normalizedAddress && normalizedAddress !== 'Main Street');

  if (hasBusinessCustomization) {
    return false;
  }

  return (
    products.length === 0 &&
    suppliers.length === 0 &&
    invoices.length === 0 &&
    purchases.length === 0 &&
    expenses.length === 0 &&
    supplierPayments.length === 0 &&
    gstNotes.length === 0 &&
    customers.length === 0
  );
}

export default function App() {
  const { data, isLoading, mutateAndRefresh, fetchBootstrap } = useApp();
  const [activeTab, setActiveTab] = useState('billing');
  const [isSidebarOpen, setSidebarOpen] = useState(true);
  const [dashboardPeriod, setDashboardPeriod] = useState('daily');
  const [dashboardFocusDate, setDashboardFocusDate] = useState(getTodayDateInput);
  const [licenseGateKey, setLicenseGateKey] = useState('');
  const [licenseGateError, setLicenseGateError] = useState('');
  const [isActivatingLicense, setIsActivatingLicense] = useState(false);
  const [isClosingApp, setIsClosingApp] = useState(false);
  const licenseInputRef = useRef(null);

  const db = data?.dashboard || {};
  const businessName = data?.business?.name || 'ERPMania';
  const businessLogoDataUrl = data?.business?.logoDataUrl || '';
  const uiSettings = data?.uiSettings || {};
  const licenseStatus = data?.licenseStatus || null;
  const isLicenseExpired = !isLoading && Boolean(licenseStatus) && !licenseStatus.isActive;
  const shouldShowInitialSetup =
    !isLoading &&
    !isLicenseExpired &&
    !uiSettings.setupCompleted &&
    isLikelyFreshInstall(data);
  const safeInvoices = data?.invoices || [];
  const safePurchases = data?.purchases || [];
  const safeExpenses = data?.expenses || [];
  const dashboardInvoices = filterRecordsByPeriod(safeInvoices, dashboardPeriod, dashboardFocusDate);
  const dashboardPurchases = filterRecordsByPeriod(safePurchases, dashboardPeriod, dashboardFocusDate);
  const dashboardExpenses = filterRecordsByPeriod(safeExpenses, dashboardPeriod, dashboardFocusDate);
  const dashboardPeriodLabel = formatPeriodLabel(dashboardPeriod, dashboardFocusDate);
  const dashboardSales = dashboardInvoices.reduce((sum, invoice) => sum + (Number(invoice?.total) || 0), 0);
  const dashboardCollections = dashboardInvoices.reduce(
    (sum, invoice) => sum + (Number(invoice?.paidAmount) || 0),
    0
  );
  const dashboardReceivables = dashboardInvoices.reduce(
    (sum, invoice) => sum + (Number(invoice?.balance) || 0),
    0
  );
  const dashboardPayables = dashboardPurchases.reduce(
    (sum, purchase) => sum + (Number(purchase?.balance ?? purchase?.dueAmount) || 0),
    0
  );
  const dashboardPurchaseSpend = dashboardPurchases.reduce(
    (sum, purchase) => sum + (Number(purchase?.total) || 0),
    0
  );
  const dashboardExpenseSpend = dashboardExpenses.reduce(
    (sum, expense) => sum + (Number(expense?.amount) || 0),
    0
  );

  const timeLabel = new Intl.DateTimeFormat('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata'
  }).format(new Date());

  const stats = [
    { label: 'Sales Total', value: formatCurrency(dashboardSales), detail: `${dashboardPeriodLabel} billed value` },
    { label: 'Collections', value: formatCurrency(dashboardCollections), detail: `Payments received in ${dashboardPeriodLabel}` },
    { label: 'Low Stock', value: `${(db.lowStockProducts || []).length} Items`, detail: 'Current stock below reorder level' },
    { label: 'Payables', value: formatCurrency(dashboardPayables), detail: `Supplier dues booked in ${dashboardPeriodLabel}` }
  ];

  const recentInvoices = [...dashboardInvoices]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 5);

  const pulseMetrics = [
    { label: 'Sales', value: dashboardSales },
    { label: 'Collections', value: dashboardCollections },
    { label: 'Purchases', value: dashboardPurchaseSpend },
    { label: 'Expenses', value: dashboardExpenseSpend },
    { label: 'Receivables', value: dashboardReceivables }
  ];
  const pulseMax = Math.max(...pulseMetrics.map((item) => item.value), 1);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!e.altKey) return;

      switch (e.key) {
        case '1':
          setActiveTab('dashboard');
          break;
        case '2':
          setActiveTab('settings');
          break;
        case '3':
          setActiveTab('products');
          break;
        case '4':
          setActiveTab('customers');
          break;
        case '5':
          setActiveTab('suppliers');
          break;
        case '6':
          setActiveTab('purchases');
          break;
        case '7':
          setActiveTab('billing');
          break;
        case '8':
          setActiveTab('invoices');
          break;
        case '9':
          setActiveTab('reports');
          break;
        case '0':
          setActiveTab('expenses');
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (!isLicenseExpired) {
      setLicenseGateError('');
      setLicenseGateKey('');
      return;
    }

    const timer = window.setTimeout(() => {
      licenseInputRef.current?.focus();
    }, 20);

    return () => window.clearTimeout(timer);
  }, [isLicenseExpired]);

  const handleActivateLicenseGate = async () => {
    if (!window.erpApi) {
      return;
    }

    const cleanKey = licenseGateKey.replace(/\D/g, '').slice(0, 12);
    if (cleanKey.length !== 12) {
      setLicenseGateError('Enter a valid 12-digit license key.');
      return;
    }

    setIsActivatingLicense(true);
    setLicenseGateError('');
    try {
      await mutateAndRefresh(window.erpApi.activateLicenseKey({ key: cleanKey }));
      setLicenseGateKey('');
    } catch (error) {
      setLicenseGateError(error.message || 'Invalid or already used key.');
    } finally {
      setIsActivatingLicense(false);
    }
  };

  const handleCloseApp = async () => {
    setIsClosingApp(true);
    try {
      if (window.erpApi?.closeApp) {
        await window.erpApi.closeApp();
      } else {
        window.close();
      }
    } finally {
      setIsClosingApp(false);
    }
  };

  if (shouldShowInitialSetup) {
    return (
      <InitialSetupWizard
        data={data}
        fetchBootstrap={fetchBootstrap}
        onComplete={() => {
          setActiveTab('billing');
        }}
      />
    );
  }

  return (
    <div className="erp-shell relative flex h-screen overflow-hidden">
      <aside
        className={`shell-sidebar ${isSidebarOpen ? 'w-72' : 'w-24'} flex shrink-0 flex-col px-3 py-6 transition-all duration-300 ease-out`}
      >
        <button type="button" className="sidebar-brand mb-6 cursor-pointer text-left" onClick={() => setSidebarOpen((open) => !open)}>
          <div className="brand-mark overflow-hidden">
            <img
              src={businessLogoDataUrl || appLogo}
              alt={`${businessName} logo`}
              className="h-full w-full object-contain"
              onError={(event) => {
                event.currentTarget.onerror = null;
                event.currentTarget.src = appLogo;
              }}
            />
          </div>
          {isSidebarOpen && (
            <div className="min-w-0 flex-1 overflow-visible">
              <p className={getSidebarBrandNameClass(businessName)}>{businessName}</p>
              <p className="brand-kicker">Retail Workspace</p>
            </div>
          )}
        </button>

        <nav className="relative z-[1] flex flex-1 flex-col gap-5 px-2">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="flex flex-col gap-2">
              {isSidebarOpen && <p className="nav-section-label">{group.label}</p>}
              <div className="flex flex-col gap-1">
                {group.items.map((item) => (
                  <NavItem
                    key={item.id}
                    icon={item.icon}
                    label={item.label}
                    isActive={activeTab === item.id}
                    isOpen={isSidebarOpen}
                    onClick={() => setActiveTab(item.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className={`sidebar-footer-brand ${isSidebarOpen ? 'justify-start gap-3' : 'justify-center'}`}>
            <div className="footer-brand-mark overflow-hidden">
              <img src={appLogo} alt="ERPManiaC logo" className="h-full w-full object-contain" />
            </div>
            {isSidebarOpen && (
              <div className="min-w-0">
                <p className="footer-brand-name truncate">ERPManiaC</p>
              </div>
            )}
          </div>
        </div>
      </aside>

      <div className="shell-main flex-1">
        <header className="topbar-shell">
          <div className="topbar-meta">
            <p className="topbar-copy">ERP Workspace</p>
            <h1 className="topbar-title">{activeTab === 'dashboard' ? 'Business Dashboard' : businessName}</h1>
          </div>

          <div className="flex items-center gap-3">
            <div className="theme-pill theme-pill-accent">
              <Clock size={14} />
              <span>{timeLabel}</span>
            </div>
            <div className="theme-pill theme-pill-success">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <span>LIVE OFFLINE</span>
            </div>
          </div>
        </header>

        <main className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col px-6 pb-8 pt-6 xl:px-8">
          {activeTab === 'dashboard' && (
            <div className="space-y-6">
              <section className="dashboard-hero px-8 py-8">
                <div className="relative z-[1] flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="hero-label">Overview</p>
                    <h2 className="mt-3 text-5xl font-semibold leading-none text-white">Dashboard</h2>
                    <p className="mt-3 text-base text-white/72">{dashboardPeriodLabel}</p>
                    <p className="mt-1 text-sm text-white/58">A calmer view of trading, stock pressure, and collections for the selected period.</p>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => setActiveTab('purchases')}
                      className="theme-button-secondary min-w-36 backdrop-blur-sm"
                      style={{ background: 'rgba(255,255,255,0.12)', color: '#f8fcfc', borderColor: 'rgba(255,255,255,0.18)' }}
                    >
                      + Purchase
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab('billing')}
                      className="theme-button-secondary min-w-36"
                      style={{ background: '#fffdfa', color: 'var(--ink)' }}
                    >
                      Open POS
                      <ArrowRight size={16} />
                    </button>
                  </div>
                </div>
              </section>

              <PeriodSelector
                period={dashboardPeriod}
                focusDate={dashboardFocusDate}
                onPeriodChange={setDashboardPeriod}
                onFocusDateChange={setDashboardFocusDate}
                label="Dashboard Range"
                summary={`Showing sales, collections, and invoice activity for ${dashboardPeriodLabel}.`}
              />

              <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                {stats.map((stat, index) => {
                  const Icon = DASHBOARD_STAT_ICONS[index];
                  const tone = DASHBOARD_STAT_TONES[index];

                  return (
                    <article key={stat.label} className="stat-card">
                      <div className="mb-4 flex items-center justify-between">
                        <p className="muted-kicker">{stat.label}</p>
                        <div
                          className="flex h-10 w-10 items-center justify-center rounded-2xl"
                          style={{ backgroundColor: `${tone}18`, color: tone }}
                        >
                          <Icon size={18} />
                        </div>
                      </div>
                      <p className="text-3xl font-extrabold tracking-tight text-[var(--ink)]">{stat.value}</p>
                      <p className="mt-2 text-sm text-[var(--ink-soft)]">{stat.detail}</p>
                    </article>
                  );
                })}
              </section>

              <section className="grid grid-cols-1 gap-5 xl:grid-cols-[1.2fr_1fr]">
                <article className="glass-panel overflow-hidden">
                  <div className="panel-header">
                    <div>
                      <h3 className="panel-title">Inventory Signals</h3>
                      <p className="panel-subtitle">Products that need attention before the next billing rush.</p>
                    </div>
                    <button type="button" onClick={() => setActiveTab('products')} className="theme-button-ghost px-4 py-2 text-sm">
                      View all
                    </button>
                  </div>

                  <div>
                    {(db.lowStockProducts || []).length === 0 ? (
                      <div className="empty-state">
                        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100/80 text-emerald-700">
                          <Package size={22} />
                        </div>
                        <p className="text-lg font-bold text-[var(--ink)]">Stock looks healthy</p>
                        <p className="max-w-md text-sm">No products are currently sitting below their reorder threshold.</p>
                      </div>
                    ) : (
                      (db.lowStockProducts || []).slice(0, 5).map((product, index) => (
                        <div key={product.id || index} className="stock-row">
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-100/80 text-amber-700">
                              <AlertTriangle size={18} />
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-base font-bold text-[var(--ink)]">{product.name}</p>
                              <p className="text-sm text-[var(--ink-soft)]">{product.category || 'Inventory item'}</p>
                            </div>
                          </div>
                          <span className="badge badge-amber">{product.stock} left</span>
                        </div>
                      ))
                    )}
                  </div>
                </article>

                <article className="glass-panel overflow-hidden">
                  <div className="panel-header">
                    <div>
                      <h3 className="panel-title">Recent Invoices</h3>
                      <p className="panel-subtitle">A quick ledger snapshot for {dashboardPeriodLabel}.</p>
                    </div>
                    <button type="button" onClick={() => setActiveTab('invoices')} className="theme-button-ghost px-4 py-2 text-sm">
                      Open ledger
                    </button>
                  </div>

                  <div>
                    {recentInvoices.length === 0 ? (
                      <div className="empty-state">
                        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-100 text-primary-700">
                          <FileText size={22} />
                        </div>
                        <p className="text-lg font-bold text-[var(--ink)]">No invoice activity in this period</p>
                        <p className="max-w-sm text-sm">Try another date or period to review earlier billing sessions.</p>
                      </div>
                    ) : (
                      recentInvoices.map((invoice) => {
                        const customer = data.customers.find((entry) => entry.id === invoice.customerId);

                        return (
                          <div key={invoice.id} className="list-row">
                            <div className="min-w-0">
                              <p className="truncate text-base font-bold text-[var(--ink)]">{customer?.name || 'Walk-in Customer'}</p>
                              <p className="text-sm text-[var(--ink-soft)]">
                                {new Date(invoice.createdAt).toLocaleDateString('en-IN', {
                                  day: 'numeric',
                                  month: 'short',
                                  year: 'numeric'
                                })}
                              </p>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className={`badge ${invoice.balance > 0 ? 'badge-amber' : 'badge-green'}`}>
                                {invoice.balance > 0 ? `Due ${formatCurrency(invoice.balance)}` : 'Paid'}
                              </span>
                              <p className="min-w-24 text-right text-sm font-extrabold text-[var(--ink)]">{formatCurrency(invoice.total)}</p>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </article>
              </section>

              <section className="glass-panel overflow-hidden">
                <div className="panel-header">
                  <div>
                    <h3 className="panel-title">Business Load</h3>
                    <p className="panel-subtitle">Relative pressure across sales, collections, and outflows for {dashboardPeriodLabel}.</p>
                  </div>
                  <button type="button" onClick={() => setActiveTab('reports')} className="theme-button-ghost px-4 py-2 text-sm">
                    Reports
                  </button>
                </div>

                <div className="progress-stack">
                  {pulseMetrics.map((metric) => (
                    <div key={metric.label} className="progress-row">
                      <p className="text-sm font-bold text-[var(--ink)]">{metric.label}</p>
                      <div className="progress-track">
                        <div className="progress-fill" style={{ width: `${Math.max(8, (metric.value / pulseMax) * 100)}%` }} />
                      </div>
                      <p className="text-sm font-extrabold text-[var(--ink-soft)]">{formatCurrency(metric.value)}</p>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}

          {activeTab === 'products' && <ProductsView />}
          {activeTab === 'customers' && <CustomersView />}
          {activeTab === 'suppliers' && <SuppliersView />}
          {activeTab === 'billing' && <BillingView />}
          {activeTab === 'invoices' && <InvoicesView />}
          {activeTab === 'purchases' && <PurchasesView />}
          {activeTab === 'expenses' && <ExpensesView />}
          {activeTab === 'reports' && <ReportsView />}
          {activeTab === 'settings' && <SettingsView />}
        </main>
      </div>

      {isLicenseExpired && (
        <div className="modal-backdrop" style={{ zIndex: 120 }}>
          <div className="modal-panel max-w-md p-6">
            <div className="flex items-start gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[rgba(244,234,213,0.92)] text-[var(--amber-text)]">
                <AlertTriangle size={24} />
              </div>
              <div className="min-w-0">
                <h3 className="text-4xl font-semibold text-[var(--ink)]">License Activation Required</h3>
                <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">
                  Your ERPManiaC license is expired. Enter a valid 12-digit license key to continue, or close the app.
                </p>
              </div>
            </div>

            <div className="mt-5 rounded-[1.25rem] border border-[rgba(70,96,103,0.1)] bg-[rgba(255,252,246,0.78)] p-4">
              <p className="text-sm font-semibold text-[var(--ink)]">
                {licenseStatus?.isGodMode
                  ? 'God mode is active.'
                  : licenseStatus?.validUntil
                    ? `Last valid until ${new Date(licenseStatus.validUntil).toLocaleDateString('en-IN')}`
                    : 'No active license found.'}
              </p>
              <p className="mt-2 text-xs leading-5 text-[var(--ink-soft)]">
                Keys used: {licenseStatus?.keysUsed ?? 0}/{licenseStatus?.maxKeys ?? 36} | Remaining: {licenseStatus?.keysRemaining ?? 0} | 1 key = {licenseStatus?.keyDays ?? 30} days
              </p>
            </div>

            <div className="mt-5">
              <label className="mb-2 block text-sm font-bold text-[var(--ink-soft)]">12-digit License Key</label>
              <input
                ref={licenseInputRef}
                value={licenseGateKey}
                onChange={(event) => {
                  setLicenseGateKey(event.target.value.replace(/\D/g, '').slice(0, 12));
                  if (licenseGateError) {
                    setLicenseGateError('');
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    handleActivateLicenseGate();
                  }
                }}
                inputMode="numeric"
                maxLength={12}
                placeholder="Enter 12-digit key"
                className="theme-input font-bold tracking-[0.18em]"
              />
              {licenseGateError && <p className="mt-2 text-sm font-medium text-rose-600">{licenseGateError}</p>}
            </div>

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={handleCloseApp}
                className="theme-button-ghost px-5 py-3"
                disabled={isActivatingLicense || isClosingApp}
              >
                {isClosingApp ? 'Closing...' : 'Close App'}
              </button>
              <button
                type="button"
                onClick={handleActivateLicenseGate}
                className="theme-button-primary px-6 py-3"
                disabled={isActivatingLicense || isClosingApp}
              >
                {isActivatingLicense ? 'Activating...' : 'Activate Key'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

function NavItem(props) {
  const { icon: Icon, label, isActive, onClick, isOpen } = props;

  return (
    <button type="button" onClick={onClick} className={`nav-item-theme group ${isActive ? 'active' : ''} ${!isOpen ? 'justify-center' : ''}`}>
      <div className="shrink-0">
        <Icon size={18} />
      </div>

      {isOpen && <span className={`text-sm ${isActive ? 'font-bold' : 'font-semibold'}`}>{label}</span>}
      {isActive && isOpen && <span className="ml-auto h-2 w-2 rounded-full bg-emerald-300" />}

      {!isOpen && (
        <div className="pointer-events-none absolute left-16 whitespace-nowrap rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white opacity-0 shadow-xl transition-opacity group-hover:opacity-100">
          {label}
        </div>
      )}
    </button>
  );
}
