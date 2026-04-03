export const PERIOD_OPTIONS = [
  { value: 'daily', label: 'Day' },
  { value: 'monthly', label: 'Month' },
  { value: 'yearly', label: 'Year' }
];

function pad(value) {
  return String(value).padStart(2, '0');
}

function parseLocalDateInput(inputDate) {
  const text = String(inputDate || '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const parsed = new Date(year, monthIndex, day, 12, 0, 0, 0);

  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== monthIndex ||
    parsed.getDate() !== day
  ) {
    return null;
  }

  return parsed;
}

function normalizePeriod(period) {
  const value = String(period || '').trim().toLowerCase();
  if (value === 'daily' || value === 'monthly' || value === 'yearly') {
    return value;
  }

  return 'daily';
}

export function toDayKey(inputDate) {
  const date = new Date(inputDate);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function getTodayDateInput() {
  return toDayKey(new Date());
}

export function resolveFocusDate(inputDate) {
  return parseLocalDateInput(inputDate) || new Date();
}

export function getPeriodRange(period, inputDate) {
  const normalizedPeriod = normalizePeriod(period);
  const focusDate = resolveFocusDate(inputDate);

  if (normalizedPeriod === 'monthly') {
    const start = new Date(focusDate.getFullYear(), focusDate.getMonth(), 1, 0, 0, 0, 0);
    const end = new Date(focusDate.getFullYear(), focusDate.getMonth() + 1, 1, 0, 0, 0, 0);
    return { start, end };
  }

  if (normalizedPeriod === 'yearly') {
    const start = new Date(focusDate.getFullYear(), 0, 1, 0, 0, 0, 0);
    const end = new Date(focusDate.getFullYear() + 1, 0, 1, 0, 0, 0, 0);
    return { start, end };
  }

  const start = new Date(focusDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 1);
  return { start, end };
}

export function formatPeriodLabel(period, inputDate) {
  const normalizedPeriod = normalizePeriod(period);
  const focusDate = resolveFocusDate(inputDate);

  if (normalizedPeriod === 'monthly') {
    return focusDate.toLocaleString('en-IN', {
      month: 'short',
      year: 'numeric'
    });
  }

  if (normalizedPeriod === 'yearly') {
    return String(focusDate.getFullYear());
  }

  return focusDate.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}

export function shiftFocusDate(period, inputDate, delta) {
  const normalizedPeriod = normalizePeriod(period);
  const focusDate = resolveFocusDate(inputDate);

  if (normalizedPeriod === 'monthly') {
    const next = new Date(focusDate.getFullYear(), focusDate.getMonth(), 1, 12, 0, 0, 0);
    next.setMonth(next.getMonth() + delta);
    return toDayKey(next);
  }

  if (normalizedPeriod === 'yearly') {
    const next = new Date(focusDate.getFullYear() + delta, 0, 1, 12, 0, 0, 0);
    return toDayKey(next);
  }

  const next = new Date(focusDate);
  next.setDate(next.getDate() + delta);
  return toDayKey(next);
}

export function filterRecordsByPeriod(records, period, inputDate, getDateValue = (record) => record?.createdAt) {
  const source = Array.isArray(records) ? records : [];
  const { start, end } = getPeriodRange(period, inputDate);

  return source.filter((record) => {
    const value = getDateValue(record);
    const date = new Date(value);
    return !Number.isNaN(date.getTime()) && date >= start && date < end;
  });
}
