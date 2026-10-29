// ==UserScript==
// @name         嵯峨野小火车全自动秒选车次直达订单页
// @namespace    sagano-romantic-train
// @version      6.0
// @description  收到Bark通知点开后，全自动精准点选路线、展开数量、设定2人、自动选车次、自动选座直达订单支付页！
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

    const url = new URL(window.location.href);
    const params = url.searchParams;

    const targetDate = params.get('date') || sessionStorage.getItem('sagano_target_date') || '2026-11-10';
    const targetService = params.get('serviceId') || sessionStorage.getItem('sagano_service_id') || '';
    const targetUnits = parseInt(params.get('unitsCount') || '2', 10);

    // =============================================================
    // 阶段 1: 活动详情页 (自动选路线、翻月、选日期、选人数、进入预约)
    // =============================================================
    if (window.location.pathname.includes('/activity/')) {
        showHUD('⚡【全自动抢票已启动】正在检索车票...', 'rgba(0, 122, 255, 0.95)');

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
                    showHUD('🎉 正在极速冲刺进入车次与选座页...', 'rgba(40, 167, 69, 0.95)');
                    submitBtn.click();
                    submitBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                    clearInterval(mainTimer);
                }
            }
        }, 150);

        setTimeout(() => clearInterval(mainTimer), 30000);
    }

    // =============================================================
    // 阶段 2: Linktivity 车次与选座系统 (全自动选车次、选车厢、选座、确认)
    // =============================================================
    if (window.location.hostname.includes('linktivity.io')) {
        showHUD('🚀 抵达车次与选座系统，正在极速匹配...', 'rgba(0, 122, 255, 0.95)');

        let trainSelected = false;
        let carriageExpanded = false;
        let seatsClicked = 0;
        let confirmClicked = false;

        const linktivityTimer = setInterval(() => {
            // ---------------------------------------------------------
            // ① 步骤一：自动选车次并点击「次へ」
            // ---------------------------------------------------------
            if (!trainSelected) {
                // 查找所有车次按钮（带有嵯峨野或时间的可用按钮）
                const trainBtns = Array.from(document.querySelectorAll('button')).filter(b => {
                    const t = (b.innerText || b.textContent || '').trim();
                    return (t.includes('嵯峨野') || (t.includes('号') && t.includes(':'))) && !b.disabled;
                });

                if (trainBtns.length > 0) {
                    // 优先选择包含目标车次 ID 或未禁用的首个车次
                    let targetTrain = trainBtns[0];
                    if (targetService) {
                        const matched = trainBtns.find(b => (b.outerHTML || '').includes(targetService));
                        if (matched) targetTrain = matched;
                    }

                    targetTrain.click();
                    const trainText = (targetTrain.innerText || '').split('\n')[0].trim();
                    showHUD(`✔ 已自动选中车次：${trainText}，正在下一步...`, 'rgba(40, 167, 69, 0.95)');

                    // 点击底部的「次へ」按钮进入选座
                    const nextBtn = Array.from(document.querySelectorAll('button')).find(b => {
                        const t = (b.innerText || '').trim();
                        return (t === '次へ' || t === 'Next' || t === '下一步') && !b.disabled;
                    });

                    if (nextBtn) {
                        nextBtn.click();
                        trainSelected = true;
                    }
                    return;
                }
            }

            // ---------------------------------------------------------
            // ② 步骤二：选座页面（自动展开车厢并勾选座位）
            // ---------------------------------------------------------
            const carriageBtns = Array.from(document.querySelectorAll('button')).filter(b => {
                const t = (b.innerText || '').trim();
                return t.includes('号車') || t.includes('Car No');
            });

            if (carriageBtns.length > 0 && seatsClicked < targetUnits) {
                // 展开第 1 个可用车厢（或包含 1号車 / 4号車）
                if (!carriageExpanded) {
                    carriageBtns[0].click();
                    carriageExpanded = true;
                    showHUD('✔ 已自动展开车厢，正在极速锁座...', 'rgba(40, 167, 69, 0.95)');
                    return;
                }

                // 在展开的座位图中，查找所有可点击的空位（非禁用且非占用）
                const allSeatDivs = Array.from(document.querySelectorAll('div, button')).filter(el => {
                    const cls = el.className || '';
                    return (typeof cls === 'string') && cls.includes('seat_') && !cls.includes('List') && !cls.includes('Line');
                });

                for (const seatEl of allSeatDivs) {
                    if (seatsClicked >= targetUnits) break;
                    // 点击空闲座位
                    seatEl.click();
                    seatEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                    seatsClicked++;
                }
            }

            // ---------------------------------------------------------
            // ③ 步骤三：点击底部的「次へ」或「確定」进入订单支付页
            // ---------------------------------------------------------
            const actionBtns = Array.from(document.querySelectorAll('button')).filter(b => {
                const t = (b.innerText || '').trim();
                return (t.includes('次へ') || t.includes('確定') || t.includes('予約確認') || t.includes('進む') || t.includes('Next')) && !b.disabled;
            });

            if (actionBtns.length > 0 && !confirmClicked) {
                const btn = actionBtns[actionBtns.length - 1]; // 通常在最底部
                btn.click();
                showHUD('🎉 座位已锁定！正在火速直达订单支付页...', 'rgba(40, 167, 69, 0.95)');
                if ((btn.innerText || '').includes('確定') || (btn.innerText || '').includes('確認')) {
                    confirmClicked = true;
                    clearInterval(linktivityTimer);
                }
            }
        }, 200);

        setTimeout(() => clearInterval(linktivityTimer), 35000);
    }

    // =============================================================
    // 阶段 3: 订单填写与支付页
    // =============================================================
    if (window.location.pathname.includes('/booking/pay')) {
        showHUD('🎉 恭喜！已全自动抵达订单支付页！请核对并支付！', 'rgba(40, 167, 69, 0.95)');
    }
})();
