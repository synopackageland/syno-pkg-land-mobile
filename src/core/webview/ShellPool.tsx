import { useRef, useState } from 'react';
import { View } from 'react-native';
import { ShellScreen, type ShellScreenProps } from './ShellScreen';
import { warmKeys } from './policy';
/** Discovery owns selection; retain the last two WebViews and their latest launch props */
export function ShellPool(props: ShellScreenProps) {
  const key = `${props.profile.id}:${props.target.id}`;
  const cache = useRef(new Map<string, ShellScreenProps>());
  cache.current.set(key, props);
  const [keys, setKeys] = useState([key]);
  const retained = keys.at(-1) === key ? keys : warmKeys(keys, key);
  if (retained !== keys) setKeys(retained);
  for (const cached of cache.current.keys()) if (!retained.includes(cached)) cache.current.delete(cached);
  return <View style={{ flex: 1 }}>{retained.map(id => <View key={id} style={{ flex: 1, display: id === key ? 'flex' : 'none' }}>
    <ShellScreen {...cache.current.get(id)!} active={props.active !== false && id === key} />
  </View>)}</View>;
}
