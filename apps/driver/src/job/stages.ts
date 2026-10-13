import { nextStageFor, previousStageFor, stagePathFor, type JobStage } from '@sv/contracts';

type ServiceKey = Parameters<typeof stagePathFor>[0];

export function driverStagePath(service: ServiceKey): readonly JobStage[] {
  return stagePathFor(service);
}

export function nextDriverStage(service: ServiceKey, current: JobStage): JobStage | null {
  return nextStageFor(service, current);
}

export function previousDriverStage(service: ServiceKey, current: JobStage): JobStage | null {
  return previousStageFor(service, current);
}

export function canUndoStage(lastChangedAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - lastChangedAt.getTime() <= 120_000;
}

export function stageLabel(stage: JobStage): string {
  return stage
    .toLowerCase()
    .split('_')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}
