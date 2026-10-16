// ==UserScript==
// @name         GeoFS V1/VR/V2 Calculator
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  近似计算 V1 / VR / V2（物理推导模式）。右下角按钮始终可见，面板含中/英语言选择（由 哔哩哔哩-我是小猪05 小红书-起飞吧！凤凰牌飞机！ GitHub-zssszscnplane 制作）。仅为估算工具，含多项近似。
// @author       Bilibili-我是小猪05 Xiaohongshu-起飞吧！凤凰牌飞机！ GitHub-zssszscnplane
// @match        https://*.geo-fs.com/*
// @match        https://geo-fs.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // ---- helpers ----
    const g = 9.80665;
    function ktToMs(v) { return v * 0.514444; }
    function msToKt(v) { return v / 0.514444; }
    function ftToM(x) { return x * 0.3048; }

    // ---- defaults ----
    const defaults = {
        weight_kg: 70000,
        thrust_to_weight: 0.28,
        vstall_kt: 120,
        reaction_time: 1.5,
        rolling_mu: 0.02,
        engine_failure_fraction: 0.5,
        decel_g: 0.4
    };

    // ---- translations ----
    const TRANSLATIONS = {
        zh: {
            title: "GeoFS V1/VR/V2 计算器（近似）",
            made_by: "由 哔哩哔哩-我是小猪05 小红书-起飞吧！凤凰牌飞机！ GitHub-zssszscnplane 制作",
            lang_label: "语言",
            weight_label: "重量 (kg)",
            tw_label: "T/W (总推力/重力)",
            vstall_label: "Vstall (kt)",
            reaction_label: "反应时间 (s)",
            mu_label: "滚动摩擦 μ",
            ef_label: "单发失效推力损失(比例)",
            decel_label: "制动减速 (g)",
            btn_calc: "计算 V1/VR/V2",
            btn_sample: "示例值",
            result_title: "结果（近似）",
            description: "说明：物理模型为近似数值估算，未使用厂商查表。请以飞行手册(OM/AFM)为准。",
            toggle_title: "V1 计算器：点击打开/关闭面板"
        },
        en: {
            title: "GeoFS V1/VR/V2 Calculator (approximate)",
            made_by: "由 Bilibili-我是小猪05 Xiaohongshu-起飞吧！凤凰牌飞机！ GitHub-zssszscnplane",
            lang_label: "Language",
            weight_label: "Weight (kg)",
            tw_label: "T/W (thrust/weight)",
            vstall_label: "Vstall (kt)",
            reaction_label: "Reaction time (s)",
            mu_label: "Rolling μ",
            ef_label: "Engine failure thrust loss (fraction)",
            decel_label: "Braking decel (g)",
            btn_calc: "Compute V1/VR/V2",
            btn_sample: "Sample values",
            result_title: "Result (approx)",
            description: "Note: physical model is an approximation and does not use manufacturer tables. Refer to AFM/OM for official values.",
            toggle_title: "V1 Calculator: click to open/close panel"
        }
    };

    const STORAGE_KEY = 'geofs_vcalc_visible';
    const STORAGE_LANG = 'geofs_vcalc_lang';

    // ---- numeric simulators (unchanged) ----
    const dragK = 0.020;
    function tractiveForce(totalThrust_N, v_ms) {
        return Math.max(0, totalThrust_N - dragK * v_ms * v_ms);
    }

    function simulate_accel_distance(v_target_ms, mass_kg, thrust_N, mu, dt=0.1) {
        let v = 0, s = 0, t = 0;
        while (v < v_target_ms - 1e-6 && t < 1000) {
            const F = tractiveForce(thrust_N, v) - mu * mass_kg * g;
            const a = F / mass_kg;
            v += a * dt;
            if (v < 0) v = 0;
            s += v * dt;
            t += dt;
        }
        return { distance: s, time: t, v: v };
    }

    function braking_distance_from_speed(v_ms, decel_g_value) {
        const decel = decel_g_value * g;
        if (decel <= 0) return Infinity;
        return v_ms * v_ms / (2 * decel);
    }

    function compute_stop_distance(V_ms, params) {
        const m = params.weight_kg;
        const T = params.thrust_to_weight * params.weight_kg * g;
        const mu = params.rolling_mu;
        const t_reaction = params.reaction_time;

        const accel = simulate_accel_distance(V_ms, m, T, mu);
        const reaction_dist = V_ms * t_reaction;
        const brake_dist = braking_distance_from_speed(V_ms, params.decel_g);

        return accel.distance + reaction_dist + brake_dist;
    }

    function compute_go_distance(V_ms, params, V2_ms) {
        const m = params.weight_kg;
        const Tfull = params.thrust_to_weight * params.weight_kg * g;
        const T_after = Tfull * (1 - params.engine_failure_fraction);
        const mu = params.rolling_mu;

        const toV = simulate_accel_distance(V_ms, m, Tfull, mu);

        let extra = 0;
        if (V2_ms > V_ms) {
            const toV2_fromV = simulate_accel_distance(V2_ms, m, T_after, mu);
            const dist0V_underReduced = simulate_accel_distance(V_ms, m, T_after, mu).distance;
            extra = toV2_fromV.distance - dist0V_underReduced;
            if (extra < 0) extra = 0;
        }

        const screenHeight_m = ftToM(35);
        const climbGradient = 0.02;
        const climb_horiz = screenHeight_m / climbGradient;

        return toV.distance + extra + climb_horiz;
    }

    function findV1(params) {
        const Vstall_kt = params.vstall_kt;
        const Vstall_ms = ktToMs(Vstall_kt);

        const Vmin_ms = Math.max(ktToMs(30), 1.05 * Vstall_ms);
        const Vmax_ms = ktToMs(240);
        const maxIter = 40;

        let lo = Vmin_ms, hi = Vmax_ms;
        let v1 = lo;
        for (let i=0;i<maxIter;i++) {
            v1 = 0.5 * (lo + hi);
            const V2_ms = Math.max(1.2 * Vstall_ms, 1.1 * v1);
            const stop = compute_stop_distance(v1, params);
            const go = compute_go_distance(v1, params, V2_ms);

            if (stop > go) {
                lo = v1;
            } else {
                hi = v1;
            }
            if (Math.abs(stop - go) < 0.5) break;
        }

        const finalV1_ms = v1;
        const finalV2_ms = Math.max(1.2 * Vstall_ms, 1.1 * finalV1_ms);
        const VR_ms = Math.max(finalV1_ms * 1.05, finalV2_ms * 0.97);
        return {
            V1_kt: msToKt(finalV1_ms),
            VR_kt: msToKt(VR_ms),
            V2_kt: msToKt(finalV2_ms),
            stop_dist_m: compute_stop_distance(finalV1_ms, params),
            go_dist_m: compute_go_distance(finalV1_ms, params, finalV2_ms)
        };
    }

    // ---- UI + Toggle Button (button always visible) ----
    const style = document.createElement('style');
    style.innerHTML = `
    #vcalc-panel{position:fixed;right:12px;top:12px;width:340px;background:#111;color:#eee;padding:10px;border-radius:8px;z-index:99999;font-family:Arial, sans-serif;font-size:13px;box-shadow:0 4px 14px rgba(0,0,0,0.6)}
    #vcalc-panel h3{margin:0 0 6px 0;font-size:14px}
    #vcalc-panel .made-by{font-size:12px;color:#bbb;margin-bottom:6px}
    #vcalc-panel .lang-row{display:flex;align-items:center;gap:8px;margin-bottom:8px}
    #vcalc-panel .lang-row label{font-size:12px;color:#bbb}
    #vcalc-panel input[type="number"]{width:130px}
    #vcalc-panel .row{display:flex;justify-content:space-between;align-items:center;margin:6px 0}
    #vcalc-panel .btn{background:#2b7cd3;color:white;padding:6px 10px;border-radius:6px;border:none;cursor:pointer}
    #vcalc-panel .small{font-size:12px;color:#bbb}
    #vcalc-panel .close{position:absolute;left:8px;top:6px;cursor:pointer;color:#999}
    #vcalc-toggle{position:fixed;right:12px;bottom:12px;width:44px;height:44px;border-radius:22px;background:#2b7cd3;color:white;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 18px rgba(0,0,0,0.5);z-index:99999;cursor:pointer;font-weight:bold}
    `;
    document.head.appendChild(style);

    const panel = document.createElement('div');
    panel.id = 'vcalc-panel';
    panel.innerHTML = `
      <span class="close" title="收起">✖</span>
      <h3 id="panel-title"></h3>
      <div class="made-by" id="made-by">由 哔哩哔哩-我是小猪05 小红书-起飞吧！凤凰牌飞机！ GitHub-zssszscnplane 制作</div>
      <div class="lang-row"><label id="label-lang"></label><select id="lang-select"><option value="zh">简体中文</option><option value="en">English</option></select></div>

      <div class="row"><label class="small" id="label-weight"></label><input id="inp-weight" type="number" value="${defaults.weight_kg}"></div>
      <div class="row"><label class="small" id="label-tw"></label><input id="inp-tw" type="number" step="0.01" value="${defaults.thrust_to_weight}"></div>
      <div class="row"><label class="small" id="label-vstall"></label><input id="inp-vstall" type="number" value="${defaults.vstall_kt}"></div>
      <div class="row"><label class="small" id="label-reaction"></label><input id="inp-reaction" type="number" step="0.1" value="${defaults.reaction_time}"></div>
      <div class="row"><label class="small" id="label-mu"></label><input id="inp-mu" type="number" step="0.001" value="${defaults.rolling_mu}"></div>
      <div class="row"><label class="small" id="label-ef"></label><input id="inp-ef" type="number" step="0.05" value="${defaults.engine_failure_fraction}"></div>
      <div class="row"><label class="small" id="label-decel"></label><input id="inp-decel" type="number" step="0.05" value="${defaults.decel_g}"></div>

      <div style="display:flex;gap:8px;margin-top:8px">
        <button id="btn-calc" class="btn"></button>
        <button id="btn-sample" class="btn" style="background:#4caf50"></button>
      </div>
      <div id="result" style="margin-top:10px;font-size:13px;line-height:1.4"></div>
      <div style="margin-top:8px;color:#9aa" class="small" id="panel-desc"></div>
    `;
    document.body.appendChild(panel);

    // toggle button (always visible)
    const toggle = document.createElement('div');
    toggle.id = 'vcalc-toggle';
    toggle.title = 'V1';
    toggle.innerText = 'V1';
    document.body.appendChild(toggle);

    // initialize visibility from storage (default visible)
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === '0') {
        panel.style.display = 'none';
    } else {
        panel.style.display = 'block';
    }

    // language init
    function applyLanguage(lang) {
        const t = TRANSLATIONS[lang] || TRANSLATIONS['zh'];
        document.getElementById('panel-title').textContent = t.title;
        // made-by stays as provided by user requirement (text above selector)
        document.getElementById('label-lang').textContent = t.lang_label + ':';
        document.getElementById('label-weight').textContent = t.weight_label;
        document.getElementById('label-tw').textContent = t.tw_label;
        document.getElementById('label-vstall').textContent = t.vstall_label;
        document.getElementById('label-reaction').textContent = t.reaction_label;
        document.getElementById('label-mu').textContent = t.mu_label;
        document.getElementById('label-ef').textContent = t.ef_label;
        document.getElementById('label-decel').textContent = t.decel_label;
        document.getElementById('btn-calc').textContent = t.btn_calc;
        document.getElementById('btn-sample').textContent = t.btn_sample;
        document.getElementById('panel-desc').textContent = t.description;
        toggle.title = t.toggle_title;
        // result heading will be set when showing results
    }

    // set saved language or default zh
    const savedLang = localStorage.getItem(STORAGE_LANG) || 'zh';
    const langSelect = document.getElementById('lang-select');
    langSelect.value = savedLang;
    applyLanguage(savedLang);

    // language change handler
    langSelect.addEventListener('change', () => {
        const lv = langSelect.value || 'zh';
        localStorage.setItem(STORAGE_LANG, lv);
        applyLanguage(lv);
    });

    // draggable
    panel.onmousedown = function(e){
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' || e.target.tagName === 'SELECT') return;
        const startX = e.clientX, startY = e.clientY;
        const rect = panel.getBoundingClientRect();
        const offsetX = startX - rect.left, offsetY = startY - rect.top;
        function move(ev){
            panel.style.left = (ev.clientX - offsetX) + 'px';
            panel.style.top = (ev.clientY - offsetY) + 'px';
            panel.style.right = 'auto';
        }
        function up(){ window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); }
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
    };

    // close -> hide (not remove). Button remains visible.
    document.querySelector('#vcalc-panel .close').onclick = () => {
        panel.style.display = 'none';
        localStorage.setItem(STORAGE_KEY, '0');
    };

    // toggle click -> show/hide (button remains visible)
    toggle.onclick = () => {
        if (panel.style.display === 'none' || getComputedStyle(panel).display === 'none') {
            panel.style.display = 'block';
            localStorage.setItem(STORAGE_KEY, '1');
        } else {
            panel.style.display = 'none';
            localStorage.setItem(STORAGE_KEY, '0');
        }
    };

    // sample values
    document.getElementById('btn-sample').onclick = () => {
        document.getElementById('inp-weight').value = 70000;
        document.getElementById('inp-tw').value = 0.28;
        document.getElementById('inp-vstall').value = 120;
        document.getElementById('inp-reaction').value = 1.5;
        document.getElementById('inp-mu').value = 0.02;
        document.getElementById('inp-ef').value = 0.5;
        document.getElementById('inp-decel').value = 0.4;
    };

    document.getElementById('btn-calc').onclick = () => {
        const params = {
            weight_kg: parseFloat(document.getElementById('inp-weight').value),
            thrust_to_weight: parseFloat(document.getElementById('inp-tw').value),
            vstall_kt: parseFloat(document.getElementById('inp-vstall').value),
            reaction_time: parseFloat(document.getElementById('inp-reaction').value),
            rolling_mu: parseFloat(document.getElementById('inp-mu').value),
            engine_failure_fraction: parseFloat(document.getElementById('inp-ef').value),
            decel_g: parseFloat(document.getElementById('inp-decel').value)
        };
        const lang = localStorage.getItem(STORAGE_LANG) || 'zh';
        const t = TRANSLATIONS[lang] || TRANSLATIONS['zh'];

        if (!params.weight_kg || !params.thrust_to_weight || !params.vstall_kt) {
            document.getElementById('result').innerText = (lang === 'en') ? 'Please enter weight, T/W and Vstall at minimum.' : '请填写重量、T/W 和 Vstall（至少）。';
            return;
        }
        const out = findV1(params);
        const html = `
          <b>${t.result_title}</b><br/>
          V1 = ${out.V1_kt.toFixed(1)} kt<br/>
          VR = ${out.VR_kt.toFixed(1)} kt<br/>
          V2 = ${out.V2_kt.toFixed(1)} kt<br/>
          停止距离 ≈ ${Math.round(out.stop_dist_m)} m<br/>
          继续离地所需距离 ≈ ${Math.round(out.go_dist_m)} m
        `;
        // Note: the distances lines remain in Chinese numeric labels for quickness; localize the two lines too:
        const stopLine = (lang === 'en') ? `Stop distance ≈ ${Math.round(out.stop_dist_m)} m` : `停止距离 ≈ ${Math.round(out.stop_dist_m)} m`;
        const goLine = (lang === 'en') ? `Go/clear distance ≈ ${Math.round(out.go_dist_m)} m` : `继续离地所需距离 ≈ ${Math.round(out.go_dist_m)} m`;
        document.getElementById('result').innerHTML = `<b>${t.result_title}</b><br/>V1 = ${out.V1_kt.toFixed(1)} kt<br/>VR = ${out.VR_kt.toFixed(1)} kt<br/>V2 = ${out.V2_kt.toFixed(1)} kt<br/>${stopLine}<br/>${goLine}`;
    };

    // helpers used in math (kept below for function hoisting)
    function ktToMs(v) { return v * 0.514444; }
    function msToKt(v) { return v / 0.514444; }
    function ftToM(x) { return x * 0.3048; }

})();
