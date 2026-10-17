import { DoctorReportSchema, type DoctorCheck, type DoctorReport } from '@xc/shared/types';
import { element } from './dom';

type Tone = 'ok' | 'warn' | 'bad';

const STATUS_TEXT: Record<DoctorCheck['status'], string> = {
  ok: 'ok',
  missing: 'missing',
  not_logged_in: 'not logged in',
  problem: 'problem',
};

const STATUS_TONE: Record<DoctorCheck['status'], Tone> = {
  ok: 'ok',
  not_logged_in: 'warn',
  missing: 'bad',
  problem: 'bad',
};

function dot(tone: Tone): HTMLElement {
  const el = element('span', '', 'doctor-dot');
  el.dataset.tone = tone;
  el.setAttribute('aria-hidden', 'true');
  return el;
}

function renderCheck(check: DoctorCheck): HTMLElement {
  const row = document.createElement('li');
  row.className = 'doctor-row';
  row.dataset.status = check.status;
  const head = element('div', '', 'doctor-row-head');
  head.append(dot(STATUS_TONE[check.status]), element('span', check.label, 'doctor-label'));
  head.append(element('span', [STATUS_TEXT[check.status], check.detail].filter(Boolean).join(' · '), 'doctor-detail'));
  row.append(head);
  if (check.status !== 'ok' && check.fix) row.append(element('code', check.fix, 'doctor-fix'));
  return row;
}

function summaryTone(issues: DoctorCheck[]): Tone {
  if (!issues.length) return 'ok';
  return issues.some((c) => STATUS_TONE[c.status] === 'bad') ? 'bad' : 'warn';
}

function summaryText(issueCount: number): string {
  if (issueCount === 0) return 'All systems ready';
  return issueCount === 1 ? '1 issue needs attention' : `${issueCount} issues need attention`;
}

export function renderDoctor(report: DoctorReport): HTMLElement[] {
  const issues = report.checks.filter((c) => c.status !== 'ok');
  const details = document.createElement('details');
  details.className = 'doctor';
  details.open = issues.length > 0;
  const summary = element('summary', '', 'doctor-summary');
  summary.append(dot(summaryTone(issues)), element('span', summaryText(issues.length), 'doctor-summary-text'));
  const list = document.createElement('ul');
  list.className = 'doctor-list';
  list.setAttribute('aria-label', 'Readiness checks');
  list.append(...report.checks.map(renderCheck));
  details.append(summary, list);
  return [details];
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
