import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  ImagePlus,
  Receipt,
  Settings2,
  Store
} from 'lucide-react';
import appLogo from '../../../../assets/logo/icon.png';

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
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return parsed;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });
}

function buildSetupState(data) {
  const business = data?.business || {};
  const uiSettings = data?.uiSettings || {};
  const normalizedName = String(business.name || '').trim();
  const normalizedPhone = String(business.phone || '').trim();
  const normalizedAddress = String(business.address || '').trim();

  return {
    name: normalizedName === 'Grocery Store' ? '' : normalizedName,
    phone: normalizedPhone === '+91 90000 00000' ? '' : normalizedPhone,
    address: normalizedAddress === 'Main Street' ? '' : normalizedAddress,
    gstin: String(business.gstin || '').trim().toUpperCase(),
    logoDataUrl: String(business.logoDataUrl || '').trim(),
    billingGstEnabled: Boolean(uiSettings.billingGstEnabled),
    billingGstRate: String(
      Math.max(
        0,
        toNumber(
          uiSettings.billingGstRate,
          uiSettings.billingGstEnabled ? DEFAULT_BILLING_GST_RATE : 0
        )
      )
    )
  };
}

export default function InitialSetupWizard({ data, fetchBootstrap, onComplete }) {
  const [formState, setFormState] = useState(() => buildSetupState(data));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);
  const nameInputRef = useRef(null);

  useEffect(() => {
    setFormState(buildSetupState(data));
  }, [data]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      nameInputRef.current?.focus();
    }, 20);

    return () => window.clearTimeout(timer);
  }, []);

  const gstRateValue = formState.billingGstEnabled
    ? Math.max(0, toNumber(formState.billingGstRate, DEFAULT_BILLING_GST_RATE))
    : 0;
  const sgstRate = gstRateValue > 0 ? gstRateValue / 2 : 0;
  const cgstRate = gstRateValue > 0 ? gstRateValue - sgstRate : 0;

  const handleLogoPick = async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      setFormState((current) => ({
        ...current,
        logoDataUrl: dataUrl
      }));
      setError('');
    } catch (uploadError) {
      setError(uploadError.message || 'Failed to load logo');
    } finally {
      event.target.value = '';
    }
  };

  const finishSetup = async ({ skipBusinessSave = false } = {}) => {
    if (!window.erpApi) {
      return;
    }

    if (!skipBusinessSave && !formState.name.trim()) {
      setError('Enter the store name to continue.');
      nameInputRef.current?.focus();
      return;
    }

    setIsSaving(true);
    setError('');

    try {
      if (!skipBusinessSave) {
        await unwrapIpcResponse(
          await window.erpApi.upsertBusiness({
            name: formState.name.trim(),
            phone: formState.phone.trim(),
            address: formState.address.trim(),
            gstin: formState.gstin.trim().toUpperCase(),
            logoDataUrl: formState.logoDataUrl
          })
        );
      }

      await unwrapIpcResponse(
        await window.erpApi.upsertUiSettings({
          setupCompleted: true,
          billingGstEnabled: formState.billingGstEnabled,
          billingGstRate: gstRateValue
        })
      );

      await fetchBootstrap();
      onComplete?.();
    } catch (saveError) {
      setError(saveError.message || 'Failed to complete setup.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen overflow-y-auto bg-[var(--canvas)]">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-5 py-6 sm:px-8 lg:px-10">
        <header className="flex flex-wrap items-center justify-between gap-4 pb-6">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-[1.25rem] border border-[rgba(70,96,103,0.12)] bg-white shadow-[0_14px_34px_rgba(27,44,54,0.08)]">
              <img src={appLogo} alt="ERPManiaC logo" className="h-full w-full object-contain" />
            </div>
            <div>
              <p className="muted-kicker">ERPManiaC</p>
              <h1 className="text-4xl font-semibold text-[var(--ink)]">Initial Setup</h1>
            </div>
          </div>

          <button
            type="button"
            onClick={() => finishSetup({ skipBusinessSave: true })}
            disabled={isSaving}
            className="theme-button-ghost px-4 py-2.5 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Skip For Now
          </button>
        </header>

        <div className="grid flex-1 gap-6 xl:grid-cols-[minmax(0,1.08fr)_24rem]">
          <div className="space-y-6">
            <section
              className="overflow-hidden rounded-[1.8rem] border border-[rgba(255,255,255,0.28)] px-6 py-7 text-white shadow-[0_30px_70px_rgba(24,40,49,0.16)]"
              style={{
                background:
                  'radial-gradient(circle at top right, rgba(160,217,203,0.24), transparent 11rem), linear-gradient(135deg, #274958 0%, #365f70 52%, #4f8b84 100%)'
              }}
            >
              <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                <div className="max-w-3xl">
                  <p className="text-xs font-bold uppercase tracking-[0.24em] text-white/72">Startup Setup</p>
                  <h2 className="mt-3 text-5xl font-semibold leading-none text-white">
                    Set up the essentials before you start billing.
                  </h2>
                  <p className="mt-4 max-w-2xl text-sm leading-6 text-white/78">
                    This screen is only for fresh systems. Add the business identity once, decide whether billing should include GST, and then move directly into the main app.
                  </p>
                </div>

                <div className="rounded-[1.25rem] border border-[rgba(255,255,255,0.18)] bg-[rgba(255,255,255,0.12)] px-4 py-3 text-sm font-semibold text-white/92 backdrop-blur-sm">
                  Startup Configuration
                </div>
              </div>
            </section>

            <section className="glass-panel p-6">
              <div className="mb-5 flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgba(69,111,121,0.12)] text-[var(--ink)]">
                  <Building2 size={20} />
                </div>
                <div>
                  <p className="muted-kicker">Business Details</p>
                  <h2 className="text-3xl font-semibold text-[var(--ink)]">Store identity</h2>
                </div>
              </div>

              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_16rem]">
                <div className="grid grid-cols-1 gap-5">
                  <div>
                    <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Store Name</label>
                    <input
                      ref={nameInputRef}
                      value={formState.name}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          name: event.target.value
                        }))
                      }
                      className="theme-input"
                      placeholder="ASH STORE"
                    />
                  </div>

                  <div className="grid gap-5 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Phone Number</label>
                      <input
                        value={formState.phone}
                        onChange={(event) =>
                          setFormState((current) => ({
                            ...current,
                            phone: event.target.value
                          }))
                        }
                        className="theme-input"
                        placeholder="+91 94960 51129"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">GSTIN (Optional)</label>
                      <input
                        value={formState.gstin}
                        onChange={(event) =>
                          setFormState((current) => ({
                            ...current,
                            gstin: event.target.value.toUpperCase()
                          }))
                        }
                        className="theme-input"
                        placeholder="32XXXXXXXXXXXX"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Store Address</label>
                    <textarea
                      rows={4}
                      value={formState.address}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          address: event.target.value
                        }))
                      }
                      className="theme-textarea"
                      placeholder="Chaniyamkadavu, Thiruvallur, Kerala"
                    />
                  </div>
                </div>

                <div className="section-card flex flex-col items-center justify-between gap-4 p-5">
                  <div className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-[1.2rem] border border-[rgba(70,96,103,0.12)] bg-white">
                    {formState.logoDataUrl ? (
                      <img src={formState.logoDataUrl} alt="Store logo preview" className="h-full w-full object-contain" />
                    ) : (
                      <span className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--ink-soft)]">
                        No Logo
                      </span>
                    )}
                  </div>

                  <div className="w-full space-y-3">
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
                      className="theme-button-secondary w-full px-4 py-3"
                    >
                      <ImagePlus size={18} />
                      Upload Logo
                    </button>
                    {formState.logoDataUrl && (
                      <button
                        type="button"
                        onClick={() =>
                          setFormState((current) => ({
                            ...current,
                            logoDataUrl: ''
                          }))
                        }
                        className="theme-button-ghost w-full px-4 py-3"
                      >
                        Remove Logo
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </section>

            <section className="glass-panel p-6">
              <div className="mb-5 flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgba(69,111,121,0.12)] text-[var(--ink)]">
                  <Receipt size={20} />
                </div>
                <div>
                  <p className="muted-kicker">Billing Preferences</p>
                  <h2 className="text-3xl font-semibold text-[var(--ink)]">GST in billing</h2>
                </div>
              </div>

              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
                <div className="space-y-5">
                  <label className="section-card flex cursor-pointer items-start gap-4 p-5">
                    <input
                      type="checkbox"
                      checked={formState.billingGstEnabled}
                      onChange={(event) =>
                        setFormState((current) => {
                          const nextEnabled = event.target.checked;
                          const currentRate = Math.max(0, toNumber(current.billingGstRate, 0));

                          return {
                            ...current,
                            billingGstEnabled: nextEnabled,
                            billingGstRate:
                              nextEnabled && currentRate <= 0
                                ? String(DEFAULT_BILLING_GST_RATE)
                                : current.billingGstRate
                          };
                        })
                      }
                      className="mt-1 h-4 w-4 accent-[var(--sidebar-accent)]"
                    />
                    <div>
                      <p className="text-sm font-semibold text-[var(--ink)]">Enable GST in billing</p>
                      <p className="mt-1 text-sm leading-6 text-[var(--ink-soft)]">
                        When enabled, billing invoices and printouts will automatically show the total GST split into SGST and CGST.
                      </p>
                    </div>
                  </label>

                  <div>
                    <label className="mb-1 block text-sm font-bold text-[var(--ink-soft)]">Total GST Rate (%)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={formState.billingGstRate}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          billingGstRate: event.target.value
                        }))
                      }
                      disabled={!formState.billingGstEnabled}
                      className="theme-input"
                    />
                  </div>
                </div>

                <div className="section-card p-5">
                  <p className="muted-kicker">Tax Preview</p>
                  <div className="mt-4 space-y-3 text-sm text-[var(--ink-soft)]">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">Billing GST</span>
                      <span className={`badge ${formState.billingGstEnabled ? 'badge-green' : 'badge-amber'}`}>
                        {formState.billingGstEnabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="font-medium">SGST</span>
                      <span className="text-lg font-bold text-[var(--ink)]">{sgstRate.toFixed(2)}%</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="font-medium">CGST</span>
                      <span className="text-lg font-bold text-[var(--ink)]">{cgstRate.toFixed(2)}%</span>
                    </div>
                  </div>
                </div>
              </div>

              {error && (
                <div className="mt-5 rounded-[1rem] border border-[rgba(158,88,73,0.18)] bg-[rgba(255,241,236,0.82)] px-4 py-3 text-sm font-medium text-[var(--rose-text)]">
                  {error}
                </div>
              )}

              <div className="mt-6 flex flex-col-reverse gap-3 border-t border-[rgba(70,96,103,0.08)] pt-6 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm leading-6 text-[var(--ink-soft)]">
                  You can still change branding, GST, printing, and backups later from Settings.
                </p>

                <button
                  type="button"
                  onClick={() => finishSetup()}
                  disabled={isSaving}
                  className="theme-button-primary px-6 py-3 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSaving ? 'Starting...' : 'Save And Start ERPManiaC'}
                  {!isSaving && <ArrowRight size={16} />}
                </button>
              </div>
            </section>
          </div>

          <aside className="space-y-4">
            <div className="section-card p-5">
              <p className="muted-kicker">Live Preview</p>
              <div className="mt-4 flex items-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-[1rem] border border-[rgba(70,96,103,0.12)] bg-white">
                  {formState.logoDataUrl ? (
                    <img src={formState.logoDataUrl} alt="Store logo preview" className="h-full w-full object-contain" />
                  ) : (
                    <Store size={22} className="text-[var(--ink-soft)]" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-2xl font-semibold text-[var(--ink)]">
                    {formState.name || 'Your Store'}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-[var(--ink-soft)]">
                    {formState.address || 'Address will appear here'}
                  </p>
                </div>
              </div>
            </div>

            <div className="section-card p-5">
              <p className="muted-kicker">What gets configured</p>
              <div className="mt-4 space-y-4">
                <div className="flex items-start gap-3">
                  <CheckCircle2 size={18} className="mt-0.5 text-emerald-600" />
                  <div>
                    <p className="font-semibold text-[var(--ink)]">Invoice identity</p>
                    <p className="mt-1 text-sm leading-6 text-[var(--ink-soft)]">
                      Store name, address, phone, GSTIN, and logo are used across print and preview.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <CheckCircle2 size={18} className="mt-0.5 text-emerald-600" />
                  <div>
                    <p className="font-semibold text-[var(--ink)]">POS tax behavior</p>
                    <p className="mt-1 text-sm leading-6 text-[var(--ink-soft)]">
                      Billing will follow the GST preference you choose here.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Settings2 size={18} className="mt-0.5 text-[var(--ink)]" />
                  <div>
                    <p className="font-semibold text-[var(--ink)]">Everything remains editable</p>
                    <p className="mt-1 text-sm leading-6 text-[var(--ink-soft)]">
                      Later changes stay in the Settings screen instead of reopening this startup page.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
