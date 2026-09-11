import React from 'react';
import { FitScore, bandFor, BAND_LABEL, colorFor, colorForDark } from '../fitScore';
import { cn } from '../utils';

/**
 * A fit score, as a needle on an arc.
 *
 * The score is encoded four ways: the needle's angle, the length of the filled
 * arc, the colour, and the number itself. That redundancy is not decoration —
 * red-to-green is unreadable as colour to about one man in twelve, and the
 * other three channels are what make the dial work for them. It is also why
 * the number is never dropped at small sizes.
 *
 * Hovering shows the breakdown. A score you cannot interrogate is a score
 * nobody should act on, and "why is this a 43" has an answer that fits in a
 * tooltip: six rows, the points each earned, and what earned them.
 */

const SIZE = 74;
const CX = SIZE / 2;
const CY = SIZE / 2 + 5;
const R = 26;
/** 240° of travel, from bottom-left round through the top to bottom-right. */
const START = 210;
const SWEEP = 240;

const polar = (deg: number, radius = R) => {
  const rad = (deg * Math.PI) / 180;
  return { x: CX + radius * Math.cos(rad), y: CY - radius * Math.sin(rad) };
};

/** Arc path from the start of the scale to `t` (0-1). */
function arcTo(t: number): string {
  const from = polar(START);
  const to = polar(START - SWEEP * t);
  const large = SWEEP * t > 180 ? 1 : 0;
  // Sweep flag 1: the scale runs clockwise on screen, which is the direction
  // every dial a person has ever read runs in.
  return `M ${from.x.toFixed(2)} ${from.y.toFixed(2)} A ${R} ${R} 0 ${large} 1 ${to.x.toFixed(2)} ${to.y.toFixed(2)}`;
}

export function FitDial({
  fit,
  label = 'Fit',
  className,
}: {
  fit: FitScore;
  /** What the score is of — "Fit" for a company, "Similarity" for a firm. */
  label?: string;
  className?: string;
}) {
  const t = Math.max(0, Math.min(100, fit.score)) / 100;
  const band = bandFor(fit.score);
  const light = colorFor(fit.score);
  const dark = colorForDark(fit.score);
  const needle = polar(START - SWEEP * t, R - 6);
  const hub = polar(START - SWEEP * t, 5);

  // Under about a third coverage the rubric had almost nothing to read, and
  // the score is a placeholder rather than a judgement. Shown as a dashed
  // track and an explicit word, because a confident-looking 8 on a company
  // nobody has researched is worse than no dial at all.
  const provisional = fit.coverage < 0.35;

  const summary = [
    `${label}: ${fit.score} out of 100 — ${BAND_LABEL[band]}.`,
    provisional ? 'Provisional: not enough is known about this yet.' : '',
    '',
    ...fit.reasons.map((r) => `${r.label}: ${r.points}/${r.max} — ${r.detail}`),
  ]
    .filter((line, i, all) => line !== '' || all[i - 1] !== '')
    .join('\n');

  return (
    <div
      className={cn('group relative flex shrink-0 flex-col items-center', className)}
      title={summary}
    >
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={summary}
        className="overflow-visible"
      >
        {/*
          The track is a tint of the arc's own colour rather than neutral grey,
          so the state reads across the whole dial and not only the filled
          part. Dashed when the score is provisional.
        */}
        <path
          d={arcTo(1)}
          fill="none"
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={provisional ? '2 4' : undefined}
          className="stroke-slate-200 dark:stroke-slate-700"
        />

        {/*
          Two arcs, one per theme. The colour depends on the score, so it
          cannot live in a stylesheet, and painting both lets the theme switch
          without JavaScript or a flash of the wrong colour.
        */}
        <g className="dark:hidden">
          <path d={arcTo(t)} fill="none" stroke={light} strokeWidth={6} strokeLinecap="round" />
          <line
            x1={hub.x} y1={hub.y} x2={needle.x} y2={needle.y}
            stroke={light} strokeWidth={2.5} strokeLinecap="round"
          />
          <circle cx={CX} cy={CY} r={3.5} fill={light} />
        </g>
        <g className="hidden dark:block">
          <path d={arcTo(t)} fill="none" stroke={dark} strokeWidth={6} strokeLinecap="round" />
          <line
            x1={hub.x} y1={hub.y} x2={needle.x} y2={needle.y}
            stroke={dark} strokeWidth={2.5} strokeLinecap="round"
          />
          <circle cx={CX} cy={CY} r={3.5} fill={dark} />
        </g>

        {/*
          The number wears an ink colour, not the arc's. It has to stay
          readable at every point on the ramp, and a number painted amber on
          white is the one thing on the card nobody can read.
        */}
        <text
          x={CX}
          y={CY - 8}
          textAnchor="middle"
          className="fill-slate-900 text-[17px] font-bold dark:fill-white"
        >
          {provisional ? '–' : fit.score}
        </text>
      </svg>

      <span className="-mt-1 text-[9.5px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {provisional ? 'No data' : BAND_LABEL[band]}
      </span>
    </div>
  );
}

/**
 * The breakdown, for somewhere there is room to show it properly.
 *
 * The tooltip is the quick answer; this is the one you can read.
 */
export function FitBreakdown({ fit }: { fit: FitScore }) {
  return (
    <div className="space-y-1">
      {fit.reasons.map((r) => (
        <div key={r.label} className="flex items-baseline gap-2 text-[11.5px]">
          <span className="w-24 shrink-0 text-slate-400">{r.label}</span>
          <span className="w-10 shrink-0 font-semibold tabular-nums text-slate-700 dark:text-slate-200">
            {r.points}/{r.max}
          </span>
          <span className="text-slate-500 dark:text-slate-400">{r.detail}</span>
        </div>
      ))}
    </div>
  );
}
