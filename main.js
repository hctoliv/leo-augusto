(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const root = document.documentElement;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isMobile = () => innerWidth <= 820;

  /* ---------- intro: line check ---------- */
  function runIntro(done) {
    const lc = $('#lc');
    if (!root.classList.contains('intro-on') || reduce) { root.classList.remove('intro-on'); done(); return; }
    const meters = $('#lcMeters');
    const n = Math.min(32, Math.floor(innerWidth / 30));
    for (let i = 0; i < n; i++) meters.appendChild(document.createElement('i'));
    const bars = $$('i', meters);
    let t0 = performance.now(), raf, finished = false;
    const count = $('#lcCount');
    const words = ['um, dois', 'um, dois, som', 'som', ''];
    const tick = (now) => {
      const t = (now - t0) / 1000;
      const env = t < 1.6 ? (Math.sin(t * 9) * .5 + .5) * (t % .8 < .5 ? 1 : .35) : Math.max(0, 1 - (t - 1.6) * 1.2);
      bars.forEach((b, i) => {
        const shape = 1 - Math.abs(i - n / 2) / (n / 2) * .6;
        b.style.height = (Math.max(.02, env * shape * (.6 + Math.random() * .4)) * 52) + 'vh';
      });
      count.textContent = words[Math.min(words.length - 1, Math.floor(t / .7))];
      if (t > 1.5) lc.classList.add('is-up');
      if (t > 1.9) lc.classList.add('is-name');
      if (t > 3.1) return finish();
      raf = requestAnimationFrame(tick);
    };
    const finish = () => {
      if (finished) return; finished = true;
      cancelAnimationFrame(raf);
      try { sessionStorage.setItem('la-intro', '1'); } catch (e) {}
      lc.classList.add('is-out');
      done();
      setTimeout(() => root.classList.remove('intro-on'), 600);
    };
    $('#lcSkip').addEventListener('click', finish);
    addEventListener('keydown', finish, { once: true });
    lc.addEventListener('click', finish);
    raf = requestAnimationFrame(tick);
  }

  /* ---------- hero videos ---------- */
  const heroCols = $$('.hero__col');
  heroCols.forEach(c => { const v = $('video', c); v.src = v.dataset.src; });
  let heroCur = 0;
  function heroPlay() {
    heroCols.forEach((c, i) => {
      const v = $('video', c);
      const on = !isMobile() || i === heroCur;
      c.classList.toggle('is-cur', i === heroCur);
      if (on) v.play().catch(() => {}); else v.pause();
    });
  }
  setInterval(() => { if (isMobile()) { heroCur = (heroCur + 1) % heroCols.length; heroPlay(); } }, 5200);
  addEventListener('resize', heroPlay);

  /* ---------- hero timecode + SPL ---------- */
  const tc = $('#tc'), spl = $('#spl');
  const tcStart = performance.now();
  let splVal = 89.4;
  setInterval(() => {
    splVal += (89.4 - splVal) * .2 + (Math.random() - .5) * 1.1;
    spl.textContent = splVal.toFixed(1);
  }, 420);

  /* ---------- RTA canvas ---------- */
  const rta = $('#rta'), rctx = rta.getContext('2d');
  const BANDS = 48;
  const bandVals = new Float32Array(BANDS);
  function sizeCanvas(c) {
    const r = c.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1);
    c.width = Math.max(1, r.width * d); c.height = Math.max(1, r.height * d);
  }
  sizeCanvas(rta);
  addEventListener('resize', () => { sizeCanvas(rta); sizeCanvas(ftc); });

  /* ---------- audio engine (mesa) ---------- */
  let actx = null, master = null, mAnL = null, mAnR = null;
  const strips = $$('.strip[data-ch]');
  const chans = strips.map(el => ({
    el, v: $('video', el), fader: $('input', el), db: $('.strip__db', el),
    mute: $('.b-mute', el), solo: $('.b-solo', el), meter: $('canvas', el),
    gain: null, an: null, buf: null, level: 0, peak: 0, peakT: 0, loaded: false,
    color: getComputedStyle(el).getPropertyValue('--ch').trim()
  }));
  const hint = $('#mesaHint');

  function ensureAudio() {
    if (actx) { if (actx.state === 'suspended') actx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = new AC();
    master = actx.createGain();
    const split = actx.createChannelSplitter(2);
    mAnL = actx.createAnalyser(); mAnR = actx.createAnalyser();
    mAnL.fftSize = mAnR.fftSize = 1024;
    master.connect(actx.destination);
    master.connect(split); split.connect(mAnL, 0); split.connect(mAnR, 1);
    chans.forEach(c => {
      loadChan(c);
      const src = actx.createMediaElementSource(c.v);
      c.gain = actx.createGain(); c.gain.gain.value = 0;
      c.an = actx.createAnalyser(); c.an.fftSize = 512; c.an.smoothingTimeConstant = .6;
      c.buf = new Float32Array(c.an.fftSize);
      src.connect(c.gain); c.gain.connect(c.an); c.an.connect(master);
      c.v.muted = false;
    });
    setMaster();
    hint.textContent = 'som ligado · arrasta os faders';
  }
  function loadChan(c) {
    if (c.loaded) return;
    c.loaded = true; c.v.src = c.v.dataset.src; c.v.preload = 'auto';
  }
  const pct2db = p => p <= 0 ? -Infinity : 20 * Math.log10(Math.pow(p / 78, 2.2));
  const fmtDb = d => d === -Infinity ? '-∞' : (d > 0 ? '+' : '') + d.toFixed(1);
  function applyGains() {
    const anySolo = chans.some(c => c.solo.getAttribute('aria-pressed') === 'true');
    chans.forEach(c => {
      const p = +c.fader.value;
      const muted = c.mute.getAttribute('aria-pressed') === 'true';
      const soloed = c.solo.getAttribute('aria-pressed') === 'true';
      const audible = p > 0 && !muted && (!anySolo || soloed);
      const g = p <= 0 ? 0 : Math.pow(p / 78, 2.2);
      c.db.textContent = fmtDb(pct2db(p));
      c.el.classList.toggle('is-on', audible);
      if (c.gain) c.gain.gain.setTargetAtTime(audible ? g : 0, actx.currentTime, .03);
      if (audible || p > 0) { loadChan(c); c.v.play().catch(() => {}); }
    });
  }
  const mainF = $('#mainFader'), mainDb = $('#mainDb');
  function setMaster() {
    const p = +mainF.value;
    mainDb.textContent = fmtDb(pct2db(p));
    if (master) master.gain.setTargetAtTime(p <= 0 ? 0 : Math.pow(p / 78, 2.2), actx.currentTime, .03);
  }
  chans.forEach(c => {
    c.fader.addEventListener('pointerdown', ensureAudio);
    c.fader.addEventListener('keydown', ensureAudio);
    c.fader.addEventListener('input', () => { ensureAudio(); applyGains(); });
    c.mute.addEventListener('click', () => { ensureAudio(); c.mute.setAttribute('aria-pressed', c.mute.getAttribute('aria-pressed') !== 'true'); applyGains(); });
    c.solo.addEventListener('click', () => {
      ensureAudio();
      const on = c.solo.getAttribute('aria-pressed') !== 'true';
      c.solo.setAttribute('aria-pressed', on);
      if (on && +c.fader.value === 0) c.fader.value = 78;
      applyGains();
    });
    $('.strip__screen', c.el).addEventListener('click', () => {
      ensureAudio();
      c.fader.value = +c.fader.value > 0 ? 0 : 78;
      applyGains();
    });
  });
  mainF.addEventListener('input', () => { ensureAudio(); setMaster(); });
  $('#allOff').addEventListener('click', () => {
    chans.forEach(c => { c.fader.value = 0; c.mute.setAttribute('aria-pressed', 'false'); c.solo.setAttribute('aria-pressed', 'false'); });
    applyGains();
  });

  // play the mesa videos muted (visual only) while the console is visible
  const consoleEl = $('#console');
  let consoleVisible = false;
  new IntersectionObserver(es => es.forEach(e => {
    consoleVisible = e.isIntersecting;
    chans.forEach(c => {
      if (consoleVisible) { loadChan(c); c.v.play().catch(() => {}); }
      else c.v.pause();
    });
  }), { rootMargin: '200px 0px' }).observe(consoleEl);

  function drawMeter(cv, level, peak, color) {
    const x = cv.getContext('2d'), w = cv.width, h = cv.height;
    x.clearRect(0, 0, w, h);
    const segs = 32, sh = h / segs;
    const lit = Math.round(level * segs);
    for (let i = 0; i < segs; i++) {
      const y = h - (i + 1) * sh;
      const col = i > segs * .86 ? '#ff4d5e' : i > segs * .68 ? '#ffb547' : '#3ee08f';
      x.fillStyle = i < lit ? col : '#17171e';
      x.fillRect(0, y + 1, w, sh - 2);
    }
    const pi = Math.round(peak * segs);
    if (pi > 0) { x.fillStyle = color || '#fff'; x.fillRect(0, h - pi * sh + 1, w, 2); }
  }
  const rms = (an, buf) => {
    an.getFloatTimeDomainData(buf);
    let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    const r = Math.sqrt(s / buf.length);
    return Math.max(0, Math.min(1, (20 * Math.log10(r + 1e-6) + 54) / 54));
  };
  const mBufL = new Float32Array(1024), mBufR = new Float32Array(1024);
  const mainMeters = $$('.strip--main canvas');
  const mainState = [{ l: 0, p: 0, t: 0 }, { l: 0, p: 0, t: 0 }];
  const freq = new Uint8Array(512);

  /* ---------- scroll-driven bits ---------- */
  const hd = $('#hd'), heroStage = $('#heroStage');
  const mani = $('#mani'), maniText = $('#maniText'), maniLeds = $('#maniLeds');
  maniText.innerHTML = maniText.textContent.trim().split(/\s+/).map(w => `<span class="w">${w}</span>`).join(' ');
  const maniWords = $$('.w', maniText);
  const LEDN = 22;
  for (let i = 0; i < LEDN; i++) { const l = document.createElement('i'); if (i >= LEDN * .86) l.className = 'r'; else if (i >= LEDN * .68) l.className = 'y'; maniLeds.appendChild(l); }
  const leds = $$('i', maniLeds);
  const flow = $('#flow'), flowFill = $('#flowFill'), flowSpark = $('#flowSpark');
  let lastY = scrollY;

  function onScroll() {
    const y = scrollY, vh = innerHeight;
    // header
    hd.classList.toggle('is-solid', y > 40);
    if (!document.body.classList.contains('menu-open')) hd.classList.toggle('is-hidden', y > vh && y > lastY + 2);
    if (y < lastY - 2) hd.classList.remove('is-hidden');
    lastY = y;
    // hero
    const hp = Math.min(1, y / vh);
    heroStage.style.transform = `scale(${1 + hp * .12})`;
    heroStage.style.opacity = 1 - hp * .7;
    // manifesto
    const mr = mani.getBoundingClientRect();
    const mp = Math.max(0, Math.min(1, -mr.top / (mr.height - vh)));
    const on = Math.round(mp * 1.15 * maniWords.length);
    maniWords.forEach((w, i) => w.classList.toggle('on', i < on));
    const ledOn = Math.round(Math.min(1, mp * 1.15) * LEDN);
    leds.forEach((l, i) => l.classList.toggle('on', i < ledOn));
    // flow wire
    const fr = flow.getBoundingClientRect();
    const fp = Math.max(0, Math.min(1, (vh * .6 - fr.top) / fr.height));
    flowFill.style.height = (fp * 100) + '%';
    flowSpark.style.top = (fp * 100) + '%';
  }
  addEventListener('scroll', () => requestAnimationFrame(onScroll), { passive: true });
  onScroll();

  const nodeIO = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) e.target.classList.add('is-in'); }), { threshold: .2 });
  $$('.node').forEach(n => nodeIO.observe(n));

  // rack LEDs light in sequence when seen
  const rus = $$('.ru');
  new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) rus.forEach((r, i) => setTimeout(() => r.classList.add('is-lit'), 180 * i));
  }), { threshold: .4 }).observe($('.rack__frame'));

  /* ---------- footer wave ---------- */
  const ftc = $('#ftWave'), fctx = ftc.getContext('2d');
  sizeCanvas(ftc);
  let ftVisible = false, heroVisible = true;
  new IntersectionObserver(es => es.forEach(e => { ftVisible = e.isIntersecting; })).observe(ftc);
  new IntersectionObserver(es => es.forEach(e => { heroVisible = e.isIntersecting; })).observe($('.hero'));

  /* ---------- main loop ---------- */
  function frame(now) {
    // timecode
    const s = (now - tcStart) / 1000;
    const p2 = n => String(n).padStart(2, '0');
    tc.textContent = `${p2(Math.floor(s / 3600))}:${p2(Math.floor(s / 60) % 60)}:${p2(Math.floor(s) % 60)}:${p2(Math.floor((s % 1) * 30))}`;

    const audioLive = actx && actx.state === 'running' && chans.some(c => c.el.classList.contains('is-on'));
    if (audioLive && mAnL) mAnL.getByteFrequencyData(freq);

    // hero RTA
    if (heroVisible) {
      const w = rta.width, h = rta.height;
      rctx.clearRect(0, 0, w, h);
      const bw = w / BANDS;
      for (let i = 0; i < BANDS; i++) {
        let target;
        if (audioLive) {
          const idx = Math.floor(Math.pow(i / BANDS, 1.9) * 200) + 1;
          target = freq[idx] / 255;
        } else {
          const tilt = 1 - i / BANDS * .55;
          target = tilt * (.35 + .3 * Math.sin(now / 380 + i * .55) * Math.sin(now / 900 + i * .21) + Math.random() * .22);
        }
        bandVals[i] += (Math.max(.03, target) - bandVals[i]) * .22;
        const bh = bandVals[i] * h;
        const g = rctx.createLinearGradient(0, h, 0, h - bh);
        g.addColorStop(0, 'rgba(180,140,255,.05)');
        g.addColorStop(1, 'rgba(180,140,255,.55)');
        rctx.fillStyle = g;
        rctx.fillRect(i * bw + 1, h - bh, bw - 2, bh);
        rctx.fillStyle = 'rgba(220,200,255,.9)';
        rctx.fillRect(i * bw + 1, h - bh, bw - 2, 2);
      }
    }

    // mesa meters
    if (consoleVisible) {
      chans.forEach(c => {
        let lv = 0;
        if (c.an && c.el.classList.contains('is-on')) lv = rms(c.an, c.buf);
        c.level = lv > c.level ? lv : c.level * .9;
        if (c.level >= c.peak) { c.peak = c.level; c.peakT = now; } else if (now - c.peakT > 900) c.peak *= .96;
        drawMeter(c.meter, c.level, c.peak, c.color);
      });
      [mAnL, mAnR].forEach((an, i) => {
        const st = mainState[i];
        const lv = an && audioLive ? rms(an, i ? mBufR : mBufL) : 0;
        st.l = lv > st.l ? lv : st.l * .9;
        if (st.l >= st.p) { st.p = st.l; st.t = now; } else if (now - st.t > 900) st.p *= .96;
        drawMeter(mainMeters[i], st.l, st.p, '#fff');
      });
    }

    // footer wave
    if (ftVisible) {
      const w = ftc.width, h = ftc.height;
      fctx.clearRect(0, 0, w, h);
      fctx.lineWidth = 2; fctx.strokeStyle = 'rgba(180,140,255,.8)';
      fctx.beginPath();
      for (let x = 0; x <= w; x += 4) {
        const k = x / w;
        const env = Math.sin(k * Math.PI);
        const yv = h / 2 + env * h * .38 * (Math.sin(k * 38 + now / 260) * .6 + Math.sin(k * 91 - now / 170) * .3 + Math.sin(k * 7 + now / 900) * .4);
        x ? fctx.lineTo(x, yv) : fctx.moveTo(x, yv);
      }
      fctx.stroke();
    }
    requestAnimationFrame(frame);
  }

  /* ---------- menu ---------- */
  const burger = $('#burger');
  burger.addEventListener('click', () => {
    const open = !document.body.classList.contains('menu-open');
    document.body.classList.toggle('menu-open', open);
    burger.setAttribute('aria-expanded', open);
  });
  $$('#nav a').forEach(a => a.addEventListener('click', () => { document.body.classList.remove('menu-open'); burger.setAttribute('aria-expanded', 'false'); }));

  /* ---------- talkback form ---------- */
  const tb = $('#tb'), prev = $('#tbPrev'), note = $('#tbNote');
  function buildMsg() {
    const f = new FormData(tb);
    const tipo = f.get('tipo');
    const data = f.get('data');
    const dataBr = data ? data.split('-').reverse().join('/') : '';
    const local = (f.get('local') || '').trim();
    const msg = (f.get('msg') || '').trim();
    let t = `Oi, Léo! Vi teu site e queria falar sobre ${tipo}`;
    if (dataBr) t += ` no dia ${dataBr}`;
    if (local) t += ` em ${local}`;
    t += '.';
    if (msg) t += `\n${msg}`;
    return t;
  }
  const upd = () => { prev.textContent = buildMsg(); };
  tb.addEventListener('input', upd); tb.addEventListener('change', upd); upd();
  tb.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('.tb__btn', tb);
    btn.classList.add('is-talk');
    const text = buildMsg();
    let copied = false;
    try { await navigator.clipboard.writeText(text); copied = true; } catch (err) {}
    note.textContent = copied ? 'Copiado! Agora é só colar no direct e enviar.' : 'Copia o texto acima e cola no direct.';
    window.open('https://ig.me/m/ragasse_', '_blank', 'noopener');
    setTimeout(() => btn.classList.remove('is-talk'), 1200);
  });

  /* ---------- start ---------- */
  runIntro(() => {
    document.body.classList.add('is-ready');
    heroPlay();
  });
  requestAnimationFrame(frame);
})();
