/*
 * Dota Fantasy — заставки «Ширина» и «Сетка».
 * Без зависимостей. Web Animations API.
 *
 *   DFIntro.play('width'   [, opts])  → Promise, резолвится после закрытия
 *   DFIntro.play('bracket' [, opts])
 *
 * opts:
 *   tagline  — подпись под названием (строка)
 *   hold     — сколько держать готовый кадр, мс (по умолчанию 700)
 *   skippable — клик/Esc/кнопка «Пропустить» закрывают заставку (по умолчанию true)
 *   onDone   — колбэк после закрытия (то же, что then у промиса)
 *
 * prefers-reduced-motion: показывает готовый кадр без анимации и закрывается через hold.
 */
(function (global) {
  'use strict';
  var EASE = 'cubic-bezier(.2,.8,.2,1)';
  var SNAP = 'cubic-bezier(.7,0,.2,1)';
  var DURATION = { width: 2200, bracket: 2800 };
  var TAGLINE = {
    width: 'Собери пятёрку. Пройди свой турнир.',
    bracket: 'GSL-группы → double elimination → твой чемпион'
  };
  var BRACKET_PATHS = [
    'M60 170 H250 V270 H430', 'M60 370 H250 V270', 'M60 530 H250 V630 H430', 'M60 730 H250 V630',
    'M430 270 H560 V450 H700', 'M430 630 H560 V450',
    'M1540 170 H1350 V270 H1170', 'M1540 370 H1350 V270', 'M1540 530 H1350 V630 H1170', 'M1540 730 H1350 V630',
    'M1170 270 H1040 V450 H900', 'M1170 630 H1040 V450'
  ];

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function anim(node, kf, o) {
    var opts = { fill: 'both', easing: EASE };
    for (var k in o) opts[k] = o[k];
    return node.animate(kf, opts);
  }
  function splitChars(node, text) {
    Array.from(text).forEach(function (c) { node.appendChild(el('span', 'dfi-ch', c)); });
  }

  function buildWidth(root, tagline) {
    var box = el('div', 'dfi-width');
    var a = el('div', 'dfi-wm'), b = el('div', 'dfi-wm');
    splitChars(a, 'DOTA'); splitChars(b, 'FANTASY');
    var bar = el('div', 'dfi-bar'), tag = el('div', 'dfi-tag', tagline);
    box.append(a, b, bar, tag); root.appendChild(box);
    return function () {
      box.querySelectorAll('.dfi-ch').forEach(function (c, i) {
        anim(c, [
          { fontVariationSettings: "'wdth' 50, 'wght' 100", opacity: 0, transform: 'translateY(35%)' },
          { fontVariationSettings: "'wdth' 125, 'wght' 900", opacity: 1, transform: 'none' }
        ], { duration: 1100, delay: 150 + i * 60 });
      });
      anim(bar, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 700, delay: 1150 });
      anim(tag, [{ opacity: 0, transform: 'translateY(60%)' }, { opacity: 1, transform: 'none' }], { duration: 600, delay: 1500 });
    };
  }

  function buildBracket(root, tagline) {
    var NS = 'http://www.w3.org/2000/svg';
    var box = el('div', 'dfi-bracket');
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 1600 900');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.setAttribute('aria-hidden', 'true');
    var g = document.createElementNS(NS, 'g');
    BRACKET_PATHS.forEach(function (d) { var p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); g.appendChild(p); });
    var champ = document.createElementNS(NS, 'circle');
    champ.setAttribute('class', 'dfi-champ'); champ.setAttribute('cx', 800); champ.setAttribute('cy', 450); champ.setAttribute('r', 11);
    svg.append(g, champ);
    var center = el('div', 'dfi-center');
    var wm = el('div', 'dfi-wm', 'DOTA FANTASY'), tag = el('div', 'dfi-tag', tagline);
    center.append(wm, tag); box.append(svg, center); root.appendChild(box);
    return function () {
      g.querySelectorAll('path').forEach(function (p, i) {
        var len = p.getTotalLength();
        p.style.strokeDasharray = len;
        var round = i % 6 < 4 ? 0 : 1;
        anim(p, [{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: 700, delay: 100 + round * 650 + (i % 2) * 80, easing: 'cubic-bezier(.6,0,.3,1)' });
      });
      anim(g, [{ opacity: 1 }, { opacity: 1, offset: .7 }, { opacity: .18 }], { duration: 2400 });
      anim(champ, [{ r: 0 }, { r: 22 }, { r: 11 }], { duration: 500, delay: 1450 });
      anim(wm, [{ clipPath: 'inset(0 50% 0 50%)', letterSpacing: '.2em' }, { clipPath: 'inset(0 0% 0 0%)', letterSpacing: '-.01em' }], { duration: 900, delay: 1650, easing: SNAP });
      anim(tag, [{ opacity: 0 }, { opacity: 1 }], { duration: 500, delay: 2300 });
    };
  }

  var BUILD = { width: buildWidth, bracket: buildBracket };

  function play(name, opts) {
    opts = opts || {};
    if (!BUILD[name]) return Promise.reject(new Error('DFIntro: неизвестная заставка ' + name));
    var reduce = global.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var hold = opts.hold != null ? opts.hold : 700;
    var root = el('div', 'dfi dfi-wait'); // dfi-wait: пока ждём шрифт — только пустой фон, без готового кадра
    root.setAttribute('role', 'presentation');
    var start = BUILD[name](root, opts.tagline || TAGLINE[name]);
    var skip = null;
    if (opts.skippable !== false) { skip = el('button', 'dfi-skip', 'Пропустить'); skip.type = 'button'; root.appendChild(skip); }
    document.body.appendChild(root);

    return new Promise(function (resolve) {
      var closed = false, timer;
      function close() {
        if (closed) return; closed = true; clearTimeout(timer);
        document.removeEventListener('keydown', onKey);
        var done = false;
        function finish() { if (done) return; done = true; root.remove(); if (opts.onDone) opts.onDone(); resolve(); }
        var out = root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 350, easing: 'ease-out', fill: 'forwards' });
        out.onfinish = finish;
        // страховка: во фоновой/скрытой вкладке время анимаций стоит и onfinish не наступает — убираем оверлей по таймеру
        setTimeout(finish, 450);
      }
      function onKey(e) { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') close(); }
      if (opts.skippable !== false) { root.addEventListener('click', close); document.addEventListener('keydown', onKey); }

      var go = function () {
        // анимации с fill:'both' сразу ставят начальные кадры — снимаем скрытие в том же кадре, мигания нет
        if (!reduce) start();
        root.classList.remove('dfi-wait');
        timer = setTimeout(close, (reduce ? 0 : DURATION[name]) + hold);
      };
      // ждём шрифт, чтобы анимация ширины шла на Saira, а не на запасном (но не дольше 1,5 с)
      if (document.fonts && document.fonts.load) {
        Promise.race([document.fonts.load('900 10px Saira'), new Promise(function (r) { setTimeout(r, 1500); })]).then(go, go);
      } else go();
    });
  }

  global.DFIntro = { play: play, names: Object.keys(BUILD) };
})(window);
