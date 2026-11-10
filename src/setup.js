/**
 * setup.js — 管理者が Apps Script のエディタから実行する関数
 *
 *   setup()      … 初回だけ。管理用スプレッドシートを作り、「全社」の組織を用意する
 *   syncUnits()  … 「組織」シートに行を足したら実行。スプレッドシート ID が空の行に、組織のスプレッドシートを作る
 *   authorize()  … 権限の許可だけを行う（権限が増えた更新のあと、許可の画面を出すために実行する）
 *
 * 実行すると、作ったスプレッドシートの URL が「実行ログ」に出ます。
 * 共有の設定（誰が見られるか・編集できるか）は、Google ドライブで行ってください（README の手順 4）。
 */

function setup() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty(APP.props.configId);
  if (id) {
    Logger.log('管理用スプレッドシートは作成済みです：' + SpreadsheetApp.openById(id).getUrl());
  } else {
    const ss = SpreadsheetApp.create(APP.title + '（管理用）');
    const sheet = ss.getSheets()[0].setName(APP.unitsSheet.name);
    sheet.getRange(1, 1, 1, APP.unitsSheet.headers.length).setValues([APP.unitsSheet.headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.getRange(2, 1, 2, 5).setValues([
      ['全社', '全社', '', 1, '組織内の全員と共有する'],
      ['（例）営業部', '部署', '', 10, '行ごと消してもかまいません'],
    ]);
    const rule = SpreadsheetApp.newDataValidation().requireValueInList(APP.kinds, true).setAllowInvalid(false).build();
    sheet.getRange('B2:B').setDataValidation(rule);
    sheet.setColumnWidth(1, 160);
    sheet.setColumnWidth(3, 380);
    sheet.setColumnWidth(5, 260);
    id = ss.getId();
    props.setProperty(APP.props.configId, id);
    Logger.log('管理用スプレッドシートを作りました：' + ss.getUrl());
  }
  syncUnits();
}

function syncUnits() {
  const ss = configSpreadsheet_();
  const sheet = ss.getSheetByName(APP.unitsSheet.name);
  const values = sheet.getDataRange().getValues();
  const col = columnMap_(values[0]);
  let created = 0;
  for (let i = 1; i < values.length; i++) {
    const name = String(values[i][col['名前']] || '').trim();
    const id = String(values[i][col['スプレッドシートID']] || '').trim();
    if (!name || id) continue;
    const unit = createUnitSpreadsheet_(name);
    sheet.getRange(i + 1, col['スプレッドシートID'] + 1).setValue(unit.getId());
    Logger.log('作成：' + name + ' → ' + unit.getUrl());
    created++;
  }
  CacheService.getScriptCache().remove('units:list');
  Logger.log(created ? created + ' 件の組織を作りました。共有の設定を忘れずに（README の手順 4）' : '新しく作る組織はありませんでした');
  Logger.log('管理用スプレッドシート：' + ss.getUrl());
}

function createUnitSpreadsheet_(name) {
  const ss = SpreadsheetApp.create(APP.title + '：' + name);
  const notices = ss.getSheets()[0].setName(APP.noticesSheet.name);
  notices.getRange(1, 1, 1, APP.noticesSheet.headers.length).setValues([APP.noticesSheet.headers]).setFontWeight('bold');
  notices.setFrozenRows(1);
  notices.getRange('D2:D').insertCheckboxes();
  notices.getRange('E2:F').setNumberFormat('yyyy-mm-dd');
  notices.getRange('H2:H').setNumberFormat('yyyy-mm-dd hh:mm');
  notices.setColumnWidth(2, 240);
  notices.setColumnWidth(3, 420);
  createDashboardSheet_(ss);
  return ss;
}

/**
 * 権限の許可だけを行う。何も書き換えない。
 * エディタでこの関数を実行すると、appsscript.json に書いた権限すべての許可の画面が出る。
 */
function authorize() {
  DriveApp.getRootFolder().getName();
  Logger.log('許可されています：' + userEmail_());
}
