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
    chart: document.getElementById("tabChart")
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
  var newStudentEndDate = document.getElementById("newStudentEndDate");
  var addStudentBtn = document.getElementById("addStudentBtn");

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
      rosterBody.innerHTML = '<tr><td colspan="12" class="empty-row">등록된 수강생이 없어요. 위에서 추가해 보세요.</td></tr>';
      return;
    }
    if (term && filteredTotal === 0) {
      rosterBody.innerHTML = '<tr><td colspan="12" class="empty-row">"' + term + '" 검색 결과가 없어요.</td></tr>';
      return;
    }
    rows.forEach(function (r) {
      var tr = document.createElement("tr");

      tr.appendChild(makeEditableCell(r.id, "name", r.name, "text", "수강생명"));

      tr.appendChild(makeEditableCell(r.id, "contact", r.contact, "text", "연락처"));
      tr.appendChild(makeEditableCell(r.id, "registeredDate", r.registeredDate, "date"));
      tr.appendChild(makeEditableCell(r.id, "endDate", r.endDate, "date"));

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
      tr.appendChild(tdLink);

      var tdDelete = document.createElement("td");
      var deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "row-delete-btn";
      deleteBtn.textContent = "삭제";
      deleteBtn.addEventListener("click", function () { deleteStudentRow(r.id, r.name); });
      tdDelete.appendChild(deleteBtn);
      tr.appendChild(tdDelete);

      rosterBody.appendChild(tr);
    });
  }

  // 수강생 삭제 - 해당 수강생의 모든 회차 기록도 함께 지워지므로 반드시 확인을 받는다.
  function deleteStudentRow(studentId, name) {
    var ok = window.confirm('"' + name + '" 수강생을 삭제할까요?\n등록된 모든 회차 기록도 함께 삭제되며, 되돌릴 수 없습니다.');
    if (!ok) return;
    setStatus("삭제 중…");
    callApi("deleteStudent", { studentId: studentId })
      .then(function () {
        setStatus("삭제됨 · " + nowLabel());

        // 방금 삭제한 학생이 회차별 평가 탭에서 선택되어 있었다면 선택을 초기화한다.
        if (currentStudentId === studentId) {
          currentStudentId = null;
          try { localStorage.removeItem(LAST_STUDENT_KEY); } catch (e) {}
        }

        refreshRoster();
        return callApi("getStudents").then(function (students) {
          allStudentsForSelect = students;
          studentSearchEl.value = "";
          chartStudentSearchEl.value = "";
          populateStudentSelect(true);
        });
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
    callApi("addStudent", { name: name, contact: newStudentContact.value.trim(), registeredDate: newStudentDate.value, endDate: newStudentEndDate.value })
      .then(function (newStudent) {
        addStudentBtn.disabled = false;
        newStudentName.value = "";
        newStudentContact.value = "";
        newStudentDate.value = todayStr();
        newStudentEndDate.value = "";
        setStatus("등록됨 · " + nowLabel());

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

  focusMemoEl.addEventListener("input", function () {
    focusMemoStatusEl.textContent = "저장 중…";
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
  sessionDateEl.value = todayStr();
  renderHistoryHeader();
  refreshRoster();
  refreshStudentSelect();
})();
