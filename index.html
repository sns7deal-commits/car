/**
 * 운전 실력 진단 - Apps Script 백엔드
 * 이 파일은 Google Sheet에 바인딩된 Apps Script 프로젝트에 붙여넣습니다.
 * (스프레드시트를 열고 확장 프로그램 > Apps Script)
 *
 * 데이터 모델
 *  - Students: 수강생 명부 (이름/연락처/등록일/강사메모) - 회차 정보는 없음
 *  - Sessions: 회차별 평가 이력 - 수업마다 한 행씩 쌓이는 기록(수정 없이 추가만 됨)
 *              총 수업횟수·최근 점수·이전 점수·향상도는 전부 Sessions에서 계산해서 보여준다.
 */

var SHEET_STUDENTS = 'Students';
var SHEET_SESSIONS = 'Sessions';

var SPREADSHEET_ID = '1D_bBxOLIoEL-KbARvufekeDA5Fodt28TIZPA3E_Bw7c';

function getSpreadsheet_() {
  return SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}

// 평가 항목 메타데이터 - 이 배열이 유일한 기준(Single Source of Truth)입니다.
// 항목을 추가/변경하려면 여기만 고치면 서버·클라이언트·시트 헤더에 모두 반영됩니다.
var ITEMS = [
  { id: 'basic',      label: '기본조작',    group: 'course' },
  { id: 'startstop',  label: '출발·정지',   group: 'course' },
  { id: 'corner',     label: '코너링',      group: 'course' },
  { id: 'tpark',      label: 'T자 주차',    group: 'course' },
  { id: 'reverse',    label: '후진',        group: 'course' },
  { id: 'parking',    label: '주차',        group: 'course' },
  { id: 'lanechange', label: '차선변경',    group: 'road' },
  { id: 'signal',     label: '신호·교차로', group: 'road' },
  { id: 'roaddrive',  label: '도로주행',    group: 'road' },
  { id: 'hazard',     label: '위험대처',    group: 'road' }
];

var STUDENTS_HEADERS = ['StudentId', 'Name', 'Contact', 'RegisteredDate', 'Memo'];

// 눈으로 볼 열(수업일~이전점수)을 앞에, 조회용 기술 열(StudentId 등)은 뒤에 둔다 -
// 시트를 직접 열어도 "수업일/수강생명/회차/.../종합점수/이전점수" 순서로 바로 읽힌다.
var SESSIONS_HEADERS = ['Date', 'StudentName', 'SessionNo']
  .concat(ITEMS.map(function (item) { return item.id; }))
  .concat(['TotalScore', 'PrevScore', 'StudentId', 'SessionId', 'CreatedAt']);

// 데모로 시딩할 첫 수강생의 1회차 점수 (필요 없으면 setup()에서 이 부분만 지워도 됩니다)
var DEMO_SCORES = {
  basic: 100, startstop: 50, corner: 50, tpark: 10,
  reverse: 0, parking: 0, lanechange: 0, signal: 0, roaddrive: 0, hazard: 0
};

/* ---------------------------------------------------------------------- */
/* 웹앱 진입점                                                              */
/* ---------------------------------------------------------------------- */

function doGet() {
  ensureSetup_();
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('차샘 운전교실 - 수강생 실력 체크리스트')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// index.html 안에서 <?!= include('Stylesheet'); ?> 형태로 다른 HTML 파일을 끼워 넣을 때 사용
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/* ---------------------------------------------------------------------- */
/* 외부(GitHub Pages 등) 화면용 JSON API                                    */
/* ---------------------------------------------------------------------- */

// 이 웹앱 URL이 아닌 다른 곳(GitHub Pages 등)에 화면을 따로 두었을 때,
// 그 화면의 자바스크립트가 fetch(...)로 이 주소에 POST 요청을 보내 데이터를
// 읽고 쓸 수 있게 해주는 창구. google.script.run을 쓸 수 없는 외부 화면 전용이며,
// 기존 doGet() 화면(google.script.run 방식)은 그대로 영향받지 않는다.
function doPost(e) {
  var response;
  try {
    var req = JSON.parse(e.postData.contents);
    var action = req.action;
    var data = req.data || {};
    var result;
    switch (action) {
      case 'getStudents':        result = getStudents(); break;
      case 'getStudentRoster':   result = getStudentRoster(); break;
      case 'getStudentSummary':  result = getStudentSummary(data.studentId); break;
      case 'getSessions':        result = getSessions(data.studentId); break;
      case 'addStudent':         result = addStudent(data); break;
      case 'updateStudentInfo':  result = updateStudentInfo(data.studentId, data.patch); break;
      case 'deleteStudent':      result = deleteStudent(data.studentId); break;
      case 'addSession':         result = addSession(data.studentId, data.date, data.itemScores); break;
      case 'updateSession':      result = updateSession(data.sessionId, data.studentId, data.date, data.itemScores); break;
      case 'deleteLastSession':  result = deleteLastSession(data.studentId); break;
      default: throw new Error('알 수 없는 요청입니다: ' + action);
    }
    response = { ok: true, result: result };
  } catch (err) {
    response = { ok: false, error: (err && err.message) ? err.message : String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(response))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------------------------------------------------------------------- */
/* 시트 준비 / 시드 데이터                                                   */
/* ---------------------------------------------------------------------- */

function getSheet_(name, headers) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// 스프레드시트를 열고 Apps Script 편집기에서 이 함수를 한 번 실행하면
// 필요한 시트(Students, Sessions)를 만들고 데모 수강생 1명 + 1회차를 채워줍니다.
function setup() {
  var studentsSheet = getSheet_(SHEET_STUDENTS, STUDENTS_HEADERS);
  var sessionsSheet = getSheet_(SHEET_SESSIONS, SESSIONS_HEADERS);

  if (studentsSheet.getLastRow() < 2) {
    var id = Utilities.getUuid();
    var today = todayKey_();
    studentsSheet.appendRow([id, '이석재', '', today, '']);
    appendSessionRow_(sessionsSheet, id, '이석재', today, 1, DEMO_SCORES, null);
  }

  applyScoreFormatting_(sessionsSheet);
  return 'setup 완료';
}

// 점수 기준(0~59 집중 연습 / 60~74 연습 필요 / 75~89 가능 / 90~100 능숙)에 맞춰
// Sessions 시트의 점수 열(항목 10개 + 종합점수)에 색을 입힌다.
// 값이 채워지는 대로 자동 적용되도록 넉넉한 범위(2~2000행)에 미리 걸어둔다.
function applyScoreFormatting_(sessionsSheet) {
  var lastCol = sessionsSheet.getLastColumn();
  var headerRow = sessionsSheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var idx = headerIndex_(headerRow);
  var scoreCols = ITEMS.map(function (item) { return idx[item.id] + 1; }).concat([idx.TotalScore + 1]);

  var ranges = scoreCols.map(function (col) { return sessionsSheet.getRange(2, col, 1999, 1); });

  var rules = [
    { min: 90, max: 100, bg: '#dcfce7', text: '#047857' },  // 능숙
    { min: 75, max: 89,  bg: '#e0f2f1', text: '#0f766e' },  // 가능
    { min: 60, max: 74,  bg: '#fef3c7', text: '#92400e' },  // 연습 필요
    { min: 0,  max: 59,  bg: '#fee2e2', text: '#b91c1c' }   // 집중 연습
  ].map(function (band) {
    return SpreadsheetApp.newConditionalFormatRule()
      .whenNumberBetween(band.min, band.max)
      .setBackground(band.bg)
      .setFontColor(band.text)
      .setRanges(ranges)
      .build();
  });

  // 이 시트에 이미 걸려 있던 규칙은 지우고 새로 건다 (setup을 여러 번 실행해도 중복되지 않도록).
  sessionsSheet.setConditionalFormatRules(rules);
}

function ensureSetup_() {
  var ss = getSpreadsheet_();
  if (!ss.getSheetByName(SHEET_STUDENTS) || !ss.getSheetByName(SHEET_SESSIONS)) {
    setup();
  }
  ensureContactColumnIsText_(getSheet_(SHEET_STUDENTS, STUDENTS_HEADERS));
}

// 연락처 칸을 항상 "일반 텍스트" 서식으로 고정한다.
// 그냥 두면 010으로 시작하는 번호를 숫자로 인식해 앞자리 0을 지워버리기 때문.
function ensureContactColumnIsText_(studentsSheet) {
  var col = STUDENTS_HEADERS.indexOf('Contact') + 1;
  studentsSheet.getRange(2, col, 1999, 1).setNumberFormat('@');
}

/* ---------------------------------------------------------------------- */
/* 조회 - 수강생 목록 / 명부 / 상세 요약 / 회차 이력                            */
/* ---------------------------------------------------------------------- */

function getStudents() {
  ensureSetup_();
  return readAllStudents_()
    .map(function (s) { return { id: s.id, name: s.name }; })
    .sort(function (a, b) { return a.name.localeCompare(b.name, 'ko'); });
}

// "수강생 관리" 화면용 - 학생별 요약 행 (총 수업횟수/최근점수/이전점수/향상도/레벨 포함)
function getStudentRoster() {
  ensureSetup_();
  // 등록한 순서(시트에 쌓이는 순서)의 반대로 보여줘서 최근에 등록한 수강생이 맨 위로 오게 한다.
  var students = readAllStudents_().reverse();
  return students.map(function (s) {
    var sessions = readSessions_(s.id);
    var latest = sessions.length ? sessions[sessions.length - 1] : null;
    var prev = sessions.length > 1 ? sessions[sessions.length - 2] : null;
    var recentScore = latest ? latest.total : null;
    var prevScore = prev ? prev.total : null;
    var delta = (recentScore != null && prevScore != null) ? recentScore - prevScore : null;
    var level = latest ? levelFromScore_(latest.total) : '-';
    return {
      id: s.id,
      name: s.name,
      contact: s.contact,
      registeredDate: s.registeredDate,
      memo: s.memo,
      sessionCount: sessions.length,
      recentScore: recentScore,
      prevScore: prevScore,
      delta: delta,
      level: level
    };
  });
}

// "회차별 평가" 화면용 - 특정 학생의 최신 상태 요약 (막대그래프/집중 보완 영역 등에 사용)
function getStudentSummary(studentId) {
  ensureSetup_();
  var student = findStudent_(studentId);
  if (!student) throw new Error('수강생을 찾을 수 없습니다.');

  var sessions = readSessions_(studentId);
  var latest = sessions.length ? sessions[sessions.length - 1] : null;
  var prev = sessions.length > 1 ? sessions[sessions.length - 2] : null;

  var items = ITEMS.map(function (meta) {
    return {
      id: meta.id,
      label: meta.label,
      group: meta.group,
      value: latest ? (latest.items[meta.id] || 0) : 0
    };
  });

  var overall = latest ? latest.total : 0;
  var prevScore = prev ? prev.total : null;
  var level = latest ? levelFromScore_(latest.total) : '-';
  var delta = (latest && prev) ? (latest.total - prev.total) : null;

  var needsWork = latest
    ? items.filter(function (it) { return it.value > 0 && it.value < 90; })
        .sort(function (a, b) { return a.value - b.value; })
        .slice(0, 3)
    : [];

  var weakest = items.reduce(function (best, it) { return it.value < best.value ? it : best; }, items[0]);

  return {
    student: student,
    items: items,
    overall: overall,
    prevScore: prevScore,
    level: level,
    delta: delta,
    needsWork: needsWork,
    weakest: weakest,
    hasSessions: !!latest,
    sessionCount: sessions.length,
    nextSessionNo: sessions.length + 1
  };
}

// 회차별 평가 화면 하단의 "수업 이력" 표 - 최신 회차가 맨 위로 오도록 반환
function getSessions(studentId) {
  ensureSetup_();
  return readSessions_(studentId).slice().reverse();
}

/* ---------------------------------------------------------------------- */
/* 저장                                                                     */
/* ---------------------------------------------------------------------- */

function addStudent(data) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    ensureSetup_();
    var name = ((data && data.name) || '').trim();
    if (!name) throw new Error('이름을 입력해 주세요.');
    var contact = (data && data.contact) || '';
    var registeredDate = (data && data.registeredDate) || todayKey_();

    var sheet = getSheet_(SHEET_STUDENTS, STUDENTS_HEADERS);
    var id = Utilities.getUuid();
    // Contact는 일단 비워서 행을 만들고, 실제 그 셀에 "서식(텍스트) -> 값" 순서로 확실히 써서
    // 010으로 시작하는 번호의 앞자리 0이 숫자로 인식돼 사라지는 걸 막는다.
    sheet.appendRow([id, name, '', registeredDate, '']);
    var newRow = sheet.getLastRow();
    var contactCol = STUDENTS_HEADERS.indexOf('Contact') + 1;
    sheet.getRange(newRow, contactCol).setNumberFormat('@').setValue(contact);
    return { id: id, name: name };
  } finally {
    lock.releaseLock();
  }
}

// 수강생 관리 화면에서 이름 / 연락처 / 등록일 / 강사메모를 인라인으로 수정할 때 호출
function updateStudentInfo(studentId, patch) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    ensureSetup_();
    if (patch.name !== undefined && !String(patch.name).trim()) {
      throw new Error('이름은 비워둘 수 없습니다.');
    }
    var sheet = getSheet_(SHEET_STUDENTS, STUDENTS_HEADERS);
    var rowIndex = findRowIndexById_(sheet, studentId);
    if (rowIndex === -1) throw new Error('수강생을 찾을 수 없습니다.');

    var fieldToColumn = { name: 'Name', contact: 'Contact', registeredDate: 'RegisteredDate', memo: 'Memo' };
    Object.keys(fieldToColumn).forEach(function (key) {
      if (patch[key] === undefined) return;
      var col = STUDENTS_HEADERS.indexOf(fieldToColumn[key]) + 1;
      var cell = sheet.getRange(rowIndex + 1, col);
      // 연락처는 앞자리 0이 숫자로 인식돼 사라지지 않도록 "서식(텍스트) -> 값" 순서로 쓴다.
      if (key === 'contact') cell.setNumberFormat('@');
      cell.setValue(patch[key]);
    });
  } finally {
    lock.releaseLock();
  }
  return getStudentRoster();
}

// 수강생을 명부에서 삭제하고, 그 수강생의 회차 기록도 전부 함께 삭제한다. 되돌릴 수 없다.
function deleteStudent(studentId) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    ensureSetup_();

    var studentsSheet = getSheet_(SHEET_STUDENTS, STUDENTS_HEADERS);
    var rowIndex = findRowIndexById_(studentsSheet, studentId);
    if (rowIndex === -1) throw new Error('수강생을 찾을 수 없습니다.');
    studentsSheet.deleteRow(rowIndex + 1);

    // 해당 학생의 회차 기록을 전부 지운다. 아래에서 위로 지워야 행 번호가 밀리지 않는다.
    var sessionsSheet = getSheet_(SHEET_SESSIONS, SESSIONS_HEADERS);
    var sessions = readSessions_(studentId).sort(function (a, b) { return b.rowIndex - a.rowIndex; });
    sessions.forEach(function (s) { sessionsSheet.deleteRow(s.rowIndex + 1); });
  } finally {
    lock.releaseLock();
  }
  return getStudentRoster();
}

// 새 회차 평가 저장 - 10개 항목 점수와 수업일을 받아 한 행으로 쌓는다.
function addSession(studentId, dateStr, itemScores) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    ensureSetup_();
    var student = findStudent_(studentId);
    if (!student) throw new Error('수강생을 찾을 수 없습니다.');

    var sessionsSheet = getSheet_(SHEET_SESSIONS, SESSIONS_HEADERS);
    var existing = readSessions_(studentId);
    var sessionNo = existing.length + 1;
    var prevScore = existing.length ? existing[existing.length - 1].total : null;

    appendSessionRow_(sessionsSheet, studentId, student.name, (dateStr || todayKey_()), sessionNo, itemScores || {}, prevScore);
  } finally {
    lock.releaseLock();
  }
  return { summary: getStudentSummary(studentId), sessions: getSessions(studentId) };
}

// 이미 저장된 회차의 수업일/항목 점수를 고쳐 쓴다. 회차 번호·이전점수·생성일시는 그대로 둔다.
function updateSession(sessionId, studentId, dateStr, itemScores) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    ensureSetup_();
    var sheet = getSheet_(SHEET_SESSIONS, SESSIONS_HEADERS);
    var rows = sheet.getDataRange().getValues();
    var idx = headerIndex_(rows[0]);

    var rowIndex = -1;
    for (var r = 1; r < rows.length; r++) {
      if (rows[r][idx.SessionId] === sessionId && rows[r][idx.StudentId] === studentId) { rowIndex = r; break; }
    }
    if (rowIndex === -1) throw new Error('수정할 회차를 찾을 수 없습니다.');

    var total = computeTotal_(itemScores || {});
    var itemValues = ITEMS.map(function (item) { return clampScore_((itemScores || {})[item.id]); });

    sheet.getRange(rowIndex + 1, idx.Date + 1).setValue(dateStr || todayKey_());
    sheet.getRange(rowIndex + 1, idx[ITEMS[0].id] + 1, 1, ITEMS.length).setValues([itemValues]);
    sheet.getRange(rowIndex + 1, idx.TotalScore + 1).setValue(total);
  } finally {
    lock.releaseLock();
  }
  return { summary: getStudentSummary(studentId), sessions: getSessions(studentId) };
}

// 잘못 입력한 마지막 회차를 삭제 (되돌리기). 과거 회차는 손대지 않는다.
function deleteLastSession(studentId) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    ensureSetup_();
    var sessionsSheet = getSheet_(SHEET_SESSIONS, SESSIONS_HEADERS);
    var sessions = readSessions_(studentId);
    if (!sessions.length) throw new Error('삭제할 회차가 없습니다.');
    var last = sessions[sessions.length - 1];
    sessionsSheet.deleteRow(last.rowIndex + 1);
  } finally {
    lock.releaseLock();
  }
  return { summary: getStudentSummary(studentId), sessions: getSessions(studentId) };
}

// SESSIONS_HEADERS의 순서에 맞춰 행을 조립한다 (헤더 이름 기준이라 열 순서를 바꿔도 안전하다).
function appendSessionRow_(sheet, studentId, studentName, dateStr, sessionNo, itemScores, prevScore) {
  var total = computeTotal_(itemScores);
  var record = {
    Date: dateStr,
    StudentName: studentName,
    SessionNo: sessionNo,
    TotalScore: total,
    PrevScore: (prevScore == null ? '' : prevScore),
    StudentId: studentId,
    SessionId: Utilities.getUuid(),
    CreatedAt: new Date()
  };
  ITEMS.forEach(function (item) { record[item.id] = clampScore_(itemScores[item.id]); });

  var row = SESSIONS_HEADERS.map(function (header) { return record[header]; });
  sheet.appendRow(row);
  return total;
}

function computeTotal_(itemScores) {
  var sum = 0;
  ITEMS.forEach(function (item) { sum += clampScore_(itemScores[item.id]); });
  return Math.round(sum / ITEMS.length);
}

function clampScore_(v) {
  var n = Math.round(Number(v) || 0);
  return Math.max(0, Math.min(100, n));
}

/* ---------------------------------------------------------------------- */
/* 내부 유틸                                                                */
/* ---------------------------------------------------------------------- */

function headerIndex_(headerRow) {
  var idx = {};
  headerRow.forEach(function (h, i) { idx[h] = i; });
  return idx;
}

function findRowIndexById_(sheet, id) {
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] === id) return i;
  }
  return -1;
}

function readAllStudents_() {
  var sheet = getSheet_(SHEET_STUDENTS, STUDENTS_HEADERS);
  var rows = sheet.getDataRange().getValues();
  var idx = headerIndex_(rows[0]);
  var list = [];
  for (var i = 1; i < rows.length; i++) {
    if (!rows[i][idx.StudentId]) continue;
    list.push({
      id: rows[i][idx.StudentId],
      name: rows[i][idx.Name],
      contact: rows[i][idx.Contact] || '',
      registeredDate: formatDateCell_(rows[i][idx.RegisteredDate]),
      memo: rows[i][idx.Memo] || ''
    });
  }
  return list;
}

function findStudent_(studentId) {
  var students = readAllStudents_();
  for (var i = 0; i < students.length; i++) {
    if (students[i].id === studentId) return students[i];
  }
  return null;
}

// 특정 학생의 회차 기록을 회차 번호 오름차순으로 반환 (items는 {itemId: value} 형태)
function readSessions_(studentId) {
  var sheet = getSheet_(SHEET_SESSIONS, SESSIONS_HEADERS);
  var rows = sheet.getDataRange().getValues();
  var idx = headerIndex_(rows[0]);
  var list = [];
  for (var r = 1; r < rows.length; r++) {
    var row = rows[r];
    if (row[idx.StudentId] !== studentId) continue;
    var items = {};
    ITEMS.forEach(function (item) { items[item.id] = Number(row[idx[item.id]]) || 0; });
    list.push({
      sessionId: row[idx.SessionId],
      studentId: row[idx.StudentId],
      studentName: row[idx.StudentName],
      date: formatDateCell_(row[idx.Date]),
      sessionNo: Number(row[idx.SessionNo]) || 0,
      items: items,
      total: Number(row[idx.TotalScore]) || 0,
      prevScore: row[idx.PrevScore] === '' ? null : Number(row[idx.PrevScore]),
      rowIndex: r
    });
  }
  list.sort(function (a, b) { return a.sessionNo - b.sessionNo; });
  return list;
}

// 차샘 운전교실 점수 기준: 0~59 집중 연습 / 60~74 연습 필요 / 75~89 가능 / 90~100 능숙
function levelFromScore_(v) {
  if (v >= 90) return '능숙';
  if (v >= 75) return '가능';
  if (v >= 60) return '연습 필요';
  return '집중 연습';
}

function todayKey_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function formatDateCell_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return v || '';
}
