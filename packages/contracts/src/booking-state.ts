import { DEFAULT_PRICING_CONFIG, type ServiceKey } from '@sv/pricing';
import { AppError } from './errors';

export const BOOKING_STATUSES = [
  'PENDING_PAYMENT',
  'CONFIRMED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'EXPIRED',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const DISPATCH_STATUSES = ['UNASSIGNED', 'OFFERED', 'ACCEPTED'] as const;
export type DispatchStatus = (typeof DISPATCH_STATUSES)[number];

export const JOB_STAGES = [
  'NOT_STARTED',
  'EN_ROUTE_TO_PICKUP',
  'AT_PICKUP',
  'LOADING',
  'EN_ROUTE_TO_DROPOFF',
  'AT_DROPOFF',
  'UNLOADING',
  'COMPLETED',
] as const;
export type JobStage = (typeof JOB_STAGES)[number];

export const TRANSITION_ACTORS = ['SYSTEM', 'OWNER', 'ADMIN', 'DRIVER', 'CUSTOMER'] as const;
export type TransitionActor = (typeof TRANSITION_ACTORS)[number];

export interface Transition<From extends string, To extends string> {
  from: From;
  to: To;
  actors: readonly TransitionActor[];
}

export const BOOKING_TRANSITIONS = [
  { from: 'PENDING_PAYMENT', to: 'CONFIRMED', actors: ['SYSTEM', 'OWNER'] },
  { from: 'PENDING_PAYMENT', to: 'EXPIRED', actors: ['SYSTEM'] },
  { from: 'PENDING_PAYMENT', to: 'CANCELLED', actors: ['ADMIN', 'OWNER'] },
  { from: 'EXPIRED', to: 'CONFIRMED', actors: ['SYSTEM'] },
  { from: 'CONFIRMED', to: 'IN_PROGRESS', actors: ['DRIVER', 'ADMIN', 'OWNER'] },
  { from: 'CONFIRMED', to: 'CANCELLED', actors: ['CUSTOMER', 'ADMIN', 'OWNER'] },
  { from: 'IN_PROGRESS', to: 'CONFIRMED', actors: ['DRIVER', 'ADMIN', 'OWNER'] },
  { from: 'IN_PROGRESS', to: 'COMPLETED', actors: ['DRIVER', 'ADMIN', 'OWNER'] },
  { from: 'IN_PROGRESS', to: 'CANCELLED', actors: ['ADMIN', 'OWNER'] },
] as const satisfies readonly Transition<BookingStatus, BookingStatus>[];

export const DISPATCH_TRANSITIONS = [
  { from: 'UNASSIGNED', to: 'OFFERED', actors: ['ADMIN', 'OWNER'] },
  { from: 'OFFERED', to: 'ACCEPTED', actors: ['DRIVER'] },
  { from: 'OFFERED', to: 'UNASSIGNED', actors: ['SYSTEM', 'ADMIN', 'OWNER'] },
  { from: 'UNASSIGNED', to: 'ACCEPTED', actors: ['ADMIN', 'OWNER'] },
  { from: 'ACCEPTED', to: 'UNASSIGNED', actors: ['ADMIN', 'OWNER', 'SYSTEM'] },
] as const satisfies readonly Transition<DispatchStatus, DispatchStatus>[];

export const DROPOFF_STAGE_PATH = [
  'NOT_STARTED',
  'EN_ROUTE_TO_PICKUP',
  'AT_PICKUP',
  'LOADING',
  'EN_ROUTE_TO_DROPOFF',
  'AT_DROPOFF',
  'UNLOADING',
  'COMPLETED',
] as const satisfies readonly JobStage[];

export const SINGLE_ADDRESS_STAGE_PATH = [
  'NOT_STARTED',
  'EN_ROUTE_TO_PICKUP',
  'AT_PICKUP',
  'LOADING',
  'COMPLETED',
] as const satisfies readonly JobStage[];

export type TransitionKind = 'booking' | 'dispatch';

function actorAllowed(actors: readonly TransitionActor[], actor: TransitionActor): boolean {
  return actors.includes(actor);
}

function invalidTransition(kind: TransitionKind | 'job-stage', from: string, to: string, actor: TransitionActor): never {
  throw new AppError('INVALID_TRANSITION', `Invalid ${kind} transition from ${from} to ${to} by ${actor}`, {
    actor,
    from,
    kind,
    to,
  });
}

export function canBookingTransition(from: BookingStatus, to: BookingStatus, actor: TransitionActor): boolean {
  return BOOKING_TRANSITIONS.some(
    (transition) => transition.from === from && transition.to === to && actorAllowed(transition.actors, actor),
  );
}

export function canDispatchTransition(from: DispatchStatus, to: DispatchStatus, actor: TransitionActor): boolean {
  return DISPATCH_TRANSITIONS.some(
    (transition) => transition.from === from && transition.to === to && actorAllowed(transition.actors, actor),
  );
}

export function assertTransition(
  kind: 'booking',
  from: BookingStatus,
  to: BookingStatus,
  actor: TransitionActor,
): void;
export function assertTransition(
  kind: 'dispatch',
  from: DispatchStatus,
  to: DispatchStatus,
  actor: TransitionActor,
): void;
export function assertTransition(
  kind: TransitionKind,
  from: BookingStatus | DispatchStatus,
  to: BookingStatus | DispatchStatus,
  actor: TransitionActor,
): void {
  const allowed =
    kind === 'booking'
      ? canBookingTransition(from as BookingStatus, to as BookingStatus, actor)
      : canDispatchTransition(from as DispatchStatus, to as DispatchStatus, actor);
  if (!allowed) {
    invalidTransition(kind, from, to, actor);
  }
}

export function dispatchCanChangeWhile(status: BookingStatus): boolean {
  return status === 'CONFIRMED' || status === 'IN_PROGRESS';
}

export function stagePathFor(service: ServiceKey): readonly JobStage[] {
  return DEFAULT_PRICING_CONFIG.services[service].requiresDropoff ? DROPOFF_STAGE_PATH : SINGLE_ADDRESS_STAGE_PATH;
}

export function nextStageFor(service: ServiceKey, current: JobStage): JobStage | null {
  const path = stagePathFor(service);
  const index = path.indexOf(current);
  if (index < 0 || index >= path.length - 1) {
    return null;
  }
  return path[index + 1] ?? null;
}

export function previousStageFor(service: ServiceKey, current: JobStage): JobStage | null {
  const path = stagePathFor(service);
  const index = path.indexOf(current);
  if (index <= 0) {
    return null;
  }
  return path[index - 1] ?? null;
}

export interface DriverStageTransitionInput {
  service: ServiceKey;
  from: JobStage;
  to: JobStage;
  actor: TransitionActor;
  ownAcceptedJob: boolean;
  moveDateIsTodayOrYesterday: boolean;
  undoWindowOpen: boolean;
  completionEvidenceSatisfied: boolean;
}

export interface JobStageTransitionInput extends DriverStageTransitionInput {
  overrideReason?: string | undefined;
}

export function canDriverMoveStage(input: DriverStageTransitionInput): boolean {
  if (input.actor !== 'DRIVER' || !input.ownAcceptedJob || !input.moveDateIsTodayOrYesterday) {
    return false;
  }
  if (nextStageFor(input.service, input.from) === input.to) {
    return input.to !== 'COMPLETED' || input.completionEvidenceSatisfied;
  }
  return input.undoWindowOpen && previousStageFor(input.service, input.from) === input.to;
}

function stageIsOnServicePath(service: ServiceKey, stage: JobStage): boolean {
  return stagePathFor(service).includes(stage);
}

export function canJobStageTransition(input: JobStageTransitionInput): boolean {
  if (!stageIsOnServicePath(input.service, input.from) || !stageIsOnServicePath(input.service, input.to)) {
    return false;
  }
  if (input.actor === 'ADMIN' || input.actor === 'OWNER') {
    return typeof input.overrideReason === 'string' && input.overrideReason.trim().length > 0;
  }
  return canDriverMoveStage(input);
}

export function assertDriverStageTransition(input: DriverStageTransitionInput): void {
  if (!canDriverMoveStage(input)) {
    invalidTransition('job-stage', input.from, input.to, input.actor);
  }
}

export function assertJobStageTransition(input: JobStageTransitionInput): void {
  if (!canJobStageTransition(input)) {
    invalidTransition('job-stage', input.from, input.to, input.actor);
  }
}
