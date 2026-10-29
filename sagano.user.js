// ==UserScript==
// @name         嵯峨野小火车全自动秒选车次直达订单页
// @namespace    sagano-romantic-train
// @version      6.1
// @description  收到Bark通知点开后，全自动精准点选路线、设定2人、自动选择车站下拉框、自动选车次、自动展开车厢锁定座位，直达订单支付页！
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
    // 阶段 2: Linktivity 车次与选座系统 (全自动选车站、选车次、选车厢、选座、确认)
    // =============================================================
    if (window.location.hostname.includes('linktivity.io')) {
        showHUD('🚀 抵达车次与选座系统，正在极速匹配...', 'rgba(0, 122, 255, 0.95)');

        let fromStationSelected = false;
        let toStationSelected = false;
        let trainSelected = false;
        let carriageIndex = 0;
        let lastSeatClickTime = 0;
        let confirmClicked = false;

        const linktivityTimer = setInterval(() => {
            // ---------------------------------------------------------
            // ① 步骤 2.1：自动选车站（处理乗車駅和降車駅下拉框）
            // ---------------------------------------------------------
            // 1. 乘车站（トロッコ嵯峨）
            if (!fromStationSelected) {
                // 检查是否已经在页面选定嵯峨
                const selectedSaga = Array.from(document.querySelectorAll('div, span')).some(el => {
                    const t = (el.innerText || '').trim();
                    return t === 'トロッコ嵯峨' && !el.closest('[class*="option"], ul, li');
                });

                if (selectedSaga) {
                    fromStationSelected = true;
                } else {
                    // 查找乘车站下拉框并点击展开
                    const startStationBox = Array.from(document.querySelectorAll('div, button, input, span')).find(el => {
                        const t = (el.innerText || el.textContent || '').trim();
                        return t === '乗車駅を選択してください' || t.includes('乗車駅を選択');
                    });

                    if (startStationBox) {
                        startStationBox.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                        startStationBox.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                        startStationBox.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                        showHUD('🚉 正在选择乘车站：トロッコ嵯峨...', 'rgba(0, 122, 255, 0.95)');
                    }

                    // 在展开的浮层选项中查找并点击「トロッコ嵯峨」
                    const sagaOption = Array.from(document.querySelectorAll('div, li, button, span, p')).find(el => {
                        const t = (el.innerText || el.textContent || '').trim();
                        return t === 'トロッコ嵯峨' || (t.includes('嵯峨') && !t.includes('嵐山') && !t.includes('亀岡') && !t.includes('選択') && !t.includes('乗車駅'));
                    });

                    if (sagaOption) {
                        sagaOption.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                        sagaOption.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                        sagaOption.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                        fromStationSelected = true;
                        showHUD('✔ 乘车站已选中：トロッコ嵯峨', 'rgba(40, 167, 69, 0.95)');
                        return;
                    }
                }
            }

            // 2. 降车站（トロッコ亀岡）
            if (fromStationSelected && !toStationSelected) {
                // 检查是否已经在页面选定亀岡
                const selectedKameoka = Array.from(document.querySelectorAll('div, span')).some(el => {
                    const t = (el.innerText || '').trim();
                    return t === 'トロッコ亀岡' && !el.closest('[class*="option"], ul, li');
                });

                if (selectedKameoka) {
                    toStationSelected = true;
                } else {
                    // 查找降车站下拉框并点击展开
                    const endStationBox = Array.from(document.querySelectorAll('div, button, input, span')).find(el => {
                        const t = (el.innerText || el.textContent || '').trim();
                        return t === '降車駅を選択してください' || t.includes('降車駅を選択');
                    });

                    if (endStationBox) {
                        endStationBox.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                        endStationBox.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                        endStationBox.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                        showHUD('🏁 正在选择降车站：トロッコ亀岡...', 'rgba(0, 122, 255, 0.95)');
                    }

                    // 在展开的浮层选项中查找并点击「トロッコ亀岡」
                    const kameokaOption = Array.from(document.querySelectorAll('div, li, button, span, p')).find(el => {
                        const t = (el.innerText || el.textContent || '').trim();
                        return t === 'トロッコ亀岡' || (t.includes('亀岡') && !t.includes('選択') && !t.includes('降車駅'));
                    });

                    if (kameokaOption) {
                        kameokaOption.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                        kameokaOption.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                        kameokaOption.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                        toStationSelected = true;
                        showHUD('✔ 降车站已选中：トロッコ亀岡，正在查询车次...', 'rgba(40, 167, 69, 0.95)');
                        return;
                    }
                }
            }

            // ---------------------------------------------------------
            // ② 步骤 2.2：自动选车次并点击「次へ」进入选座
            // ---------------------------------------------------------
            if (!trainSelected) {
                const trainBtns = Array.from(document.querySelectorAll('button')).filter(b => {
                    const cls = b.className || '';
                    const t = (b.innerText || b.textContent || '').trim();
                    const isTrainClass = (typeof cls === 'string') && cls.includes('_train_');
                    const isTrainText = (t.includes('嵯峨野') || (t.includes('号') && t.includes(':'))) && !t.includes('号車');
                    return (isTrainClass || isTrainText) && !b.disabled && !b.hasAttribute('disabled');
                });

                if (trainBtns.length > 0) {
                    let targetTrain = trainBtns[0];
                    if (targetService) {
                        const matched = trainBtns.find(b => (b.outerHTML || '').includes(targetService) || (b.innerText || '').includes(targetService));
                        if (matched) targetTrain = matched;
                    }

                    targetTrain.click();
                    targetTrain.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                    const trainText = (targetTrain.innerText || '').split('\n')[0].trim();
                    showHUD(`✔ 已自动选中车次：${trainText}，正在下一步...`, 'rgba(40, 167, 69, 0.95)');

                    // 点击底部的「次へ」按钮进入选座
                    const nextBtn = Array.from(document.querySelectorAll('button')).find(b => {
                        const t = (b.innerText || '').trim();
                        return (t === '次へ' || t === 'Next' || t === '下一步') && !b.disabled && !b.hasAttribute('disabled');
                    });

                    if (nextBtn) {
                        nextBtn.click();
                        nextBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                        trainSelected = true;
                    }
                    return;
                }
            }

            // ---------------------------------------------------------
            // ③ 步骤 2.3：选座页面（展开车厢并精准勾选空闲座位）
            // ---------------------------------------------------------
            const carriageBtns = Array.from(document.querySelectorAll('button')).filter(b => {
                const t = (b.innerText || '').trim();
                const cls = b.className || '';
                return (t.includes('号車') || t.includes('Car No') || (typeof cls === 'string' && cls.includes('carriageContainer'))) && !t.includes('次へ');
            });

            if (carriageBtns.length > 0) {
                // 查找所有座位按钮（真正带 onClick 的 button）
                const seatButtons = Array.from(document.querySelectorAll('button[class*="_seatInner_"], div[class*="_seat_"] button'));

                // 如果座位尚未展开，点击当前车厢按钮展开
                if (seatButtons.length === 0) {
                    if (carriageBtns[carriageIndex]) {
                        carriageBtns[carriageIndex].click();
                        carriageBtns[carriageIndex].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                        showHUD(`✔ 正在展开第 ${carriageIndex + 1} 个车厢...`, 'rgba(0, 122, 255, 0.95)');
                    }
                    return;
                }

                // 统计已选中的座位数（带 _selected_ 类名）
                const selectedSeatBtns = seatButtons.filter(b => {
                    const cls = b.className || '';
                    return cls.includes('_selected_') || cls.includes('selected');
                });

                // 读取页面底部的数量计数（如 "2/2"）
                const countEl = document.querySelector('[class*="_count_"], [class*="count"]');
                const countText = countEl ? (countEl.innerText || '').trim() : '';

                // 判断是否已经选够了人数（例如已选中 2 人）
                if (selectedSeatBtns.length >= targetUnits || (countText && countText.startsWith(`${targetUnits}/`))) {
                    showHUD(`🎉 成功锁定 ${targetUnits} 个座位！正在点击下一步...`, 'rgba(40, 167, 69, 0.95)');

                    // 点击底部的「次へ」按钮进入订单确认页
                    const nextBtn = Array.from(document.querySelectorAll('button')).find(b => {
                        const t = (b.innerText || '').trim();
                        return (t === '次へ' || t === 'Next' || t === '下一步') && !b.disabled && !b.hasAttribute('disabled');
                    });

                    if (nextBtn) {
                        nextBtn.click();
                        nextBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                    }
                    return;
                }

                // 查找所有可点击的空闲座位（排除 disabled、_disabled_ 以及已选中的座位）
                const now = Date.now();
                if (now - lastSeatClickTime > 250) {
                    const availableSeatBtns = seatButtons.filter(b => {
                        if (b.disabled || b.hasAttribute('disabled')) return false;
                        const cls = b.className || '';
                        if (cls.includes('_disabled') || cls.includes('disabled')) return false;
                        if (cls.includes('_selected') || cls.includes('selected')) return false;
                        return true;
                    });

                    if (availableSeatBtns.length > 0) {
                        const seatBtn = availableSeatBtns[0];
                        seatBtn.click();
                        seatBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                        seatBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                        seatBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                        lastSeatClickTime = now;
                        showHUD(`💺 正在锁定座位 (${selectedSeatBtns.length + 1}/${targetUnits})...`, 'rgba(40, 167, 69, 0.95)');
                        return;
                    } else {
                        // 当前车厢空位不足，切换展开下一个车厢
                        if (carriageIndex + 1 < carriageBtns.length) {
                            carriageIndex++;
                            carriageBtns[carriageIndex].click();
                            carriageBtns[carriageIndex].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                            showHUD(`🔍 切换至车厢 ${carriageIndex + 1} 寻找可用座位...`, 'rgba(255, 149, 0, 0.95)');
                            return;
                        }
                    }
                }
            }

            // ---------------------------------------------------------
            // ④ 步骤 2.4：确认页面自动提交直达订单支付页
            // ---------------------------------------------------------
            const isConfirmPage = !!document.querySelector('[class*="orderConfirm"], [class*="carriageList"]');
            const actionBtns = Array.from(document.querySelectorAll('button')).filter(b => {
                const t = (b.innerText || '').trim();
                return (t.includes('次へ') || t.includes('確定') || t.includes('予約確認') || t.includes('進む') || t.includes('Next')) && !b.disabled && !b.hasAttribute('disabled');
            });

            if (actionBtns.length > 0 && isConfirmPage && !confirmClicked) {
                const btn = actionBtns[actionBtns.length - 1];
                btn.click();
                btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                confirmClicked = true;
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
        showHUD('🎉 恭喜！已全自动抵达订单支付页！请核对并支付！', 'rgba(40, 167, 69, 0.95)');
    }
})();
