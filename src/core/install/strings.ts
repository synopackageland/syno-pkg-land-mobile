/** Copy for the "Add to Home Screen" card, in the UI kit's nine locales. No trailing periods; no "..." in buttons */
const en = {
  title: 'Add {name} to your Home Screen', detail: 'It opens full screen, like an App',
  stepShare: 'Tap Share', stepAdd: 'Choose Add to Home Screen', stepConfirm: 'Tap Add',
  add: 'Add to Home Screen', close: 'Don’t show again', steps: 'How to add it',
};
export type InstallStrings = typeof en;
const zhTW: InstallStrings = {
  title: '把 {name} 加入主畫面', detail: '開啟後全螢幕顯示，用起來就像 App',
  stepShare: '點「分享」', stepAdd: '選「加入主畫面」', stepConfirm: '點「加入」',
  add: '加入主畫面', close: '不再顯示', steps: '加入步驟',
};
const zhCN: InstallStrings = {
  title: '把 {name} 添加到主屏幕', detail: '打开后全屏显示，用起来就像 App',
  stepShare: '点“共享”', stepAdd: '选“添加到主屏幕”', stepConfirm: '点“添加”',
  add: '添加到主屏幕', close: '不再显示', steps: '添加步骤',
};
const ja: InstallStrings = {
  title: '{name} をホーム画面に追加', detail: 'アプリのように全画面で開けます',
  stepShare: '「共有」をタップ', stepAdd: '「ホーム画面に追加」を選ぶ', stepConfirm: '「追加」をタップ',
  add: 'ホーム画面に追加', close: '今後表示しない', steps: '追加の手順',
};
const ko: InstallStrings = {
  title: '{name}을(를) 홈 화면에 추가', detail: '앱처럼 전체 화면으로 열려요',
  stepShare: '공유 탭하기', stepAdd: '홈 화면에 추가 선택', stepConfirm: '추가 탭하기',
  add: '홈 화면에 추가', close: '다시 보지 않기', steps: '추가 방법',
};
const de: InstallStrings = {
  title: '{name} zum Home-Bildschirm hinzufügen', detail: 'Öffnet im Vollbild, wie eine App',
  stepShare: 'Auf Teilen tippen', stepAdd: 'Zum Home-Bildschirm wählen', stepConfirm: 'Auf Hinzufügen tippen',
  add: 'Zum Home-Bildschirm', close: 'Nicht mehr anzeigen', steps: 'So geht’s',
};
const fr: InstallStrings = {
  title: 'Ajoutez {name} à l’écran d’accueil', detail: 'Il s’ouvre en plein écran, comme une app',
  stepShare: 'Touchez Partager', stepAdd: 'Choisissez Sur l’écran d’accueil', stepConfirm: 'Touchez Ajouter',
  add: 'Ajouter à l’écran d’accueil', close: 'Ne plus afficher', steps: 'Comment l’ajouter',
};
const es: InstallStrings = {
  title: 'Añade {name} a la pantalla de inicio', detail: 'Se abre a pantalla completa, como una app',
  stepShare: 'Toca Compartir', stepAdd: 'Elige Añadir a pantalla de inicio', stepConfirm: 'Toca Añadir',
  add: 'Añadir a pantalla de inicio', close: 'No volver a mostrar', steps: 'Cómo añadirlo',
};
const it: InstallStrings = {
  title: 'Aggiungi {name} alla schermata Home', detail: 'Si apre a schermo intero, come un’app',
  stepShare: 'Tocca Condividi', stepAdd: 'Scegli Aggiungi alla schermata Home', stepConfirm: 'Tocca Aggiungi',
  add: 'Aggiungi alla schermata Home', close: 'Non mostrare più', steps: 'Come aggiungerla',
};
export const installLocales = { en, 'zh-TW': zhTW, 'zh-CN': zhCN, ja, ko, de, fr, es, it };
export type InstallLocale = keyof typeof installLocales;

/** The App's language tag to one of the nine locales; English for any other language. Chinese splits like the launcher's strings */
export function installLocale(tag = ''): InstallLocale {
  const lower = tag.toLowerCase().replace(/_/g, '-');
  if (lower.startsWith('zh')) return /^zh-(cn|sg|hans)\b/.test(lower) ? 'zh-CN' : 'zh-TW';
  const base = lower.split('-')[0] as InstallLocale;
  return base in installLocales ? base : 'en';
}
export function installStrings(tag?: string): InstallStrings {
  return installLocales[installLocale(tag)];
}
