(function () {
  "use strict";

  // ====================================================================
  // 이 화면(GitHub Pages 등 외부 정적 호스팅용)은 Apps Script가 직접 그려주는
  // 화면이 아니라서 google.script.run을 쓸 수 없습니다. 대신 아래 APPS_SCRIPT_URL로
  // fetch(...) POST 요청을 보내 Code.js의 doPost(e)를 호출하는 방식으로 동작합니다.
  //
  // 사용 전 꼭 할 일:
  // 1) Apps Script 프로젝트를 "웹 앱"으로 배포(또는 재배포)해서 URL을 발급받는다.
  // 2) 아래 APPS_SCRIPT_URL 값을 그 배포 URL("...../exec")로 바꾼다.
  // ====================================================================
  var APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwRtWYjdZJnN8pVjuGS7i-JwiS25sb2Vq-fuSwAPiLJoa_myU9xRs-kEkEFHOh865dM/exec";

  function callApi(action, data) {
    return fetch(APPS_SCRIPT_URL, {
      method: "POST",
      // Content-Type을 application/json으로 두면 브라우저가 CORS 사전요청(preflight)을
      // 보내는데, Apps Script 웹앱은 이를 처리하지 못해 요청이 실패합니다.
      // text/plain으로 보내면 사전요청 없이 바로 전송되고, 서버(doPost)는 어차피
      // JSON.parse로 읽으므로 내용은 그대로 JSON이어도 문제없습니다.
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: action, data: data || {} })
    })
      .then(function (res) { return res.json(); })
      .then(function (json) {
        if (!json || !json.ok) throw new Error((json && json.error) || "알 수 없는 오류");
        return json.result;
      });
  }

  var LAST_STUDENT_KEY = "driving-skill-tracker-last-student";

  // 항목 순서/이름은 Code.gs의 ITEMS 배열과 반드시 일치해야 합니다.
  // (수업 이력 표의 열 제목을 서버 응답을 기다리지 않고 바로 그리기 위해 클라이언트에도 둡니다.)
  var ITEM_META = [
    { id: "basic",      label: "기본조작",    group: "course" },
    { id: "startstop",  label: "출발·정지",   group: "course" },
    { id: "corner",     label: "코너링",      group: "course" },
    { id: "tpark",      label: "T자 주차",    group: "course" },
    { id: "reverse",    label: "후진",        group: "course" },
    { id: "parking",    label: "주차",        group: "course" },
    { id: "lanechange", label: "차선변경",    group: "road" },
    { id: "signal",     label: "신호·교차로", group: "road" },
    { id: "roaddrive",  label: "도로주행",    group: "road" },
    { id: "hazard",     label: "위험대처",    group: "road" }
  ];

  var currentStudentId = null;
  var currentSummary = null;
  var sessionInputs = {};
  var editingSessionId = null;

  var tabButtons = Array.prototype.slice.call(document.querySelectorAll(".tab-btn"));
  var panels = {
    roster: document.getElementById("tabRoster"),
    sessions: document.getElementById("tabSessions"),
    chart: document.getElementById("tabChart"),
    payments: document.getElementById("tabPayments")
  };

  var rosterBody = document.getElementById("rosterBody");
  var rosterSearchEl = document.getElementById("rosterSearch");
  var rosterCountEl = document.getElementById("rosterCount");
  var rosterPaginationEl = document.getElementById("rosterPagination");
  var rosterAllRows = [];
  var rosterPage = 1;
  var ROSTER_PAGE_SIZE = 5;

  var historyAllSessions = [];
  var historyPage = 1;
  var HISTORY_PAGE_SIZE = 5;

  var newStudentName = document.getElementById("newStudentName");
  var newStudentContact = document.getElementById("newStudentContact");
  var newStudentDate = document.getElementById("newStudentDate");
  var newStudentEnd = document.getElementById("newStudentEnd");
  var addStudentBtn = document.getElementById("addStudentBtn");
  var newStudentFee = document.getElementById("newStudentFee");
  var newStudentAmount = document.getElementById("newStudentAmount");
  var newStudentPaidOff = document.getElementById("newStudentPaidOff");
  var newStudentMethod = document.getElementById("newStudentMethod");
  var printAppOnAdd = document.getElementById("printAppOnAdd");
  var printCertOnAdd = document.getElementById("printCertOnAdd");
  var printAreaEl = document.getElementById("printArea");

  var studentSelect = document.getElementById("studentSelect");
  var studentSearchEl = document.getElementById("studentSearch");
  var chartStudentSelectEl = document.getElementById("chartStudentSelect");
  var chartStudentSearchEl = document.getElementById("chartStudentSearch");
  var courseRowsEl = document.getElementById("courseRows");
  var roadRowsEl = document.getElementById("roadRows");
  var sessionDateEl = document.getElementById("sessionDate");
  var saveSessionBtn = document.getElementById("saveSessionBtn");
  var deleteLastBtn = document.getElementById("deleteLastBtn");
  var historyHeadEl = document.getElementById("historyHead");
  var historyBodyEl = document.getElementById("historyBody");
  var historyPaginationEl = document.getElementById("historyPagination");
  var editBannerEl = document.getElementById("editBanner");
  var editBannerTextEl = document.getElementById("editBannerText");
  var cancelEditBtn = document.getElementById("cancelEditBtn");
  var statusNote = document.getElementById("statusNote");

  /* ---------------------------------------------------------------- */
  /* 공용 유틸                                                          */
  /* ---------------------------------------------------------------- */

  // 차샘 운전교실 점수 기준: 0~59 집중 연습 / 60~74 연습 필요 / 75~89 가능 / 90~100 능숙
  // (Code.gs의 levelFromScore_와 반드시 같은 경계값을 써야 합니다.)
  function tierClass(v) {
    if (v >= 90) return "tier-master";
    if (v >= 75) return "tier-ok";
    if (v >= 60) return "tier-practice";
    return "tier-focus";
  }
  function tierLabel(v) {
    if (v >= 90) return "능숙";
    if (v >= 75) return "가능";
    if (v >= 60) return "연습 필요";
    return "집중 연습";
  }
  function scoreChip(v) {
    return '<span class="score-chip ' + tierClass(v) + '">' + v + "</span>";
  }

  function clampScore(raw) {
    var v = Math.round(Number(raw));
    if (isNaN(v)) v = 0;
    return Math.max(0, Math.min(100, v));
  }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function nowLabel() {
    var d = new Date();
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }

  function setStatus(text, isError) {
    statusNote.textContent = text;
    statusNote.style.color = isError ? "var(--bad)" : "var(--ink-muted)";
  }

  function onError(err) {
    console.error(err);
    setStatus("오류: " + (err && err.message ? err.message : "저장/불러오기에 실패했어요."), true);
  }

  function deltaHtml(delta, hasEnoughHistory) {
    if (!hasEnoughHistory || delta === null || delta === undefined) return '<span class="dtxt-flat">첫 평가</span>';
    if (delta > 0) return '<span class="dtxt-up">▲ +' + delta + '</span>';
    if (delta < 0) return '<span class="dtxt-down">▼ ' + delta + '</span>';
    return '<span class="dtxt-flat">변화 없음</span>';
  }

  /* ---------------------------------------------------------------- */
  /* 탭 전환                                                            */
  /* ---------------------------------------------------------------- */

  function switchTab(name) {
    tabButtons.forEach(function (b) { b.classList.toggle("is-active", b.dataset.tab === name); });
    Object.keys(panels).forEach(function (key) { panels[key].hidden = key !== name; });
  }
  tabButtons.forEach(function (btn) {
    btn.addEventListener("click", function () { switchTab(btn.dataset.tab); });
  });

  /* ---------------------------------------------------------------- */
  /* 탭 1: 수강생 관리                                                   */
  /* ---------------------------------------------------------------- */

  function refreshRoster() {
    callApi("getStudentRoster")
      .then(function (rows) {
        rosterAllRows = rows;
        applyRosterView();
      })
      .catch(onError);
  }

  rosterSearchEl.addEventListener("input", function () {
    rosterPage = 1;
    applyRosterView();
  });

  // 검색어로 걸러서 5개씩 페이지로 나눠 보여준다 (수강생이 많아져도 표가 안 늘어지도록).
  function applyRosterView() {
    updatePaymentSummary();
    renderPayments();
    var term = rosterSearchEl.value.trim().toLowerCase();
    var filtered = term
      ? rosterAllRows.filter(function (r) { return (r.name || "").toLowerCase().indexOf(term) !== -1; })
      : rosterAllRows;

    var totalPages = Math.max(1, Math.ceil(filtered.length / ROSTER_PAGE_SIZE));
    if (rosterPage > totalPages) rosterPage = totalPages;
    if (rosterPage < 1) rosterPage = 1;

    var start = (rosterPage - 1) * ROSTER_PAGE_SIZE;
    var pageRows = filtered.slice(start, start + ROSTER_PAGE_SIZE);

    rosterCountEl.textContent = rosterAllRows.length
      ? "전체 " + rosterAllRows.length + "명" + (term ? " · 검색됨 " + filtered.length + "명" : "")
      : "";

    renderRoster(pageRows, filtered.length, term);
    renderPagination(rosterPaginationEl, totalPages, rosterPage, function (p) {
      rosterPage = p;
      applyRosterView();
    });
  }

  // 페이지 번호 버튼을 그리는 공용 함수 (수강생 관리 표 / 수업 이력 표 둘 다 사용)
  function renderPagination(containerEl, totalPages, currentPage, onSelect) {
    containerEl.innerHTML = "";
    if (totalPages <= 1) return;
    for (var p = 1; p <= totalPages; p++) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "page-btn" + (p === currentPage ? " is-active" : "");
      btn.textContent = String(p);
      btn.addEventListener("click", (function (page) {
        return function () { onSelect(page); };
      })(p));
      containerEl.appendChild(btn);
    }
  }

  function renderRoster(rows, filteredTotal, term) {
    rosterBody.innerHTML = "";
    if (!rosterAllRows.length) {
      rosterBody.innerHTML = '<tr><td colspan="14" class="empty-row">등록된 수강생이 없어요. 위에서 추가해 보세요.</td></tr>';
      return;
    }
    if (term && filteredTotal === 0) {
      rosterBody.innerHTML = '<tr><td colspan="14" class="empty-row">"' + term + '" 검색 결과가 없어요.</td></tr>';
      return;
    }
    rows.forEach(function (r) {
      var tr = document.createElement("tr");

      tr.appendChild(makeEditableCell(r.id, "name", r.name, "text", "수강생명"));

      tr.appendChild(makeEditableCell(r.id, "contact", r.contact, "text", "연락처"));
      tr.appendChild(makeEditableCell(r.id, "registeredDate", r.registeredDate, "date"));
      tr.appendChild(makeEditableCell(r.id, "endDate", r.endDate || endDateOf(r.registeredDate), "date"));
      tr.appendChild(makeFeeCell(r));

      var tdPaid = document.createElement("td");
      tdPaid.className = "pay-amount";
      tdPaid.textContent = r.paidTotal ? formatWon(r.paidTotal) : "-";
      tr.appendChild(tdPaid);

      var tdStatus = document.createElement("td");
      tdStatus.innerHTML = statusBadgeHtml(r) + (r.balance > 0 ? '<small class="pay-balance">잔금 ' + formatWon(r.balance) + '</small>' : "");
      tr.appendChild(tdStatus);

      var tdCount = document.createElement("td");
      tdCount.textContent = r.sessionCount + "회";
      tr.appendChild(tdCount);

      var tdRecent = document.createElement("td");
      tdRecent.textContent = r.recentScore == null ? "-" : r.recentScore + "점";
      tr.appendChild(tdRecent);

      var tdPrev = document.createElement("td");
      tdPrev.textContent = r.prevScore == null ? "-" : r.prevScore + "점";
      tr.appendChild(tdPrev);

      var tdDelta = document.createElement("td");
      tdDelta.innerHTML = deltaHtml(r.delta, r.sessionCount >= 2);
      tr.appendChild(tdDelta);

      var tdLevel = document.createElement("td");
      tdLevel.textContent = r.level;
      tr.appendChild(tdLevel);

      tr.appendChild(makeEditableCell(r.id, "memo", r.memo, "text", "메모", true));

      var tdLink = document.createElement("td");
      var payBtn = document.createElement("button");
      payBtn.type = "button";
      payBtn.className = "roster-link roster-pay";
      payBtn.textContent = "납입 관리";
      payBtn.addEventListener("click", function () { openPayDialog(r.id); });
      tdLink.appendChild(payBtn);

      var linkBtn = document.createElement("button");
      linkBtn.type = "button";
      linkBtn.className = "roster-link";
      linkBtn.textContent = "회차별 평가 →";
      linkBtn.addEventListener("click", function () {
        switchTab("sessions");
        studentSearchEl.value = ""; // 검색으로 옵션이 좁혀져 있어도 이 학생이 목록에 보이도록 초기화
        chartStudentSearchEl.value = "";
        populateStudentSelect(false);
        studentSelect.value = r.id;
        chartStudentSelectEl.value = r.id;
        loadStudent(r.id);
      });
      tdLink.appendChild(linkBtn);

      [["성적표 출력", { report: true }], ["신청서 출력", { application: true }], ["확인서 출력", { certificate: true }]].forEach(function (def) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "roster-link roster-print";
        b.textContent = def[0];
        b.addEventListener("click", function () { printDocs(r, def[1]); });
        tdLink.appendChild(b);
      });

      var delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "roster-link roster-del";
      delBtn.textContent = "삭제";
      delBtn.addEventListener("click", function () { deleteStudentRow(r); });
      tdLink.appendChild(delBtn);
      tr.appendChild(tdLink);

      rosterBody.appendChild(tr);
    });
  }

  var METHODS = ["현금", "카드", "계좌이체"];

  // 모든 수강생의 납입 내역을 한 줄로 펼친 목록 (수강료 현황/합계 계산용)
  function allPayments() {
    var list = [];
    rosterAllRows.forEach(function (r) {
      (r.payments || []).forEach(function (p) {
        list.push({ id: p.id, studentId: r.id, name: r.name, date: p.date || "", amount: Number(p.amount) || 0, method: p.method || "", memo: p.memo || "" });
      });
    });
    return list;
  }

  function sumByMethod(list) {
    var by = { "현금": 0, "카드": 0, "계좌이체": 0, "미지정": 0 };
    list.forEach(function (p) { by[METHODS.indexOf(p.method) !== -1 ? p.method : "미지정"] += p.amount; });
    return by;
  }

  function statusBadgeHtml(r) {
    var cls = r.status === "완불" ? "st-paid" : (r.status === "분납중" ? "st-part" : (r.status === "미납" ? "st-none" : "st-etc"));
    return '<span class="pay-badge ' + cls + '">' + r.status + '</span>';
  }

  // 수강생 관리 탭 위쪽 합계: 전체 입금 / 이번 달 / 미수금(잔금) / 결제방법별
  function updatePaymentSummary() {
    var el = document.getElementById("paySummary");
    if (!el) return;
    var pays = allPayments();
    var total = 0, month = 0, owed = 0, owedCount = 0;
    var thisMonth = todayStr().slice(0, 7);
    pays.forEach(function (p) {
      total += p.amount;
      if (p.date.slice(0, 7) === thisMonth) month += p.amount;
    });
    rosterAllRows.forEach(function (r) {
      if (r.balance > 0) { owed += r.balance; owedCount++; }
    });
    var by = sumByMethod(pays);
    var chips = [
      '<span class="pay-chip pay-total">입금 합계 <b>' + formatWon(total) + '</b> <small>(' + pays.length + '건)</small></span>',
      '<span class="pay-chip">이번 달 <b>' + formatWon(month) + '</b></span>',
      '<span class="pay-chip pay-owed">미수금(잔금) <b>' + formatWon(owed) + '</b> <small>(' + owedCount + '명)</small></span>',
      '<span class="pay-chip">현금 <b>' + formatWon(by["현금"]) + '</b></span>',
      '<span class="pay-chip">카드 <b>' + formatWon(by["카드"]) + '</b></span>',
      '<span class="pay-chip">계좌이체 <b>' + formatWon(by["계좌이체"]) + '</b></span>'
    ];
    if (by["미지정"]) chips.push('<span class="pay-chip">결제방법 미지정 <b>' + formatWon(by["미지정"]) + '</b></span>');
    el.innerHTML = chips.join("");
  }

  /* ---------------------------------------------------------------- */
  /* 탭 4: 수강료 현황 (주간 / 월간)                                       */
  /* 수강료는 수강생의 "등록일" 기준으로 해당 기간에 집계한다.                  */
  /* ---------------------------------------------------------------- */

  var payMode = "week";           // "week" | "month"
  var payAnchor = new Date();     // 보고 있는 기간 안의 아무 날짜
  var payBodyEl = document.getElementById("payBody");
  var payFootEl = document.getElementById("payFoot");
  var payDateEl = document.getElementById("payDate");
  var payPeriodLabelEl = document.getElementById("payPeriodLabel");
  var payRangeSummaryEl = document.getElementById("payRangeSummary");
  var payTodayBtn = document.getElementById("payToday");

  function ymdOf(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function parseYmd(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || "");
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }

  // "9/28(월)" 형태로 짧게 표시 (모바일에서 표가 옆으로 길어지지 않도록)
  function shortDate(s) {
    var d = parseYmd(s);
    return d ? (d.getMonth() + 1) + "/" + d.getDate() + "(" + "일월화수목금토".charAt(d.getDay()) + ")" : "";
  }

  // 주간은 월요일 ~ 일요일, 월간은 1일 ~ 말일
  function payRange() {
    var d = payAnchor;
    if (payMode === "week") {
      var start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
      var end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
      return { start: start, end: end };
    }
    return { start: new Date(d.getFullYear(), d.getMonth(), 1), end: new Date(d.getFullYear(), d.getMonth() + 1, 0) };
  }

  // 기간(주간/월간) 안에 "돈을 받은 날(납입일)"이 있는 납입 내역을 모아 보여준다.
  function renderPayments() {
    if (!payBodyEl) return;
    var range = payRange();
    var startKey = ymdOf(range.start), endKey = ymdOf(range.end);

    payDateEl.type = payMode === "week" ? "date" : "month";
    payDateEl.value = payMode === "week" ? ymdOf(payAnchor) : startKey.slice(0, 7);
    payTodayBtn.textContent = payMode === "week" ? "이번 주" : "이번 달";
    payPeriodLabelEl.textContent = payMode === "week"
      ? (range.start.getFullYear() + "년 " + (range.start.getMonth() + 1) + "월 " + range.start.getDate() + "일 ~ "
         + (range.end.getMonth() + 1) + "월 " + range.end.getDate() + "일")
      : (range.start.getFullYear() + "년 " + (range.start.getMonth() + 1) + "월");

    var pays = allPayments().filter(function (p) {
      var k = p.date.slice(0, 10);
      return k >= startKey && k <= endKey;
    }).sort(function (x, y) {
      return x.date.localeCompare(y.date) || x.name.localeCompare(y.name, "ko");
    });

    var total = 0, people = {};
    payBodyEl.innerHTML = "";
    if (!pays.length) {
      payBodyEl.innerHTML = '<tr><td colspan="4" class="empty-row">이 기간에 납입된 수강료가 없어요.</td></tr>';
    }
    pays.forEach(function (p) {
      total += p.amount;
      people[p.studentId] = true;
      var tr = document.createElement("tr");

      var tdDate = document.createElement("td");
      tdDate.textContent = shortDate(p.date);
      tr.appendChild(tdDate);

      var tdName = document.createElement("td");
      tdName.textContent = p.name;
      if (p.memo) {
        var sm = document.createElement("small");
        sm.className = "pay-memo";
        sm.textContent = p.memo;
        tdName.appendChild(sm);
      }
      tr.appendChild(tdName);

      var tdMethod = document.createElement("td");
      tdMethod.textContent = p.method || "-";
      tr.appendChild(tdMethod);

      var tdAmt = document.createElement("td");
      tdAmt.className = "pay-amount";
      tdAmt.textContent = formatWon(p.amount);
      tr.appendChild(tdAmt);

      payBodyEl.appendChild(tr);
    });

    var peopleCount = Object.keys(people).length;
    payFootEl.innerHTML = pays.length
      ? '<tr class="pay-total-row"><td colspan="3">합계 (' + pays.length + '건 · ' + peopleCount + '명)</td><td class="pay-amount">' + formatWon(total) + '</td></tr>'
      : "";

    var by = sumByMethod(pays);
    var chips = [
      '<span class="pay-chip pay-total">' + (payMode === "week" ? "주간" : "월간") + ' 수강료 합계 <b>' + formatWon(total) + '</b> <small>(' + pays.length + '건 · ' + peopleCount + '명)</small></span>',
      '<span class="pay-chip">현금 <b>' + formatWon(by["현금"]) + '</b></span>',
      '<span class="pay-chip">카드 <b>' + formatWon(by["카드"]) + '</b></span>',
      '<span class="pay-chip">계좌이체 <b>' + formatWon(by["계좌이체"]) + '</b></span>'
    ];
    if (by["미지정"]) chips.push('<span class="pay-chip">결제방법 미지정 <b>' + formatWon(by["미지정"]) + '</b></span>');
    payRangeSummaryEl.innerHTML = chips.join("");
  }

  function payShift(dir) {
    var d = payAnchor;
    payAnchor = payMode === "week"
      ? new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7 * dir)
      : new Date(d.getFullYear(), d.getMonth() + dir, 1);
    renderPayments();
  }
  document.getElementById("payPrev").addEventListener("click", function () { payShift(-1); });
  document.getElementById("payNext").addEventListener("click", function () { payShift(1); });
  payTodayBtn.addEventListener("click", function () { payAnchor = new Date(); renderPayments(); });
  payDateEl.addEventListener("change", function () {
    var v = payDateEl.value;
    if (!v) return;
    payAnchor = payMode === "week" ? parseYmd(v) : parseYmd(v + "-01");
    if (payAnchor) renderPayments();
  });
  Array.prototype.slice.call(document.querySelectorAll(".pay-mode-btn")).forEach(function (btn) {
    btn.addEventListener("click", function () {
      payMode = btn.dataset.mode;
      Array.prototype.slice.call(document.querySelectorAll(".pay-mode-btn")).forEach(function (b) {
        b.classList.toggle("is-active", b === btn);
      });
      renderPayments();
    });
  });

  function formatWon(n) {
    return (Number(n) || 0).toLocaleString("ko-KR") + "원";
  }

  function moneyVal(el) {
    return Number(String(el.value).replace(/[^\d]/g, "")) || 0;
  }
  function bindMoneyInput(el) {
    el.addEventListener("input", function () {
      var d = el.value.replace(/[^\d]/g, "");
      el.value = d ? Number(d).toLocaleString("ko-KR") : "";
    });
  }

  // 총 수강료 칸: 클릭하면 숫자만 보이고, 입력이 끝나면 저장한 뒤 "280,000원" 형태로 보여준다.
  function makeFeeCell(r) {
    var td = document.createElement("td");
    var input = document.createElement("input");
    input.type = "text";
    input.inputMode = "numeric";
    input.className = "cell-input cell-amount";
    input.placeholder = "총액";
    input.value = r.totalFee ? formatWon(r.totalFee) : "";
    input.addEventListener("focus", function () { input.value = r.totalFee ? String(r.totalFee) : ""; });
    input.addEventListener("change", function () {
      var fee = moneyVal(input);
      callApi("updateStudentInfo", { studentId: r.id, patch: { totalFee: fee } })
        .then(function (rows) {
          rosterAllRows = rows;
          setStatus("저장됨 · " + nowLabel());
          applyRosterView();
        })
        .catch(onError);
    });
    input.addEventListener("blur", function () {
      var fee = moneyVal(input);
      input.value = fee ? formatWon(fee) : "";
    });
    td.appendChild(input);
    return td;
  }

  /* ---------------------------------------------------------------- */
  /* 납입 관리 팝업 (분납: 계약금 / 중도금 / 잔금, 완불 체크)                  */
  /* ---------------------------------------------------------------- */

  var payDialog = document.getElementById("payDialog");
  var pdTitle = document.getElementById("pdTitle");
  var pdFee = document.getElementById("pdFee");
  var pdStatus = document.getElementById("pdStatus");
  var pdSums = document.getElementById("pdSums");
  var pdBody = document.getElementById("pdBody");
  var pdDate = document.getElementById("pdDate");
  var pdAmount = document.getElementById("pdAmount");
  var pdMethod = document.getElementById("pdMethod");
  var pdMemo = document.getElementById("pdMemo");
  var pdPaidOff = document.getElementById("pdPaidOff");
  var pdSave = document.getElementById("pdSave");
  var pdUnpaid = document.getElementById("pdUnpaid");
  var pdMsg = document.getElementById("pdMsg");
  var pdStudentId = null;

  function pdStudent() {
    for (var i = 0; i < rosterAllRows.length; i++) {
      if (rosterAllRows[i].id === pdStudentId) return rosterAllRows[i];
    }
    return null;
  }

  function openPayDialog(studentId) {
    pdStudentId = studentId;
    pdDate.value = todayStr();
    pdAmount.value = "";
    pdMemo.value = "";
    pdPaidOff.checked = false;
    pdMsg.hidden = true;
    renderPayDialog();
    if (payDialog.showModal) payDialog.showModal(); else payDialog.setAttribute("open", "");
  }

  function renderPayDialog() {
    var r = pdStudent();
    if (!r) { if (payDialog.close) payDialog.close(); return; }
    pdTitle.textContent = r.name + " · 수강료 납입";
    pdFee.value = r.totalFee ? formatWon(r.totalFee) : "";
    pdStatus.className = "pay-badge " + (r.status === "완불" ? "st-paid" : (r.status === "분납중" ? "st-part" : (r.status === "미납" ? "st-none" : "st-etc")));
    pdStatus.textContent = r.status;
    pdSums.innerHTML =
      '<span>납입 합계 <b>' + formatWon(r.paidTotal) + '</b></span>' +
      '<span>잔금 <b>' + (r.status === "완불" ? "0원 (완불)" : (r.totalFee ? formatWon(r.balance) : "총 수강료 입력 필요")) + '</b></span>';
    pdUnpaid.hidden = !r.paidOffManual;

    pdBody.innerHTML = "";
    if (!(r.payments || []).length) {
      pdBody.innerHTML = '<tr><td colspan="5" class="empty-row">아직 납입 내역이 없어요.</td></tr>';
    }
    (r.payments || []).forEach(function (p) {
      var tr = document.createElement("tr");
      [shortDate(p.date), p.memo || "-", p.method || "-", formatWon(p.amount)].forEach(function (text, i) {
        var td = document.createElement("td");
        td.textContent = text;
        if (i === 3) td.className = "pay-amount";
        tr.appendChild(td);
      });
      var tdDel = document.createElement("td");
      var del = document.createElement("button");
      del.type = "button";
      del.className = "pd-del";
      del.textContent = "삭제";
      del.addEventListener("click", function () {
        if (!confirm(shortDate(p.date) + " " + formatWon(p.amount) + " 납입 내역을 삭제할까요?")) return;
        callApi("deletePayment", { paymentId: p.id })
          .then(function (rows) {
            rosterAllRows = rows;
            setStatus("삭제됨 · " + nowLabel());
            applyRosterView();
            renderPayDialog();
          })
          .catch(pdError);
      });
      tdDel.appendChild(del);
      tr.appendChild(tdDel);
      pdBody.appendChild(tr);
    });
  }

  // 팝업 안에 오류를 크게 보여준다 (화면 아래쪽 작은 글씨를 놓치지 않도록)
  function pdError(err) {
    console.error(err);
    var m = err && err.message ? err.message : "저장에 실패했어요.";
    if (/알 수 없는 요청/.test(m)) m += " → 서버(Apps Script)가 옛날 버전이에요. 새 코드를 붙여넣고 '배포 관리 → 새 버전'으로 다시 배포해 주세요.";
    pdMsg.textContent = "저장 실패: " + m;
    pdMsg.hidden = false;
    setStatus("오류: " + m, true);
  }

  function pdApply(rows, msg) {
    pdMsg.hidden = true;
    rosterAllRows = rows;
    setStatus(msg + " · " + nowLabel());
    applyRosterView();
    renderPayDialog();
  }

  bindMoneyInput(pdAmount);
  bindMoneyInput(pdFee);
  pdFee.addEventListener("focus", function () { var r = pdStudent(); pdFee.value = r && r.totalFee ? String(r.totalFee) : ""; });
  pdFee.addEventListener("change", function () {
    var fee = moneyVal(pdFee);
    callApi("updateStudentInfo", { studentId: pdStudentId, patch: { totalFee: fee } })
      .then(function (rows) { pdApply(rows, "저장됨"); })
      .catch(pdError);
  });
  pdFee.addEventListener("blur", function () { var r = pdStudent(); if (r) pdFee.value = r.totalFee ? formatWon(r.totalFee) : ""; });

  // 완불 체크 시: 남은 잔금을 금액 칸에 자동으로 채워 준다.
  pdPaidOff.addEventListener("change", function () {
    var r = pdStudent();
    if (pdPaidOff.checked && r && r.balance > 0 && !pdAmount.value) {
      pdAmount.value = Number(r.balance).toLocaleString("ko-KR");
    }
  });

  pdSave.addEventListener("click", function () {
    var r = pdStudent();
    if (!r) return;
    var amount = moneyVal(pdAmount);
    var markPaidOff = pdPaidOff.checked;
    if (amount <= 0 && !markPaidOff) { pdAmount.focus(); setStatus("납입 금액을 입력해 주세요.", true); return; }
    var memo = pdMemo.value.trim();
    if (!memo && amount > 0) {
      var n = (r.payments || []).length;
      var closesOut = markPaidOff || (r.totalFee > 0 && amount >= r.balance);
      memo = n === 0 ? (closesOut ? "전액" : "계약금") : (closesOut ? "잔금" : (n + 1) + "차");
    }
    pdSave.disabled = true;
    callApi("addPayment", {
      studentId: r.id, date: pdDate.value || todayStr(), amount: amount,
      method: pdMethod.value, memo: memo, markPaidOff: markPaidOff
    })
      .then(function (rows) {
        pdSave.disabled = false;
        pdAmount.value = "";
        pdMemo.value = "";
        pdPaidOff.checked = false;
        pdApply(rows, "납입 저장됨");
      })
      .catch(function (err) { pdSave.disabled = false; pdError(err); });
  });

  pdUnpaid.addEventListener("click", function () {
    callApi("updateStudentInfo", { studentId: pdStudentId, patch: { paidOff: false } })
      .then(function (rows) { pdApply(rows, "완불 취소됨"); })
      .catch(pdError);
  });
  document.getElementById("pdClose").addEventListener("click", function () { payDialog.close(); });

  /* ---------------------------------------------------------------- */
  /* 수강 신청서 출력 (A4)                                                */
  /* ---------------------------------------------------------------- */

  function escHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch];
    });
  }

  function dateKor(ymd) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd || "");
    return m ? m[1] + "년 " + Number(m[2]) + "월 " + Number(m[3]) + "일" : "";
  }

  // 교습 만료일 = 등록일로부터 2개월 (등록일 포함, 예: 9/28 등록 -> 11/27 까지)
  function endDateOf(ymd) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd || "");
    if (!m) return "";
    var first = new Date(+m[1], +m[2] - 1 + 2, 1);
    var lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    var end = new Date(first.getFullYear(), first.getMonth(), Math.min(+m[3], lastDay));
    end.setDate(end.getDate() - 1);
    return end.getFullYear() + "-" + String(end.getMonth() + 1).padStart(2, "0") + "-" + String(end.getDate()).padStart(2, "0");
  }

  // 대표 서명 이미지 (수강 확인서 하단에 들어감)
  var SIGN_IMG = "data:image/png;base64,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";

  function box(on) { return on ? "[ ✓ ]" : "[&nbsp;&nbsp;&nbsp;]"; }

  function usedMethods(s) {
    var o = {};
    (s.payments || []).forEach(function (p) { if (p.method) o[p.method] = true; });
    return o;
  }
  // 총 수강료가 있으면 그 금액, 없으면 지금까지 낸 금액
  function feeOf(s) {
    return Number(s.totalFee) || Number(s.paidTotal) || 0;
  }
  // 분납 내역 한 줄: "9/28(월) 계약금 100,000원 / 10/20(화) 잔금 180,000원"
  function installmentLineHtml(s) {
    var list = s.payments || [];
    if (!list.length) return "";
    var parts = list.map(function (p) {
      return escHtml(shortDate(p.date)) + " " + escHtml(p.memo || "") + " " + escHtml(Number(p.amount).toLocaleString("ko-KR")) + "원";
    });
    return '<p>납입 내역: ' + parts.join(" / ") + (s.balance > 0 ? ' <b>(잔금 ' + escHtml(Number(s.balance).toLocaleString("ko-KR")) + '원)</b>' : '') + '</p>';
  }

  // ① 실내운전교습 등록 신청서
  function buildApplicationHtml(s) {
    var used = usedMethods(s);
    var fee = feeOf(s);
    return ''
      + '<div class="form-page app-form">'
      + '<h1>실내운전교습 등록 신청서</h1>'
      + '<h2>[교습생 정보]</h2>'
      + '<div class="info-grid">'
      + '<p>성 명: ' + escHtml(s.name) + '</p>'
      + '<p>연락처: ' + escHtml(s.contact) + '</p>'
      + '<p>생년월일: </p>'
      + '<p>등록일자: ' + escHtml(dateKor(s.registeredDate)) + '</p>'
      + '<p class="span2">교습 만료일: ' + escHtml(dateKor(s.endDate || endDateOf(s.registeredDate))) + ' (등록일로부터 2개월)</p>'
      + '</div>'
      + '<h2>[수강 약관]</h2>'
      + '<div class="terms-cols">'
      + '<p class="art">제1조 (교습 기간 및 조건)</p>'
      + '<p>1.본 등록의 교습 기간은 등록일로부터 2개월이며, 교습소 영업일 기준 1일 최대 2시간 이용할 수 있습니다.</p>'
      + '<p>2.교습 만료일 이전이라도 수강생이 운전면허 자격증을 취득한 경우 교습 효력은 자동 종료됩니다.</p>'
      + '<p>3.개인의 운전 능력 차이, 연습량 또는 의지 부족 등으로 기간 내 면허를 취득하지 못한 경우 이는 수강생 본인의 귀책사유이며, 이에 따른 교습비 환불 및 이의제기는 불가합니다.</p>'
      + '<p class="art">제2조 (권리 양도 금지)</p>'
      + '<p>- 본 수강 권리는 제3자에게 양도, 대여, 매매할 수 없습니다.</p>'
      + '<p class="art">제3조 (교습소 수칙 및 원칙)</p>'
      + '<p>1.[음주·흡연 금지] 음주 후 연습은 금지되며 위반 시 즉시 중단됩니다. 음주 연습 재발 및 실내 흡연 수칙 위반 시 즉시 등록 취소(퇴정) 조치되며 환불되지 않습니다.</p>'
      + '<p>2.[면학 분위기 조성] 교습소 내 타인과의 다툼, 시비, 소란 행위 시 강제 퇴장 조치될 수 있습니다.</p>'
      + '<p class="art">제4조 (교습비 및 무상 서비스 특약)</p>'
      + '<p>1.본 교습비는 실내 시뮬레이터 시설 이용 및 교육에 대한 비용입니다. 수강생의 요청으로 지원되는 실차 연습은 교습비에 포함되지 않은 \'순수 무상 선택 서비스\'입니다.</p>'
      + '<p>2.실차 연습 이용 여부와 관계없이 교습비는 동일하게 유지되며, 이에 대한 추가 금전 대가는 요구되지 않습니다.</p>'
      + '<p class="art">제5조 (환불 규정)</p>'
      + '<p>1.[접수 후 24시간 이내] 수강 철회 및 환불 신청 시 납부한 교습비 전액을 환불합니다.</p>'
      + '<p>2.[교습소 귀책사유] 교습소의 객관적·중대한 과실로 정상 교습이 불가능한 경우 잔여 기간을 일할 계산하여 환불합니다.</p>'
      + '<p>3.접수 24시간 경과 후의 단순 변심, 제1조 제3항(기간 내 미취득), 제3조(수칙 위반)에 따른 등록 취소는 환불이 불가합니다.</p>'
      + '</div>'
      + '<div class="keep">'
      + '<h2>[중요 약관 필수 동의]</h2>'
      + '<p>1.[&nbsp;&nbsp;&nbsp;] 동의함 — (이용 조건 및 미취득 귀책 동의) 영업일 기준 1일 최대 2시간 이용 규칙을 숙지하였으며, 2개월 내 면허 미취득 시 수강생 귀책사유임에 동의합니다.</p>'
      + '<p>2.[&nbsp;&nbsp;&nbsp;] 동의함 — (무상 서비스 동의) 실차 연습은 교습비와 무관한 순수 무상 선택 서비스임을 확인하고 동의합니다.</p>'
      + '<p>3.[&nbsp;&nbsp;&nbsp;] 동의함 — (안전 및 퇴정 수칙 동의) 음주·실내 흡연 금지 및 소란 행위 시 등록 취소(환불 불가) 규정에 동의합니다.</p>'
      + '</div>'
      + '<div class="keep">'
      + '<h2>[결제 및 영수 확인]</h2>'
      + '<p>총 교습비: ' + (fee ? '<b>' + escHtml(Number(fee).toLocaleString("ko-KR")) + '</b>' : '___________________') + ' 원</p>'
      + '<p>결제 수단: ' + box(used["카드"]) + ' 카드 &nbsp;/&nbsp; ' + box(used["계좌이체"]) + ' 계좌이체 &nbsp;/&nbsp; ' + box(used["현금"]) + ' 현금 &nbsp;/&nbsp; ' + box(false) + ' 기타 (&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;)</p>'
      + installmentLineHtml(s)
      + '<p class="gap">위 교습비를 정식 영수하였으며, 본인은 위 수강 약관을 충분히 숙지하고 동의하여 실내운전교습 등록을 신청합니다.</p>'
      + '<p class="center gap">' + escHtml(dateKor(s.registeredDate)) + '</p>'
      + '<p class="gap">신청인(수강생): ' + escHtml(s.name) + ' ___________________ (인/서명)</p>'
      + '<p>교습소명: 차샘 운전교실</p>'
      + '<p>대표자: 이석재 (인/서명)</p>'
      + '</div>'
      + '</div>';
  }

  // ② 실내 운전 수강 확인서
  function buildCertificateHtml(s) {
    var period = dateKor(s.registeredDate) + "~" + dateKor(s.endDate || endDateOf(s.registeredDate));
    return ''
      + '<div class="form-page cert-form">'
      + '<h1>실내 운전 수강 확인서</h1>'
      + '<table class="cert-table cert-top"><tr><th>수강생 성함</th><td>' + escHtml(s.name) + '</td><th>수강생 연락처</th><td>' + escHtml(s.contact) + '</td></tr></table>'
      + '<table class="cert-table cert-main">'
      + '<tr><th>발급처</th><td><b><u>차샘 운전교실</u></b></td></tr>'
      + '<tr><th>과정명</th><td>운전면허 취득</td></tr>'
      + '<tr><th>수업내용</th><td>실내 시뮬레이션 연습</td></tr>'
      + '<tr><th>수강기간</th><td>' + escHtml(period) + '</td></tr>'
      + '<tr><th>교육비 결제금액</th><td>' + (feeOf(s) ? escHtml(Number(feeOf(s)).toLocaleString("ko-KR")) : '') + ' 원'
      + (s.balance > 0 ? '<br><small>(납입 ' + escHtml(Number(s.paidTotal).toLocaleString("ko-KR")) + '원 · 잔금 ' + escHtml(Number(s.balance).toLocaleString("ko-KR")) + '원)</small>' : '')
      + '</td></tr>'
      + '</table>'
      + '<div class="cert-terms">'
      + '<p class="art">[수강 약관]</p>'
      + '<p>(교습 기간 및 조건)</p>'
      + '<p>1.본 등록의 교습 기간은 등록일로부터 2개월이며, 교습소 영업일 기준 1일 최대 2시간 이용할 수 있습니다.</p>'
      + '<p>2.교습 만료일 이전이라도 수강생이 운전면허 자격증을 취득한 경우 교습 효력은 자동 종료됩니다.</p>'
      + '<p>3.개인의 운전 능력 차이, 연습량 또는 의지 부족 등으로 기간 내 면허를 취득하지 못한 경우 이는 수강생 본인의 귀책 사유이며, 이에 따른 교습비 환불 및 이의제기는 불가합니다.</p>'
      + '<p class="gap">(교습소 수칙 및 원칙)</p>'
      + '<p>1.[음주·흡연 금지] 음주 후 연습은 금지되며 위반 시 즉시 중단됩니다. 음주 연습 재발 및 실내 흡연 수칙 위반 시 즉시 등록 취소(퇴정) 조치되며 환불되지 않습니다.</p>'
      + '<p>2.[면학 분위기 조성] 교습소 내 타인과의 다툼, 시비, 소란 행위 시 강제 퇴장 조치될 수 있습니다.</p>'
      + '</div>'
      + '<p class="cert-date">' + escHtml(dateKor(s.registeredDate)) + '</p>'
      + '<p class="cert-sign">대표: 이 석 재 <img src="' + SIGN_IMG + '" alt=""></p>'
      + '</div>';
  }

  // ③ 수강생에게 주는 실력 리포트: 최근점수 / 이전점수 / 향상도 / 현재레벨 / 강사메모만 담는다.
  function buildReportHtml(s) {
    var recent = s.recentScore == null ? "-" : s.recentScore + "점";
    var prev = s.prevScore == null ? "-" : s.prevScore + "점";
    var delta, deltaCls = "flat";
    if (s.sessionCount >= 2 && s.delta != null) {
      if (s.delta > 0) { delta = "▲ +" + s.delta + "점"; deltaCls = "up"; }
      else if (s.delta < 0) { delta = "▼ " + s.delta + "점"; deltaCls = "down"; }
      else delta = "변화 없음";
    } else {
      delta = "첫 평가";
    }
    var memo = String(s.memo || "").trim();
    return ''
      + '<div class="form-page report-form">'
      + '<div class="rp-brand">차샘 운전교실</div>'
      + '<h1>실력 향상 리포트</h1>'
      + '<p class="rp-meta"><b>' + escHtml(s.name) + '</b> 수강생 &nbsp;·&nbsp; ' + escHtml(dateKor(todayStr())) + '</p>'
      + '<table class="rp-table"><tr>'
      + '<th>최근 점수</th><th>이전 점수</th><th>향상도</th><th>현재 레벨</th></tr><tr>'
      + '<td>' + escHtml(recent) + '</td><td>' + escHtml(prev) + '</td>'
      + '<td class="rp-' + deltaCls + '">' + escHtml(delta) + '</td><td>' + escHtml(s.level || "-") + '</td>'
      + '</tr></table>'
      + '<div class="rp-memo"><div class="rp-memo-title">강사 메모</div>'
      + '<div class="rp-memo-body ' + (memo.length > 2400 ? "m4" : memo.length > 1500 ? "m3" : memo.length > 900 ? "m2" : memo.length > 500 ? "m1" : "") + '">' + (memo ? escHtml(memo).replace(/\n/g, "<br>") : "&nbsp;") + '</div></div>'
      + '</div>';
  }

  // which = { application, certificate, report } - 선택한 서류를 한 번에 인쇄한다.
  function printDocs(student, which) {
    var html = "";
    if (which.report) html += buildReportHtml(student);
    if (which.application) html += buildApplicationHtml(student);
    if (which.certificate) html += buildCertificateHtml(student);
    if (!html) return;
    printAreaEl.innerHTML = html;
    var imgs = Array.prototype.slice.call(printAreaEl.querySelectorAll("img"));
    Promise.all(imgs.map(function (im) {
      return im.decode ? im.decode().catch(function () {}) : Promise.resolve();
    })).then(function () { setTimeout(function () { window.print(); }, 50); });
  }

  // 수강생 삭제: 회차 평가 기록과 납입 내역까지 함께 지워지므로 한 번 더 확인한다.
  function deleteStudentRow(r) {
    var msg = '"' + r.name + '" 수강생을 삭제할까요?\n\n'
      + '이 수강생의 회차 평가 기록 ' + (r.sessionCount || 0) + '회, 납입 내역 ' + ((r.payments || []).length) + '건도 모두 함께 삭제되며 되돌릴 수 없어요.';
    if (!confirm(msg)) return;
    setStatus("삭제 중…");
    callApi("deleteStudent", { studentId: r.id })
      .then(function (rows) {
        rosterAllRows = rows;
        if (currentStudentId === r.id) currentStudentId = null;
        setStatus("삭제됨 · " + nowLabel());
        applyRosterView();
        refreshStudentSelect();
      })
      .catch(onError);
  }

  function makeEditableCell(studentId, field, value, type, placeholder, isMemo) {
    var td = document.createElement("td");
    if (field === "name") td.className = "name";
    var input = document.createElement("input");
    input.type = type;
    input.className = "cell-input" + (isMemo ? " cell-memo" : "");
    input.value = value || "";
    if (placeholder) input.placeholder = placeholder;
    input.addEventListener("change", function () {
      if (field === "name" && !input.value.trim()) {
        input.value = value;
        setStatus("이름은 비워둘 수 없어요.", true);
        return;
      }
      var patch = {};
      patch[field] = input.value;
      for (var li = 0; li < rosterAllRows.length; li++) {
        if (rosterAllRows[li].id === studentId) { rosterAllRows[li][field] = input.value; break; }
      }
      callApi("updateStudentInfo", { studentId: studentId, patch: patch })
        .then(function () {
          setStatus("저장됨 · " + nowLabel());
          if (field === "name") refreshStudentSelect();
        })
        .catch(onError);
    });
    td.appendChild(input);
    return td;
  }

  addStudentBtn.addEventListener("click", function () {
    var name = newStudentName.value.trim();
    if (!name) { newStudentName.focus(); return; }
    addStudentBtn.disabled = true;
    setStatus("수강생 등록 중…");
    var fee = moneyVal(newStudentFee);
    var amount = moneyVal(newStudentAmount);
    var paidOff = newStudentPaidOff.checked;
    if (paidOff && !amount && fee) amount = fee; // 완불인데 금액을 안 적었으면 총 수강료 전액으로
    callApi("addStudent", {
      name: name,
      contact: newStudentContact.value.trim(),
      registeredDate: newStudentDate.value,
      endDate: newStudentEnd.value,
      totalFee: fee,
      paymentAmount: amount,
      paymentMethod: newStudentMethod.value,
      paidOff: paidOff
    })
      .then(function (newStudent) {
        addStudentBtn.disabled = false;
        newStudentName.value = "";
        newStudentContact.value = "";
        newStudentFee.value = "";
        newStudentAmount.value = "";
        newStudentPaidOff.checked = false;
        newStudentDate.value = todayStr();
        newStudentEnd.dataset.manual = "";
        newStudentEnd.value = endDateOf(newStudentDate.value);
        setStatus("등록됨 · " + nowLabel());
        if (printAppOnAdd.checked || printCertOnAdd.checked) {
          printDocs(newStudent, { application: printAppOnAdd.checked, certificate: printCertOnAdd.checked });
        }

        // 등록한 수강생이 검색/페이지에 가려 안 보이는 일이 없도록 명단 보기를 초기화한다.
        rosterSearchEl.value = "";
        rosterPage = 1;
        refreshRoster();

        // 회차별 평가 탭도 방금 등록한 수강생으로 바로 전환해서 이어서 점수를 입력할 수 있게 한다.
        return callApi("getStudents").then(function (students) {
          allStudentsForSelect = students;
          studentSearchEl.value = "";
          chartStudentSearchEl.value = "";
          populateStudentSelect(false);
          studentSelect.value = newStudent.id;
          chartStudentSelectEl.value = newStudent.id;
          loadStudent(newStudent.id);
        });
      })
      .catch(function (err) { addStudentBtn.disabled = false; onError(err); });
  });
  newStudentName.addEventListener("keydown", function (e) { if (e.key === "Enter") addStudentBtn.click(); });
  bindMoneyInput(newStudentFee);
  bindMoneyInput(newStudentAmount);
  // 완불을 체크하면 오늘 받은 금액 칸에 총 수강료를 자동으로 채워 준다.
  newStudentPaidOff.addEventListener("change", function () {
    var fee = moneyVal(newStudentFee);
    if (newStudentPaidOff.checked && fee && !newStudentAmount.value) {
      newStudentAmount.value = fee.toLocaleString("ko-KR");
    }
  });

  /* ---------------------------------------------------------------- */
  /* 탭 2: 회차별 평가                                                   */
  /* ---------------------------------------------------------------- */

  var allStudentsForSelect = [];

  function refreshStudentSelect() {
    callApi("getStudents")
      .then(function (students) {
        allStudentsForSelect = students;
        populateStudentSelect(true);
      })
      .catch(onError);
  }

  function filterStudents(rawTerm) {
    var term = rawTerm.trim().toLowerCase();
    return term
      ? allStudentsForSelect.filter(function (s) { return s.name.toLowerCase().indexOf(term) !== -1; })
      : allStudentsForSelect;
  }

  function fillOptions(selectEl, list) {
    selectEl.innerHTML = "";
    list.forEach(function (s) {
      var opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.name;
      selectEl.appendChild(opt);
    });
  }

  // 검색어로 걸러진 학생만 드롭다운에 보여준다 (회차별 평가 탭 / 개인별 그래프 탭 두 선택 상자를 함께 채운다).
  // 학생이 많아져도 스크롤 없이 이름으로 바로 찾을 수 있다.
  // autoLoad가 true일 때만(첫 로드 등) 자동으로 하나를 선택해 데이터를 불러온다 - 검색 중엔 목록만 좁혀지고
  // 실제 선택은 사용자가 옵션을 고를 때(=change 이벤트) 이루어진다.
  function populateStudentSelect(autoLoad) {
    var filteredMain = filterStudents(studentSearchEl.value);
    var filteredChart = filterStudents(chartStudentSearchEl.value);
    fillOptions(studentSelect, filteredMain);
    fillOptions(chartStudentSelectEl, filteredChart);

    if (!allStudentsForSelect.length) {
      setStatus("등록된 수강생이 없어요. 수강생 관리 탭에서 먼저 추가해 주세요.");
      return;
    }

    var alreadyCurrent = allStudentsForSelect.some(function (s) { return s.id === currentStudentId; });
    if (alreadyCurrent) {
      if (filteredMain.some(function (s) { return s.id === currentStudentId; })) studentSelect.value = currentStudentId;
      if (filteredChart.some(function (s) { return s.id === currentStudentId; })) chartStudentSelectEl.value = currentStudentId;
      return;
    }

    if (!autoLoad) {
      // 검색해서 목록만 좁히는 중이면, 강제로 다른 학생을 불러오지 않고 눈에 보이는 첫 항목만 선택 표시해 둔다.
      if (filteredMain.length) studentSelect.value = filteredMain[0].id;
      if (filteredChart.length) chartStudentSelectEl.value = filteredChart[0].id;
      return;
    }

    var remembered = null;
    try { remembered = localStorage.getItem(LAST_STUDENT_KEY); } catch (e) {}
    var target = allStudentsForSelect.some(function (s) { return s.id === remembered; })
      ? remembered
      : allStudentsForSelect[0].id;
    studentSelect.value = target;
    chartStudentSelectEl.value = target;
    loadStudent(target);
  }

  studentSearchEl.addEventListener("input", function () { populateStudentSelect(false); });
  studentSelect.addEventListener("change", function () {
    chartStudentSelectEl.value = studentSelect.value;
    loadStudent(studentSelect.value);
  });

  chartStudentSearchEl.addEventListener("input", function () { populateStudentSelect(false); });
  chartStudentSelectEl.addEventListener("change", function () {
    studentSelect.value = chartStudentSelectEl.value;
    loadStudent(chartStudentSelectEl.value);
  });

  function loadStudent(studentId) {
    currentStudentId = studentId;
    try { localStorage.setItem(LAST_STUDENT_KEY, studentId); } catch (e) {}
    editingSessionId = null;
    editBannerEl.hidden = true;
    saveSessionBtn.textContent = "이번 회차 저장";
    setStatus("불러오는 중…");
    callApi("getStudentSummary", { studentId: studentId }).then(onSummary).catch(onError);
    callApi("getSessions", { studentId: studentId }).then(onSessions).catch(onError);
  }

  function onSummary(summary) {
    currentSummary = summary;

    document.getElementById("reportAvg").textContent = summary.hasSessions ? summary.overall + "점" : "-";
    document.getElementById("reportPrev").textContent = summary.prevScore == null ? "-" : summary.prevScore + "점";
    document.getElementById("reportLevel").textContent = summary.level;
    document.getElementById("reportSessionCount").textContent = summary.sessionCount;
    document.getElementById("nextSessionNo").textContent = summary.nextSessionNo;

    var deltaEl = document.getElementById("reportDelta");
    if (summary.delta === null || summary.delta === undefined) {
      deltaEl.textContent = "첫 평가";
      deltaEl.className = "field-value delta-flat";
    } else if (summary.delta > 0) {
      deltaEl.textContent = "▲ +" + summary.delta + "점";
      deltaEl.className = "field-value delta-up";
    } else if (summary.delta < 0) {
      deltaEl.textContent = "▼ " + summary.delta + "점";
      deltaEl.className = "field-value delta-down";
    } else {
      deltaEl.textContent = "변화 없음";
      deltaEl.className = "field-value delta-flat";
    }

    renderReportTable(summary.items, summary.hasSessions);
    renderFocus(summary);
    renderSessionForm(summary.items);
    focusMemoEl.value = summary.student.memo || "";
    focusMemoStatusEl.textContent = "";
    setStatus("마지막 갱신: " + nowLabel());
  }

  var itemBarCourseEl = document.getElementById("itemBarCourse");
  var itemBarRoadEl = document.getElementById("itemBarRoad");
  var itemBarPeriodLabelEl = document.getElementById("itemBarPeriodLabel");

  // 일/주/월 중 선택된 단위의 "가장 최근 구간"에 속한 회차들의 항목별 평균을 계산한다.
  function latestBucketItemAverages(chrono, granularity) {
    var last = chrono[chrono.length - 1];
    var key = bucketKeyOf(last.date, granularity);
    var matching = chrono.filter(function (s) { return bucketKeyOf(s.date, granularity) === key; });
    var sums = {};
    ITEM_META.forEach(function (m) { sums[m.id] = 0; });
    matching.forEach(function (s) {
      ITEM_META.forEach(function (m) { sums[m.id] += (s.items[m.id] || 0); });
    });
    var avgs = {};
    ITEM_META.forEach(function (m) { avgs[m.id] = Math.round(sums[m.id] / matching.length); });
    return avgs;
  }

  function updateItemBarChart() {
    if (!historyAllSessions.length) {
      itemBarCourseEl.innerHTML = '<p class="chart-empty">아직 기록이 없어요.</p>';
      itemBarRoadEl.innerHTML = "";
      itemBarPeriodLabelEl.textContent = "";
      return;
    }
    var chrono = historyAllSessions.slice().reverse();
    var avgs = latestBucketItemAverages(chrono, chartGranularity);
    var items = ITEM_META.map(function (m) { return { id: m.id, label: m.label, group: m.group, value: avgs[m.id] }; });
    var periodText = chartGranularity === "day" ? "일평균" : chartGranularity === "week" ? "주평균" : "월평균";
    itemBarPeriodLabelEl.textContent = periodText;
    renderItemBarChart(items);
  }

  // 10개 항목을 나란히 놓아, 뭘 잘하고 뭘 더 연습해야 할지 한눈에 보여준다.
  function renderItemBarChart(items) {
    itemBarCourseEl.innerHTML = "";
    itemBarRoadEl.innerHTML = "";
    items.forEach(function (item) {
      var row = document.createElement("div");
      row.className = "item-bar-row";

      var label = document.createElement("div");
      label.className = "item-bar-label";
      label.textContent = item.label;

      var track = document.createElement("div");
      track.className = "item-bar-track";
      var fill = document.createElement("div");
      fill.className = "item-bar-fill " + tierClass(item.value);
      fill.style.width = Math.max(0, Math.min(100, item.value)) + "%";
      track.appendChild(fill);

      var value = document.createElement("div");
      value.className = "item-bar-value";
      value.textContent = item.value > 0 ? item.value : "-";

      row.appendChild(label);
      row.appendChild(track);
      row.appendChild(value);

      (item.group === "course" ? itemBarCourseEl : itemBarRoadEl).appendChild(row);
    });
  }

  var focusMemoEl = document.getElementById("focusMemo");
  var focusMemoStatusEl = document.getElementById("focusMemoStatus");
  var focusMemoTimer = null;

  // 선택한 수강생의 성적표 출력
  document.getElementById("reportPrintBtn").addEventListener("click", function () {
    var row = null;
    for (var i = 0; i < rosterAllRows.length; i++) {
      if (rosterAllRows[i].id === currentStudentId) { row = rosterAllRows[i]; break; }
    }
    if (!row) { setStatus("수강생 정보를 불러오는 중이에요. 잠시 후 다시 눌러 주세요.", true); return; }
    printDocs(row, { report: true });
  });

  focusMemoEl.addEventListener("input", function () {
    focusMemoStatusEl.textContent = "저장 중…";
    // 저장이 끝나기 전에 성적표를 출력해도 방금 쓴 메모가 나오도록 로컬 데이터에도 바로 반영
    for (var mi = 0; mi < rosterAllRows.length; mi++) {
      if (rosterAllRows[mi].id === currentStudentId) { rosterAllRows[mi].memo = focusMemoEl.value; break; }
    }
    if (focusMemoTimer) clearTimeout(focusMemoTimer);
    focusMemoTimer = setTimeout(function () {
      if (!currentStudentId) return;
      callApi("updateStudentInfo", { studentId: currentStudentId, patch: { memo: focusMemoEl.value } })
        .then(function () {
          focusMemoStatusEl.textContent = "저장됨 · " + nowLabel();
          refreshRoster();
        })
        .catch(onError);
    }, 700);
  });

  function renderReportTable(items, hasSessions) {
    var tbody = document.getElementById("reportTableBody");
    tbody.innerHTML = "";
    items.forEach(function (item) {
      var tr = document.createElement("tr");
      if (!hasSessions) {
        tr.innerHTML = "<td>" + item.label + '</td><td class="muted">-</td><td class="muted">-</td>';
      } else {
        tr.innerHTML =
          "<td>" + item.label + "</td>" +
          '<td class="score">' + scoreChip(item.value) + "</td>" +
          "<td>" + tierLabel(item.value) + "</td>";
      }
      tbody.appendChild(tr);
    });
  }

  function renderFocus(summary) {
    var focusBody = document.getElementById("focusBody");
    if (!summary.hasSessions) {
      focusBody.innerHTML = "<p>아직 입력된 회차가 없어요. 아래 '새 회차 입력'에서 첫 평가를 남겨 보세요.</p>";
      return;
    }
    if (!summary.needsWork.length) {
      focusBody.innerHTML = "<p>가장 최근 회차 기준, 시도한 항목이 모두 능숙 단계예요.</p>";
      return;
    }
    var labels = ["우선 연습", "다음 연습", "세 번째 연습"];
    var html = "<ol>";
    summary.needsWork.forEach(function (item, idx) {
      html += "<li>" + labels[idx] + ": <b>" + item.label + "</b> (" + item.value.toFixed(1) + "점)</li>";
    });
    html += "</ol>";
    focusBody.innerHTML = html;
  }

  /* ------------------------- 새 회차 입력 폼 -------------------------- */

  function renderSessionForm(items) {
    courseRowsEl.innerHTML = "";
    roadRowsEl.innerHTML = "";
    sessionInputs = {};
    items.forEach(function (item) {
      var row = buildSessionRow(item);
      (item.group === "course" ? courseRowsEl : roadRowsEl).appendChild(row);
    });
    updatePreviewTotal();
  }

  var TIER_VAR = { "tier-master": "--good", "tier-ok": "--tier-ok", "tier-practice": "--warn", "tier-focus": "--bad" };
  function tierColor(v) {
    return getComputedStyle(document.body).getPropertyValue(TIER_VAR[tierClass(v)]).trim();
  }

  function buildSessionRow(item) {
    var row = document.createElement("div");
    row.className = "row";

    var label = document.createElement("div");
    label.className = "row-label";
    label.textContent = item.label;

    // 손가락으로 드래그해서 점수를 조절하는 슬라이더 (숫자 입력칸과 값이 서로 맞물려 있음)
    var range = document.createElement("input");
    range.type = "range";
    range.className = "tier-range";
    range.min = "0";
    range.max = "100";
    range.step = "5";
    range.value = item.value;
    range.setAttribute("aria-label", item.label + " 점수 슬라이더");

    var input = document.createElement("input");
    input.type = "number";
    input.className = "score-input";
    input.min = "0";
    input.max = "100";
    input.step = "5";
    input.value = item.value;
    input.setAttribute("aria-label", item.label + " 점수 입력");

    function paint(v) {
      var tier = tierClass(v);
      var color = tierColor(v);
      range.style.setProperty("--fill-color", color);
      range.style.background = "linear-gradient(to right, " + color + " " + v + "%, var(--surface-2) " + v + "%)";
      input.className = "score-input " + tier;
    }
    paint(item.value);

    range.addEventListener("input", function () {
      var v = clampScore(range.value);
      input.value = v;
      paint(v);
      updatePreviewTotal();
    });

    input.addEventListener("input", function () {
      var v = clampScore(input.value);
      range.value = v;
      paint(v);
      updatePreviewTotal();
    });
    input.addEventListener("blur", function () {
      input.value = clampScore(input.value);
      updatePreviewTotal();
    });

    row.appendChild(label);
    row.appendChild(range);
    row.appendChild(input);
    sessionInputs[item.id] = input;
    return row;
  }

  function updatePreviewTotal() {
    var ids = Object.keys(sessionInputs);
    if (!ids.length) { document.getElementById("previewTotal").textContent = "0"; return; }
    var sum = 0;
    ids.forEach(function (id) { sum += clampScore(sessionInputs[id].value); });
    document.getElementById("previewTotal").textContent = Math.round(sum / ids.length);
  }

  saveSessionBtn.addEventListener("click", function () {
    if (!currentStudentId) return;
    var itemScores = {};
    Object.keys(sessionInputs).forEach(function (id) { itemScores[id] = clampScore(sessionInputs[id].value); });
    var dateStr = sessionDateEl.value || todayStr();

    saveSessionBtn.disabled = true;
    setStatus(editingSessionId ? "수정 저장 중…" : "저장 중…");
    var wasEditing = editingSessionId;

    var action = wasEditing ? "updateSession" : "addSession";
    var data = wasEditing
      ? { sessionId: wasEditing, studentId: currentStudentId, date: dateStr, itemScores: itemScores }
      : { studentId: currentStudentId, date: dateStr, itemScores: itemScores };

    callApi(action, data)
      .then(function (result) {
        saveSessionBtn.disabled = false;
        onSummary(result.summary);
        onSessions(result.sessions);
        refreshRoster();
        setStatus((wasEditing ? "회차를 수정했어요" : "회차가 저장됐어요") + " · " + nowLabel());
        if (wasEditing) cancelEdit();
      })
      .catch(function (err) { saveSessionBtn.disabled = false; onError(err); });
  });

  var sessionFormLabelEl = document.getElementById("sessionFormLabel");
  var nextSessionNoEl = document.getElementById("nextSessionNo");

  function startEditSession(session) {
    editingSessionId = session.sessionId;
    sessionDateEl.value = session.date;
    Object.keys(sessionInputs).forEach(function (id) {
      var input = sessionInputs[id];
      input.value = session.items[id] || 0;
      input.dispatchEvent(new Event("input"));
    });
    editBannerTextEl.textContent = session.sessionNo + "회차를 수정하고 있어요.";
    editBannerEl.hidden = false;
    saveSessionBtn.textContent = session.sessionNo + "회차 수정 저장";
    sessionFormLabelEl.textContent = "회차 수정";
    nextSessionNoEl.textContent = session.sessionNo;
    document.getElementById("sessionFormGroup").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function cancelEdit() {
    editingSessionId = null;
    editBannerEl.hidden = true;
    saveSessionBtn.textContent = "이번 회차 저장";
    sessionFormLabelEl.textContent = "새 회차 입력";
    if (currentSummary) {
      nextSessionNoEl.textContent = currentSummary.nextSessionNo;
      sessionDateEl.value = todayStr();
      renderSessionForm(currentSummary.items);
    }
  }

  cancelEditBtn.addEventListener("click", cancelEdit);

  deleteLastBtn.addEventListener("click", function () {
    if (!currentStudentId || !currentSummary || !currentSummary.hasSessions) return;
    var ok = window.confirm(
      currentSummary.student.name + " 님의 " + currentSummary.sessionCount + "회차 기록을 삭제할까요? 이전 회차는 그대로 남습니다."
    );
    if (!ok) return;

    deleteLastBtn.disabled = true;
    setStatus("삭제 중…");
    callApi("deleteLastSession", { studentId: currentStudentId })
      .then(function (result) {
        deleteLastBtn.disabled = false;
        onSummary(result.summary);
        onSessions(result.sessions);
        refreshRoster();
        setStatus("삭제했어요 · " + nowLabel());
      })
      .catch(function (err) { deleteLastBtn.disabled = false; onError(err); });
  });

  /* ------------------------------ 수업 이력 --------------------------- */

  function renderHistoryHeader() {
    var tr = document.createElement("tr");
    ["수업일", "회차"].concat(ITEM_META.map(function (i) { return i.label; }), ["종합점수", "이전점수", ""])
      .forEach(function (h) {
        var th = document.createElement("th");
        th.textContent = h;
        tr.appendChild(th);
      });
    historyHeadEl.innerHTML = "";
    historyHeadEl.appendChild(tr);
  }

  function onSessions(sessions) {
    historyAllSessions = sessions;
    historyPage = 1; // 새로 불러오거나 저장/삭제한 뒤에는 최신 회차가 있는 첫 페이지부터 보여준다
    applyHistoryView();
    updateChart();
    updateItemBarChart();
  }

  var sessionChartWrapEl = document.getElementById("sessionChartWrap");
  var chartGranularityEl = document.getElementById("chartGranularity");
  var chartMetricSelectEl = document.getElementById("chartMetricSelect");
  var chartGranularity = "day"; // 'day' | 'week' | 'month'
  var chartMetric = "total";    // 'total' 또는 ITEM_META의 항목 id (종목별 보기)

  // 종목(항목) 선택지를 한 번만 채워둔다.
  ITEM_META.forEach(function (item) {
    var opt = document.createElement("option");
    opt.value = item.id;
    opt.textContent = item.label;
    chartMetricSelectEl.appendChild(opt);
  });

  Array.prototype.slice.call(chartGranularityEl.querySelectorAll(".gran-btn")).forEach(function (btn) {
    btn.addEventListener("click", function () {
      chartGranularity = btn.dataset.gran;
      Array.prototype.slice.call(chartGranularityEl.querySelectorAll(".gran-btn")).forEach(function (b) {
        b.classList.toggle("is-active", b === btn);
      });
      updateChart();
      updateItemBarChart();
    });
  });
  chartMetricSelectEl.addEventListener("change", function () {
    chartMetric = chartMetricSelectEl.value;
    updateChart();
  });

  function metricLabel(metric) {
    if (metric === "total") return "종합점수";
    var found = ITEM_META.filter(function (i) { return i.id === metric; })[0];
    return found ? found.label : metric;
  }

  // 수업일 기준으로 일/주(월요일 시작)/월 단위 구간 키를 만든다.
  function bucketKeyOf(dateStr, granularity) {
    if (granularity === "day") return dateStr;
    if (granularity === "month") return dateStr.slice(0, 7);
    var d = new Date(dateStr + "T00:00:00");
    var dow = d.getDay(); // 0=일 ... 6=토
    var diffToMonday = dow === 0 ? -6 : 1 - dow;
    d.setDate(d.getDate() + diffToMonday);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  // 회차의 날짜(YYYY-MM-DD)를 "M/D" 라벨로 바꾼다.
  function bucketLabelOf(dateStr) {
    var parts = dateStr.split("-");
    return Number(parts[1]) + "/" + Number(parts[2]);
  }

  var CHART_PERIOD_LABEL = { day: "최근 1일 · 회차별", week: "최근 7일 · 회차별", month: "이번 달 · 회차별" };
  var chartPeriodLabelEl = document.getElementById("chartPeriodLabel");

  // "일"은 가장 최근 체크된 하루에 있었던 회차를 전부 그대로 보여준다(평균 안 냄).
  // "주"(최근 7일)/"월"(이번 달)은 범위가 넓어지니, 같은 날짜에 회차가 여러 개면 하루 단위로
  // 평균 내서 하루에 점 하나로 보여준다.
  function updateChart() {
    chartPeriodLabelEl.textContent = CHART_PERIOD_LABEL[chartGranularity];
    if (!historyAllSessions.length) {
      sessionChartWrapEl.innerHTML = '<p class="chart-empty">아직 그래프로 보여줄 회차 기록이 없어요.</p>';
      return;
    }
    var chrono = historyAllSessions.slice().reverse(); // historyAllSessions는 최신이 먼저라, 그래프는 시간순(왼쪽->오른쪽)으로 그린다
    var points;
    if (chartGranularity === "day") {
      var todaysSessions = latestPeriodSessions(chrono, "day");
      points = todaysSessions.map(function (s) {
        var val = chartMetric === "total" ? s.total : (s.items[chartMetric] || 0);
        return { label: s.sessionNo + "회차", value: val };
      });
    } else {
      var scoped = chartGranularity === "week" ? lastNDaysSessions(chrono, 7) : latestPeriodSessions(chrono, "month");
      points = groupByDayAverage(scoped, chartMetric);
    }
    renderSessionChart(points, metricLabel(chartMetric));
  }

  // 가장 최근 회차가 속한 하루(day) 또는 이번 달(month)에 속하는 회차만 골라낸다.
  function latestPeriodSessions(chrono, granularity) {
    var last = chrono[chrono.length - 1];
    var periodKey = bucketKeyOf(last.date, granularity);
    return chrono.filter(function (s) { return bucketKeyOf(s.date, granularity) === periodKey; });
  }

  // 같은 날짜에 회차가 여러 개면 평균을 내서, 날짜 하나당 점 하나만 만든다.
  function groupByDayAverage(sessions, metric) {
    var buckets = {};
    sessions.forEach(function (s) {
      if (!buckets[s.date]) buckets[s.date] = { sum: 0, count: 0 };
      var val = metric === "total" ? s.total : (s.items[metric] || 0);
      buckets[s.date].sum += val;
      buckets[s.date].count += 1;
    });
    return Object.keys(buckets).sort().map(function (date) {
      var b = buckets[date];
      return { label: bucketLabelOf(date), value: Math.round(b.sum / b.count) };
    });
  }

  // 가장 최근 회차 날짜로부터 최근 N일(오늘 포함) 안에 속하는 회차만 골라낸다.
  function lastNDaysSessions(chrono, days) {
    var last = chrono[chrono.length - 1];
    var lastDate = new Date(last.date + "T00:00:00");
    var startDate = new Date(lastDate);
    startDate.setDate(lastDate.getDate() - (days - 1));
    return chrono.filter(function (s) {
      var d = new Date(s.date + "T00:00:00");
      return d >= startDate && d <= lastDate;
    });
  }

  // 집계된 {label, value} 목록을 가벼운 SVG 선 그래프로 그린다.
  // viewBox 자체를 좁게 잡아서(480), 화면 폭이 좁은 모바일에서도 글자가 실제로 크게 렌더링되게 한다
  // (SVG는 폭 100%로 늘어나므로, viewBox가 좁을수록 같은 font-size 숫자가 더 크게 보인다).
  function renderSessionChart(points, seriesLabel) {
    var w = 480, h = 320, padL = 48, padR = 16, padT = 46, padB = 40;
    var plotW = w - padL - padR, plotH = h - padT - padB;
    var n = points.length;
    // 점이 많아질수록(월별 회차가 많을 때) 숫자 크기를 줄여서 서로 겹치지 않게 한다.
    var valueFontSize = n > 10 ? Math.max(14, 24 - (n - 10) * 1.2) : 24;

    function xAt(i) { return padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW); }
    function yAt(v) { return padT + plotH - (v / 100) * plotH; }

    var grid = [0, 25, 50, 75, 100].map(function (v) {
      return '<line x1="' + padL + '" y1="' + yAt(v) + '" x2="' + (w - padR) + '" y2="' + yAt(v) +
        '" stroke="var(--line)" stroke-width="1"/>' +
        '<text x="' + (padL - 8) + '" y="' + (yAt(v) + 7) + '" font-size="21" fill="var(--ink-muted)" text-anchor="end">' + v + '</text>';
    }).join("");

    var linePoints = points.map(function (p, i) { return xAt(i) + "," + yAt(p.value); }).join(" ");
    var areaPoints = xAt(0) + "," + yAt(0) + " " + linePoints + " " + xAt(n - 1) + "," + yAt(0);

    var dots = points.map(function (p, i) {
      return '<circle cx="' + xAt(i) + '" cy="' + yAt(p.value) + '" r="6" fill="' + tierColor(p.value) +
        '" stroke="var(--surface)" stroke-width="2"/>';
    }).join("");

    // 각 점 위에 실제 점수를 직접 크게 써준다 (0/100처럼 위쪽 공간이 부족한 값은 점 아래로 내려서 표시)
    var valueLabels = points.map(function (p, i) {
      var above = p.value < 88;
      var ly = above ? yAt(p.value) - valueFontSize * 0.6 : yAt(p.value) + valueFontSize * 1.1;
      return '<text x="' + xAt(i) + '" y="' + ly + '" font-size="' + valueFontSize + '" font-weight="800" fill="var(--ink)" text-anchor="middle">' + p.value + '</text>';
    }).join("");

    var everyNth = Math.max(1, Math.ceil(n / 10));
    var xLabels = points.map(function (p, i) {
      if (i !== 0 && i !== n - 1 && i % everyNth !== 0) return "";
      return '<text x="' + xAt(i) + '" y="' + (h - 12) + '" font-size="18" fill="var(--ink-muted)" text-anchor="middle">' + p.label + '</text>';
    }).join("");

    sessionChartWrapEl.innerHTML =
      '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + seriesLabel + ' 추이 그래프">' +
      '<defs><linearGradient id="chartAreaFill" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="var(--accent)" stop-opacity="0.22"/>' +
      '<stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/>' +
      '</linearGradient></defs>' +
      grid +
      '<polygon points="' + areaPoints + '" fill="url(#chartAreaFill)"/>' +
      '<polyline points="' + linePoints + '" fill="none" stroke="var(--accent)" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>' +
      dots +
      valueLabels +
      xLabels +
      "</svg>";
  }

  function applyHistoryView() {
    var totalPages = Math.max(1, Math.ceil(historyAllSessions.length / HISTORY_PAGE_SIZE));
    if (historyPage > totalPages) historyPage = totalPages;
    if (historyPage < 1) historyPage = 1;
    var start = (historyPage - 1) * HISTORY_PAGE_SIZE;
    var pageRows = historyAllSessions.slice(start, start + HISTORY_PAGE_SIZE);

    renderHistoryRows(pageRows);
    renderPagination(historyPaginationEl, totalPages, historyPage, function (p) {
      historyPage = p;
      applyHistoryView();
    });
  }

  function renderHistoryRows(sessions) {
    historyBodyEl.innerHTML = "";
    if (!historyAllSessions.length) {
      historyBodyEl.innerHTML = '<tr><td class="empty-row">아직 기록이 없어요.</td></tr>';
      return;
    }
    sessions.forEach(function (s) {
      var tr = document.createElement("tr");

      var plainCells = [s.date, s.sessionNo + "회"];
      plainCells.forEach(function (v) {
        var td = document.createElement("td");
        td.textContent = v;
        tr.appendChild(td);
      });

      ITEM_META.forEach(function (meta) {
        var td = document.createElement("td");
        td.innerHTML = scoreChip(s.items[meta.id]);
        tr.appendChild(td);
      });

      var tdTotal = document.createElement("td");
      tdTotal.innerHTML = scoreChip(s.total);
      tr.appendChild(tdTotal);

      var tdPrev = document.createElement("td");
      tdPrev.textContent = s.prevScore == null ? "-" : s.prevScore + "점";
      tr.appendChild(tdPrev);

      var tdEdit = document.createElement("td");
      var editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "row-edit-btn";
      editBtn.textContent = "수정";
      editBtn.addEventListener("click", function () { startEditSession(s); });
      tdEdit.appendChild(editBtn);
      tr.appendChild(tdEdit);

      historyBodyEl.appendChild(tr);
    });
  }

  /* ---------------------------------------------------------------- */
  /* 초기화                                                             */
  /* ---------------------------------------------------------------- */

  newStudentDate.value = todayStr();
  newStudentEnd.value = endDateOf(newStudentDate.value);
  // 등록일을 바꾸면 마감일(등록일+2개월)이 자동으로 따라가고, 마감일을 직접 고치면 그 값을 유지한다.
  newStudentDate.addEventListener("change", function () {
    if (!newStudentEnd.dataset.manual) newStudentEnd.value = endDateOf(newStudentDate.value);
  });
  newStudentEnd.addEventListener("change", function () { newStudentEnd.dataset.manual = "1"; });
  sessionDateEl.value = todayStr();
  renderHistoryHeader();
  refreshRoster();
  refreshStudentSelect();

  // 서버(Apps Script)가 옛날 버전이면 눈에 띄게 알려준다 (그대로 쓰면 납입·삭제·마감일이 저장되지 않는다).
  callApi("getVersion").then(function (v) {
    if (v !== "payments-v3") showServerWarn();
  }).catch(function (err) {
    if (err && /알 수 없는 요청/.test(err.message || "")) showServerWarn();
  });
  function showServerWarn() {
    var el = document.getElementById("serverWarn");
    el.textContent = "⚠ 서버(Apps Script)가 옛날 버전이에요. 납입 금액·마감일·삭제가 저장되지 않아요. Apps Script에 새 Code.js를 붙여넣고 '배포 → 배포 관리 → 연필 → 새 버전 → 배포'를 해 주세요.";
    el.hidden = false;
  }
})();
  