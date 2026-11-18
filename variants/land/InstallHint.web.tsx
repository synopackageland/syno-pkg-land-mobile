import { useEffect, useState, useSyncExternalStore } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { installKind, isDismissed, rememberDismissed, type InstallKind } from '../../src/core/install/hint';
import { fill } from '../../src/core/i18n/strings';
import { installStrings } from '../../src/core/install/strings';
import type { InstallHintProps } from './InstallHint';
import { Icon, type IconName } from './ui';
import { colors, layout, radius, spacing, type } from './theme';

type PromptEvent = Event & { prompt(): Promise<void>; userChoice?: Promise<{ outcome: string }> };
/**
 * Chrome fires beforeinstallprompt once, early, maybe before the home page renders: kept from the
 * moment this module loads. Its own mini-infobar is held back so the card is the only invitation
 */
let deferred: PromptEvent | undefined;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach(listener => listener());
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferred = event as PromptEvent; changed(); });
  window.addEventListener('appinstalled', () => { deferred = undefined; changed(); });
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const canPrompt = () => Boolean(deferred);

const storage = () => { try { return window.localStorage; } catch { return undefined; } };
function standalone(): boolean {
  const media = (query: string) => { try { return window.matchMedia?.(query).matches ?? false; } catch { return false; } };
  return (navigator as Navigator & { standalone?: boolean }).standalone === true || media('(display-mode: standalone)') || media('(display-mode: fullscreen)') || media('(display-mode: minimal-ui)');
}
function framed(): boolean {
  try { return window.top !== window.self; } catch { return true; }
}

/**
 * A card in the home page's content, never over it: iPhone and iPad Safari get the
 * Share › Add to Home Screen steps, a browser with an install prompt gets one button. Closing
 * it is remembered in this browser
 */
export function InstallHint({ name, locale }: InstallHintProps) {
  const prompt = useSyncExternalStore(subscribe, canPrompt, () => false);
  const [dismissed, setDismissed] = useState(() => isDismissed(storage()));
  const [added, setAdded] = useState(standalone);
  // Added while the page stays open (Chrome switches the tab to the App window)
  useEffect(() => {
    try {
      const query = window.matchMedia?.('(display-mode: standalone)');
      const update = () => setAdded(standalone());
      query?.addEventListener?.('change', update);
      return () => query?.removeEventListener?.('change', update);
    } catch { return undefined; }
  }, []);
  const kind = installKind({ userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints, standalone: added, framed: framed(), canPrompt: prompt, dismissed });
  if (!kind) return null;
  // The page's language, not the browser's first preferred one: the two can differ
  const t = installStrings(locale);
  const close = () => { rememberDismissed(storage()); setDismissed(true); };
  const install = async () => {
    const event = deferred;
    if (!event) return;
    deferred = undefined; changed();
    try { await event.prompt(); if ((await event.userChoice)?.outcome === 'accepted') setAdded(true); } catch { /* The browser declined to show it */ }
  };
  return <HintCard kind={kind} title={fill(t.title, { name })} detail={t.detail} closeLabel={t.close} onClose={close}>
    {kind === 'ios' ? <View style={{ flexDirection: 'row', gap: spacing.xs }} accessibilityRole="list" accessibilityLabel={t.steps}>
      <Step n={1} icon="ios-share" text={t.stepShare} />
      <Step n={2} icon="add-box" text={t.stepAdd} />
      <Step n={3} icon="check" text={t.stepConfirm} />
    </View> : <Pressable onPress={() => void install()} accessibilityRole="button" accessibilityLabel={t.add}
      style={({ pressed }) => ({ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 36, paddingHorizontal: spacing.md, borderRadius: radius.full, backgroundColor: pressed ? colors.accentPressed : colors.accent })}>
      <Icon name="add-to-home-screen" size={18} color={colors.onAccent} />
      <Text style={[type.headline, { color: colors.onAccent }]}>{t.add}</Text>
    </Pressable>}
  </HintCard>;
}

function HintCard({ kind, title, detail, closeLabel, onClose, children }: { kind: InstallKind; title: string; detail: string; closeLabel: string; onClose(): void; children: React.ReactNode }) {
  return <View style={{ marginHorizontal: spacing.md, marginBottom: layout.block, padding: spacing.md, paddingTop: spacing.sm, paddingRight: spacing.xs, gap: spacing.sm, borderRadius: radius.lg, backgroundColor: colors.accentSoft }} testID={`install-hint-${kind}`}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
      <Image source={{ uri: 'icons/apple-touch-icon.png' }} style={{ width: 40, height: 40, borderRadius: 9 }} accessibilityIgnoresInvertColors />
      <View style={{ flex: 1, gap: spacing.xxs }}>
        <Text style={type.headline} accessibilityRole="header">{title}</Text>
        <Text style={type.subhead}>{detail}</Text>
      </View>
      <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={closeLabel} hitSlop={4}
        style={({ pressed }) => ({ width: layout.hit, height: layout.hit, alignSelf: 'flex-start', alignItems: 'center', justifyContent: 'center', borderRadius: radius.full, backgroundColor: pressed ? 'rgba(0,0,0,0.06)' : 'transparent' })}>
        <Icon name="close" size={20} color={colors.secondary} />
      </Pressable>
    </View>
    <View style={{ paddingRight: spacing.sm }}>{children}</View>
  </View>;
}

function Step({ n, icon, text }: { n: number; icon: IconName; text: string }) {
  return <View style={{ flex: 1, alignItems: 'center', gap: spacing.xs }} accessibilityRole="text" accessibilityLabel={`${n}. ${text}`}>
    <View style={{ width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={icon} size={22} color={colors.accent} />
      <View style={{ position: 'absolute', top: -5, left: -5, width: 18, height: 18, borderRadius: 9, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: colors.onAccent, fontSize: 11, lineHeight: 14, fontWeight: '700' }}>{n}</Text>
      </View>
    </View>
    <Text style={[type.caption, { color: colors.label, textAlign: 'center' }]}>{text}</Text>
  </View>;
}
