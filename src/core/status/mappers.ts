/**
 * Maps DSM WebAPI answers to the phone's NAS status. Every mapper takes the
 * API's `data` object and tolerates missing or mistyped fields: a field DSM
 * leaves out stays undefined and the UI hides it.
 */
import { record } from '../discovery/schema.ts';

export type Cpu = { percent: number; user: number; system: number; other: number; load1?: number; load5?: number; load15?: number };
export type Memory = { percent: number; total: number; used: number; cached?: number; buffer?: number; swapPercent?: number; swapTotal?: number };
export type Interface = { id: string; rx: number; tx: number };
export type DiskIo = { id: string; busy: number; read: number; write: number };
export type Utilization = { cpu?: Cpu; memory?: Memory; network?: { rx: number; tx: number; interfaces: Interface[] }; disk?: { read: number; write: number; busy: number; disks: DiskIo[] }; time?: number };
export type Overview = { model?: string; cpuName?: string; cores?: number; ramMb?: number; temp?: number; tempWarning?: boolean; uptime?: number; firmware?: string };
export type Disk = { id: string; name: string; order: number; model?: string; vendor?: string; firmware?: string; size?: number; temp?: number; ssd: boolean; status: 'normal' | 'warning' | 'danger'; type?: string; location?: string };
export type Link = { id: string; up: boolean; speed?: number };
/** `security` is Security Advisor's last verdict, which DSM also gives normal users here */
export type Health = { uptime?: number; model?: string; disks: Disk[]; links: Link[]; tempWarning?: boolean; crashed?: boolean; security?: string };
/** `state` marks a volume that needs attention before its fill level: crashed, degraded or read-only */
export type Volume = { id: string; name: string; total: number; used: number; status: 'normal' | 'warning' | 'danger'; state?: VolumeState; pool?: string };
export type VolumeState = 'crashed' | 'degraded' | 'readonly';
/** `dsm` is the product version (7.4.1) with its update number; `build` keys the capability table */
export type UserInfo = { user?: string; admin?: boolean; hostname?: string; dsm?: string; update?: number; build?: string };
export type Notice = { id: number; time: number; tag: string; level: 'info' | 'warning' | 'error'; params: Record<string, string>; className: string };
export type Notifications = { items: Notice[]; total: number; newest: number };
/** One catalog entry of SYNO.Core.DSMNotify.Strings, trimmed to what the list shows */
export type NoticeString = { title: string; msg: string; level?: string };

const num = (value: unknown): number | undefined => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : undefined;
};
const str = (value: unknown) => typeof value === 'string' && value ? value : undefined;
const list = (value: unknown) => Array.isArray(value) ? value.map(record) : [];
const clamp = (value: number) => Math.max(0, Math.min(100, value));

/** DSM's "hours:minutes:seconds" (hours may exceed 24) to seconds */
export function parseUptime(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const parts = value.split(':').map(Number);
  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n) || n < 0)) return undefined;
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

/** SYNO.Core.System.Utilization get: rates are bytes per second, memory sizes KiB, loads ×100 */
export function mapUtilization(data: unknown): Utilization {
  const d = record(data), cpu = record(d.cpu), mem = record(d.memory), disk = record(d.disk);
  const result: Utilization = { time: num(d.time) };
  if (Object.keys(cpu).length) {
    const user = num(cpu.user_load) ?? 0, system = num(cpu.system_load) ?? 0, other = num(cpu.other_load) ?? 0;
    const load = (key: string) => { const n = num(cpu[key]); return n === undefined ? undefined : n / 100; };
    result.cpu = { percent: clamp(user + system + other), user, system, other, load1: load('1min_load'), load5: load('5min_load'), load15: load('15min_load') };
  }
  const totalKb = num(mem.total_real) ?? num(mem.memory_size);
  if (totalKb) {
    const percent = clamp(num(mem.real_usage) ?? 0);
    const swapKb = num(mem.total_swap);
    result.memory = {
      percent, total: totalKb * 1024, used: Math.round(totalKb * percent / 100) * 1024,
      cached: (num(mem.cached) ?? 0) * 1024 || undefined, buffer: (num(mem.buffer) ?? 0) * 1024 || undefined,
      swapPercent: swapKb ? num(mem.swap_usage) : undefined, swapTotal: swapKb ? swapKb * 1024 : undefined,
    };
  }
  if (Array.isArray(d.network)) {
    const rows = list(d.network).map(row => ({ id: String(row.device ?? ''), rx: num(row.rx) ?? 0, tx: num(row.tx) ?? 0 })).filter(row => row.id);
    const total = rows.find(row => row.id === 'total');
    const interfaces = rows.filter(row => row.id !== 'total');
    result.network = { rx: total?.rx ?? interfaces.reduce((s, r) => s + r.rx, 0), tx: total?.tx ?? interfaces.reduce((s, r) => s + r.tx, 0), interfaces };
  }
  if (Object.keys(disk).length) {
    const disks = list(disk.disk).map(row => ({ id: String(row.device ?? ''), busy: clamp(num(row.utilization) ?? 0), read: num(row.read_byte) ?? 0, write: num(row.write_byte) ?? 0 })).filter(row => row.id);
    const total = record(disk.total);
    result.disk = {
      read: num(total.read_byte) ?? disks.reduce((s, r) => s + r.read, 0), write: num(total.write_byte) ?? disks.reduce((s, r) => s + r.write, 0),
      busy: num(total.utilization) ?? Math.max(0, ...disks.map(r => r.busy)), disks,
    };
  }
  return result;
}

/** SYNO.Core.System info type=overview (administrators only) */
export function mapOverview(data: unknown): Overview {
  const d = record(data);
  const cpuName = [str(d.cpu_vendor), str(d.cpu_family), str(d.cpu_series)].filter(Boolean).join(' ') || undefined;
  return {
    model: str(d.model), cpuName, cores: num(d.cpu_cores), ramMb: num(d.ram_size), temp: num(d.sys_temp),
    tempWarning: d.temperature_warning === true || d.sys_tempwarn === true, uptime: parseUptime(d.up_time), firmware: str(d.firmware_ver),
  };
}

function diskStatus(row: Record<string, unknown>): Disk['status'] {
  const overview = String(row.overview_status ?? row.status ?? '');
  if (/crash|fail|danger|damage/i.test(overview) || row.smart_status === 'failing' || row.remain_life_danger === true) return 'danger';
  if (/warn|degrad|abnormal|attention/i.test(overview) || /warn|abnormal/i.test(String(row.smart_status ?? ''))) return 'warning';
  return 'normal';
}
/** SYNO.Core.System info type=systemHealth: also answers non-administrators, with disks and uptime */
export function mapHealth(data: unknown): Health {
  const d = record(data);
  const disks = list(d.disks).map((row, index): Disk => ({
    id: String(row.id ?? row.device ?? index), name: str(row.longName) ?? str(row.name) ?? String(row.id ?? index), order: num(row.order) ?? num(row.num_id) ?? index + 1,
    model: str(row.model)?.trim(), vendor: str(row.vendor)?.trim(), firmware: str(row.firm), size: num(row.size_total), temp: num(row.temp),
    ssd: row.isSsd === true, status: diskStatus(row), type: str(row.diskType), location: str(row.disk_location),
  })).sort((a, b) => a.order - b.order);
  const links = list(d.nif).map(row => ({ id: String(row.id ?? ''), up: row.status === 'connected', speed: (num(row.speed) ?? -1) > 0 ? num(row.speed) : undefined })).filter(row => row.id);
  const container = list(d.disks).map(row => str(record(row.container).str)).find(Boolean);
  return { uptime: parseUptime(d.optime), model: container, disks, links, tempWarning: d.temperature_warning === true, crashed: d.is_system_crashed === true, security: str(d.securityScan) };
}

/** SYNO.Storage.CGI.Storage load_info (administrators only): volumes and their usage */
export function mapStorage(data: unknown): Volume[] {
  return list(record(data).volumes).map((row, index) => {
    const size = record(row.size);
    const status = String(row.summary_status ?? row.status ?? '');
    const raw = `${status} ${String(row.status ?? '')}`;
    const state: VolumeState | undefined = /crash/i.test(raw) ? 'crashed' : /degrad/i.test(raw) ? 'degraded'
      : row.is_writable === false || /read.?only/i.test(raw) ? 'readonly' : undefined;
    const level = /crash|danger/i.test(status) ? 'danger' as const : /normal/i.test(status) || !status ? 'normal' as const : 'warning' as const;
    return {
      id: String(row.id ?? index), name: str(row.display_name) ?? str(row.vol_path)?.replace(/^\//, '') ?? String(row.id ?? index),
      total: num(size.total) ?? 0, used: num(size.used) ?? 0, ...(str(row.pool_path) ? { pool: str(row.pool_path) } : {}),
      status: state === 'crashed' ? 'danger' as const : state && level === 'normal' ? 'warning' as const : level,
      ...(state ? { state } : {}),
    };
  }).filter(volume => volume.total > 0);
}

/** SYNO.Core.Desktop.Initdata get_user_service: the signed-in account, cached for a day */
export function mapUser(data: unknown): UserInfo {
  const session = record(record(data).Session);
  const dsm = str(session.productversion), update = num(session.smallfixnumber);
  const build = str(session.fullversion) ?? str(session.version);
  return {
    user: str(session.user), admin: typeof session.is_admin === 'boolean' ? session.is_admin : undefined, hostname: str(session.hostname),
    dsm, update: update && update > 0 ? update : undefined, build: build ? [dsm, build, update].filter(v => v !== undefined).join('-') : undefined,
  };
}

const levels: Record<string, Notice['level']> = { NOTIFICATION_ERROR: 'error', NOTIFICATION_WARN: 'warning', NOTIFICATION_WARNING: 'warning', NOTIFICATION_INFO: 'info' };
export const noticeLevel = (value: unknown): Notice['level'] => levels[String(value)] ?? 'info';
/** SYNO.Core.DSMNotify notify action=load: newest first; `msg[0]` is a JSON map of template parameters */
export function mapNotifications(data: unknown): Notifications {
  const d = record(data);
  const items = list(d.items).map((row): Notice | undefined => {
    const id = num(row.notifyId), time = num(row.time);
    if (id === undefined || time === undefined) return undefined;
    let params: Record<string, string> = {};
    const msg = Array.isArray(row.msg) ? row.msg[0] : undefined;
    if (typeof msg === 'string') {
      try { params = Object.fromEntries(Object.entries(record(JSON.parse(msg))).map(([k, v]) => [k, String(v)])); } catch { params = { '%1%': msg }; }
    }
    return { id, time, tag: String(row.title ?? ''), level: noticeLevel(row.level), params, className: String(row.className ?? '') };
  }).filter((item): item is Notice => Boolean(item)).sort((a, b) => b.time - a.time || b.id - a.id);
  return { items, total: num(d.total) ?? items.length, newest: num(d.newestMsgTime) ?? items[0]?.time ?? 0 };
}
/** SYNO.Core.DSMNotify.Strings get, trimmed */
export function mapNoticeStrings(data: unknown): Record<string, NoticeString> {
  const result: Record<string, NoticeString> = {};
  for (const [tag, value] of Object.entries(record(data))) {
    const entry = record(value);
    if (typeof entry.msg === 'string' || typeof entry.title === 'string') result[tag] = { title: String(entry.title ?? ''), msg: String(entry.msg ?? ''), ...(typeof entry.level === 'string' ? { level: entry.level } : {}) };
  }
  return result;
}
/** DSM's read mark: notifications newer than this time are unread (SYNO.Core.UserSettings, DSMNotify tray) */
export function mapLastRead(data: unknown): number {
  return num(record(record(data)['SYNO.SDS.DSMNotify.Tray']).lastRead) ?? 0;
}

const stripTags = (text: string) => text.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const humanize = (tag: string) => tag.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
/** A DSM string reference (`dsmnotify:system_event`, `Pkg:section:key`) that only DSM's own string tables resolve */
const reference = /^[A-Za-z0-9_.-]+(?::[A-Za-z0-9_.-]+)+$/;
/** The same reference inside a parameter value (`pkgmgr:fail_op_acquire_resource`) */
const inlineReference = /(^|\s)[a-z0-9]+:[a-z0-9]+_[a-z0-9_]+(?=\s|$)/g;
/** A bracketed string key a package left in its own text (`[COMPOSE_PROJECT_RECOVERY_HINT] If ...`); no string table DSM serves resolves it */
const bracketKey = /\[[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\]\s*/g;
/**
 * Fills a catalog template the way DSM's tray does: up to five passes, parameters may contain parameters.
 * Nothing DSM left unresolved reaches the screen: placeholders without a value (`%TASK_NAME%`) and string
 * references are dropped; an unresolved title is empty and the screen names the source App instead
 */
export function formatNotice(notice: Notice, catalog: Record<string, NoticeString> | undefined): { title: string; message: string; level: Notice['level'] } {
  const entry = catalog?.[notice.tag];
  const params = Object.entries(notice.params).filter(([key]) => key).map(([key, value]) => [key, value.replace(inlineReference, '$1').replace(bracketKey, '').trim()] as const);
  let title = entry?.title || (reference.test(notice.tag) ? '' : humanize(notice.tag));
  let message = entry?.msg || params.filter(([key]) => !/^%(DATE|TIME|HOSTNAME|OSNAME)%$/.test(key)).map(([, value]) => value).join(' ');
  if (reference.test(title)) title = /^dsmnotify:/.test(title) ? 'DSM' : '';
  if (reference.test(message)) message = '';
  for (let pass = 0; pass < 5; pass++) {
    let changed = false;
    for (const [key, value] of params) {
      if (!title.includes(key) && !message.includes(key)) continue;
      title = title.split(key).join(value); message = message.split(key).join(value); changed = true;
    }
    if (!changed) break;
  }
  const clean = (text: string) => stripTags(text.replace(/%[A-Z][A-Z0-9_]*%/g, ' '));
  return { title: clean(title), message: clean(message).replace(/\s+([.,;:!?)\]])/g, '$1').replace(/[.。]$/, ''), level: entry?.level ? noticeLevel(entry.level) : notice.level };
}

/** Notifications that carry no `className`: the App their kind belongs to */
const tagApps: [RegExp, string][] = [
  [/^docker_/, 'SYNO.SDS.ContainerManager.Application'],
  [/^(DataVolume|TPLUN|Volume|Pool|Disk|Storage)/, 'SYNO.SDS.StorageManager.Instance'],
  [/^(SYNOSYSLOG|LOGCENTER)/, 'SYNO.SDS.LogCenter.BuiltIn'],
];
/**
 * The launcher App a notification opens in DSM: its `className` (DSM's own launch target), then the App the
 * template links to (`data-syno-app`), the App its kind belongs to, and last an App named like the catalog title.
 * Undefined when the account cannot open any of them
 */
export function noticeApp<T extends { id: string; name: string }>(notice: Notice, catalog: Record<string, NoticeString> | undefined, apps: readonly T[]): T | undefined {
  const byId = new Map(apps.map(app => [app.id, app]));
  const entry = catalog?.[notice.tag];
  const links = [...(entry?.msg ?? '').matchAll(/data-syno-app="([^"]+)"/g)].map(match => match[1]);
  const hints = tagApps.filter(([pattern]) => pattern.test(notice.tag)).map(([, id]) => id);
  for (const id of [notice.className, ...links, ...hints]) {
    const app = id ? byId.get(id) : undefined;
    if (app) return app;
  }
  const title = entry?.title.trim().toLowerCase();
  return title ? apps.find(app => app.name.trim().toLowerCase() === title) : undefined;
}
