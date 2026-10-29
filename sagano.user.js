// ==UserScript==
// @name         嵯峨野小火车全自动秒选车次直达订单页
// @namespace    sagano-romantic-train
// @version      5.0
// @description  收到Bark通知点开后，全自动选路线、翻月、选日期、选车次、选人数，直达订单填写与支付页！
// @match        *://ars-saganokanko.triplabo.jp/*
// @match        *://file.sagano.linktivity.io/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    function showHUD(text, bgColor) {
        let hud = document.getElementById('sagano-hud');
        if (!hud) {
            hud = document.createElement('div');
            hud.id = 'sagano-hud';
            hud.style.cssText = 'position:fixed;top:40%;left:5%;width:90%;z-index:2147483647;padding:16px 20px;font-size:16px;font-weight:bold;text-align:center;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,0.5);pointer-events:none;transition:all 0.3s ease;';
            (document.body || document.documentElement).appendChild(hud);
        }
        hud.style.background = bgColor || 'rgba(0, 122, 255, 0.95)';
        hud.style.color = '#ffffff';
        hud.innerHTML = text;
    }

    showHUD('⚡【全自动抢票已启动】正在检索车票...', 'rgba(0, 122, 255, 0.95)');

    const url = new URL(window.location.href);
    const params = url.searchParams;

    const targetDate = params.get('date') || sessionStorage.getItem('sagano_target_date') || '2026-11-10';
    const targetService = params.get('serviceId') || sessionStorage.getItem('sagano_service_id') || '';
    const targetUnits = parseInt(params.get('unitsCount') || '2', 10);

    sessionStorage.setItem('sagano_target_date', targetDate);
    if (targetService) sessionStorage.setItem('sagano_service_id', targetService);

    // =============================================================
    // 阶段 1: 活动详情页 (自动选路线、翻月、选日期、选人数、进入预约)
    // =============================================================
    if (window.location.pathname.includes('/activity/')) {
        let targetMonth = '11月';
        let targetDay = '10';
        if (targetDate && targetDate.includes('-')) {
            const p = targetDate.split('-');
            if (p.length === 3) {
                targetMonth = parseInt(p[1], 10) + '月';
                targetDay = String(parseInt(p[2], 10));
            }
        }

        let routeDone = false;
        let dateDone = false;
        let unitDone = false;
        let submitDone = false;

        const mainTimer = setInterval(() => {
            // ① 自动翻到 11 月
            const monthHeader = document.querySelector('[class*="dateTableCurrent"], [class*="month"], [class*="dateTableHead"] p');
            if (monthHeader) {
                const curMonth = (monthHeader.innerText || monthHeader.textContent || '');
                if (!curMonth.includes(targetMonth)) {
                    const nextButtons = document.querySelectorAll('button[class*="Next"], button[class*="next"], [class*="dateTableHead"] button');
                    if (nextButtons.length > 0) {
                        const nextBtn = nextButtons[nextButtons.length - 1];
                        if (!nextBtn.disabled) {
                            nextBtn.click();
                            showHUD(`📅 正在翻月切换到 ${targetMonth}...`, 'rgba(255, 149, 0, 0.95)');
                            return;
                        }
                    }
                } else if (!dateDone) {
                    // 已是 11 月，查找并点击目标日期（如 10 号）
                    const dayButtons = document.querySelectorAll('button[class*="dateTableDayButton"], [class*="dateTableBodyCell"] button, [class*="day"] button');
                    for (const btn of dayButtons) {
                        if (btn.hasAttribute('disabled') || btn.disabled) continue;
                        const dText = (btn.innerText || btn.textContent || '').trim();
                        if (dText === targetDay) {
                            btn.click();
                            dateDone = true;
                            showHUD(`✔ 已成功选中日期：${targetMonth}${targetDay}日`, 'rgba(40, 167, 69, 0.95)');
                            break;
                        }
                    }
                }
            }

            // ② 自动选择路线：精确点击「嵯峨駅／嵐山駅 → 亀岡駅」按钮
            if (dateDone && !routeDone) {
                const candidates = document.querySelectorAll('#selectPlan button, #selectPlan [class*="PlanPicker"], [id="selectPlan"] *');
                for (const el of candidates) {
                    const txt = (el.innerText || el.textContent || '').trim();
                    if (txt.includes('嵯峨駅') && txt.includes('亀岡駅') && txt.startsWith('嵯峨')) {
                        const targetBtn = el.closest('button') || el;
                        targetBtn.click();
                        targetBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                        
                        const radio = targetBtn.querySelector('input[type="radio"]');
                        if (radio) {
                            radio.checked = true;
                            radio.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                        routeDone = true;
                        showHUD('✔ 路线已自动选中：嵯峨/岚山 ➔ 龟冈', 'rgba(40, 167, 69, 0.95)');
                        break;
                    }
                }
            }

            // ③ 自动设定人数为 2 人
            if (dateDone) {
                const plusBtns = document.querySelectorAll('button[class*="plus"], [class*="plus"], [class*="InputNumber"] button:last-child');
                const inputs = document.querySelectorAll('input[type="number"], [class*="InputNumber"] input');
                let cur = 0;
                if (inputs.length > 0) {
                    cur = parseInt(inputs[0].value || '0', 10);
                }
                if (cur < targetUnits && plusBtns.length > 0) {
                    plusBtns[0].click();
                } else if (cur >= targetUnits) {
                    unitDone = true;
                }
            }

            // ④ 自动点击「予約手続きへ」进入车次/选座流程
            if (!submitDone) {
                const allBtns = document.querySelectorAll('button');
                for (const b of allBtns) {
                    const bTxt = (b.innerText || b.textContent || '').trim();
                    if ((bTxt.includes('予約手続き') || bTxt.includes('予約へ進む') || bTxt.includes('Checkout')) && !b.disabled && !b.hasAttribute('disabled')) {
                        submitDone = true;
                        showHUD('🎉 正在极速冲刺进入车次与订单页...', 'rgba(40, 167, 69, 0.95)');
                        b.click();
                        b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                        clearInterval(mainTimer);
                        break;
                    }
                }
            }
        }, 100);

        setTimeout(() => clearInterval(mainTimer), 30000);
    }

    // =============================================================
    // 阶段 2: Linktivity 选座系统 (自动确认直达订单页)
    // =============================================================
    if (window.location.hostname.includes('linktivity.io')) {
        showHUD('🚀 抵达选座系统，正在锁定车次与座位...', 'rgba(40, 167, 69, 0.95)');
        const seatTimer = setInterval(() => {
            const allButtons = document.querySelectorAll('button');
            for (const b of allButtons) {
                const text = (b.innerText || '').trim();
                if ((text.includes('確定') || text.includes('次へ') || text.includes('進む') || text.includes('予約')) && !b.disabled) {
                    b.click();
                    clearInterval(seatTimer);
                    break;
                }
            }
        }, 200);

        setTimeout(() => clearInterval(seatTimer), 25000);
    }

    // =============================================================
    // 阶段 3: 订单填写与支付页
    // =============================================================
    if (window.location.pathname.includes('/booking/pay')) {
        showHUD('🎉 恭喜！已成功直接停留在订单支付页！', 'rgba(40, 167, 69, 0.95)');
    }
})();
