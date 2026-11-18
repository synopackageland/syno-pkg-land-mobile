import assert from 'node:assert/strict';
import test from 'node:test';
import { component } from './component.ts';

const apps = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => ({ id, name: id.toUpperCase(), registered: false }));

/** The launcher grid with its responder and its position measurement under the test's control */
function grid() {
  let config: any;
  const measures: ((x: number, y: number) => void)[] = [];
  const opened: string[] = [];
  const value = class { setValue() {} };
  const view = component('variants/land/AppGrid.tsx', {
    'react-native': {
      View: 'View', Text: 'Text', useWindowDimensions: () => ({ width: 390, height: 844 }),
      Animated: { View: 'Animated.View', Value: value, ValueXY: value, spring: () => ({ start() {} }) },
      PanResponder: { create: (c: unknown) => { config = c; return { panHandlers: {} }; } },
    },
    '../../modules/webview-cookies': { default: { haptic() {} } },
    '../../src/core/i18n/strings': { strings: () => ({ openApp: 'Open {name}', desktopBadge: 'Desktop' }), fill: (text: string) => text },
    './AppIcon': { AppIcon: 'AppIcon' }, './ui': { Icon: 'Icon' },
    './theme': { colors: {}, radius: {}, spacing: {}, type: {} },
  });
  const props = { apps, columns: 4, onOpen: (app: { id: string }) => opened.push(app.id), onPressIn() {}, onPressOut() {}, onReorder() {} };
  let root = view.render('AppGrid', props) as any;
  root.props.onLayout({ nativeEvent: { layout: { width: 400 } } });
  root = view.render('AppGrid', props);
  // The grid sits 100 px down the window; the browser answers the measurement later (a timer)
  root.props.ref.current = { measureInWindow: (callback: (x: number, y: number) => void) => measures.push(callback) };
  const touch = (pageX: number, pageY: number) => ({ nativeEvent: { pageX, pageY } });
  const measured = () => measures.splice(0).forEach(callback => callback(0, 100));
  const pressed = () => (view.render('AppGrid', props) as any).props.children.some((tile: any) => tile.props.children.props.style.backgroundColor !== 'transparent');
  return { config: () => config, touch, measured, opened, pressed, timers: view.timers };
}

test('a tap that ends before the grid is measured still opens the App under the finger', () => {
  const { config, touch, measured, opened, pressed } = grid();
  // Second tile of the first row: x 150 of a 400 px grid in 4 columns, y 140 is 40 px into the grid
  config().onPanResponderGrant(touch(150, 140));
  config().onPanResponderRelease(touch(150, 140), { dx: 0, dy: 0 });
  assert.deepEqual(opened, []);
  measured();
  assert.deepEqual(opened, ['b']);
  // The finger is up: no tile stays highlighted
  assert.equal(pressed(), false);
});

test('a measured tap opens on release, once', () => {
  const { config, touch, measured, opened } = grid();
  config().onPanResponderGrant(touch(350, 230));
  measured();
  config().onPanResponderRelease(touch(350, 230), { dx: 0, dy: 0 });
  assert.deepEqual(opened, ['f']);
});

test('a late measurement opens nothing after a drag, a cancel, a long press or a newer touch', () => {
  const moved = grid();
  moved.config().onPanResponderGrant(moved.touch(150, 140));
  moved.config().onPanResponderMove(moved.touch(150, 170), { dx: 0, dy: 30 });
  moved.config().onPanResponderRelease(moved.touch(150, 170), { dx: 0, dy: 30 });
  moved.measured();
  assert.deepEqual(moved.opened, []);

  const cancelled = grid();
  cancelled.config().onPanResponderGrant(cancelled.touch(150, 140));
  cancelled.config().onPanResponderTerminate();
  cancelled.measured();
  assert.deepEqual(cancelled.opened, []);

  const held = grid();
  held.config().onPanResponderGrant(held.touch(150, 140));
  held.timers();
  held.config().onPanResponderRelease(held.touch(150, 140), { dx: 0, dy: 0 });
  held.measured();
  assert.deepEqual(held.opened, []);

  const twice = grid();
  twice.config().onPanResponderGrant(twice.touch(50, 140));
  twice.config().onPanResponderRelease(twice.touch(50, 140), { dx: 0, dy: 0 });
  twice.config().onPanResponderGrant(twice.touch(250, 140));
  twice.config().onPanResponderRelease(twice.touch(250, 140), { dx: 0, dy: 0 });
  twice.measured();
  // Only the newer touch's measurement counts
  assert.deepEqual(twice.opened, ['c']);
});
