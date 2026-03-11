import React from 'react';
import { Tooltip } from './ui/Tooltip';
import {
  RuleChangeSummary,
  RuleKind,
  ComplexChangeType,
} from '../services/ruleAnalysis/ruleChangeTypes';

const badgeBase = 'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-semibold';
const sizeClasses = {
  sm: 'text-[11px] leading-4',
  xs: 'text-[10px] leading-4',
};

interface RuleChangeBadgesProps {
  summary: RuleChangeSummary;
  size?: 'sm' | 'xs';
}

export const RuleChangeBadges: React.FC<RuleChangeBadgesProps> = ({ summary, size = 'sm' }) => {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Tooltip content={kindTooltip(summary.kind)}>
        <span className={`${badgeBase} ${kindBadgeClass(summary.kind)} ${sizeClasses[size]}`}>
          {kindLabel(summary.kind)}
        </span>
      </Tooltip>
      <Tooltip
        content={
          summary.reversibility === 'reversible'
            ? 'Rule is reversible (<->)'
            : 'Rule is irreversible (->)'
        }
      >
        <span className={`${badgeBase} bg-slate-100 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 ${sizeClasses[size]}`}>
          {summary.reversibility === 'reversible' ? '↔ reversible' : '→ irreversible'}
        </span>
      </Tooltip>
      {[ 'assoc_nonrev', 'assoc_rev', 'dissoc_nonrev', 'dissoc_rev' ].includes(summary.complexChange) && (
        <Tooltip content={complexChangeTooltip(summary.complexChange)}>
          <span className={`${badgeBase} ${complexBadgeClass(summary.complexChange)} ${sizeClasses[size]}`}>
            {complexChangeLabel(summary.complexChange)}
          </span>
        </Tooltip>
      )}
    </div>
  );
};

export const renderHumanSummary = (summary: RuleChangeSummary): string => {
  const bits: string[] = [];

  if (summary.synthDegChanges.length > 0) {
    const synth = summary.synthDegChanges
      .filter((ch) => ch.change === 'synthesized')
      .map((ch) => ch.molecule);
    const deg = summary.synthDegChanges
      .filter((ch) => ch.change === 'degraded')
      .map((ch) => ch.molecule);
    if (synth.length) bits.push(`creates ${Array.from(new Set(synth)).join(', ')}`);
    if (deg.length) bits.push(`removes ${Array.from(new Set(deg)).join(', ')}`);
  }

  if (summary.bondChanges.length > 0) {
    const boundSites = summary.bondChanges
      .filter((b) => b.change === 'added')
      .map((b) => `${b.molecule}.${b.site}`);
    const unboundSites = summary.bondChanges
      .filter((b) => b.change === 'removed')
      .map((b) => `${b.molecule}.${b.site}`);
    if (boundSites.length) bits.push(`binds at ${Array.from(new Set(boundSites)).join(', ')}`);
    if (unboundSites.length) bits.push(`unbinds at ${Array.from(new Set(unboundSites)).join(', ')}`);
  }

  if (summary.stateChanges.length > 0) {
    const states = summary.stateChanges.map(
      (s) => `${s.molecule}.${s.site}: ${s.fromState}→${s.toState}`
    );
    bits.push(`changes states (${states.join('; ')})`);
  }

  if (bits.length === 0) {
    return 'No structural changes detected.';
  }

  return `This rule ${bits.join(', ')}.`;
};

const kindLabel = (kind: RuleKind): string => {
  switch (kind) {
    case 'pure_state_change':
      return 'State change';
    case 'pure_binding':
      return 'Binding';
    case 'binding_and_state_change':
      return 'Binding + state';
    case 'synthesis':
      return 'Synthesis';
    case 'degradation':
      return 'Degradation';
    case 'association':
      return 'Association';
    case 'dissociation':
      return 'Dissociation';
    case 'mixed':
    default:
      return 'Mixed';
  }
};

const kindTooltip = (kind: RuleKind): string => {
  switch (kind) {
    case 'pure_state_change':
      return 'Only internal states change (no binding).';
    case 'pure_binding':
      return 'Only bonds are created or broken.';
    case 'binding_and_state_change':
      return 'This rule both changes bonds and internal states.';
    case 'synthesis':
      return 'Creates molecules from nothing (0 → X).';
    case 'degradation':
      return 'Removes molecules (X → 0).';
    case 'association':
      return 'Fuses separate complexes into one.';
    case 'dissociation':
      return 'Splits a complex into separate pieces.';
    case 'mixed':
    default:
      return 'Combines several operations (binding, state changes, synth/deg).';
  }
};

const kindBadgeClass = (kind: RuleKind): string => {
  switch (kind) {
    case 'pure_state_change':
      return 'bg-amber-50 text-amber-800 border-amber-200';
    case 'pure_binding':
      return 'bg-emerald-50 text-emerald-800 border-emerald-200';
    case 'binding_and_state_change':
      return 'bg-sky-50 text-sky-800 border-sky-200';
    case 'synthesis':
    case 'degradation':
      return 'bg-fuchsia-50 text-fuchsia-800 border-fuchsia-200';
    case 'association':
    case 'dissociation':
      return 'bg-indigo-50 text-indigo-800 border-indigo-200';
    case 'mixed':
    default:
      return 'bg-slate-50 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700';
  }
};

const complexChangeLabel = (change: ComplexChangeType): string => {
  switch (change) {
    case 'assoc_nonrev':
      return 'Assoc (irreversible)';
    case 'assoc_rev':
      return 'Assoc (reversible)';
    case 'dissoc_nonrev':
      return 'Dissoc (irreversible)';
    case 'dissoc_rev':
      return 'Dissoc (reversible)';
    default:
      return '';
  }
};

const complexChangeTooltip = (change: ComplexChangeType): string => {
  switch (change) {
    case 'assoc_nonrev':
      return 'Joins separate complexes irreversibly.';
    case 'assoc_rev':
      return 'Joins separate complexes reversibly.';
    case 'dissoc_nonrev':
      return 'Splits a complex irreversibly.';
    case 'dissoc_rev':
      return 'Splits a complex reversibly.';
    default:
      return '';
  }
};

const complexBadgeClass = (change: ComplexChangeType): string => {
  if (change.startsWith('assoc')) {
    return 'bg-indigo-50 text-indigo-800 border-indigo-200';
  }
  if (change.startsWith('dissoc')) {
    return 'bg-rose-50 text-rose-800 border-rose-200';
  }
  return 'bg-slate-50 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700';
};
