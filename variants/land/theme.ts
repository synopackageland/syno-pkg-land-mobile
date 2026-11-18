/** Design tokens for the launcher (light theme, v1). Screens import tokens through components. */
/** Letter tiles for Apps without an icon: soft background, saturated glyph */
export const tiles = [
  { bg: '#E8F1FD', fg: '#1D6FE8' }, { bg: '#E6F6EF', fg: '#0B8A5A' }, { bg: '#FDF1E3', fg: '#B5620B' }, { bg: '#F3EAFD', fg: '#7A3FD1' },
  { bg: '#FDE9EE', fg: '#C2335A' }, { bg: '#E4F5F7', fg: '#0E7C8C' }, { bg: '#EEF0F3', fg: '#46525E' }, { bg: '#FBF6DC', fg: '#8A6D00' },
];
export const colors = {
  background: '#FFFFFF',
  grouped: '#F5F7FA',
  label: '#0F1419',
  secondary: '#536471',
  tertiary: '#8B98A5',
  separator: '#E7ECF0',
  accent: '#1D6FE8',
  accentPressed: '#1659BD',
  accentSoft: '#E8F1FD',
  onAccent: '#FFFFFF',
  success: '#0B8A5A',
  successSoft: '#E6F6EF',
  warning: '#A15C00',
  warningSoft: '#FFF5E0',
  danger: '#D0312D',
  dangerSoft: '#FDECEC',
  scrim: 'rgba(15, 20, 25, 0.4)',
  /** Fallback bar surface where blur is unavailable */
  bar: 'rgba(255, 255, 255, 0.94)',
  barBorder: 'rgba(15, 20, 25, 0.12)',
  pressed: '#EEF1F4',
  skeleton: '#EEF1F4',
} as const;

/** NAS status series: one hue per measure, used for rings, bars and arrows */
export const chart = { cpu: '#1D6FE8', memory: '#7A3FD1', up: '#0B8A5A', down: '#1D6FE8', read: '#B5620B', write: '#0E7C8C', hot: '#D0312D' } as const;

export const spacing ={ xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, full: 9999 } as const;
/**
 * Bars: the top bar collapses on scroll; icon-only tabs. `row` is the list row height,
 * `block` the gap between page sections, `appColumn` the narrowest launcher column
 */
export const layout = { topBar: 44, tabBar: 52, hit: 44, gutter: 16, appIcon: 44, appColumn: 76, row: 48, block: 8 } as const;

export const type = {
  title: { fontSize: 17, lineHeight: 22, fontWeight: '700', color: colors.label },
  headline: { fontSize: 15, lineHeight: 20, fontWeight: '600', color: colors.label },
  body: { fontSize: 15, lineHeight: 20, fontWeight: '400', color: colors.label },
  subhead: { fontSize: 13, lineHeight: 18, fontWeight: '400', color: colors.secondary },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400', color: colors.secondary },
  section: { fontSize: 13, lineHeight: 18, fontWeight: '600', color: colors.secondary },
  mono: { fontSize: 12, lineHeight: 17, fontFamily: 'monospace', color: colors.secondary },
  hero: { fontSize: 17, lineHeight: 22, fontWeight: '700', color: colors.label },
  /** Every text field: iOS Safari zooms the page into a focused field under 16px */
  input: { fontSize: 16, lineHeight: 21, fontWeight: '400', color: colors.label },
} as const;
