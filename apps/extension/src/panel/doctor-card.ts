import { DoctorReportSchema, type DoctorCheck, type DoctorReport } from '@xc/shared/types';
import { element } from './posts-view';

const STATUS_TEXT: Record<DoctorCheck['status'], string> = {
  ok: 'ok',
  missing: 'missing',
  not_logged_in: 'not logged in',
  problem: 'problem',
};

function renderCheck(check: DoctorCheck): HTMLElement {
  const row = document.createElement('li');
  row.dataset.status = check.status;
  const detail = check.detail ? ` (${check.detail})` : '';
  row.append(element('span', `${check.label}: ${STATUS_TEXT[check.status]}${detail}`));
  if (check.fix) row.append(element('code', check.fix, 'doctor-fix'));
  return row;
}

export function renderDoctor(report: DoctorReport): HTMLElement[] {
  const list = document.createElement('ul');
  list.className = 'doctor-list';
  list.append(...report.checks.map(renderCheck));
  return [element('h2', 'Readiness', 'doctor-title'), list];
}

export async function loadDoctor(load: () => Promise<unknown>): Promise<DoctorReport> {
  return DoctorReportSchema.parse(await load());
}

export function mountDoctorCard(root: HTMLElement, load: () => Promise<unknown>): { refresh(online: boolean): void } {
  return {
    refresh(online) {
      if (!online) return root.replaceChildren();
      loadDoctor(load).then(
        (report) => root.replaceChildren(...renderDoctor(report)),
        () => root.replaceChildren(element('p', 'Readiness check failed.', 'status')),
      );
    },
  };
}
