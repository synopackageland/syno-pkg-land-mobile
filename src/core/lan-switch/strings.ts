/** Copy for the "switch to the local network" card, in the UI kit's nine locales. No trailing periods; no "..." in buttons */
import { installLocale } from '../install/strings.ts';

const en = {
  title: 'This NAS is on your network', detail: 'Its local address is faster than going through Cloudflare. You sign in again there',
  certificate: 'The browser warns about DSM’s own certificate: choose Advanced, then continue', open: 'Switch to local network', close: 'Not now',
};
export type LanSwitchStrings = typeof en;
const zhTW: LanSwitchStrings = {
  title: '這台 NAS 就在你的網路上', detail: '走區域網路位址比經過 Cloudflare 更快。到那裡要再登入一次',
  certificate: '瀏覽器會對 DSM 自己的憑證顯示警告：請選「進階」，再選繼續前往', open: '切換到區域網路', close: '暫時不要',
};
const zhCN: LanSwitchStrings = {
  title: '这台 NAS 就在你的网络上', detail: '走局域网地址比经过 Cloudflare 更快。到那里要再登录一次',
  certificate: '浏览器会对 DSM 自己的证书显示警告：请选“高级”，再选继续前往', open: '切换到局域网', close: '暂时不要',
};
const ja: LanSwitchStrings = {
  title: 'この NAS は同じネットワーク上にあります', detail: 'ローカルアドレスなら Cloudflare 経由より速く使えます。切り替え後にもう一度サインインします',
  certificate: 'ブラウザーが DSM 自身の証明書について警告します。「詳細設定」を選んでから続行してください', open: 'ローカルネットワークに切り替え', close: '今はしない',
};
const ko: LanSwitchStrings = {
  title: '이 NAS가 같은 네트워크에 있어요', detail: '로컬 주소가 Cloudflare를 거치는 것보다 빨라요. 전환하면 다시 로그인해야 해요',
  certificate: '브라우저가 DSM 자체 인증서에 대해 경고해요. 고급을 선택한 다음 계속하세요', open: '로컬 네트워크로 전환', close: '나중에',
};
const de: LanSwitchStrings = {
  title: 'Dieses NAS ist in Ihrem Netzwerk', detail: 'Die lokale Adresse ist schneller als der Weg über Cloudflare. Dort melden Sie sich erneut an',
  certificate: 'Der Browser warnt vor dem eigenen Zertifikat von DSM: Wählen Sie Erweitert und fahren Sie dann fort', open: 'Zum lokalen Netzwerk wechseln', close: 'Nicht jetzt',
};
const fr: LanSwitchStrings = {
  title: 'Ce NAS est sur votre réseau', detail: 'Son adresse locale est plus rapide que le passage par Cloudflare. Vous vous y reconnectez',
  certificate: 'Le navigateur signale le certificat propre à DSM : choisissez Paramètres avancés, puis continuez', open: 'Passer au réseau local', close: 'Pas maintenant',
};
const es: LanSwitchStrings = {
  title: 'Este NAS está en tu red', detail: 'Su dirección local es más rápida que pasar por Cloudflare. Allí vuelves a iniciar sesión',
  certificate: 'El navegador avisa del certificado propio de DSM: elige Configuración avanzada y continúa', open: 'Cambiar a la red local', close: 'Ahora no',
};
const it: LanSwitchStrings = {
  title: 'Questo NAS è sulla tua rete', detail: 'Il suo indirizzo locale è più veloce che passare da Cloudflare. Lì accedi di nuovo',
  certificate: 'Il browser avvisa del certificato proprio di DSM: scegli Avanzate, poi continua', open: 'Passa alla rete locale', close: 'Non ora',
};
export const lanSwitchLocales = { en, 'zh-TW': zhTW, 'zh-CN': zhCN, ja, ko, de, fr, es, it };
export function lanSwitchStrings(tag?: string): LanSwitchStrings {
  return lanSwitchLocales[installLocale(tag)];
}
