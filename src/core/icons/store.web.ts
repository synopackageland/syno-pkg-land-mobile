import { PixelRatio } from 'react-native';
import type { NasProfile } from '../config';
import type { DiscoveredApp } from '../discovery/schema';
import { WebIcons, type IconCache } from './cache';

/**
 * The browser build loads DSM's icons straight from the same origin; the browser's HTTP cache keeps them.
 * A size DSM does not have (an image error) moves the App on to its next size, as the App's cache does.
 */
export const ICON_DP = 52;
const icons = new WebIcons(Math.round(ICON_DP * PixelRatio.get()));
const none = async (_profile?: NasProfile, _apps?: DiscoveredApp[]) => {};
export const iconCache: Pick<IconCache, 'subscribe' | 'uri' | 'failed' | 'beginRound' | 'sync' | 'retainApps' | 'retainProfiles' | 'refresh'> = {
  subscribe: icons.subscribe,
  uri: (profile, app) => icons.uri(profile, app),
  failed: (profile, app, uri) => icons.failed(profile, app, uri),
  beginRound() {}, retainApps() {}, retainProfiles() {},
  sync: none, refresh: none,
};
