// ==UserScript==
// @name         嵯峨野小火车全自动秒选车次直达订单页
// @namespace    sagano-romantic-train
// @version      9.0
// @description  收到Bark通知点开后，全自动精准点选路线、设定2人、真机DOM精准秒选车站、精准锁定2个座位并纠错防超选，直达订单支付页！
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
    // 阶段 2: Linktivity 车次与选座系统 (v9.0 真实 DOM 精准匹配引擎)
    // =============================================================
    if (window.location.hostname.includes('linktivity.io')) {
        showHUD('⚡ [1/4] 已进入选座系统，正在锁定车站...', 'rgba(0, 122, 255, 0.95)');

        let trainSelected = false;
        let lastSeatClickTime = 0;
        let confirmSubmitted = false;

        const linktivityTimer = setInterval(() => {
            const now = Date.now();

            // =========================================================
            // ① 阶段 2.1：选车站 (精准匹配真实 DOM 下拉框与浮层按钮)
            // =========================================================
            const comboboxes = Array.from(document.querySelectorAll('div[role="combobox"]'));

            if (comboboxes.length >= 2) {
                const fromCombobox = comboboxes[0];
                const toCombobox = comboboxes[1];

                const fromText = (fromCombobox.innerText || fromCombobox.textContent || '').trim();
                const toText = (toCombobox.innerText || toCombobox.textContent || '').trim();

                const fromDone = fromText.includes('トロッコ嵯峨') || (!fromText.includes('乗車駅を選択') && fromText.length > 0);
                const toDone = toText.includes('トロッコ亀岡') || (!toText.includes('降車駅を選択') && toText.length > 0);

                // 1. 如果乘车站未选定
                if (!fromDone) {
                    // 检查浮层是否已弹出，寻找精准选项按钮
                    const sagaBtn = document.querySelector('button[title="トロッコ嵯峨"], button._menuItemButton_151dk_1');
                    if (sagaBtn && (sagaBtn.getAttribute('title') === 'トロッコ嵯峨' || (sagaBtn.innerText || '').includes('嵯峨'))) {
                        sagaBtn.click();
                        showHUD('✔ 乘车站已选中：トロッコ嵯峨', 'rgba(40, 167, 69, 0.95)');
                        return;
                    }

                    // 如果未展开浮层，点击乘车站 combobox 展开
                    const isExpanded = fromCombobox.getAttribute('aria-expanded') === 'true';
                    if (!isExpanded) {
                        fromCombobox.click();
                        fromCombobox.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                        fromCombobox.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                        fromCombobox.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                        showHUD('🚉 正在展开乘车站选项...', 'rgba(0, 122, 255, 0.95)');
                        return;
                    }
                }

                // 2. 如果乘车站已选定，降车站未选定
                if (fromDone && !toDone) {
                    // 检查浮层是否已弹出，寻找降车站精准选项按钮
                    const kameokaBtn = document.querySelector('button[title="トロッコ亀岡"]');
                    if (kameokaBtn && !kameokaBtn.disabled) {
                        kameokaBtn.click();
                        showHUD('✔ 降车站已选中：トロッコ亀岡，正在查询车次...', 'rgba(40, 167, 69, 0.95)');
                        return;
                    }

                    // 如果未展开浮层，点击降车站 combobox 展开
                    const isExpanded = toCombobox.getAttribute('aria-expanded') === 'true';
                    if (!isExpanded) {
                        toCombobox.click();
                        toCombobox.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                        toCombobox.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                        toCombobox.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                        showHUD('🏁 正在展开降车站选项...', 'rgba(0, 122, 255, 0.95)');
                        return;
                    }
                }
            }

            // =========================================================
            // ② 阶段 2.2：车次选择 (自动选中并点击「次へ」)
            // =========================================================
            if (!trainSelected) {
                const trainBtns = Array.from(document.querySelectorAll('button[class*="_train_"], button')).filter(b => {
                    const cls = b.className || '';
                    const t = (b.innerText || b.textContent || '').trim();
                    const isTrain = (typeof cls === 'string' && cls.includes('_train_')) || (t.includes('嵯峨野') && t.includes('号'));
                    return isTrain && !b.disabled && !b.hasAttribute('disabled');
                });

                if (trainBtns.length > 0) {
                    let targetTrain = trainBtns[0];
                    if (targetService) {
                        const matched = trainBtns.find(b => (b.outerHTML || '').includes(targetService) || (b.innerText || '').includes(targetService));
                        if (matched) targetTrain = matched;
                    }

                    targetTrain.click();
                    const trainText = (targetTrain.innerText || '').split('\n')[0].trim();
                    showHUD(`✔ [2/4] 已自动选定车次：${trainText}，正在进入选座...`, 'rgba(40, 167, 69, 0.95)');

                    // 点击底部的「次へ」按钮（_filled_ 类按钮）
                    const nextBtn = document.querySelector('div[class*="_footer_"] button[class*="_filled_"], button._filled_4p3z7_30');
                    if (nextBtn && !nextBtn.disabled) {
                        nextBtn.click();
                        trainSelected = true;
                    }
                    return;
                }
            }

            // =========================================================
            // ③ 阶段 2.3：选座页面 (精准 2/2，严格限制数量，选满立即直达)
            // =========================================================
            const carriageBtn = document.querySelector('button[class*="_carriageContainer_"], button._carriageContainer_h139u_1');

            if (carriageBtn) {
                // 1. 判断 1 号车厢是否已展开（根据真实 DOM 中的 _activeArrow_ 类名）
                const isCarriageActive = !!document.querySelector('svg[class*="_activeArrow_"], ._activeArrow_h139u_20');

                if (!isCarriageActive) {
                    carriageBtn.click();
                    showHUD('✔ [3/4] 正在展开 1 号车厢座位图...', 'rgba(0, 122, 255, 0.95)');
                    return;
                }

                // 2. 真实 DOM 提取：已选中的座位 vs 可用空位
                // 根据用户提供的真实 DOM：已选中的座位带有 _selected_1t8uk_216
                const selectedSeats = Array.from(document.querySelectorAll('button[class*="_selected_1t8uk_"], button[class*="_selected_"]'));

                // 可用的空闲座位：带有 _seatInner_ 且没有 disabled、没有 _disabled_、没有 _selected_
                const availableSeats = Array.from(document.querySelectorAll('button[class*="_seatInner_"]:not([disabled]):not([class*="_disabled_"]):not([class*="_selected_"])'));

                // 读取页面底部的真实计数（如 "2/2"）
                const countEl = document.querySelector('p[class*="_count_"], p._count_h139u_58');
                const countText = countEl ? (countEl.innerText || '').trim() : '';

                // 情况 A：已经选满目标人数（正好等于 2 人，或底部显示 "2/2"）
                if (selectedSeats.length === targetUnits || countText === `${targetUnits}/${targetUnits}`) {
                    showHUD(`🎉 成功锁定 ${targetUnits} 个座位！正在提交直达...`, 'rgba(40, 167, 69, 0.95)');

                    // 点击底部的「次へ」按钮进入确认页
                    const nextBtn = document.querySelector('div[class*="_footer_"] button[class*="_filled_"], button._filled_4p3z7_30');
                    if (nextBtn && !nextBtn.disabled) {
                        nextBtn.click();
                    }
                    return;
                }

                // 情况 B：如果之前多选了导致超过 2 人（例如 4/2），自动反选多出来的座位降到 2 人！
                if (selectedSeats.length > targetUnits) {
                    if (now - lastSeatClickTime > 400) {
                        const excessSeat = selectedSeats[selectedSeats.length - 1];
                        excessSeat.click();
                        lastSeatClickTime = now;
                        showHUD(`⚠️ 座位超额，正在自动修正 (${selectedSeats.length - 1}/${targetUnits})...`, 'rgba(255, 149, 0, 0.95)');
                    }
                    return;
                }

                // 情况 C：座位不足 2 人，点击下一个可用座位（严格防抖 400ms，一次只点一个，绝不过冲）
                if (selectedSeats.length < targetUnits && availableSeats.length > 0) {
                    if (now - lastSeatClickTime > 400) {
                        const seatToClick = availableSeats[0];
                        seatToClick.click();
                        lastSeatClickTime = now;
                        showHUD(`💺 正在锁定座位 (${selectedSeats.length + 1}/${targetUnits})...`, 'rgba(40, 167, 69, 0.95)');
                    }
                    return;
                }
            }

            // =========================================================
            // ④ 阶段 2.4：确认页面直接提交，直达订单支付页
            // =========================================================
            const isConfirmPage = !!document.querySelector('div[class*="_orderConfirm_"], div[class*="_carriageList_"]');
            const confirmNextBtn = document.querySelector('div[class*="_footer_"] button[class*="_filled_"], button._filled_4p3z7_30');

            if (isConfirmPage && confirmNextBtn && !confirmNextBtn.disabled && !confirmSubmitted) {
                confirmNextBtn.click();
                confirmSubmitted = true;
                showHUD('🎉 选座锁定成功！正在火速直达订单支付页...', 'rgba(40, 167, 69, 0.95)');
                clearInterval(linktivityTimer);
            }
        }, 150);

        setTimeout(() => clearInterval(linktivityTimer), 45000);
    }

    // =============================================================
    // 阶段 3: 订单填写与支付页
    // =============================================================
    if (window.location.pathname.includes('/booking/pay')) {
        showHUD('🎉 恭喜！已全自动直达订单支付页！请核对并支付！', 'rgba(40, 167, 69, 0.95)');
    }
})();
