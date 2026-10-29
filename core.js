// РабУч · ядро расчётов: календарь, рабочий день, банк месяца, план недели.
// Без DOM и без хранилища: всё нужное приходит аргументами, результат — обычные объекты.
// В браузере доступно как window.RabuchCore, в Node — через require("./core.js").
(function (root) {
  "use strict";

  // ---- правила ----
  const DAY_START = 8 * 60;          // приход по умолчанию, если не отмечен
  const LUNCH = 30;                  // обед вычитается из каждого дня
  const MIN_PRESENCE = 4.5 * 60;     // меньше этого от прихода — день не отработан
  const MAX_SHIFT = 20 * 60;         // смена через полночь не длиннее 20 ч, иначе это ошибка ввода
  const NORM = { work: 8 * 60, short: 7 * 60 };
  const ACCOUNTING_START = "2026-09-21";   // всё раньше — вне учёта
  const EPSILON = 5;                 // расхождение до 5 мин считается «в срок»

  // ---- производственный календарь РФ ----
  // 2026 и 2027 утверждены (2027 — постановление № 1187 от 17.09.2026); 2028 — предварительно, по ТК без переносов января; обновить осенью 2027
  const HOLIDAYS = new Set(`
    2026-01-01 2026-01-02 2026-01-05 2026-01-06 2026-01-07 2026-01-08 2026-01-09 2026-02-23 2026-03-09
    2026-05-01 2026-05-11 2026-06-12 2026-11-04 2026-12-31
    2027-01-01 2027-01-04 2027-01-05 2027-01-06 2027-01-07 2027-01-08 2027-02-22 2027-02-23 2027-03-08
    2027-05-03 2027-05-10 2027-06-14 2027-11-04 2027-11-05 2027-12-31
    2028-01-03 2028-01-04 2028-01-05 2028-01-06 2028-01-07 2028-02-23 2028-03-08 2028-05-01 2028-05-09
    2028-06-12 2028-11-06`.trim().split(/\s+/));
  const SHORT_DAYS = new Set(`
    2026-04-30 2026-05-08 2026-06-11 2026-11-03
    2027-02-20 2027-04-30 2027-06-11 2027-11-03
    2028-02-22 2028-03-07 2028-05-08 2028-11-03`.trim().split(/\s+/));
  const WORKING_SATURDAYS = new Set(["2027-02-20"]);

  // ---- даты и время ----
  const pad2 = n => String(n).padStart(2, "0");
  const isoDate = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const monthKey = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const mondayOf = d => addDays(d, -((d.getDay() + 6) % 7));
  function parseIso(key) {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  /** «ЧЧ:ММ» → минуты от полуночи; пусто → null. */
  function minutesOf(hhmm) {
    if (!hhmm) return null;
    const [h, m] = hhmm.split(":");
    return +h * 60 + +m;
  }

  /** Приход по отметке или по умолчанию. */
  const startOf = mark => minutesOf(mark && mark.a) ?? DAY_START;

  /**
   * Конец смены в минутах от полуночи дня прихода.
   * Уход раньше прихода — это следующие сутки, если смена не длиннее MAX_SHIFT; иначе null (ошибка ввода).
   */
  function shiftEnd(start, leave) {
    if (leave == null) return null;
    start ??= DAY_START;
    if (leave >= start) return leave;
    if (leave + 1440 - start <= MAX_SHIFT) return leave + 1440;
    return null;
  }

  // ---- какой это день ----

  /** По календарю: "hol" праздник, "rest" выходной, "short" сокращённый, "work" рабочий. */
  function calendarKind(key, weekday) {
    if (HOLIDAYS.has(key)) return "hol";
    if ((weekday === 0 || weekday === 6) && !WORKING_SATURDAYS.has(key)) return "rest";
    return SHORT_DAYS.has(key) ? "short" : "work";
  }

  /**
   * Что за день с учётом отметок пользователя (dayTypes: ключ даты → vac | sick | off | x | xn).
   * kind: pre (до начала учёта) | work | type (отпуск, больничный, отгул) | extra (доп. день) | hol | rest.
   * Поля k, tp, counted, short названы как в интерфейсе, который их читает.
   */
  function dayInfo(date, dayTypes) {
    const k = isoDate(date);
    if (k < ACCOUNTING_START) return { kind: "pre", k, norm: 0 };
    const cal = calendarKind(k, date.getDay());
    const tp = dayTypes[k];
    if (tp === "x" || tp === "xn") return { kind: "extra", counted: tp === "xn", k, tp, norm: 0 };
    if (cal === "work" || cal === "short") {
      if (tp === "vac" || tp === "sick" || tp === "off") return { kind: "type", tp, k, norm: 0 };
      return { kind: "work", norm: NORM[cal], short: cal === "short", k };
    }
    return { kind: cal === "hol" ? "hol" : "rest", k, norm: 0 };
  }

  const isWorkLike = info => info.kind === "work" || info.kind === "extra";
  /** Идёт ли день в счёт нормы: рабочий или доп. день «в счёт нормы». */
  const countsToNorm = info => info.kind === "work" || !!info.counted;

  /** Последний ли это рабочий день месяца. */
  function isMonthEnd(date, dayTypes) {
    for (let d = addDays(date, 1); d.getMonth() === date.getMonth(); d = addDays(d, 1))
      if (dayInfo(d, dayTypes).kind === "work") return false;
    return true;
  }

  // ---- рабочий день ----

  /**
   * Сколько отработано в день недели (для текущей недели, с живым отсчётом).
   * null — день не в учёте или ещё не начался.
   * { w: минуты без обеда, b: конец, live: идёт сейчас, sched: закрыт по графику без отметки прихода }
   */
  function dayWork(info, mark, now, isToday) {
    if (!info || !isWorkLike(info)) return null;
    mark = mark || {};
    const leave = minutesOf(mark.b), start = startOf(mark), end = shiftEnd(start, leave);
    if (leave != null) return end != null ? { w: Math.max(0, end - start - LUNCH), live: false, b: end } : null;
    if (!isToday) return null;
    if (info.kind === "work" && !mark.a) {
      // без отметки прихода — день по графику и не дальше, без переработки
      const scheduled = start + (info.norm || 0) + LUNCH;
      if (now >= scheduled) return { w: info.norm || 0, live: false, b: scheduled, sched: true };
    }
    // живой день: обед вычитается сразу, неделя тикает секунда в секунду
    if ((info.kind === "work" || mark.a) && now > start) return { w: Math.max(0, now - start - LUNCH), live: true, b: now };
    return null;
  }

  /**
   * Итог любого дня (история, банк). Поля названы как в интерфейсе:
   * cls: rest | pre | hol | type | none (прошёл без ухода) | fut (впереди) | over | under | ok;
   * w — отработано, df — разница с нормой, inv — уход раньше прихода.
   */
  function dayRecord(date, mark, dayTypes, todayKey) {
    const f = dayInfo(date, dayTypes);
    mark = mark || {};
    const r = { k: f.k, f, a: mark.a || "", b: mark.b || "", cls: "", w: 0, df: 0 };
    if (f.kind === "rest" || f.kind === "pre" || f.kind === "hol" || f.kind === "type") {
      r.cls = f.kind;
      return r;
    }
    const pending = r.k < todayKey ? "none" : "fut";
    const leave = minutesOf(mark.b);
    if (leave == null) {
      r.cls = pending;
      return r;
    }
    const start = startOf(mark), end = shiftEnd(start, leave);
    if (end == null) {
      r.inv = true;
      r.cls = pending;
      return r;
    }
    r.w = Math.max(0, end - start - LUNCH);
    if (f.kind === "extra") {
      r.df = f.counted ? r.w : 0;
      r.cls = r.w > EPSILON ? "over" : "ok";
    } else {
      r.df = r.w - f.norm;
      r.cls = r.df > EPSILON ? "over" : r.df < -EPSILON ? "under" : "ok";
    }
    return r;
  }

  /** Закрытый день: учитывается в банке и в балансах. */
  const isClosed = rec => rec.cls === "over" || rec.cls === "under" || rec.cls === "ok";

  // ---- банк месяца: переработки и недоработки закрытых дней переносятся в пределах месяца ----

  /** Сумма разниц закрытых дней месяца month («ГГГГ-ММ») до даты before (не включая). */
  function monthBank(month, before, recordOf) {
    let sum = 0, days = 0;
    for (let d = parseIso(month + "-01"); d < before && monthKey(d) === month; d = addDays(d, 1)) {
      const rec = recordOf(d);
      if (isClosed(rec)) {
        sum += rec.df;
        days++;
      }
    }
    return { sum, days };
  }

  // ---- план недели ----

  /**
   * Всё, что нужно главному экрану: что за дни, сколько отработано, цели ухода и «день остатка».
   * «День остатка» — последний рабочий день недели в каждом месяце: в него сводится норма
   * этой части недели с учётом банка месяца (bankBefore(month) — банк до понедельника).
   */
  function weekPlan({ monday, marks, dayTypes, now, todayIdx, bankBefore }) {
    const days = [...Array(7)].map((_, i) => addDays(monday, i));
    const info = days.map(d => dayInfo(d, dayTypes));
    const month = days.map(monthKey);
    const work = info.map((f, i) => dayWork(f, marks[i], now, i === todayIdx));

    let norm = 0, lastWorkday = -1;
    info.forEach((f, i) => {
      if (f.kind !== "work") return;
      norm += f.norm;
      if (i < 5) lastWorkday = i;
    });

    let counted = 0, total = 0, live = null;
    const monthDelta = {}, closedDays = {};
    work.forEach((r, i) => {
      if (!r) return;
      const f = info[i];
      total += r.w;
      if (countsToNorm(f)) counted += r.w;
      if (r.live) {
        live = i;
        return;
      }
      const m = month[i];
      monthDelta[m] = (monthDelta[m] || 0) + (f.kind === "work" ? r.w - f.norm : f.counted ? r.w : 0);
      closedDays[m] = (closedDays[m] || 0) + 1;
    });

    const restDayOf = {};
    for (let i = 0; i < 5; i++) if (info[i].kind === "work") restDayOf[month[i]] = i;

    const rest = {};
    for (const [m, ri] of Object.entries(restDayOf)) {
      const bank = bankBefore(m);
      let monthNorm = 0, others = 0, known = true;
      info.forEach((f, i) => {
        if (month[i] !== m) return;
        if (f.kind === "work") monthNorm += f.norm;
        if (i === ri) return;
        const done = work[i] && !work[i].live;
        if (f.kind === "work") {
          if (done) others += work[i].w;
          else {
            others += f.norm;
            known = false;
          }
        } else if (f.kind === "extra" && f.counted && done) others += work[i].w;
      });
      const remaining = monthNorm - others - bank, start = startOf(marks[ri]);
      rest[ri] = {
        m, rem: remaining, known, bank,
        fT: Math.max(start + MIN_PRESENCE, start + LUNCH + Math.max(0, remaining)),
        end: isMonthEnd(days[ri], dayTypes),
        wk: ri === lastWorkday,
      };
    }

    const target = info.map((f, i) => rest[i] ? rest[i].fT : startOf(marks[i]) + (f.norm || 0) + LUNCH);
    return { info, work, target, rest, norm, counted, total, live, monthDelta, closedDays, month };
  }

  const core = {
    DAY_START, LUNCH, MIN_PRESENCE, MAX_SHIFT, NORM, ACCOUNTING_START, EPSILON,
    HOLIDAYS, SHORT_DAYS, WORKING_SATURDAYS,
    pad2, isoDate, monthKey, addDays, mondayOf, parseIso, minutesOf, startOf, shiftEnd,
    calendarKind, dayInfo, isMonthEnd, countsToNorm,
    dayWork, dayRecord, isClosed, monthBank, weekPlan,
  };
  if (typeof module === "object" && module.exports) module.exports = core;
  else root.RabuchCore = core;
})(this);
