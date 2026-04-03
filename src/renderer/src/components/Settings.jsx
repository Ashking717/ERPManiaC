import { useEffect, useRef, useState } from 'react';
import {
  Building2,
  ChevronDown,
  Cloud,
  FolderOpen,
  ImagePlus,
  Printer,
  RefreshCw,
  Receipt,
  RotateCcw,
  ShieldCheck
} from 'lucide-react';
import { useApp } from '../AppContext';

const DEFAULT_BILLING_GST_RATE = 18;

function unwrapIpcResponse(response) {
  if (response && typeof response === 'object' && Object.prototype.hasOwnProperty.call(response, 'ok')) {
    if (!response.ok) {
      throw new Error(response.error || 'Unexpected error');
    }

    return response.data;
  }

  return response;
}

function toNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = Number(value);
  if (Number.isNaN(parsed) || !Number.isFinite(parsed)) {
    return fallback;
  }

  return parsed;
}

function splitTaxValue(value) {
  const totalValue = Math.max(0, toNumber(value, 0));
  const primaryAmount = Math.round((totalValue / 2 + Number.EPSILON) * 100) / 100;

  return {
    primary: primaryAmount,
    secondary: Math.round((totalValue - primaryAmount + Number.EPSILON) * 100) / 100
  };
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });
}

function normalizeBackupSettingsForUi(backup) {
  const source = backup && typeof backup === 'object' ? backup : {};
  const interval = Math.trunc(toNumber(source.autoBackupIntervalHours, 24));

  return {
    mode: 'local-folder',
    enabled: Boolean(source.enabled),
    autoBackupEnabled: Boolean(source.autoBackupEnabled),
    autoBackupIntervalHours: Math.max(1, Math.min(168, interval || 24)),
    folderPath: String(source.folderPath || '').trim(),
    lastBackupAt: source.lastBackupAt || null,
    lastBackupFileName: String(source.lastBackupFileName || '').trim(),
    lastBackupStatus: String(source.lastBackupStatus || 'never').trim().toLowerCase(),
    lastBackupError: String(source.lastBackupError || '').trim(),
    lastRestoreAt: source.lastRestoreAt || null,
    lastRestoreFileName: String(source.lastRestoreFileName || '').trim(),
    lastRestoreStatus: String(source.lastRestoreStatus || 'never').trim().toLowerCase(),
    lastRestoreError: String(source.lastRestoreError || '').trim()
  };
}

function normalizePrinterList(printers) {
  const source = Array.isArray(printers) ? printers : [];
  const seen = new Set();
  const normalized = [];

  for (const printer of source) {
    const name = String(printer && printer.name ? printer.name : '').trim();
    const displayName = String(
      printer && (printer.displayName || printer.name) ? printer.displayName || printer.name : ''
    ).trim();

    if (!name || seen.has(name)) {
      continue;
    }

    seen.add(name);
    normalized.push({
      name,
      displayName: displayName || name,
      isDefault: Boolean(printer && printer.isDefault)
    });
  }

  return normalized.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function normalizeBillingGstSettingsForUi(uiSettings) {
  const source = uiSettings && typeof uiSettings === 'object' ? uiSettings : {};
  const rate = Math.max(0, toNumber(source.billingGstRate, 0));

  return {
    billingGstEnabled: Boolean(source.billingGstEnabled),
    billingGstRate: String(rate)
  };
}

function backupStatusLabel(status, timeValue) {
  const normalized = String(status || 'never').toLowerCase();
  if (normalized === 'success') {
    return `Success${timeValue ? ` • ${formatDateTime(timeValue)}` : ''}`;
  }

  if (normalized === 'failed') {
    return `Failed${timeValue ? ` • ${formatDateTime(timeValue)}` : ''}`;
  }

  return 'Never';
}

function formatDateTime(value) {
  if (!value) {
    return 'Never';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Never';
  }

  return parsed.toLocaleString();
}

function SettingsSection({ sectionKey, title, description, icon, isOpen, onToggle, badge, children }) {
  const SectionIcon = icon;
  const contentId = `settings-section-${sectionKey}`;

  return (
    <section className="glass-panel shrink-0 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start justify-between gap-4 px-6 py-5 text-left transition-colors hover:bg-[rgba(237,244,242,0.3)]"
        aria-expanded={isOpen}
        aria-controls={contentId}
      >
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <div className="mt-0.5 flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[rgba(70,96,103,0.12)] bg-[rgba(238,246,244,0.92)] text-[var(--ink)]">
            <SectionIcon size={20} />
          </div>
          <div className="min-w-0">
            <h3 className="text-3xl font-semibold text-[var(--ink)]">{title}</h3>
            <p className="mt-1 text-sm leading-6 text-[var(--ink-soft)]">{description}</p>
          </div>
        </div>

        <div className="flex shrink-0 items-start gap-3 pt-1">
          {badge}
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[rgba(70,96,103,0.1)] bg-[rgba(255,252,246,0.72)] text-[var(--ink-soft)]">
            <ChevronDown size={18} className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
          </span>
        </div>
      </button>

      {isOpen && (
        <div id={contentId} className="border-t border-[rgba(70,96,103,0.08)] p-6">
          {children}
        </div>
      )}
    </section>
  );
}

function BackupInfoCard({ label, value, tone = 'default', multiline = false }) {
  const toneClass =
    tone === 'danger'
      ? 'bg-[rgba(255,241,236,0.78)] border-[rgba(158,88,73,0.14)]'
      : 'bg-[rgba(255,253,248,0.78)] border-[rgba(70,96,103,0.1)]';

  return (
    <div className={`section-card h-full p-4 ${toneClass}`}>
      <p className="muted-kicker">{label}</p>
      <p className={`mt-2 text-sm text-[var(--ink)] ${multiline ? 'whitespace-pre-wrap break-words leading-6' : 'break-all'}`}>
        {value || '-'}
      </p>
    </div>
  );
}

export default function SettingsView() {
  const { data, mutateAndRefresh, fetchBootstrap } = useApp();
  const fileInputRef = useRef(null);

  const [bName, setBName] = useState('');
  const [bAddr, setBAddr] = useState('');
  const [bPhone, setBPhone] = useState('');
  const [bgst, setBgst] = useState('');
  const [bLogoDataUrl, setBLogoDataUrl] = useState('');
  const [backupSettings, setBackupSettings] = useState(() => normalizeBackupSettingsForUi(data.backup));
  const [billingGstSettings, setBillingGstSettings] = useState(() =>
    normalizeBillingGstSettingsForUi(data.uiSettings)
  );
  const [printingSettings, setPrintingSettings] = useState({
    thermalAutoPrintEnabled: Boolean(data.uiSettings?.thermalAutoPrintEnabled),
    thermalPrinterName: String(data.uiSettings?.thermalPrinterName || '').trim()
  });
  const [availablePrinters, setAvailablePrinters] = useState([]);
  const [licenseKey, setLicenseKey] = useState('');
  const [openSection, setOpenSection] = useState('business');
  const [isSavingBusiness, setSavingBusiness] = useState(false);
  const [isSavingBackup, setSavingBackup] = useState(false);
  const [isSavingBillingGst, setSavingBillingGst] = useState(false);
  const [isSavingPrinting, setSavingPrinting] = useState(false);
  const [isRunningBackup, setRunningBackup] = useState(false);
  const [isRestoringBackup, setRestoringBackup] = useState(false);
  const [isRefreshingPrinters, setRefreshingPrinters] = useState(false);
  const [isActivatingLicense, setActivatingLicense] = useState(false);

  useEffect(() => {
    setBName(data.business?.name || '');
    setBAddr(data.business?.address || '');
    setBPhone(data.business?.phone || '');
    setBgst(data.business?.gstin || '');
    setBLogoDataUrl(data.business?.logoDataUrl || '');
  }, [data.business]);

  useEffect(() => {
    setBackupSettings(normalizeBackupSettingsForUi(data.backup));
  }, [data.backup]);

  useEffect(() => {
    setBillingGstSettings(normalizeBillingGstSettingsForUi(data.uiSettings));
    setPrintingSettings({
      thermalAutoPrintEnabled: Boolean(data.uiSettings?.thermalAutoPrintEnabled),
      thermalPrinterName: String(data.uiSettings?.thermalPrinterName || '').trim()
    });
  }, [data.uiSettings]);

  useEffect(() => {
    if (openSection !== 'printing' || isRefreshingPrinters || availablePrinters.length > 0 || !window.erpApi) {
      return;
    }

    const loadPrinters = async () => {
      setRefreshingPrinters(true);
      try {
        const printers = unwrapIpcResponse(await window.erpApi.getPrinters());
        setAvailablePrinters(normalizePrinterList(printers));
      } catch {
        setAvailablePrinters([]);
      } finally {
        setRefreshingPrinters(false);
      }
    };

    loadPrinters();
  }, [openSection, isRefreshingPrinters, availablePrinters.length]);

  const toggleSection = (sectionKey) => {
    setOpenSection((current) => (current === sectionKey ? null : sectionKey));
  };

  const saveBusinessSettings = async () => {
    if (!window.erpApi) {
      return;
    }

    setSavingBusiness(true);
    try {
      await mutateAndRefresh(
        window.erpApi.upsertBusiness({
          name: bName,
          address: bAddr,
          phone: bPhone,
          gstin: bgst,
          logoDataUrl: bLogoDataUrl
        })
      );
      alert('Business settings saved successfully!');
    } catch (error) {
      alert(error.message || 'Failed to save business settings');
    } finally {
      setSavingBusiness(false);
    }
  };

  const handleLogoPick = async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      setBLogoDataUrl(dataUrl);
    } catch (error) {
      alert(error.message || 'Failed to load logo');
    } finally {
      event.target.value = '';
    }
  };

  const handleChooseBackupFolder = async () => {
    if (!window.erpApi) {
      return;
    }

    try {
      const result = unwrapIpcResponse(await window.erpApi.pickBackupFolder(backupSettings.folderPath));
      if (result?.selected && result.folderPath) {
        setBackupSettings((current) => ({
          ...current,
          folderPath: result.folderPath
        }));
      }
    } catch (error) {
      alert(error.message || 'Failed to choose backup folder');
    }
  };

  const saveBackupSettings = async ({ silentSuccess = false } = {}) => {
    if (!window.erpApi) {
      return null;
    }

    setSavingBackup(true);
    try {
      const payload = {
        mode: 'local-folder',
        enabled: backupSettings.enabled,
        autoBackupEnabled: backupSettings.autoBackupEnabled,
        autoBackupIntervalHours: backupSettings.autoBackupIntervalHours,
        folderPath: backupSettings.folderPath
      };

      const updated = await mutateAndRefresh(window.erpApi.upsertBackupSettings(payload));
      setBackupSettings(normalizeBackupSettingsForUi(updated));

      if (!silentSuccess) {
        alert('Backup settings saved successfully!');
      }

      return updated;
    } catch (error) {
      alert(error.message || 'Failed to save backup settings');
      throw error;
    } finally {
      setSavingBackup(false);
    }
  };

  const refreshPrinters = async ({ silentError = false } = {}) => {
    if (!window.erpApi) {
      return;
    }

    setRefreshingPrinters(true);
    try {
      const printers = unwrapIpcResponse(await window.erpApi.getPrinters());
      setAvailablePrinters(normalizePrinterList(printers));
    } catch (error) {
      setAvailablePrinters([]);
      if (!silentError) {
        alert(error.message || 'Failed to load printers');
      }
    } finally {
      setRefreshingPrinters(false);
    }
  };

  const saveBillingGstSettings = async () => {
    await persistBillingGstSettings(billingGstSettings);
  };

  const persistBillingGstSettings = async (nextSettings, { silentSuccess = false } = {}) => {
    if (!window.erpApi) {
      return null;
    }

    const parsedRate = Math.max(0, toNumber(nextSettings.billingGstRate, 0));

    setSavingBillingGst(true);
    try {
      const updated = await mutateAndRefresh(
        window.erpApi.upsertUiSettings({
          billingGstEnabled: nextSettings.billingGstEnabled,
          billingGstRate: parsedRate
        })
      );
      setBillingGstSettings(normalizeBillingGstSettingsForUi(updated));

      if (!silentSuccess) {
        alert('Billing GST settings saved successfully!');
      }

      return updated;
    } catch (error) {
      alert(error.message || 'Failed to save GST settings');
      throw error;
    } finally {
      setSavingBillingGst(false);
    }
  };

  const savePrintingSettings = async () => {
    if (!window.erpApi) {
      return;
    }

    setSavingPrinting(true);
    try {
      await mutateAndRefresh(
        window.erpApi.upsertUiSettings({
          thermalAutoPrintEnabled: printingSettings.thermalAutoPrintEnabled,
          thermalPrinterName: printingSettings.thermalPrinterName
        })
      );
      alert('Receipt printer settings saved successfully!');
    } catch (error) {
      alert(error.message || 'Failed to save printer settings');
    } finally {
      setSavingPrinting(false);
    }
  };

  const handleBackupNow = async () => {
    if (!window.erpApi) {
      return;
    }

    setRunningBackup(true);
    try {
      await saveBackupSettings({ silentSuccess: true });
      const result = await mutateAndRefresh(window.erpApi.runLocalBackup());
      alert(`Backup created: ${result.fileName}`);
    } catch {
      // saveBackupSettings and mutateAndRefresh already surface the error
    } finally {
      setRunningBackup(false);
    }
  };

  const handleRestoreBackup = async () => {
    if (!window.erpApi) {
      return;
    }

    const confirmed = window.confirm(
      'Restore latest backup file? This will replace current local data with backup data.'
    );

    if (!confirmed) {
      return;
    }

    setRestoringBackup(true);
    try {
      await saveBackupSettings({ silentSuccess: true });
      const result = await mutateAndRefresh(window.erpApi.restoreLatestLocalBackup());
      await fetchBootstrap();
      alert(`Restored: ${result.fileName}`);
    } catch {
      // saveBackupSettings and mutateAndRefresh already surface the error
    } finally {
      setRestoringBackup(false);
    }
  };

  const handleActivateLicense = async () => {
    if (!window.erpApi) {
      return;
    }

    const key = licenseKey.trim();
    if (!key) {
      return;
    }

    setActivatingLicense(true);
    try {
      await mutateAndRefresh(window.erpApi.activateLicenseKey({ key }));
      setLicenseKey('');
      alert('License activated successfully!');
    } catch (error) {
      alert(error.message || 'Invalid or already used key.');
    } finally {
      setActivatingLicense(false);
    }
  };

  const licenseStatus = data.licenseStatus || {};
  const backupEnabled = backupSettings.enabled;
  const autoBackupEnabled = backupEnabled && backupSettings.autoBackupEnabled;
  const backupActionBusy = isSavingBackup || isRunningBackup || isRestoringBackup;

  const licenseBadge = licenseStatus.isGodMode
    ? { label: 'LIFETIME', className: 'badge badge-blue' }
    : licenseStatus.isActive
      ? { label: 'ACTIVE', className: 'badge badge-green' }
      : { label: 'EXPIRED', className: 'badge badge-red' };
  const remainingDays = Math.max(0, Number(licenseStatus.daysRemaining) || 0);
  const licenseWindowDays = Math.max(1, Number(licenseStatus.keyDays) || 30);
  const licenseProgressPercent = licenseStatus.isGodMode
    ? 100
    : Math.max(0, Math.min(100, (remainingDays / licenseWindowDays) * 100));
  const remainingDaysBadgeClass = licenseStatus.isGodMode
    ? 'badge badge-blue'
    : remainingDays > 10
      ? 'badge badge-green'
      : remainingDays > 0
        ? 'badge badge-amber'
        : 'badge badge-red';
  const remainingDaysCopy = licenseStatus.isGodMode
    ? 'Lifetime access is active for this installation.'
    : remainingDays > 0
      ? `${remainingDays} day${remainingDays === 1 ? '' : 's'} left in the current license window.`
      : 'No licensed days remaining. Activate a new key to continue.';
  const hasPrinters = availablePrinters.length > 0;
  const hasSavedThermalPrinter = availablePrinters.some(
    (printer) => printer.name === printingSettings.thermalPrinterName
  );
  const billingGstRateValue = Math.max(0, toNumber(billingGstSettings.billingGstRate, 0));
  const { primary: billingSgstRate, secondary: billingCgstRate } = splitTaxValue(billingGstRateValue);
  const billingGstBadge = billingGstSettings.billingGstEnabled
    ? { className: 'badge badge-green', label: 'Enabled' }
    : { className: 'badge badge-amber', label: 'Disabled' };
  const thermalPrinterStatusBadge = printingSettings.thermalAutoPrintEnabled
    ? hasPrinters
      ? printingSettings.thermalPrinterName && !hasSavedThermalPrinter
        ? { className: 'badge badge-red', label: 'Printer Missing' }
        : { className: 'badge badge-green', label: 'Auto Print Ready' }
      : { className: 'badge badge-amber', label: 'No Printer Found' }
    : { className: 'badge badge-blue', label: 'Manual Only' };

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-6 overflow-y-auto pb-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="muted-kicker">Settings</p>
          <h2 className="mt-2 text-5xl font-semibold text-[var(--ink)]">Business Control Panel</h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--ink-soft)]">
            Keep store identity, logo, backups, and license controls organized in collapsible sections.
          </p>
        </div>
        <div className="rounded-[1.3rem] border border-[rgba(70,96,103,0.1)] bg-[rgba(255,252,246,0.78)] px-4 py-3 text-right shadow-[inset_0_1px_0_rgba(255,255,255,0.86)]">
          <p className="muted-kicker">Backup Mode</p>
          <p className="mt-1 text-sm font-semibold text-[var(--ink)]">Local folder or Google Drive Desktop sync folder</p>
        </div>
      </div>

      <SettingsSection
        sectionKey="business"
        title="Business Details"
        description="Core store information used across invoices, billing screens, and reports."
        icon={Building2}
        isOpen={openSection === 'business'}
        onToggle={() => toggleSection('business')}
      >
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div className="lg:col-span-2">
            <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Company / Store Name</label>
            <input value={bName} onChange={(event) => setBName(event.target.value)} className="theme-input" />
          </div>

          <div>
            <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Phone Number</label>
            <input value={bPhone} onChange={(event) => setBPhone(event.target.value)} className="theme-input" />
          </div>

          <div>
            <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">GSTIN Number (Optional)</label>
            <input value={bgst} onChange={(event) => setBgst(event.target.value)} className="theme-input" />
          </div>

          <div className="lg:col-span-2">
            <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Store Address</label>
            <textarea
              value={bAddr}
              onChange={(event) => setBAddr(event.target.value)}
              rows="3"
              className="theme-textarea"
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end border-t border-[rgba(70,96,103,0.08)] pt-6">
          <button
            type="button"
            onClick={saveBusinessSettings}
            className="theme-button-primary px-6 py-3"
            disabled={isSavingBusiness}
          >
            {isSavingBusiness ? 'Saving...' : 'Save Business Details'}
          </button>
        </div>
      </SettingsSection>

      <SettingsSection
        sectionKey="branding"
        title="Branding"
        description="Upload the logo used in the sidebar and on printed or previewed invoices."
        icon={ImagePlus}
        isOpen={openSection === 'branding'}
        onToggle={() => toggleSection('branding')}
      >
        <div className="section-card p-5">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="text-3xl font-semibold text-[var(--ink)]">Store Logo</h3>
              <p className="mt-1 text-sm text-[var(--ink-soft)]">
                Square or landscape logos usually look best in the sidebar and invoice header.
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleLogoPick}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="theme-button-secondary px-4 py-2.5"
            >
              <ImagePlus size={18} />
              Choose Logo
            </button>
          </div>

          <div className="flex flex-col gap-5 rounded-[1.25rem] border border-[rgba(70,96,103,0.08)] bg-[rgba(255,252,246,0.75)] p-4 sm:flex-row sm:items-center">
            <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-[1.1rem] border border-[rgba(70,96,103,0.12)] bg-white">
              {bLogoDataUrl ? (
                <img src={bLogoDataUrl} alt="Store logo preview" className="h-full w-full object-contain" />
              ) : (
                <span className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--ink-soft)]">No Logo</span>
              )}
            </div>

            <div className="flex flex-1 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm leading-6 text-[var(--ink-soft)]">
                Save after uploading so the new logo is available in both the app sidebar and invoice viewer.
              </p>
              {bLogoDataUrl && (
                <button
                  type="button"
                  onClick={() => setBLogoDataUrl('')}
                  className="theme-button-ghost px-4 py-2.5"
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end border-t border-[rgba(70,96,103,0.08)] pt-6">
          <button
            type="button"
            onClick={saveBusinessSettings}
            className="theme-button-primary px-6 py-3"
            disabled={isSavingBusiness}
          >
            {isSavingBusiness ? 'Saving...' : 'Save Branding'}
          </button>
        </div>
      </SettingsSection>

      <SettingsSection
        sectionKey="backup"
        title="Backup & Restore"
        description="Write JSON backups into any local folder, including a Google Drive Desktop synced folder for off-device safety."
        icon={Cloud}
        isOpen={openSection === 'backup'}
        onToggle={() => toggleSection('backup')}
        badge={<span className={`badge ${backupEnabled ? 'badge-green' : 'badge-amber'}`}>{backupEnabled ? 'Enabled' : 'Disabled'}</span>}
      >
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)]">
          <div className="space-y-5">
            <div className="section-card p-5">
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <label className="section-card flex cursor-pointer items-start gap-4 p-4">
                  <input
                    type="checkbox"
                    checked={backupSettings.enabled}
                    onChange={(event) =>
                      setBackupSettings((current) => ({
                        ...current,
                        enabled: event.target.checked,
                        autoBackupEnabled: event.target.checked ? current.autoBackupEnabled : false
                      }))
                    }
                    className="mt-1 h-4 w-4 accent-[var(--sidebar-accent)]"
                  />
                  <div>
                    <p className="text-sm font-semibold text-[var(--ink)]">Enable local data backup</p>
                    <p className="mt-1 text-sm leading-6 text-[var(--ink-soft)]">
                      Turn on backup storage before choosing a synced or local folder.
                    </p>
                  </div>
                </label>

                <label className={`section-card flex cursor-pointer items-start gap-4 p-4 ${backupEnabled ? '' : 'opacity-60'}`}>
                  <input
                    type="checkbox"
                    checked={backupSettings.autoBackupEnabled}
                    onChange={(event) =>
                      setBackupSettings((current) => ({
                        ...current,
                        autoBackupEnabled: event.target.checked
                      }))
                    }
                    disabled={!backupEnabled}
                    className="mt-1 h-4 w-4 accent-[var(--sidebar-accent)]"
                  />
                  <div>
                    <p className="text-sm font-semibold text-[var(--ink)]">Enable auto backup</p>
                    <p className="mt-1 text-sm leading-6 text-[var(--ink-soft)]">
                      Automatically refresh the latest backup file at your chosen interval.
                    </p>
                  </div>
                </label>

                <div>
                  <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Auto Backup Interval (Hours)</label>
                  <input
                    type="number"
                    min="1"
                    max="168"
                    step="1"
                    value={backupSettings.autoBackupIntervalHours}
                    onChange={(event) =>
                      setBackupSettings((current) => ({
                        ...current,
                        autoBackupIntervalHours: Math.max(1, Math.min(168, Math.trunc(toNumber(event.target.value, 24)) || 24))
                      }))
                    }
                    disabled={!autoBackupEnabled}
                    className="theme-input"
                  />
                </div>

                <div className="lg:col-span-2">
                  <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Backup Folder</label>
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <input
                      value={backupSettings.folderPath}
                      readOnly
                      placeholder="Choose a local or Google Drive synced folder"
                      className="theme-input flex-1"
                    />
                    <button
                      type="button"
                      onClick={handleChooseBackupFolder}
                      disabled={!backupEnabled || backupActionBusy}
                      className="theme-button-secondary px-4 py-3"
                    >
                      <FolderOpen size={17} />
                      Choose Folder
                    </button>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">
                    Tip: choose a Google Drive Desktop sync folder if you want the backup file copied to your Drive automatically.
                  </p>
                </div>
              </div>

              <div className="mt-6 flex flex-wrap gap-3 border-t border-[rgba(70,96,103,0.08)] pt-6">
                <button
                  type="button"
                  onClick={() => saveBackupSettings()}
                  className="theme-button-primary px-5 py-3"
                  disabled={backupActionBusy}
                >
                  {isSavingBackup ? 'Saving...' : 'Save Backup Settings'}
                </button>
                <button
                  type="button"
                  onClick={handleBackupNow}
                  className="theme-button-secondary px-5 py-3"
                  disabled={backupActionBusy}
                >
                  <RefreshCw size={16} className={isRunningBackup ? 'animate-spin' : ''} />
                  {isRunningBackup ? 'Backing Up...' : 'Backup Now'}
                </button>
                <button
                  type="button"
                  onClick={handleRestoreBackup}
                  className="theme-button-danger px-5 py-3"
                  disabled={backupActionBusy}
                >
                  <RotateCcw size={16} className={isRestoringBackup ? 'animate-spin' : ''} />
                  {isRestoringBackup ? 'Restoring...' : 'Restore Latest'}
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <BackupInfoCard label="Backup Status" value={backupStatusLabel(backupSettings.lastBackupStatus, backupSettings.lastBackupAt)} />
            <BackupInfoCard label="Restore Status" value={backupStatusLabel(backupSettings.lastRestoreStatus, backupSettings.lastRestoreAt)} />
            <BackupInfoCard
              label="Latest Backup File"
              value={backupSettings.lastBackupFileName || backupSettings.lastRestoreFileName || '-'}
            />
            <BackupInfoCard
              label="Last Error"
              value={backupSettings.lastBackupError || backupSettings.lastRestoreError || 'No recent errors'}
              tone={backupSettings.lastBackupError || backupSettings.lastRestoreError ? 'danger' : 'default'}
              multiline
            />
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        sectionKey="tax"
        title="Tax & GST"
        description="Enable GST for billing invoices and set the total rate that will be split automatically into SGST and CGST."
        icon={Receipt}
        isOpen={openSection === 'tax'}
        onToggle={() => toggleSection('tax')}
        badge={<span className={billingGstBadge.className}>{billingGstBadge.label}</span>}
      >
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <div className="section-card p-5">
            <div className="grid grid-cols-1 gap-5">
              <label className="section-card flex cursor-pointer items-start gap-4 p-4">
                <input
                  type="checkbox"
                  checked={billingGstSettings.billingGstEnabled}
                  onChange={(event) => {
                    const nextEnabled = event.target.checked;
                    const currentRate = Math.max(0, toNumber(billingGstSettings.billingGstRate, 0));
                    const nextSettings = {
                      ...billingGstSettings,
                      billingGstEnabled: nextEnabled,
                      billingGstRate:
                        nextEnabled && currentRate <= 0
                          ? String(DEFAULT_BILLING_GST_RATE)
                          : billingGstSettings.billingGstRate
                    };

                    setBillingGstSettings(nextSettings);
                    void persistBillingGstSettings(nextSettings, { silentSuccess: true });
                  }}
                  className="mt-1 h-4 w-4 accent-[var(--sidebar-accent)]"
                />
                <div>
                  <p className="text-sm font-semibold text-[var(--ink)]">Enable SGST + CGST in billing</p>
                  <p className="mt-1 text-sm leading-6 text-[var(--ink-soft)]">
                    When enabled, billing totals, saved invoices, and printed invoice values split the configured GST into equal SGST and CGST components.
                  </p>
                  {!billingGstSettings.billingGstEnabled && (
                    <p className="mt-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-soft)]">
                      Turning this on defaults to {DEFAULT_BILLING_GST_RATE}% total GST if no rate is set.
                    </p>
                  )}
                </div>
              </label>

              <div>
                <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Default Total GST Rate (%)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={billingGstSettings.billingGstRate}
                  onChange={(event) =>
                    setBillingGstSettings((current) => ({
                      ...current,
                      billingGstRate: event.target.value
                    }))
                  }
                  className="theme-input"
                />
                <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">
                  The billing screen applies this total rate on the taxable value after discount, then splits it into SGST and CGST.
                </p>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-3 border-t border-[rgba(70,96,103,0.08)] pt-6">
              <button
                type="button"
                onClick={saveBillingGstSettings}
                className="theme-button-primary px-5 py-3"
                disabled={isSavingBillingGst}
              >
                {isSavingBillingGst ? 'Saving...' : 'Save GST Settings'}
              </button>
            </div>
          </div>

          <div className="space-y-4">
            <BackupInfoCard
              label="Billing GST"
              value={
                billingGstSettings.billingGstEnabled
                  ? 'SGST and CGST will be added to POS billing invoices.'
                  : 'GST is turned off for POS billing invoices.'
              }
              tone={billingGstSettings.billingGstEnabled ? 'default' : 'danger'}
              multiline
            />
            <BackupInfoCard
              label="Default Rate"
              value={`${billingGstRateValue.toFixed(2)}% total (${billingSgstRate.toFixed(2)}% SGST + ${billingCgstRate.toFixed(2)}% CGST)`}
            />
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        sectionKey="printing"
        title="Receipt Printing"
        description="Choose the thermal printer used for automatic POS receipt printing after invoice creation."
        icon={Printer}
        isOpen={openSection === 'printing'}
        onToggle={() => toggleSection('printing')}
        badge={<span className={thermalPrinterStatusBadge.className}>{thermalPrinterStatusBadge.label}</span>}
      >
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <div className="section-card p-5">
            <div className="grid grid-cols-1 gap-5">
              <label className="section-card flex cursor-pointer items-start gap-4 p-4">
                <input
                  type="checkbox"
                  checked={printingSettings.thermalAutoPrintEnabled}
                  onChange={(event) =>
                    setPrintingSettings((current) => ({
                      ...current,
                      thermalAutoPrintEnabled: event.target.checked
                    }))
                  }
                  className="mt-1 h-4 w-4 accent-[var(--sidebar-accent)]"
                />
                <div>
                  <p className="text-sm font-semibold text-[var(--ink)]">Auto print POS receipt after invoice save</p>
                  <p className="mt-1 text-sm leading-6 text-[var(--ink-soft)]">
                    When enabled, invoice creation will automatically send a thermal receipt to the selected POS printer if it is connected.
                  </p>
                </div>
              </label>

              <div>
                <div className="mb-1 flex items-center justify-between gap-3">
                  <label className="block text-sm font-bold text-[var(--ink-soft)]">Thermal Printer</label>
                  <button
                    type="button"
                    onClick={() => refreshPrinters()}
                    className="theme-button-ghost px-3 py-2 text-xs"
                    disabled={isRefreshingPrinters}
                  >
                    <RefreshCw size={14} className={isRefreshingPrinters ? 'animate-spin' : ''} />
                    {isRefreshingPrinters ? 'Refreshing...' : 'Refresh'}
                  </button>
                </div>
                <select
                  value={printingSettings.thermalPrinterName}
                  onChange={(event) =>
                    setPrintingSettings((current) => ({
                      ...current,
                      thermalPrinterName: event.target.value
                    }))
                  }
                  disabled={!printingSettings.thermalAutoPrintEnabled}
                  className="theme-select"
                >
                  <option value="">System Default Printer</option>
                  {availablePrinters.map((printer) => (
                    <option key={printer.name} value={printer.name}>
                      {printer.isDefault ? `${printer.displayName} (Default)` : printer.displayName}
                    </option>
                  ))}
                  {printingSettings.thermalPrinterName && !hasSavedThermalPrinter && (
                    <option value={printingSettings.thermalPrinterName}>
                      {printingSettings.thermalPrinterName} (Saved)
                    </option>
                  )}
                </select>
                <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">
                  A4 invoice printing stays manual. This section only controls automatic POS receipt printing.
                </p>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-3 border-t border-[rgba(70,96,103,0.08)] pt-6">
              <button
                type="button"
                onClick={savePrintingSettings}
                className="theme-button-primary px-5 py-3"
                disabled={isSavingPrinting}
              >
                {isSavingPrinting ? 'Saving...' : 'Save Printer Settings'}
              </button>
            </div>
          </div>

          <div className="space-y-4">
            <BackupInfoCard
              label="Selected Printer"
              value={printingSettings.thermalPrinterName || 'System Default Printer'}
            />
            <BackupInfoCard
              label="Detected Printers"
              value={hasPrinters ? `${availablePrinters.length} printer(s) available` : 'No printers detected'}
              tone={hasPrinters ? 'default' : 'danger'}
            />
            <BackupInfoCard
              label="Status"
              value={
                printingSettings.thermalAutoPrintEnabled
                  ? hasPrinters
                    ? printingSettings.thermalPrinterName && !hasSavedThermalPrinter
                      ? 'Saved printer is not connected right now.'
                      : 'Thermal auto print is ready for invoice creation.'
                    : 'Enable a printer connection before using thermal auto print.'
                  : 'Thermal auto print is disabled.'
              }
              tone={printingSettings.thermalAutoPrintEnabled && !hasPrinters ? 'danger' : 'default'}
              multiline
            />
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        sectionKey="license"
        title="License & Subscription"
        description="Activate the desktop app with a serial key and keep track of remaining licensed usage."
        icon={ShieldCheck}
        isOpen={openSection === 'license'}
        onToggle={() => toggleSection('license')}
        badge={<span className={licenseBadge.className}>{licenseBadge.label}</span>}
      >
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <div className="section-card p-5">
            <h3 className="text-3xl font-semibold text-[var(--ink)]">Software Product Key</h3>
            <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">
              Activate offline features for another 30 days with each valid key. The special admin key still works the same way.
            </p>

            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <input
                type="text"
                placeholder="12-Digit License Key"
                value={licenseKey}
                onChange={(event) => setLicenseKey(event.target.value)}
                className="theme-input flex-1 font-bold uppercase tracking-widest"
              />
              <button
                type="button"
                onClick={handleActivateLicense}
                className="theme-button-danger px-6 py-3"
                disabled={isActivatingLicense}
              >
                {isActivatingLicense ? 'Activating...' : 'Activate Key'}
              </button>
            </div>
          </div>

          <div className="section-card p-5">
            <p className="muted-kicker">License Summary</p>
            <div className="mt-4 rounded-[1.25rem] border border-[rgba(70,96,103,0.1)] bg-[rgba(255,252,246,0.84)] p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-[var(--ink-soft)]">Remaining Days</p>
                  <p className="mt-2 text-5xl font-black tracking-tight text-[var(--ink)]">
                    {licenseStatus.isGodMode ? '∞' : remainingDays}
                  </p>
                </div>
                <span className={remainingDaysBadgeClass}>
                  {licenseStatus.isGodMode ? 'No Expiry' : `${remainingDays} Days`}
                </span>
              </div>

              <div className="mt-4 h-2 overflow-hidden rounded-full bg-[rgba(212,223,219,0.72)]">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${licenseProgressPercent}%`,
                    background:
                      licenseStatus.isGodMode
                        ? 'linear-gradient(90deg, #5a8092, #3f6478)'
                        : remainingDays > 10
                          ? 'linear-gradient(90deg, #7cae9f, #4f7c6c)'
                          : remainingDays > 0
                            ? 'linear-gradient(90deg, #d4b06d, #a27a39)'
                            : 'linear-gradient(90deg, #c88272, #9c5a47)'
                  }}
                />
              </div>
              <p className="mt-3 text-xs leading-5 text-[var(--ink-soft)]">{remainingDaysCopy}</p>
            </div>

            <div className="mt-4 space-y-3 text-sm text-[var(--ink)]">
              <div className="flex items-center justify-between gap-4">
                <span className="text-[var(--ink-soft)]">Status</span>
                <span className="font-semibold">{licenseBadge.label}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-[var(--ink-soft)]">Days Remaining</span>
                <span className="font-semibold">
                  {licenseStatus.isGodMode ? 'Unlimited' : String(remainingDays)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-[var(--ink-soft)]">Valid Until</span>
                <span className="text-right font-semibold">
                  {licenseStatus.isGodMode ? 'No expiry' : formatDateTime(licenseStatus.validUntil)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-[var(--ink-soft)]">Keys Used</span>
                <span className="font-semibold">
                  {licenseStatus.keysUsed ?? 0} / {licenseStatus.maxKeys ?? 36}
                </span>
              </div>
            </div>
          </div>
        </div>
      </SettingsSection>
    </div>
  );
}
