import { RefreshControl, type RefreshControlProps } from 'react-native';
import { colors } from './theme';
import { usePulled } from './pull';

export type PullRefreshProps = Omit<RefreshControlProps, 'refreshing' | 'onRefresh' | 'colors' | 'progressViewOffset'> & {
  /** A refresh of this screen's data is running (pulled or not) */
  busy: boolean;
  /** The screen's own reload; its errors show where the screen already shows them */
  onRefresh(): unknown;
  /** Where the indicator stops: below the top bar */
  offset?: number;
};

/**
 * Pull to refresh for any scroll view or list: pass it as `refreshControl`.
 * Android draws the platform's Material indicator in the accent colour; the
 * browser build (PullRefresh.web.tsx) draws its own with the same rules.
 */
export function PullRefresh({ busy, onRefresh, offset = 0, ...rest }: PullRefreshProps) {
  const pull = usePulled({ busy, onRefresh });
  return <RefreshControl {...rest} refreshing={pull.refreshing} onRefresh={pull.start} progressViewOffset={offset}
    colors={[colors.accent]} progressBackgroundColor={colors.background} tintColor={colors.accent} />;
}
