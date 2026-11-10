/**
 * config.js — 定数と定義
 *
 * 運用者が変えるもの（部署の一覧・お知らせ）はスプレッドシートに置き、
 * ここには開発者しか触らない定義だけを置きます。
 */

/** アプリのバージョン（make release v=… で書き換わる。画面の下に表示） */
const APP_VERSION = "v0.1";

const APP = {
  /** 画面のタイトル（ブラウザのタブに出る名前） */
  title: 'チームダッシュボード',

  /** Script Properties のキー */
  props: {
    configId: 'CONFIG_SPREADSHEET_ID',
  },

  /** 管理用スプレッドシートの「組織」シート */
  unitsSheet: {
    name: '組織',
    headers: ['名前', '種別', 'スプレッドシートID', '並び順', 'メモ'],
  },

  /** 種別の値（全社 → 部署 の順にタブを並べる） */
  kinds: ['全社', '部署'],

  /** 各組織（全社・部署）のスプレッドシートのシート */
  noticesSheet: {
    name: 'お知らせ',
    headers: ['ID', 'タイトル', '本文', '重要', '掲載開始', '掲載終了', '投稿者', '投稿日時'],
  },
  dashboardSheet: {
    name: '_dashboard', // A1 に版、A2 以降にダッシュボードの JSON を分割して入れる（各セルの先頭に「|」）
  },

  /** 上限 */
  limits: {
    dashboardChars: 400000, // ダッシュボード 1 つの JSON の最大文字数
    sheetChunkChars: 40000, // シートの 1 セルに入れる文字数（セルの上限は 50,000）
    propChunkChars: 2600, // UserProperties の 1 値に入れる文字数（上限 9KB。日本語 1 文字＝最大 3 バイト）
    noticeTitle: 120,
    noticeBody: 5000,
    noticeReadIds: 1000, // 既読として覚えておく件数
  },

  /** キャッシュの秒数 */
  cache: {
    unitList: 300, // 組織の一覧（全員で共有）
    unitAccess: 600, // その人が見られる組織と編集できるか（人ごと）
    unitData: 120, // 組織のダッシュボードとお知らせ（全員で共有）
  },
};
