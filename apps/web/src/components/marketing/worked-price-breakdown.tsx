import { formatGBP } from '@sv/contracts';
import type { ReactNode } from 'react';
import { workedExampleCopy } from '@/content/pricing';
import type { WorkedExample } from '@/server/marketing';

export function WorkedPriceBreakdown({ example }: { example: WorkedExample }): ReactNode {
  return (
    <>
      {example.selectedSlot ? (
        <p>
          <time dateTime={example.selectedSlot.date}>{example.selectedSlot.dateLabel}</time>
          {' — '}{workedExampleCopy.afternoon}{' ('}{example.selectedSlot.windowLabel}{')'}
        </p>
      ) : null}
      <dl className="breakdown-list">
        {example.breakdown.map((line) => (
          <div key={line.label}>
            <dt>{line.label}</dt>
            <dd>{formatGBP(line.pence)}</dd>
          </div>
        ))}
        {example.subtotalPence !== null ? (
          <div>
            <dt>{workedExampleCopy.subtotal}</dt>
            <dd>{formatGBP(example.subtotalPence)}</dd>
          </div>
        ) : null}
        {example.selectedSlot ? (
          <div>
            <dt>{workedExampleCopy.adjustment}</dt>
            <dd>
              {example.selectedSlot.adjustmentPence < 0 ? '−' : '+'}
              {formatGBP(Math.abs(example.selectedSlot.adjustmentPence))}
            </dd>
          </div>
        ) : null}
        <div>
          <dt>{workedExampleCopy.total}</dt>
          <dd>{example.totalPence === null ? example.unavailableReason : formatGBP(example.totalPence)}</dd>
        </div>
      </dl>
      {example.selectedSlot ? (
        <p className="field-help">
          {example.selectedSlot.adjustments.length === 0
            ? workedExampleCopy.noAdjustments
            : example.selectedSlot.adjustments.map((adjustment) => `${adjustment.label} ×${String(adjustment.multiplier)}`).join(' · ')}
        </p>
      ) : null}
      <p className="field-help">{workedExampleCopy.generated} {example.dateLabel}.</p>
    </>
  );
}
