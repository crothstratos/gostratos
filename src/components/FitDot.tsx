import React from 'react';
import { FitScore, verdictFor, verdictColor, VERDICT_LABEL } from '../fitScore';
import { cn } from '../utils';

/**
 * The same judgement as the dial, reduced to a coloured dot.
 *
 * On a pipeline card the question is not "how good is this out of a hundred" —
 * it is which of three things to do with it, and a number invites a debate
 * about whether 63 and 66 really differ. So Sourcing keeps the dial, where the
 * job is ranking several hundred companies against each other, and the board
 * gets a dot, where the job is a decision.
 *
 * Green: a good fit, keep looking at it. Amber: worth reaching out to learn
 * more. Red: below the bar — Watchlist or Passed.
 *
 * A bare colour is the weakest possible encoding, and red/amber/green is the
 * worst case of it. Three things carry the meaning anyway: the dot's own
 * brightness differs between verdicts because the ramp's lightness is
 * monotonic, the hover text spells out the verdict and the score, and the
 * aria-label says it to a screen reader. A person who cannot separate the hues
 * still gets the answer.
 */
export function FitDot({
  fit,
  className,
}: {
  fit: FitScore;
  className?: string;
}) {
  const verdict = verdictFor(fit.score);
  const colour = verdictColor(verdict);

  // Nothing is known about this company, so there is no verdict to give. A red
  // dot here would say "we looked and it is poor" about something nobody has
  // looked at, which is the one reading that must not happen.
  if (fit.coverage < 0.35) return null;

  const label = `${VERDICT_LABEL[verdict]} (${fit.score}/100)`;

  return (
    <span
      className={cn('relative inline-flex shrink-0', className)}
      title={label}
      aria-label={label}
      role="img"
    >
      <span
        className="block h-3 w-3 rounded-full ring-2 ring-white dark:hidden dark:ring-slate-900"
        style={{ backgroundColor: colour.light }}
      />
      <span
        className="hidden h-3 w-3 rounded-full ring-2 ring-white dark:block dark:ring-slate-900"
        style={{ backgroundColor: colour.dark }}
      />
    </span>
  );
}
