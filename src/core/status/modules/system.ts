/** The status items the App has always read, as module descriptors */
import { mapHealth, mapLastRead, mapNotifications, mapOverview, mapUser, mapUtilization } from '../mappers.ts';
import { pushSample } from '../live.ts';
import type { TrendPoint } from '../model.ts';
import { dsmApps, type StatusModule } from './types.ts';

/** Live samples kept with their time (a ring buffer), so a return to the page continues the line */
export const TREND = 40;
export const MAX_NOTICES = 200;

export const util: StatusModule = {
  id: 'util', requires: { api: 'SYNO.Core.System.Utilization', min: 1, max: 1 }, params: { method: 'get' }, missing: 'fallback', dsmApp: dsmApps.resource,
  apply(snapshot, data, now) {
    const value = mapUtilization(data);
    const point: TrendPoint = { t: now, cpu: value.cpu?.percent, memory: value.memory?.percent, rx: value.network?.rx, tx: value.network?.tx, read: value.disk?.read, write: value.disk?.write };
    return { util: value, trend: pushSample(snapshot.trend, point, TREND) };
  },
};
export const overview: StatusModule = {
  id: 'overview', requires: { api: 'SYNO.Core.System', min: 1, max: 1 }, params: { method: 'info', type: 'overview' }, missing: 'hide', dsmApp: dsmApps.info,
  apply: (_snapshot, data) => ({ overview: mapOverview(data) }),
};
export const health: StatusModule = {
  id: 'health', requires: { api: 'SYNO.Core.System', min: 1, max: 1 }, params: { method: 'info', type: 'systemHealth' }, missing: 'hide',
  apply: (_snapshot, data) => ({ health: mapHealth(data) }),
};
export const user: StatusModule = {
  id: 'user', requires: { api: 'SYNO.Core.Desktop.Initdata', min: 1, max: 1 }, params: { method: 'get_user_service' }, missing: 'hide',
  apply: (_snapshot, data) => ({ user: mapUser(data) }),
};
export const notify: StatusModule = {
  id: 'notify', requires: { api: 'SYNO.Core.DSMNotify', min: 1, max: 1 }, params: { method: 'notify', action: 'load', offset: 0, limit: 30 }, missing: 'hide',
  apply(snapshot, data) {
    const first = mapNotifications(data), previous = snapshot.notices;
    // Keep pages loaded further down the list that are older than the new first page
    const oldest = first.items[first.items.length - 1]?.time ?? Infinity;
    const rest = previous?.items.filter(old => old.time < oldest && !first.items.some(n => n.id === old.id)) ?? [];
    return { notices: { ...first, items: [...first.items, ...rest].slice(0, MAX_NOTICES) } };
  },
};
export const lastRead: StatusModule = {
  id: 'lastRead', requires: { api: 'SYNO.Core.UserSettings', min: 1, max: 1 }, params: { method: 'get' }, missing: 'hide',
  apply: (_snapshot, data) => ({ lastRead: mapLastRead(data) }),
};
