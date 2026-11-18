/**
 * Strings for the NAS status modules (needs attention, storage, security,
 * backup, history). Kept apart from strings.ts so the launcher's table stays
 * small; the locale follows the launcher's strings. No trailing periods.
 */
import { locales, type Strings } from './strings.ts';

const en = {
  attention: 'Needs attention', allClear: 'All clear', allClearAge: 'All clear · {age}',
  justNow: 'just now', minutesAgo: '{count} min ago', hoursAgo: '{count} h ago',
  att_system: 'System partition crashed', att_temperature: 'Temperature high', att_full: '{percent}% full',
  att_pool: 'Storage Pool {order}', att_disk: 'Drive needs attention', att_diskDanger: 'Drive failing',
  att_security: '{count} issues', att_securityOne: '1 issue', att_backupFailed: 'Last backup failed', att_backupPartial: 'Last backup partly failed',
  openInDsm: 'Open {app} in DSM',
  app_storage: 'Storage Manager', app_security: 'Security Advisor', app_backup: 'Hyper Backup', app_resource: 'Resource Monitor',
  unsupported: 'This DSM doesn’t offer it to the App', historyOff: 'Usage history is off in DSM',
  offline: 'Can’t connect · showing data from {time}', stillLoading: 'Still loading',
  unknownStatus: 'Unknown ({raw})', unknown: 'Unknown',
  // Security Advisor
  sec_safe: 'No risks found', sec_info: 'Notes only', sec_outOfDate: 'Out of date', sec_warning: 'Warnings', sec_risk: 'At risk', sec_danger: 'Critical', sec_unknown: 'Unknown',
  cat_malware: 'Malware', cat_systemCheck: 'System check', cat_userInfo: 'Accounts', cat_network: 'Network', cat_update: 'Updates',
  fail_danger: '{count} critical', fail_risk: '{count} risks', fail_warning: '{count} warnings', fail_outOfDate: '{count} out of date', fail_info: '{count} notes',
  catClear: 'Fine', lastScan: 'Last scan {age}', scanning: 'Scanning',
  // Backup
  backup: 'Backup', bk_success: 'Succeeded', bk_failed: 'Failed', bk_partial: 'Partly failed', bk_cancelled: 'Cancelled', bk_running: 'Running', bk_never: 'Not run yet', bk_unknown: 'Unknown',
  nextRun: 'next {time}',
  // Storage
  pool: 'Storage Pool {order}', poolSummary: '{pools} pools · {disks} drives', poolSummaryOne: '1 pool · {disks} drives', poolsCount: '{count} pools', poolsOne: '1 pool', drivesCount: '{count} drives', drivesOne: '1 drive', drivesGood: 'all healthy', drivesBad: '{count} with problems', moreDrives: '{count} more', moreVolumesShort: '{count} more', storageInDsm: 'Expansion, repair and checks are in DSM',
  pool_normal: 'Healthy', pool_warning: 'Attention', pool_danger: 'Failing', status: 'Status', type: 'Type',
  // Resources
  live: 'Live', range_week: 'Week', range_month: 'Month', range_half_year: '6 months', range_year: 'Year', noHistory: 'No history yet',
  dsmVersion: 'DSM {version}', upFor: 'up {time}', tomorrow: 'Tomorrow',
};
export type StatusStrings = typeof en;
const zh: StatusStrings = {
  attention: '需要注意', allClear: '一切正常', allClearAge: '一切正常 · {age}',
  justNow: '剛剛', minutesAgo: '{count} 分鐘前', hoursAgo: '{count} 小時前',
  att_system: '系統分割區已損毀', att_temperature: '溫度過高', att_full: '已用 {percent}%',
  att_pool: '儲存集區 {order}', att_disk: '硬碟需要注意', att_diskDanger: '硬碟故障',
  att_security: '{count} 項問題', att_securityOne: '1 項問題', att_backupFailed: '上次備份失敗', att_backupPartial: '上次備份部分失敗',
  openInDsm: '在 DSM 開啟 {app}',
  app_storage: '儲存空間管理員', app_security: '安全諮詢中心', app_backup: 'Hyper Backup', app_resource: '資源監控',
  unsupported: '這台 DSM 沒有提供給 App', historyOff: 'DSM 未開啟使用歷史',
  offline: '無法連線 · 顯示 {time} 的資料', stillLoading: '仍在讀取',
  unknownStatus: '未知（{raw}）', unknown: '未知',
  sec_safe: '沒有發現風險', sec_info: '只有提示', sec_outOfDate: '有過期項目', sec_warning: '有警告', sec_risk: '有風險', sec_danger: '危險', sec_unknown: '未知',
  cat_malware: '惡意軟體', cat_systemCheck: '系統檢查', cat_userInfo: '帳號', cat_network: '網路', cat_update: '更新',
  fail_danger: '{count} 項危險', fail_risk: '{count} 項風險', fail_warning: '{count} 項警告', fail_outOfDate: '{count} 項過期', fail_info: '{count} 項提示',
  catClear: '正常', lastScan: '上次掃描 {age}', scanning: '掃描中',
  backup: '備份', bk_success: '成功', bk_failed: '失敗', bk_partial: '部分失敗', bk_cancelled: '已取消', bk_running: '執行中', bk_never: '尚未執行', bk_unknown: '未知',
  nextRun: '下次 {time}',
  pool: '儲存集區 {order}', poolSummary: '{pools} 個集區 · {disks} 顆硬碟', poolSummaryOne: '1 個集區 · {disks} 顆硬碟', poolsCount: '{count} 個集區', poolsOne: '1 個集區', drivesCount: '{count} 顆硬碟', drivesOne: '1 顆硬碟', drivesGood: '全部良好', drivesBad: '{count} 顆異常', moreDrives: '還有 {count} 顆', moreVolumesShort: '還有 {count} 個', storageInDsm: '擴充、修復與檢查請到 DSM',
  pool_normal: '良好', pool_warning: '注意', pool_danger: '故障', status: '狀態', type: '介面',
  live: '即時', range_week: '週', range_month: '月', range_half_year: '半年', range_year: '年', noHistory: '還沒有歷史資料',
  dsmVersion: 'DSM {version}', upFor: '已運行 {time}', tomorrow: '明天',
};
const hans: StatusStrings = {
  attention: '需要注意', allClear: '一切正常', allClearAge: '一切正常 · {age}',
  justNow: '刚刚', minutesAgo: '{count} 分钟前', hoursAgo: '{count} 小时前',
  att_system: '系统分区已损毁', att_temperature: '温度过高', att_full: '已用 {percent}%',
  att_pool: '存储池 {order}', att_disk: '硬盘需要注意', att_diskDanger: '硬盘故障',
  att_security: '{count} 项问题', att_securityOne: '1 项问题', att_backupFailed: '上次备份失败', att_backupPartial: '上次备份部分失败',
  openInDsm: '在 DSM 打开 {app}',
  app_storage: '存储空间管理员', app_security: '安全顾问', app_backup: 'Hyper Backup', app_resource: '资源监控',
  unsupported: '这台 DSM 没有提供给 App', historyOff: 'DSM 未开启使用历史',
  offline: '无法连接 · 显示 {time} 的数据', stillLoading: '仍在读取',
  unknownStatus: '未知（{raw}）', unknown: '未知',
  sec_safe: '没有发现风险', sec_info: '只有提示', sec_outOfDate: '有过期项目', sec_warning: '有警告', sec_risk: '有风险', sec_danger: '危险', sec_unknown: '未知',
  cat_malware: '恶意软件', cat_systemCheck: '系统检查', cat_userInfo: '账户', cat_network: '网络', cat_update: '更新',
  fail_danger: '{count} 项危险', fail_risk: '{count} 项风险', fail_warning: '{count} 项警告', fail_outOfDate: '{count} 项过期', fail_info: '{count} 项提示',
  catClear: '正常', lastScan: '上次扫描 {age}', scanning: '扫描中',
  backup: '备份', bk_success: '成功', bk_failed: '失败', bk_partial: '部分失败', bk_cancelled: '已取消', bk_running: '运行中', bk_never: '尚未运行', bk_unknown: '未知',
  nextRun: '下次 {time}',
  pool: '存储池 {order}', poolSummary: '{pools} 个存储池 · {disks} 块硬盘', poolSummaryOne: '1 个存储池 · {disks} 块硬盘', poolsCount: '{count} 个存储池', poolsOne: '1 个存储池', drivesCount: '{count} 块硬盘', drivesOne: '1 块硬盘', drivesGood: '全部良好', drivesBad: '{count} 块异常', moreDrives: '还有 {count} 块', moreVolumesShort: '还有 {count} 个', storageInDsm: '扩充、修复与检查请到 DSM',
  pool_normal: '良好', pool_warning: '注意', pool_danger: '故障', status: '状态', type: '接口',
  live: '实时', range_week: '周', range_month: '月', range_half_year: '半年', range_year: '年', noHistory: '还没有历史数据',
  dsmVersion: 'DSM {version}', upFor: '已运行 {time}', tomorrow: '明天',
};
/** The status strings in the launcher strings' language */
export function statusStrings(t: Strings): StatusStrings {
  return t === locales.hans ? hans : t === locales.zh ? zh : en;
}
