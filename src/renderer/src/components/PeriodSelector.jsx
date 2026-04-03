import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { PERIOD_OPTIONS, formatPeriodLabel, shiftFocusDate } from '../utils/dateFilters';

export default function PeriodSelector(props) {
  const {
    period,
    focusDate,
    onPeriodChange,
    onFocusDateChange,
    label = 'Period',
    summary,
    className = ''
  } = props;

  const resolvedSummary = summary || formatPeriodLabel(period, focusDate);

  return (
    <div className={`section-card flex flex-col gap-4 p-4 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="muted-kicker">{label}</p>
          <p className="mt-2 text-sm font-semibold text-[var(--ink)]">{resolvedSummary}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {PERIOD_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onPeriodChange(option.value)}
              className={`${period === option.value ? 'theme-button-primary' : 'theme-button-secondary'} rounded-full px-4 py-2 text-sm`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onFocusDateChange(shiftFocusDate(period, focusDate, -1))}
          className="theme-button-ghost rounded-full px-3 py-2"
          aria-label="Previous period"
        >
          <ChevronLeft size={16} />
        </button>

        <div className="flex min-w-[12rem] flex-1 items-center gap-2 rounded-[1rem] border border-[rgba(70,96,103,0.12)] bg-[rgba(255,252,246,0.82)] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.82)]">
          <CalendarDays size={16} className="text-[var(--ink-soft)]" />
          <input
            type="date"
            value={focusDate}
            onChange={(event) => onFocusDateChange(event.target.value)}
            className="w-full border-0 bg-transparent text-sm font-semibold text-[var(--ink)] outline-none"
          />
        </div>

        <button
          type="button"
          onClick={() => onFocusDateChange(shiftFocusDate(period, focusDate, 1))}
          className="theme-button-ghost rounded-full px-3 py-2"
          aria-label="Next period"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
