import { createServer, type Server } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import type { AppConfig } from '@xc/shared';
import { openDb } from './db';
import { createDigestService, getIdea, readDigestView } from './digest/digest';
import { createDoctor } from './doctor';
import { log } from './log';
import { killAllChildren } from './llm/run-cli';
import { createAutoPolish } from './polish/auto-polish';
import { remainingSlots } from './polish/daily-cap';
import { clearStalePolishing } from './polish/drafts-store';
import { claudeGenerate, createPolishService } from './polish/polish';
import { prunePosts } from './posts';
import { createRouter, type RouterHooks } from './router';
import { createVoiceService, loadStyle, opencodeModel, readVoiceView } from './voice/voice';
import { rulesFromConfig } from './triage/prefilter';
import { createTriageService, opencodeClassify } from './triage/triage';

export interface AppOptions {
  home: string;
  port: number;
  token: string;
  config: AppConfig;
}

export interface RunningApp {
  port: number;
  close(): Promise<void>;
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : port);
    });
  });
}

function openPreparedDb(home: string): DatabaseSync {
  const db = openDb(home);
  prunePosts(db, Date.now());
  clearStalePolishing(db);
  return db;
}

function createServices(db: DatabaseSync, home: string, config: AppConfig) {
  const style = () => loadStyle(db);
  const model = opencodeModel(config, home);
  const polish = createPolishService(db, config, claudeGenerate(config, style));
  const voice = createVoiceService(db, config, model);
  const digest = createDigestService(db, config, model);
  const autoPolish = createAutoPolish(db, config, polish);
  const triage = createTriageService(db, config, opencodeClassify(config, home, style), Date.now, () => void autoPolish.run());
  const notifyAll = () => {
    triage.notify();
    voice.notify();
    digest.notify();
  };
  return { polish, notifyAll, runDigestNow: digest.runNow };
}

type Services = ReturnType<typeof createServices>;

function capReached(db: DatabaseSync, config: AppConfig): boolean {
  return config.autoPolish.dailyCap > 0 && remainingSlots(db, config.autoPolish.dailyCap, Date.now()) === 0;
}

function buildHooks(db: DatabaseSync, home: string, config: AppConfig, services: Services): RouterHooks {
  const { polish } = services;
  return {
    onIngest: services.notifyAll,
    onPolish: (statusId, regenerate) => polish.request(statusId, 'manual', regenerate).state,
    onIdeaPolish: (ideaId) => {
      const idea = getIdea(db, ideaId);
      return idea ? polish.requestIdea(ideaId, idea).state : 'unknown';
    },
    voiceView: () => readVoiceView(db, config),
    digestView: () => readDigestView(db),
    runDigestNow: services.runDigestNow,
    ownHandle: config.handle,
    flagRules: rulesFromConfig(config),
    polishContext: () => ({ threshold: config.autoPolish.threshold, capReached: capReached(db, config) }),
    doctor: createDoctor({ home, config }),
  };
}

async function listenOrClose(server: Server, port: number, db: DatabaseSync): Promise<number> {
  try {
    return await listen(server, port);
  } catch (e) {
    db.close();
    throw e;
  }
}

function closeApp(server: Server, db: DatabaseSync): Promise<void> {
  return new Promise((resolve) => {
    killAllChildren();
    server.close(() => {
      db.close();
      resolve();
    });
    server.closeAllConnections();
  });
}

export async function startApp({ home, port, token, config }: AppOptions): Promise<RunningApp> {
  const db = openPreparedDb(home);
  const services = createServices(db, home, config);
  if (!config.models.triage) log('triage disabled: set models.triage in config.json');
  services.notifyAll();
  const server = createServer(createRouter(db, buildHooks(db, home, config, services), token));
  const boundPort = await listenOrClose(server, port, db);
  log(`server listening on 127.0.0.1:${boundPort}`);
  return { port: boundPort, close: () => closeApp(server, db) };
}
