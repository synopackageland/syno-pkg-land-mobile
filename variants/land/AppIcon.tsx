import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Animated, Image, Text, View } from 'react-native';
import type { DiscoveredApp } from '../../src/core/discovery/schema';
import { iconCache } from '../../src/core/icons/store';
import { colors, layout, radius, tiles, type } from './theme';

export const tileOf = (name: string) => tiles[[...name].reduce((sum, c) => (sum * 31 + c.charCodeAt(0)) >>> 0, 7) % tiles.length];

function Letter({ app, size }: { app: DiscoveredApp; size: number }) {
  const tile = tileOf(app.package || app.name);
  return <View style={{ position: 'absolute', width: size, height: size, borderRadius: radius.md * size / layout.appIcon, backgroundColor: tile.bg, alignItems: 'center', justifyContent: 'center' }}>
    <Text style={[type.hero, { color: tile.fg, fontSize: 20 * size / layout.appIcon, lineHeight: 26 * size / layout.appIcon }]}>{app.name.slice(0, 1).toUpperCase()}</Text>
  </View>;
}

/**
 * The App's own icon from the on-disk cache. Without a cached icon the letter
 * tile shows at once and the icon cross-fades in when it arrives; an icon that
 * was already cached renders directly, so a relaunch shows no letter flash.
 * Shared by the launcher grid, search results, pickers and the App loading screen.
 */
export function AppIcon({ app, profile, size = layout.appIcon }: { app: DiscoveredApp; profile?: string; size?: number }) {
  const uri = useSyncExternalStore(iconCache.subscribe, () => iconCache.uri(profile, app));
  // shown: decoded and visible; incoming: a newer file fading in above it
  const [shown, setShown] = useState<string | undefined>(uri);
  const [failed, setFailed] = useState<string>();
  const fade = useRef(new Animated.Value(0)).current;
  const incoming = uri && uri !== shown && uri !== failed ? uri : undefined;
  useEffect(() => { if (incoming) fade.setValue(0); }, [incoming, fade]);
  useEffect(() => { if (!uri) setShown(undefined); }, [uri]);
  const style = { position: 'absolute' as const, width: size, height: size, borderRadius: radius.md * size / layout.appIcon };
  return <View style={{ width: size, height: size, borderRadius: style.borderRadius, backgroundColor: colors.grouped }} accessibilityIgnoresInvertColors>
    {!shown ? <Letter app={app} size={size} /> : <Image source={{ uri: shown }} fadeDuration={0} style={style} onError={() => { setFailed(shown); setShown(undefined); iconCache.failed(profile, app, shown); }} />}
    {incoming ? <Animated.Image key={incoming} source={{ uri: incoming }} fadeDuration={0} style={[style, { opacity: fade }]}
      onLoad={() => Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }).start(({ finished }) => { if (finished) setShown(incoming); })}
      onError={() => { setFailed(incoming); iconCache.failed(profile, app, incoming); }} /> : null}
  </View>;
}
