// РабУч · модель главного экрана: что написать на карточках дней, плашках, кольцах и большом таймере.
// Чистые функции поверх плана недели из core.js — DOM здесь не трогается, только решается, что показать.
// В браузере доступно как window.RabuchScreen, в Node — через require("./screen.js").
(function (root) {
  "use strict";
  const core = typeof module === "object" && module.exports ? require("./core.js") : root.RabuchCore;
  const { LUNCH, MIN_PRESENCE, EPSILON, pad2, startOf, minutesOf, shiftEnd, addDays, isClosed } = core;

  const TYPE_EMOJI = { vac: "🌴", sick: "🤒", off: "💤" };
  const TYPE_LABEL = { vac: "Отпуск", sick: "Больничный", off: "Отгул" };
  const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

  // ---- форматы времени ----
  const hmm = m => { const a = Math.abs(Math.round(m)); return Math.floor(a / 60) + ":" + pad2(a % 60); };   // 9:05
  const sg = m => { m = Math.round(m); return (m > 0 ? "+" : m < 0 ? "−" : "") + hmm(m); };                  // +1:30 / −0:45
  const clock = m => { m = Math.round(m); return pad2(Math.floor(m / 60) % 24) + ":" + pad2(m % 60); };       // 16:30
  const clockT = m => Math.round(m) >= 1440 ? clock(m) + "⁺¹" : clock(m);                                    // 06:01⁺¹ — следующие сутки
  const hmsF = m => { const t = Math.floor(Math.max(0, m) * 60 + 1e-6); return Math.floor(t / 3600) + ":" + pad2(Math.floor(t % 3600 / 60)) + ":" + pad2(t % 60); };
  const ms3 = m => "." + String(Math.min(999, Math.floor((Math.max(0, m) * 60) % 1 * 1000))).padStart(3, "0");
  const remFmt = m => m < -0.5 ? "+" + hmm(-m) : hmm(Math.max(0, m));                                        // остаток недели; сверх нормы — с плюсом
  const plus = m => "+" + hmm(m);
  const FORMATS = { hmm, sg, clockT, remFmt, plus };

  /** Знак разницы с нормой: переработка, недоработка или в пределах EPSILON. */
  const tone = d => d > EPSILON ? "over" : d < -EPSILON ? "under" : "ok";
  const toneOrNone = d => d > EPSILON ? "over" : d < -EPSILON ? "under" : "";
  const normOrSigned = d => Math.abs(d) <= EPSILON ? "в норме" : sg(d);

  // Значение элемента: число с форматом (анимируется), готовый текст или «не трогать» (его ведёт живой отсчёт).
  const num = (n, fmt, quiet = false) => ({ num: n, fmt, quiet });
  const text = t => ({ text: t });
  const KEEP = { keep: true };

  // ---- карточка дня ----

  /**
   * Всё, что показывает карточка дня i. ctx: { plan, marks, now, todayIdx, bankNow(месяц), miss (ключ дня без ухода) }.
   * null в полях lab, val, marks — эту часть карточки не трогать.
   */
  function dayCard(i, ctx) {
    const { plan, marks, now, todayIdx } = ctx;
    const f = plan.info[i], kind = f.kind, mark = marks[i] || {}, r = plan.work[i];
    const card = { hidden: kind === "rest", need: inputWarnings(i, ctx) };
    if (card.hidden) return card;

    const ha = !!mark.a, hb = !!mark.b, today = i === todayIdx, future = i > todayIdx, isVoid = kind === "type" || kind === "hol";
    card.flags = {
      xd: kind === "extra", void: isVoid, fri: !!plan.rest[i], live: !!(r && r.live),
      arriveEmpty: !ha, leaveEmpty: !hb,
      arriveGone: future && !ha, leaveGone: (today && !ha && !hb) || (future && !hb),
    };
    card.emoji = kind === "type" ? TYPE_EMOJI[f.tp] : kind === "extra" ? "➕" : "";
    card.suffix = (kind === "hol" ? " · праздник" : "") + (f.short ? " · сокр." : "") + (kind === "extra" ? " · доп." : "");

    if (isVoid) {
      card.total = text("");
      card.forecast = { label: kind === "hol" ? "Праздник" : TYPE_LABEL[f.tp], value: text(kind === "hol" ? "🎉" : TYPE_EMOJI[f.tp]), sun: null };
      card.chip = { text: kind === "hol" ? "нерабочий день" : "день не требует отметок", cls: "n" };
      card.lab = card.val = card.marks = null;
      return card;
    }

    card.labToggle = kind === "extra";
    card.total = r && !r.live ? num(r.w, "hmm") : r ? KEEP : text("—");
    if (kind === "extra") Object.assign(card, extraDay(f, r));
    else Object.assign(card, plan.rest[i] ? restDay(i, ctx) : workDay(i, ctx), workResult(i, ctx));
    const warn = chipWarning(i, ctx);
    if (warn) card.chip = warn;
    card.marks = markHints(i, ctx);
    card.flags.nowk = !(r && !r.live);
    return card;
  }

  function extraDay(f, r) {
    const label = f.counted ? "в счёт нормы" : "сверх нормы";
    return {
      forecast: { label: "Доп. день", value: text(r ? hmm(r.w) : "—"), sun: null },
      chip: { text: label, cls: f.counted ? "" : "over" },
      lab: label,
      val: r ? { value: num(r.w, "plus"), cls: "over" } : { value: text("—"), cls: "" },
    };
  }

  /** Обычный рабочий день: цель ухода и подсказка с банком месяца. */
  function workDay(i, ctx) {
    const { plan, marks } = ctx, f = plan.info[i], r = plan.work[i], goal = plan.target[i], start = startOf(marks[i]);
    const closed = r && !r.live, diff = closed ? r.w - f.norm : 0, bank = ctx.bankNow(plan.month[i]);
    const tooShort = closed && r.b - start < MIN_PRESENCE;   // день короче минимума: банк его не закрывает
    const chipText =
      tooShort ? "меньше 4,5 ч — день не отработан"
      : closed ? (diff > EPSILON ? "переработка +" + hmm(diff) : diff < -EPSILON ? "недоработка −" + hmm(-diff) : "ровно в срок")
      : bank >= EPSILON ? "с банком можно в " + clockT(Math.max(start + MIN_PRESENCE, goal - bank))
      : bank <= -EPSILON ? "долг " + hmm(-bank) + " · уход в " + clockT(goal - bank)
      : r ? "идёт рабочий день" : f.short ? "сокращённый день" : "обычный день";
    return {
      forecast: { label: "Цель ухода", value: num(goal, "clockT", true), sun: goal },
      chip: { text: chipText, cls: closed ? toneOrNone(diff) : bank <= -EPSILON ? "under" : "" },
    };
  }

  /** «День остатка» — последний рабочий день недели в месяце: сюда сводится норма с учётом банка. */
  function restDay(i, ctx) {
    const { plan, marks, now, todayIdx } = ctx, G = plan.rest[i], f = plan.info[i], r = plan.work[i];
    const start = startOf(marks[i]), usual = start + f.norm + LUNCH;
    const out = { forecast: { label: G.end ? "Конец месяца" : G.known ? "Остаток недели" : "Прогноз ухода" } };
    if (G.rem <= 0) {
      const from = start + MIN_PRESENCE, canGo = i < todayIdx || (i === todayIdx && now >= from);
      out.forecast.value = text(canGo ? "можно" : clockT(from));
      out.forecast.sun = canGo ? null : from;
      out.chip = { text: canGo ? "норма набрана — можно домой" : "норма набрана — можно с " + clock(from), cls: "" };
    } else {
      const d = usual - G.fT;
      out.forecast.value = num(G.fT, "clockT", true);
      out.forecast.sun = G.fT;
      out.chip = {
        text: d > EPSILON ? "на " + hmm(d) + " раньше, чем в " + clockT(usual) : d < -EPSILON ? "на " + hmm(-d) + " позже, чем в " + clockT(usual) : "как обычно",
        cls: d < -EPSILON ? "under" : "",
      };
    }
    if (r && !r.live) {   // день закрыт — плашка подводит итог недели или месяца
      if (G.end) {
        const m = ctx.bankNow(G.m), mt = normOrSigned(m);
        out.chip = { text: G.wk ? "неделя " + hmm(plan.counted) + " · месяц " + mt : "итог месяца " + mt, cls: toneOrNone(m) };
      } else {
        const d = plan.counted - plan.norm;
        out.chip = { text: "неделя " + hmm(plan.counted) + " · " + normOrSigned(d), cls: toneOrNone(d) };
      }
      if (r.b - start < MIN_PRESENCE) out.chip = { text: "меньше 4,5 ч — день не отработан", cls: "under" };
    }
    return out;
  }

  /** Нижняя строка карточки: итог закрытого дня, живой остаток или когда можно уходить. */
  function workResult(i, ctx) {
    const { plan, now } = ctx, r = plan.work[i], goal = plan.target[i], G = plan.rest[i];
    if (r && !r.live) {
      const d = r.b - goal;
      return { lab: d > EPSILON ? "переработка" : d < -EPSILON ? "недоработка" : "ровно в срок", val: { value: num(d, "sg"), cls: tone(d) } };
    }
    if (r) return now < goal
      ? { lab: "до ухода осталось", val: { value: text(hmm(goal - now)), cls: "" } }
      : { lab: "переработка идёт", val: { value: text("+" + hmm(now - goal)), cls: "over" } };
    return { lab: G ? (G.rem > 0 ? "уход в " + clockT(G.fT) : "норма набрана") : "уход с " + clockT(goal), val: { value: text("—"), cls: "" } };
  }

  /** Подозрительные отметки — плашка-предупреждение поверх обычной. */
  function chipWarning(i, ctx) {
    const { mark, bad, tooLongNight, arrivalAhead } = markChecks(i, ctx);
    if (bad) return { text: "уход раньше прихода — проверьте", cls: "err" };
    if (tooLongNight) return { text: "смена через полночь " + hmm(minutesOf(mark.b) + 1440 - minutesOf(mark.a) - LUNCH) + " — верно?", cls: "err" };
    if (arrivalAhead) return { text: "приход позже текущего времени?", cls: "err" };
    return null;
  }

  function markChecks(i, ctx) {
    const f = ctx.plan.info[i], mark = ctx.marks[i] || {}, counts = f.kind === "work" || f.kind === "extra";
    const a = minutesOf(mark.a), b = minutesOf(mark.b);
    return {
      mark,
      bad: counts && b != null && shiftEnd(a, b) == null,
      tooLongNight: counts && a != null && b != null && b < a && b + 1440 - a > 720,   // возможно, перепутаны приход и уход
      arrivalAhead: counts && i === ctx.todayIdx && a != null && a > ctx.now + 30 && b == null,
    };
  }

  /** Какие поля ввода подсветить. */
  function inputWarnings(i, ctx) {
    const c = markChecks(i, ctx);
    return { leave: c.bad || ctx.plan.info[i].k === ctx.miss, arrive: c.arrivalAhead };
  }

  /** «пришёл → ушёл»: пустое место занято серым (по графику / цель ухода), забытый уход — красным. */
  function markHints(i, ctx) {
    const { plan, marks, todayIdx } = ctx, mark = marks[i] || {}, f = plan.info[i], G = plan.rest[i];
    const hb = !!mark.b, missed = i < todayIdx && !hb, extra = f.kind === "extra";
    return {
      arrive: mark.a ? "" : clockT(startOf(mark)),
      leaveLabel: hb || missed || extra ? "ушёл" : G ? (G.end ? "конец месяца" : "остаток недели") : "цель ухода",
      leave: hb ? "" : missed || extra ? "—:—" : G ? (G.rem <= 0 ? "можно" : clockT(G.fT)) : clockT(plan.target[i]),
      missed,
    };
  }

  // ---- неделя, кнопка, баланс ----

  function weekSummary(plan) {
    const remain = Math.max(0, plan.norm - plan.counted);
    return {
      remain,
      frac: plan.norm > 0 ? Math.max(0, Math.min(1, plan.counted / plan.norm)) : 0,
      done: remain <= 0,
      over: plan.counted - plan.norm > EPSILON && plan.norm > 0,
    };
  }

  /** Что сделает большая кнопка: отметить приход или уход в день i. Ночная смена вчерашнего дня — тоже уход. */
  function goTarget(plan, marks, now, todayIdx) {
    let go = null;
    plan.info.forEach((f, i) => {
      if (f.kind === "rest") return;
      const mark = marks[i] || {}, ha = !!mark.a, hb = !!mark.b;
      const nightGoesOn = i === todayIdx - 1 && ha && !hb && now < 360 && now < startOf(mark);
      if (nightGoesOn) go = { i, k: "b" };
      else if (i === todayIdx && !go && f.kind !== "type" && f.kind !== "hol" && (!ha || !hb)) go = { i, k: ha ? "b" : "a" };
    });
    return go;
  }

  /** То, что живой отсчёт пересчитывает каждую секунду, — снимок на момент update(). */
  function liveState(plan, marks) {
    const i = plan.live;
    if (i == null) return null;
    const f = plan.info[i], r = plan.work[i], counts = core.countsToNorm(f), G = plan.rest[i];
    return {
      i, st: startOf(marks[i]), tg: plan.target[i], W: plan.norm, cnt: counts, ex: f.kind === "extra",
      base: plan.counted - (counts ? r.w : 0), baseAll: plan.total - r.w,
      ul: G && Math.abs(G.bank) >= EPSILON ? "с банком уход в " : "уход в ",
    };
  }

  /** Живой отсчёт в момент now: сколько отработано сегодня и за неделю. */
  function liveTick(LS, now) {
    const w = Math.max(0, now - LS.st - LUNCH), total = LS.base + (LS.cnt ? w : 0);
    return { w, total, remain: Math.max(0, LS.W - total), over: now >= LS.tg, frac: LS.W > 0 ? Math.max(0, Math.min(1, total / LS.W)) : 0 };
  }

  /** Подпись под большим числом в режиме «неделя». */
  function weekCaption(norm, counted) {
    return norm <= 0 ? "на этой неделе нет рабочих часов"
      : norm - counted <= 0 ? (counted - norm >= 1 ? "сверх нормы недели" : "норма недели выполнена")
      : "осталось до " + norm / 60 + " ч";
  }

  /**
   * Баланс месяца в шапке. Пока в месяце нет закрытых дней — итог прошлого месяца.
   * sum/days — банк месяца сейчас, recordOf — итог любого дня.
   */
  function monthBalance({ sum, days, today, recordOf }) {
    let label = "Баланс месяца";
    if (!days) {
      const prev = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      let s = 0, n = 0;
      for (let d = prev; d.getMonth() === prev.getMonth(); d = addDays(d, 1)) {
        const rec = recordOf(d);
        if (isClosed(rec)) {
          s += rec.df;
          n++;
        }
      }
      if (n) {
        sum = s;
        days = n;
        label = "Итог " + MONTHS_GEN[prev.getMonth()];
      }
    }
    const cls = !days ? "" : Math.abs(sum) <= EPSILON ? "ok" : sum > 0 ? "over" : "under";
    return {
      label, cls,
      value: !days ? "—" : cls === "ok" ? "0:00" : sg(sum),
      note: !days ? "нет данных" : cls === "ok" ? "в норме" : cls === "over" ? "переработка" : "недоработка",
    };
  }

  // ---- выбранный день: кольцо дня и большой таймер ----

  /** Кольцо дня: доля пройденного пути к цели ухода (null — у дня нет рабочих часов) и переработка ли это. */
  function dayRing(sel, ctx) {
    const { plan, marks, now, todayIdx } = ctx;
    if (plan.info[sel].kind !== "work") return { frac: null, over: false };
    const mark = marks[sel] || {}, start = startOf(mark), leave = minutesOf(mark.b), end = shiftEnd(start, leave);
    const goal = plan.target[sel], span = Math.max(1, goal - start);
    if (leave != null) return { frac: end != null && end > start ? Math.min(1, (end - start) / span) : 0, over: end != null && end > goal + EPSILON };
    if (sel === todayIdx && now > start) return { frac: Math.min(1, (now - start) / span), over: now > goal && !!mark.a };
    return { frac: 0, over: false };
  }

  /** Что знает большой таймер о выбранном дне (null — день без рабочих часов). */
  function dayFocus(sel, ctx) {
    const { plan, marks, todayIdx } = ctx, f = plan.info[sel], r = plan.work[sel], mark = marks[sel] || {};
    if (f.kind !== "work" && f.kind !== "extra") return null;
    const st = startOf(mark), leave = minutesOf(mark.b), b = shiftEnd(st, leave);
    return {
      ex: f.kind === "extra", norm: f.norm || 0, ha: !!mark.a, st, tg: plan.target[sel], b,
      inv: leave != null && b == null, w: r ? r.w : 0, live: !!(r && r.live),
      isToday: sel === todayIdx, past: sel < todayIdx,
    };
  }

  /** Плашку закрытого рабочего дня прячем: итог дня уже крупно сверху. */
  function chipHidden(i, sel, mode, plan, chipCls) {
    const r = plan.work[i];
    return plan.info[i].kind === "work" && !!r && !r.live && (i !== sel || mode === "day") && chipCls !== "err";
  }

  /**
   * Большой таймер в режиме «день». ms — минуты для тысячных (null — тысячные не показывать).
   */
  function dayHeadline(D, now) {
    const title = D && D.isToday ? "Отработано сегодня" : "Отработано в этот день";
    const h = (big, caption, total, ms = null) => ({ title, big, caption, total, ms });
    if (!D) return h("—", "в этот день нет рабочих часов", "—");
    if (D.inv) return h("—", "проверьте время: уход раньше прихода", "—");
    if (D.ex) {
      if (D.b != null) return h(hmm(D.w), "доп. день · отработано", hmm(D.w));
      if (D.isToday && D.ha && now > D.st) { const w = Math.max(0, now - D.st - LUNCH); return h(hmsF(w), "доп. день идёт", hmsF(w)); }
      return h("—", D.ha ? "доп. день · уход не отмечен" : "доп. день · отметьте приход", "—");
    }
    if (D.b != null) {
      const d = D.w - D.norm;
      const caption = D.b - D.st < MIN_PRESENCE ? "итог дня: меньше 4,5 ч — не отработан" : d > EPSILON ? "итог дня: переработка" : d < -EPSILON ? "итог дня: недоработка" : "итог дня: в срок";
      return h((d < 0 ? "−" : "+") + hmm(Math.abs(d)), caption, hmm(D.w));
    }
    if (D.isToday && !D.ha && now >= D.st + D.norm + LUNCH)
      return h("0:00", "итог дня: по графику " + clock(D.st) + "–" + clock(D.st + D.norm + LUNCH), hmm(D.norm));
    if (!D.isToday || now <= D.st)
      return D.past ? h("—", D.ha ? "уход не отмечен" : "день не отмечен", "—") : h(hmm(D.tg - D.st), "длина рабочего дня", "0:00");
    const left = D.tg - now, over = left <= 0;
    return h(over ? "+" + hmsF(-left) : hmsF(left), over ? "переработка идёт" : "до ухода", hmsF(Math.max(0, now - D.st - LUNCH)), over ? -left : left);
  }

  const screen = {
    TYPE_EMOJI, TYPE_LABEL, MONTHS_GEN, FORMATS,
    hmm, sg, clock, clockT, hmsF, ms3, remFmt,
    dayCard, weekSummary, goTarget, liveState, liveTick, weekCaption, monthBalance,
    dayRing, dayFocus, chipHidden, dayHeadline,
  };
  if (typeof module === "object" && module.exports) module.exports = screen;
  else root.RabuchScreen = screen;
})(this);
