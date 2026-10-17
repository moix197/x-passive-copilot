import { createServer, type Server } from 'node:http';
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
import { createRouter } from './router';
import { createVoiceService, loadStyle, opencodeModel, readVoiceView } from './voice/voice';
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

export async function startApp({ home, port, token, config }: AppOptions): Promise<RunningApp> {
  const db = openDb(home);
  prunePosts(db, Date.now());
  clearStalePolishing(db);
  const style = () => loadStyle(db);
  const model = opencodeModel(config, home);
  const polish = createPolishService(db, config, claudeGenerate(config, style));
  const voice = createVoiceService(db, config, model);
  const digest = createDigestService(db, config, model);
  const autoPolish = createAutoPolish(db, config, polish);
  const triage = createTriageService(db, config, opencodeClassify(config, home, style), Date.now, () => void autoPolish.run());
  if (!config.models.triage) log('triage disabled: set models.triage in config.json');
  triage.notify();
  voice.notify();
  digest.notify();
  const hooks = {
    onIngest: () => {
      triage.notify();
      voice.notify();
      digest.notify();
    },
    onPolish: (statusId: string) => polish.request(statusId, 'manual').state,
    onIdeaPolish: (ideaId: string) => {
      const idea = getIdea(db, ideaId);
      return idea ? polish.requestIdea(ideaId, idea).state : 'unknown';
    },
    voiceView: () => readVoiceView(db, config),
    digestView: () => readDigestView(db),
    ownHandle: config.handle,
    polishContext: () => ({
      threshold: config.autoPolish.threshold,
      capReached: config.autoPolish.dailyCap > 0 && remainingSlots(db, config.autoPolish.dailyCap, Date.now()) === 0,
    }),
    doctor: createDoctor({ home, config }),
  };
  const server = createServer(createRouter(db, hooks, token));
  let boundPort: number;
  try {
    boundPort = await listen(server, port);
  } catch (e) {
    db.close();
    throw e;
  }
  log(`server listening on 127.0.0.1:${boundPort}`);
  return {
    port: boundPort,
    close: () =>
      new Promise((resolve) => {
        killAllChildren();
        server.close(() => {
          db.close();
          resolve();
        });
        server.closeAllConnections();
      }),
  };
}
