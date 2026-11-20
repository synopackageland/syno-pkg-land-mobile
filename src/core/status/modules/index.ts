/** Every status module by item */
import type { Item } from '../model.ts';
import { backup } from './backup.ts';
import { history } from './history.ts';
import { security } from './security.ts';
import { storage } from './storage.ts';
import { health, lastRead, notify, overview, user, util } from './system.ts';
import type { StatusModule } from './types.ts';
import { upgrade } from './upgrade.ts';

export const modules: Record<Item, StatusModule> = { util, overview, health, storage, user, upgrade, notify, lastRead, security, backup, history };
export { dsmApps, type StatusModule, type Unavailable } from './types.ts';
