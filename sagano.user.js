// ==UserScript==
// @name         嵯峨野小火车全自动秒选车次直达订单页
// @namespace    sagano-romantic-train
// @version      10.0
// @description  收到Bark通知点开后，全自动精准点选路线、设定2人、真机DOM精准秒选车站、精准锁定2个座位(严格2/2超额自动反选纠错)，直达订单支付页！
// @match        *://ars-saganokanko.triplabo.jp/*
// @match        *://file.sagano.linktivity.io/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // 屏幕顶部悬浮状态提示条 (HUD)
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

    // 全兼容移动端 iOS Safari 与 React 合成事件的仿真点击触发器
    function simulatePointerClick(element) {
        if (!element) return;
        const rect = element.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;

        const eventProps = {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: x,
            clientY: y,
            screenX: x,
            screenY: y,
            button: 0,
            buttons: 1
        };

        // 1. Touch 触控事件 (针对 iOS Safari 移动端)
        try {
            if (typeof Touch !== 'undefined' && typeof TouchEvent !== 'undefined') {
                const touch = new Touch({
                    identifier: Date.now(),
                    target: element,
                    clientX: x,
                    clientY: y,
                    screenX: x,
                    screenY: y,
                    pageX: x + window.scrollX,
                    pageY: y + window.scrollY,
                    radiusX: 5,
                    radiusY: 5
                });
                element.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [touch], targetTouches: [touch], changedTouches: [touch] }));
                element.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [touch] }));
            }
        } catch (e) {}

        // 2. Pointer 指针事件
        try {
            element.dispatchEvent(new PointerEvent('pointerdown', Object.assign({ pointerType: 'touch', isPrimary: true }, eventProps)));
            element.dispatchEvent(new PointerEvent('pointerup', Object.assign({ pointerType: 'touch', isPrimary: true }, eventProps)));
        } catch (e) {}

        // 3. Mouse 鼠标事件与原生 click
        element.dispatchEvent(new MouseEvent('mousedown', eventProps));
        element.dispatchEvent(new MouseEvent('mouseup', eventProps));
        element.dispatchEvent(new MouseEvent('click', eventProps));
        try { element.click(); } catch (e) {}

        // 4. React Fiber 事件处理函数直接调用 (绕过合成事件层)
        for (const key in element) {
            if (key.startsWith('__reactProps') || key.startsWith('__reactEventHandlers')) {
                const props = element[key];
                if (props) {
                    if (typeof props.onClick === 'function') {
                        try { props.onClick({ stopPropagation: () => {}, preventDefault: () => {}, target: element, currentTarget: element }); } catch (err) {}
                    }
                    if (typeof props.onPointerDown === 'function') {
                        try { props.onPointerDown({ stopPropagation: () => {}, preventDefault: () => {}, target: element, currentTarget: element }); } catch (err) {}
                    }
                }
            }
        }
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

            // ② 自动选择路线：点击嵯峨野小火车路线
            if (!routeDone) {
                const routeButtons = Array.from(document.querySelectorAll('button[class*="PlanPicker"], button')).filter(b => {
                    const t = (b.innerText || '').trim();
                    return t.includes('嵯峨駅') && t.includes('亀岡駅') && t.startsWith('嵯峨');
                });

                if (routeButtons.length > 0) {
                    const targetBtn = routeButtons[0];
                    simulatePointerClick(targetBtn);

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
                    simulatePointerClick(adultPlus);
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
                    simulatePointerClick(submitBtn);
                    clearInterval(mainTimer);
                }
            }
        }, 150);

        setTimeout(() => clearInterval(mainTimer), 30000);
    }

    // =============================================================
    // 阶段 2: Linktivity 车次与选座系统 (v10.0 真实 DOM 精准匹配引擎)
    // =============================================================
    if (window.location.hostname.includes('linktivity.io')) {
        showHUD('⚡ [1/4] 已进入选座系统，正在锁定车站...', 'rgba(0, 122, 255, 0.95)');

        let trainSelected = false;
        let lastSeatClickTime = 0;
        let lastStationClickTime = 0;
        let confirmSubmitted = false;

        const linktivityTimer = setInterval(() => {
            const now = Date.now();

            // =========================================================
            // ① 阶段 2.1：选车站 (根据真实 DOM 标签匹配 Combobox 与 Popper 选项)
            // =========================================================
            // 真实 DOM: <p class="_label_xcgtf_11">乗車駅</p> 后紧跟 <div role="combobox" class="_ref_151dk_1">
            let fromCombobox = null;
            let toCombobox = null;

            const allLabels = Array.from(document.querySelectorAll('p[class*="_label_"], p, label'));
            for (const lbl of allLabels) {
                const t = (lbl.innerText || lbl.textContent || '').trim();
                if (t === '乗車駅') {
                    fromCombobox = lbl.nextElementSibling;
                } else if (t === '降車駅') {
                    toCombobox = lbl.nextElementSibling;
                }
            }

            // 备用选择器：若未通过 label 匹配到，按顺位匹配
            if (!fromCombobox || !toCombobox) {
                const boxes = Array.from(document.querySelectorAll('div[role="combobox"][class*="_ref_"], div[role="combobox"]'));
                if (boxes.length >= 2) {
                    if (!fromCombobox) fromCombobox = boxes[0];
                    if (!toCombobox) toCombobox = boxes[1];
                }
            }

            if (fromCombobox && toCombobox) {
                // 判断是否已经选定车站（根据内部是否有 placeholder）
                const fromPlaceholder = fromCombobox.querySelector('[class*="_placeholder_"]');
                const toPlaceholder = toCombobox.querySelector('[class*="_placeholder_"]');

                const fromDone = !fromPlaceholder && (fromCombobox.innerText || '').includes('嵯峨');
                const toDone = !toPlaceholder && (toCombobox.innerText || '').includes('亀岡');

                // 1. 如果乗車駅未选定
                if (!fromDone) {
                    // 检查浮层是否已弹出 (div[role="dialog"][class*="_popper_"])
                    const popper = document.querySelector('div[role="dialog"][class*="_popper_"], div[class*="_popper_"]');
                    if (popper) {
                        const sagaBtn = popper.querySelector('button[title="トロッコ嵯峨"]') ||
                                        Array.from(popper.querySelectorAll('button, div[role="option"]')).find(el => (el.innerText || '').includes('トロッコ嵯峨'));
                        if (sagaBtn) {
                            simulatePointerClick(sagaBtn);
                            showHUD('✔ 乘车站已选中：トロッコ嵯峨', 'rgba(40, 167, 69, 0.95)');
                            lastStationClickTime = now;
                            return;
                        }
                    }

                    // 如果未展开浮层，点击乗車駅 combobox 展开 (带 500ms 防抖)
                    if (now - lastStationClickTime > 500) {
                        simulatePointerClick(fromCombobox);
                        lastStationClickTime = now;
                        showHUD('🚉 正在展开乘车站选项...', 'rgba(0, 122, 255, 0.95)');
                    }
                    return;
                }

                // 2. 如果乗車駅已选好，降車駅未选定
                if (fromDone && !toDone) {
                    const popper = document.querySelector('div[role="dialog"][class*="_popper_"], div[class*="_popper_"]');
                    if (popper) {
                        // 在降车站浮层中，トロッコ亀岡 会变成非 disabled 状态
                        const kameokaBtn = popper.querySelector('button[title="トロッコ亀岡"]:not([disabled])') ||
                                           Array.from(popper.querySelectorAll('button:not([disabled]), div[role="option"]')).find(el => (el.innerText || '').includes('トロッコ亀岡'));
                        if (kameokaBtn) {
                            simulatePointerClick(kameokaBtn);
                            showHUD('✔ 降车站已选中：トロッコ亀岡，正在查询车次...', 'rgba(40, 167, 69, 0.95)');
                            lastStationClickTime = now;
                            return;
                        }
                    }

                    // 如果未展开降车站浮层，点击降車站 combobox 展开
                    if (now - lastStationClickTime > 500) {
                        simulatePointerClick(toCombobox);
                        lastStationClickTime = now;
                        showHUD('🏁 正在展开降车站选项...', 'rgba(0, 122, 255, 0.95)');
                    }
                    return;
                }

                // 3. 乘降车站都已选好，点击底部的「次へ」进入车次选择
                if (fromDone && toDone) {
                    const stationNextBtn = document.querySelector('div[class*="_footer_"] button[class*="_filled_"], button._filled_4p3z7_30');
                    if (stationNextBtn && !stationNextBtn.disabled) {
                        simulatePointerClick(stationNextBtn);
                    }
                }
            }

            // =========================================================
            // ② 阶段 2.2：车次选择 (自动选中车次并点击「次へ」)
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

                    simulatePointerClick(targetTrain);
                    const trainText = (targetTrain.innerText || '').split('\n')[0].trim();
                    showHUD(`✔ [2/4] 已自动选定车次：${trainText}，正在进入选座...`, 'rgba(40, 167, 69, 0.95)');

                    // 点击底部的「次へ」按钮
                    const nextBtn = document.querySelector('div[class*="_footer_"] button[class*="_filled_"], button._filled_4p3z7_30');
                    if (nextBtn && !nextBtn.disabled) {
                        simulatePointerClick(nextBtn);
                        trainSelected = true;
                    }
                    return;
                }
            }

            // =========================================================
            // ③ 阶段 2.3：选座页面 (真实 DOM 严密对齐：严格 2/2，超选自动反选纠错)
            // =========================================================
            const carriageBtn = document.querySelector('button[class*="_carriageContainer_"], button._carriageContainer_h139u_1');

            if (carriageBtn) {
                // 1. 检查 1 号车厢是否已展开 (根据真实 DOM 中的 _activeArrow_ 类名)
                const isCarriageActive = !!document.querySelector('svg[class*="_activeArrow_"], ._activeArrow_h139u_20');

                if (!isCarriageActive) {
                    simulatePointerClick(carriageBtn);
                    showHUD('✔ [3/4] 正在展开 1 号车厢座位图...', 'rgba(0, 122, 255, 0.95)');
                    return;
                }

                // 2. 读取页面底部的权威真实人数计数器 (例如: "2/2", "4/2")
                const countEl = document.querySelector('p[class*="_count_"], p._count_h139u_58');
                let curSelected = 0;
                let maxAllowed = targetUnits;

                if (countEl) {
                    const m = (countEl.innerText || '').match(/(\d+)\s*\/\s*(\d+)/);
                    if (m) {
                        curSelected = parseInt(m[1], 10);
                        maxAllowed = parseInt(m[2], 10);
                    }
                }

                // 真实 DOM 提取：已选中的座位元素
                const selectedSeats = Array.from(document.querySelectorAll('button[class*="_selected_1t8uk_"], button[class*="_selected_"]'));
                // 兜底：若 countEl 未读取到数字，以 selectedSeats.length 为准
                if (!countEl) curSelected = selectedSeats.length;

                // ---------------------------------------------------------
                // 状态 A：正好选满目标人数 (2/2) ➔ 立即直达！
                // ---------------------------------------------------------
                if (curSelected === maxAllowed) {
                    showHUD(`🎉 成功锁定 ${curSelected}/${maxAllowed} 个座位！正在提交直达...`, 'rgba(40, 167, 69, 0.95)');

                    // 点击底部的「次へ」按钮进入确认页
                    const nextBtn = document.querySelector('div[class*="_footer_"] button[class*="_filled_"], button._filled_4p3z7_30');
                    if (nextBtn && !nextBtn.disabled) {
                        simulatePointerClick(nextBtn);
                    }
                    return;
                }

                // ---------------------------------------------------------
                // 状态 B：发生超选 (如 4/2，3/2) ➔ 立即执行自动反选纠错！
                // ---------------------------------------------------------
                if (curSelected > maxAllowed) {
                    if (now - lastSeatClickTime > 500 && selectedSeats.length > 0) {
                        // 取最后一个已选座位进行反选取消
                        const excessSeat = selectedSeats[selectedSeats.length - 1];
                        simulatePointerClick(excessSeat);
                        lastSeatClickTime = now;
                        showHUD(`⚠️ 座位超额 (${curSelected}/${maxAllowed})，正在自动反选回退...`, 'rgba(255, 149, 0, 0.95)');
                    }
                    return;
                }

                // ---------------------------------------------------------
                // 状态 C：座位未选满 (如 0/2, 1/2) ➔ 严格防抖单次选座，绝不过冲！
                // ---------------------------------------------------------
                if (curSelected < maxAllowed) {
                    // 可选的空位：带有 _seatInner_ 且没有 disabled 属性、没有 _disabled_ 类名、没有 _selected_ 类名
                    const availableSeats = Array.from(document.querySelectorAll('button[class*="_seatInner_"]:not([disabled]):not([class*="_disabled_"]):not([class*="_selected_"])'));

                    if (availableSeats.length > 0 && now - lastSeatClickTime > 600) {
                        const seatToClick = availableSeats[0];
                        simulatePointerClick(seatToClick);
                        lastSeatClickTime = now;
                        showHUD(`💺 正在锁定座位 (${curSelected + 1}/${maxAllowed})...`, 'rgba(40, 167, 69, 0.95)');
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
                simulatePointerClick(confirmNextBtn);
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

