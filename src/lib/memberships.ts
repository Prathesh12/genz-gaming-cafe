/**
 * Which membership term is in force at a given moment.
 *
 * Renewals *stack*: buying a renewal before the current term runs out creates a
 * new row that starts on the day the old one ends. So a paid-up member can
 * easily have a row whose start date is in the future, and "the row with the
 * latest end date" is then a term that has not begun yet.
 *
 * Reading it that way is what caused a real billing bug: a member who renewed
 * early was charged regular rates, while the member search — which looked only
 * at the latest end date — still showed them in green as active. The screen and
 * the till disagreed.
 *
 * The rule here is the one a person would use: find the term that covers this
 * moment, then follow the chain of renewals stacked on top of it to see how far
 * unbroken cover runs. Pure and dependency-free, so it can be tested directly.
 */
export type MembershipTerm = {
  id: string;
  startDate: Date;
  endDate: Date;
};

export type MembershipCoverage<T extends MembershipTerm> = {
  /** The term the member is inside right now. */
  term: T;
  /** The end of unbroken cover, following renewals stacked on top of it. */
  validUntil: Date;
};

export function activeCoverage<T extends MembershipTerm>(
  terms: T[],
  at: Date,
): MembershipCoverage<T> | null {
  const moment = at.getTime();
  const sorted = [...terms].sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

  const current = sorted.find(
    (term) => term.startDate.getTime() <= moment && term.endDate.getTime() > moment,
  );
  if (!current) return null;

  // Walk forward through renewals that begin on or before cover would lapse.
  let validUntil = current.endDate;
  for (const term of sorted) {
    if (term.startDate.getTime() <= validUntil.getTime() && term.endDate.getTime() > validUntil.getTime()) {
      validUntil = term.endDate;
    }
  }

  return { term: current, validUntil };
}

/** True when the member is covered at `at`. */
export function isCovered(terms: MembershipTerm[], at: Date): boolean {
  return activeCoverage(terms, at) !== null;
}
