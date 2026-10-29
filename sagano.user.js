// ==UserScript==
// @name         嵯峨野小火车全自动秒选车次直达订单页
// @namespace    sagano-romantic-train
// @version      6.2
// @description  收到Bark通知点开后，全自动精准点选路线、设定2人、高可靠状态机秒选车站下拉框、自动选车次、自动展开车厢锁定座位，直达订单支付页！
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
    // 阶段 2: Linktivity 车次与选座系统 (高可靠状态机 + 全事件派发引擎)
    // =============================================================
    if (window.location.hostname.includes('linktivity.io')) {
        showHUD('🚀 抵达车次与选座系统，正在极速匹配...', 'rgba(0, 122, 255, 0.95)');

        // 终极事件触发引擎（全方位兼容 iOS Safari 触屏、React 合成事件与原生事件）
        function smartTrigger(el) {
            if (!el) return;

            // 1. 调用原生 click
            try {
                if (typeof el.click === 'function') el.click();
            } catch (e) {}

            // 2. 尝试读取并直接调用 React Props 中的 onClick / onSelect
            try {
                const pKey = Object.keys(el).find(k => k.startsWith('__reactProps$') || k.startsWith('__reactInternalInstance$'));
                if (pKey && el[pKey]) {
                    if (typeof el[pKey].onClick === 'function') el[pKey].onClick({ stopPropagation: () => {}, preventDefault: () => {} });
                    if (typeof el[pKey].onSelect === 'function') el[pKey].onSelect();
                }
            } catch (e) {}

            // 3. 完整派发 Pointer / Touch / Mouse 全套事件链
            ['pointerdown', 'touchstart', 'pointerup', 'touchend', 'mousedown', 'mouseup', 'click'].forEach(evtName => {
                try {
                    let evt;
                    if (evtName.startsWith('touch')) {
                        evt = new TouchEvent(evtName, { bubbles: true, cancelable: true });
                    } else if (evtName.startsWith('pointer')) {
                        evt = new PointerEvent(evtName, { bubbles: true, cancelable: true });
                    } else {
                        evt = new MouseEvent(evtName, { bubbles: true, cancelable: true });
                    }
                    el.dispatchEvent(evt);
                } catch (err) {
                    try {
                        const fallbackEvt = document.createEvent('Event');
                        fallbackEvt.initEvent(evtName, true, true);
                        el.dispatchEvent(fallbackEvt);
                    } catch (e) {}
                }
            });
        }

        // 辅助查找下拉框容器
        function findDropdownTrigger(keyword) {
            const list = Array.from(document.querySelectorAll('div, button, input, span, p')).filter(el => {
                const t = (el.innerText || el.textContent || '').trim();
                return (t === keyword || (t.includes(keyword) && t.length < 35)) && el.children.length <= 3;
            });
            if (list.length > 0) {
                list.sort((a, b) => a.children.length - b.children.length);
                return list[0];
            }
            return null;
        }

        // 辅助查找选项元素
        function findOptionItem(targetText) {
            const list = Array.from(document.querySelectorAll('div, li, button, span, p, a')).filter(el => {
                const t = (el.innerText || el.textContent || '').trim();
                if (t === targetText) return true;
                if (t.includes(targetText) && t.length < targetText.length + 6) {
                    return !t.includes('選択') && !t.includes('乗車駅') && !t.includes('降車駅');
                }
                return false;
            });
            if (list.length > 0) {
                list.sort((a, b) => a.children.length - b.children.length);
                return list[0];
            }
            return null;
        }

        // 状态机状态定义
        let stationStep = 0; // 0: 准备开乘车站, 1: 等待乘车站选项, 2: 准备开降车站, 3: 等待降车站选项, 4: 车站选完
        let lastStepTime = 0;

        let trainSelected = false;
        let carriageIndex = 0;
        let lastSeatClickTime = 0;
        let confirmClicked = false;

        const linktivityTimer = setInterval(() => {
            const now = Date.now();

            // ---------------------------------------------------------
            // ① 步骤 2.1：高可靠车站下拉框状态机
            // ---------------------------------------------------------
            if (stationStep < 4) {
                // 如果页面已经直接显示了已选中的站名，自动前推状态
                const bodyText = document.body ? (document.body.innerText || '') : '';
                const hasSagaSelected = bodyText.includes('トロッコ嵯峨') && !findDropdownTrigger('乗車駅を選択してください');
                const hasKameokaSelected = bodyText.includes('トロッコ亀岡') && !findDropdownTrigger('降車駅を選択してください');

                if (hasSagaSelected && hasKameokaSelected) {
                    stationStep = 4;
                } else if (hasSagaSelected && stationStep < 2) {
                    stationStep = 2;
                }

                // 阶段 0: 寻找乘车站下拉框并展开
                if (stationStep === 0) {
                    const fromBox = findDropdownTrigger('乗車駅を選択してください');
                    if (fromBox) {
                        smartTrigger(fromBox);
                        smartTrigger(fromBox.parentElement);
                        stationStep = 1;
                        lastStepTime = now;
                        showHUD('🚉 正在展开乘车站列表...', 'rgba(0, 122, 255, 0.95)');
                        return;
                    }
                }

                // 阶段 1: 在展开的选项中寻找并点击「トロッコ嵯峨」
                if (stationStep === 1) {
                    const sagaOpt = findOptionItem('トロッコ嵯峨');
                    if (sagaOpt) {
                        smartTrigger(sagaOpt);
                        smartTrigger(sagaOpt.parentElement);
                        stationStep = 2;
                        lastStepTime = now;
                        showHUD('✔ 乘车站已选中：トロッコ嵯峨', 'rgba(40, 167, 69, 0.95)');
                        return;
                    } else if (now - lastStepTime > 1500) {
                        // 超时未找到选项，可能未成功展开，允许重新触发
                        stationStep = 0;
                    }
                }

                // 阶段 2: 寻找降车站下拉框并展开
                if (stationStep === 2) {
                    const toBox = findDropdownTrigger('降車駅を選択してください');
                    if (toBox) {
                        smartTrigger(toBox);
                        smartTrigger(toBox.parentElement);
                        stationStep = 3;
                        lastStepTime = now;
                        showHUD('🏁 正在展开降车站列表...', 'rgba(0, 122, 255, 0.95)');
                        return;
                    }
                }

                // 阶段 3: 在展开的选项中寻找并点击「トロッコ亀岡」
                if (stationStep === 3) {
                    const kameokaOpt = findOptionItem('トロッコ亀岡');
                    if (kameokaOpt) {
                        smartTrigger(kameokaOpt);
                        smartTrigger(kameokaOpt.parentElement);
                        stationStep = 4;
                        lastStepTime = now;
                        showHUD('✔ 降车站已选中：トロッコ亀岡，正在查询车次...', 'rgba(40, 167, 69, 0.95)');
                        return;
                    } else if (now - lastStepTime > 1500) {
                        // 超时未找到选项，可能未成功展开，允许重新触发
                        stationStep = 2;
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

                    smartTrigger(targetTrain);
                    const trainText = (targetTrain.innerText || '').split('\n')[0].trim();
                    showHUD(`✔ 已自动选中车次：${trainText}，正在下一步...`, 'rgba(40, 167, 69, 0.95)');

                    // 点击底部的「次へ」按钮
                    const nextBtn = Array.from(document.querySelectorAll('button')).find(b => {
                        const t = (b.innerText || '').trim();
                        return (t === '次へ' || t === 'Next' || t === '下一步') && !b.disabled && !b.hasAttribute('disabled');
                    });

                    if (nextBtn) {
                        smartTrigger(nextBtn);
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
                // 查找所有座位按钮（带 _seatInner_ 的真正 button）
                const seatButtons = Array.from(document.querySelectorAll('button[class*="_seatInner_"], div[class*="_seat_"] button'));

                // 如果尚未展开车厢，点击车厢展开
                if (seatButtons.length === 0) {
                    if (carriageBtns[carriageIndex]) {
                        smartTrigger(carriageBtns[carriageIndex]);
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

                // 如果已经选够人数（例如 2/2）
                if (selectedSeatBtns.length >= targetUnits || (countText && countText.startsWith(`${targetUnits}/`))) {
                    showHUD(`🎉 成功锁定 ${targetUnits} 个座位！正在点击下一步...`, 'rgba(40, 167, 69, 0.95)');

                    // 点击底部的「次へ」按钮进入确认页
                    const nextBtn = Array.from(document.querySelectorAll('button')).find(b => {
                        const t = (b.innerText || '').trim();
                        return (t === '次へ' || t === 'Next' || t === '下一步') && !b.disabled && !b.hasAttribute('disabled');
                    });

                    if (nextBtn) {
                        smartTrigger(nextBtn);
                    }
                    return;
                }

                // 查找所有可点击的空闲座位（排除 disabled、_disabled_ 以及已选中的座位）
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
                        smartTrigger(seatBtn);
                        smartTrigger(seatBtn.parentElement);
                        lastSeatClickTime = now;
                        showHUD(`💺 正在锁定座位 (${selectedSeatBtns.length + 1}/${targetUnits})...`, 'rgba(40, 167, 69, 0.95)');
                        return;
                    } else {
                        // 当前车厢无可用座位，切换到下一个车厢
                        if (carriageIndex + 1 < carriageBtns.length) {
                            carriageIndex++;
                            smartTrigger(carriageBtns[carriageIndex]);
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
                smartTrigger(btn);
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
