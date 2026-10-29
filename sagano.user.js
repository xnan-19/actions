// ==UserScript==
// @name         嵯峨野小火车全自动秒选车次直达订单页
// @namespace    sagano-romantic-train
// @version      5.2
// @description  收到Bark通知点开后，全自动精准点选路线、展开数量、设定2人、点击预约直达订单页！
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
            hud.style.cssText = 'position:fixed;top:38%;left:5%;width:90%;z-index:2147483647;padding:16px 20px;font-size:16px;font-weight:bold;text-align:center;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,0.5);pointer-events:none;transition:all 0.3s ease;';
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

        let dateDone = false;
        let routeDone = false;
        let unitCount = 0;
        let submitDone = false;

        const mainTimer = setInterval(() => {
            // ① 自动翻到目标月份（如 11 月）
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
                    // 已是目标月份，查找并点击目标日期（如 10 号）
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

            // ② 自动选择路线：必须精准点击 BUTTON.PlanPicker_planPicker_KCJLc
            if (!routeDone) {
                const routeButtons = Array.from(document.querySelectorAll('button[class*="PlanPicker"], button')).filter(b => {
                    const t = (b.innerText || '').trim();
                    return t.includes('嵯峨駅') && t.includes('亀岡駅') && t.startsWith('嵯峨');
                });

                if (routeButtons.length > 0) {
                    const targetBtn = routeButtons[0];
                    targetBtn.click();
                    targetBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                    targetBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                    targetBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

                    // 检查按钮是否已高亮，或数量区域是否已展开
                    const isChecked = targetBtn.className.includes('checked') || targetBtn.className.includes('active');
                    const hasQuantity = !!document.querySelector('button use[xlink\\:href*="plus"], button use[*|href*="plus"]');

                    if (isChecked || hasQuantity) {
                        routeDone = true;
                        showHUD('✔ 路线已成功选中：嵯峨/岚山 ➔ 龟冈', 'rgba(40, 167, 69, 0.95)');
                    }
                }
            }

            // ③ 自动设定人数：点击「大人 (12歳以上)」加号按钮直到达到目标人数
            if (routeDone && unitCount < targetUnits) {
                const plusBtns = Array.from(document.querySelectorAll('button')).filter(b => {
                    const use = b.querySelector('use');
                    const href = use ? (use.getAttribute('xlink:href') || use.getAttribute('href') || '') : '';
                    return href.includes('plus') || (b.className || '').toLowerCase().includes('plus');
                });

                if (plusBtns.length > 0) {
                    const adultPlus = plusBtns[0];
                    adultPlus.click();
                    unitCount++;
                    showHUD(`👥 已设定人数: ${unitCount}/${targetUnits} 人`, 'rgba(40, 167, 69, 0.95)');
                }
            }

            // ④ 自动点击「予約手続きへ」进入车次/选座流程
            if (!submitDone) {
                const allBtns = Array.from(document.querySelectorAll('button'));
                const submitBtn = allBtns.find(b => {
                    const txt = (b.innerText || b.textContent || '').trim();
                    return (txt.includes('予約手続き') || txt.includes('予約へ進む') || txt.includes('Checkout')) && !b.disabled && !b.hasAttribute('disabled');
                });

                if (submitBtn) {
                    submitDone = true;
                    showHUD('🎉 人数与路线已全部就绪！正在极速进入车次订单页...', 'rgba(40, 167, 69, 0.95)');
                    submitBtn.click();
                    submitBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                    clearInterval(mainTimer);
                }
            }
        }, 150);

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
