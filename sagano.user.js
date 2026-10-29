// ==UserScript==
// @name         嵯峨野小火车全自动秒选车次直达订单页
// @namespace    sagano-romantic-train
// @version      12.0
// @description  收到Bark通知点开后，全自动精准点选路线、设定人数、逐一展开指定车厢锁定目标座位、锁座中防并发、满额即锁死直达订单支付页！
// @match        *://ars-saganokanko.triplabo.jp/*
// @match        *://file.sagano.linktivity.io/*
// @grant        GM_setValue
// @grant        GM_getValue
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

    // 单一安全点击触发器 (只触发一次真实点击流程，绝不重复叠加，杜绝多重事件致使连选)
    function safeClick(element) {
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
            button: 0,
            buttons: 1
        };

        try {
            element.dispatchEvent(new PointerEvent('pointerdown', Object.assign({ pointerType: 'touch' }, eventProps)));
            element.dispatchEvent(new MouseEvent('mousedown', eventProps));
            element.dispatchEvent(new PointerEvent('pointerup', Object.assign({ pointerType: 'touch' }, eventProps)));
            element.dispatchEvent(new MouseEvent('mouseup', eventProps));
            element.click();
        } catch (e) {
            try { element.click(); } catch (err) {}
        }
    }

    // 解析目标座位参数（支持多车厢格式，例如: "2-16-C-3,3-10-C-3" 或 "4-01-A,6-02-B"）
    function parseTargetSeats(seatsParam) {
        if (!seatsParam) return [];
        return seatsParam.split(',').map(item => {
            const parts = item.trim().split(/[-_]/);
            if (parts.length >= 3) {
                return {
                    car: parseInt(parts[0], 10),         // 车厢号 (如 2, 3, 4)
                    group: parseInt(parts[1], 10),       // 排号 (如 16, 10, 1)
                    seat: parts[2].trim().toUpperCase(), // 座位字母 (如 'A', 'B', 'C')
                    raw: item.trim()
                };
            }
            return null;
        }).filter(Boolean);
    }

    const url = new URL(window.location.href);
    const params = url.searchParams;

    // 参数读取（多源融合：URL Query ➔ GM_getValue ➔ sessionStorage）
    const targetDate = params.get('date') || (typeof GM_getValue !== 'undefined' ? GM_getValue('sagano_date') : null) || sessionStorage.getItem('sagano_date') || '2026-11-10';
    const targetService = params.get('serviceId') || (typeof GM_getValue !== 'undefined' ? GM_getValue('sagano_service') : null) || sessionStorage.getItem('sagano_service') || '';
    const seatsParam = params.get('seats') || (typeof GM_getValue !== 'undefined' ? GM_getValue('sagano_seats') : null) || sessionStorage.getItem('sagano_seats') || '';
    const parsedTargetSeats = parseTargetSeats(seatsParam);
    const targetUnits = parseInt(params.get('unitsCount') || (parsedTargetSeats.length > 0 ? parsedTargetSeats.length : '2'), 10);

    // 持久化存储参数以备跨域或页面跳转传递
    if (params.get('date')) {
        try { sessionStorage.setItem('sagano_date', params.get('date')); } catch(e){}
        if (typeof GM_setValue !== 'undefined') GM_setValue('sagano_date', params.get('date'));
    }
    if (params.get('serviceId')) {
        try { sessionStorage.setItem('sagano_service', params.get('serviceId')); } catch(e){}
        if (typeof GM_setValue !== 'undefined') GM_setValue('sagano_service', params.get('serviceId'));
    }
    if (params.get('seats')) {
        try { sessionStorage.setItem('sagano_seats', params.get('seats')); } catch(e){}
        if (typeof GM_setValue !== 'undefined') GM_setValue('sagano_seats', params.get('seats'));
    }
    if (params.get('unitsCount')) {
        try { sessionStorage.setItem('sagano_units', params.get('unitsCount')); } catch(e){}
        if (typeof GM_setValue !== 'undefined') GM_setValue('sagano_units', params.get('unitsCount'));
    }

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
                    safeClick(targetBtn);

                    const isChecked = targetBtn.className.includes('checked') || targetBtn.className.includes('active');
                    const hasQuantity = !!document.querySelector('button use[xlink\\:href*="plus"], button use[*|href*="plus"]');

                    if (isChecked || hasQuantity) {
                        routeDone = true;
                        showHUD('✔ 路线已成功选中：嵯峨/岚山 ➔ 龟冈', 'rgba(40, 167, 69, 0.95)');
                    }
                }
            }

            // ③ 自动设定人数：点击加号按钮直到达到目标人数
            if (routeDone && unitCount < targetUnits) {
                const plusBtns = Array.from(document.querySelectorAll('button')).filter(b => {
                    const use = b.querySelector('use');
                    const href = use ? (use.getAttribute('xlink:href') || use.getAttribute('href') || '') : '';
                    return href.includes('plus') || (b.className || '').toLowerCase().includes('plus');
                });

                if (plusBtns.length > 0) {
                    const adultPlus = plusBtns[0];
                    safeClick(adultPlus);
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
                    safeClick(submitBtn);
                    clearInterval(mainTimer);
                }
            }
        }, 150);

        setTimeout(() => clearInterval(mainTimer), 30000);
    }

    // =============================================================
    // 阶段 2: Linktivity 车次与选座系统 (v12.0 终极防震荡与多车厢精准选座引擎)
    // =============================================================
    if (window.location.hostname.includes('linktivity.io')) {
        showHUD('⚡ [1/4] 已进入选座系统，正在锁定车站...', 'rgba(0, 122, 255, 0.95)');

        let trainSelected = false;
        let lastSeatActionTime = 0;
        let lastStationClickTime = 0;
        let isSeatLocked = false; // 满额强锁标识：一旦达标，永久封锁一切选座与反选，持续猛击提交
        let confirmSubmitted = false;

        const linktivityTimer = setInterval(() => {
            const now = Date.now();

            // =========================================================
            // ① 阶段 2.1：选车站 (根据真实 DOM 标签匹配 Combobox 与 Popper 选项)
            // =========================================================
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

            if (!fromCombobox || !toCombobox) {
                const boxes = Array.from(document.querySelectorAll('div[role="combobox"][class*="_ref_"], div[role="combobox"]'));
                if (boxes.length >= 2) {
                    if (!fromCombobox) fromCombobox = boxes[0];
                    if (!toCombobox) toCombobox = boxes[1];
                }
            }

            if (fromCombobox && toCombobox) {
                const fromPlaceholder = fromCombobox.querySelector('[class*="_placeholder_"]');
                const toPlaceholder = toCombobox.querySelector('[class*="_placeholder_"]');

                const fromDone = !fromPlaceholder && (fromCombobox.innerText || '').includes('嵯峨');
                const toDone = !toPlaceholder && (toCombobox.innerText || '').includes('亀岡');

                // 1. 如果乗車駅未选定
                if (!fromDone) {
                    const popper = document.querySelector('div[role="dialog"][class*="_popper_"], div[class*="_popper_"]');
                    if (popper) {
                        const sagaBtn = popper.querySelector('button[title="トロッコ嵯峨"]') ||
                                        Array.from(popper.querySelectorAll('button, div[role="option"]')).find(el => (el.innerText || '').includes('トロッコ嵯峨'));
                        if (sagaBtn) {
                            safeClick(sagaBtn);
                            showHUD('✔ 乘车站已选中：トロッコ嵯峨', 'rgba(40, 167, 69, 0.95)');
                            lastStationClickTime = now;
                            return;
                        }
                    }

                    if (now - lastStationClickTime > 500) {
                        safeClick(fromCombobox);
                        lastStationClickTime = now;
                        showHUD('🚉 正在展开乘车站选项...', 'rgba(0, 122, 255, 0.95)');
                    }
                    return;
                }

                // 2. 如果乗車駅已选好，降車駅未选定
                if (fromDone && !toDone) {
                    const popper = document.querySelector('div[role="dialog"][class*="_popper_"], div[class*="_popper_"]');
                    if (popper) {
                        const kameokaBtn = popper.querySelector('button[title="トロッコ亀岡"]:not([disabled])') ||
                                           Array.from(popper.querySelectorAll('button:not([disabled]), div[role="option"]')).find(el => (el.innerText || '').includes('トロッコ亀岡'));
                        if (kameokaBtn) {
                            safeClick(kameokaBtn);
                            showHUD('✔ 降车站已选中：トロッコ亀岡，正在查询车次...', 'rgba(40, 167, 69, 0.95)');
                            lastStationClickTime = now;
                            return;
                        }
                    }

                    if (now - lastStationClickTime > 500) {
                        safeClick(toCombobox);
                        lastStationClickTime = now;
                        showHUD('🏁 正在展开降车站选项...', 'rgba(0, 122, 255, 0.95)');
                    }
                    return;
                }

                // 3. 乘降车站都已选好，点击底部的「次へ」进入车次选择
                if (fromDone && toDone) {
                    const stationNextBtn = document.querySelector('div[class*="_footer_"] button[class*="_filled_"], button._filled_4p3z7_30');
                    if (stationNextBtn && !stationNextBtn.disabled) {
                        safeClick(stationNextBtn);
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

                    safeClick(targetTrain);
                    const trainText = (targetTrain.innerText || '').split('\n')[0].trim();
                    showHUD(`✔ [2/4] 已自动选定车次：${trainText}，正在进入选座...`, 'rgba(40, 167, 69, 0.95)');

                    const nextBtn = document.querySelector('div[class*="_footer_"] button[class*="_filled_"], button._filled_4p3z7_30');
                    if (nextBtn && !nextBtn.disabled) {
                        safeClick(nextBtn);
                        trainSelected = true;
                    }
                    return;
                }
            }

            // =========================================================
            // ③ 阶段 2.3：选座页面 (精准多车厢锁定 + 彻底杜绝 4/4 与 6/4 震荡)
            // =========================================================
            const carriageItems = Array.from(document.querySelectorAll('div[class*="_carriageContent_"], div[class*="_carriage_"]'));
            const countEl = document.querySelector('p[class*="_count_"], p._count_h139u_58');

            if (carriageItems.length > 0 || countEl) {
                // 1. 监测官方系统的锁定弹窗状态 (若正在与服务器通信，静默等待，绝不乱动)
                const isSystemBusy = Array.from(document.querySelectorAll('div, p, span')).some(el => {
                    const t = (el.innerText || '').trim();
                    return t.includes('正在锁定') || t.includes('座席を確保') || t.includes('処理中');
                });

                // 2. 权威读取当前选座计数（分子/分母）
                let curSelected = 0;
                let maxAllowed = targetUnits;

                if (countEl) {
                    const m = (countEl.innerText || '').match(/(\d+)\s*\/\s*(\d+)/);
                    if (m) {
                        curSelected = parseInt(m[1], 10);
                        maxAllowed = parseInt(m[2], 10); // 严格自适应页面设定的总人数（如 4 或 2）
                    }
                }

                const selectedSeats = Array.from(document.querySelectorAll('button[class*="_selected_1t8uk_"], button[class*="_selected_"]'));
                if (!countEl) curSelected = selectedSeats.length;

                const nextBtn = document.querySelector('div[class*="_footer_"] button[class*="_filled_"], button._filled_4p3z7_30');

                // ---------------------------------------------------------
                // 核心控制 A：【满额永久锁死直达】（已正好选满如 4/4 或 2/2）
                // ---------------------------------------------------------
                if (curSelected === maxAllowed || isSeatLocked) {
                    isSeatLocked = true; // 一旦满额永久强锁，绝不再执行选座，也绝不再反选！
                    showHUD(`🎉 成功锁定 ${curSelected}/${maxAllowed} 座位！正在极速提交直达订单页...`, 'rgba(40, 167, 69, 0.95)');

                    // 不受 disabled 限制，全力尝试点击下一步
                    if (nextBtn) {
                        safeClick(nextBtn);
                    }
                    return;
                }

                // 若系统正处于锁定通信中，跳过后续操作静候回包
                if (isSystemBusy) {
                    return;
                }

                // ---------------------------------------------------------
                // 核心控制 B：【超额安全回退】（当前分子 > 分母，如 6/4，单次反选且冷却 1200ms）
                // ---------------------------------------------------------
                if (curSelected > maxAllowed) {
                    if (now - lastSeatActionTime > 1200 && selectedSeats.length > 0) {
                        // 优先反选非目标推荐座位的元素
                        let seatToCancel = selectedSeats[selectedSeats.length - 1];
                        if (parsedTargetSeats.length > 0) {
                            const nonTargetSeat = selectedSeats.find(s => {
                                const sText = (s.innerText || '').trim().toUpperCase();
                                const groupDiv = s.closest('div[class*="_group_"]');
                                const gText = groupDiv ? (groupDiv.querySelector('span[class*="_groupId_"]')?.innerText || '').trim() : '';
                                return !parsedTargetSeats.some(t => String(t.group) === gText && t.seat === sText);
                            });
                            if (nonTargetSeat) seatToCancel = nonTargetSeat;
                        }

                        safeClick(seatToCancel);
                        lastSeatActionTime = now;
                        showHUD(`⚠️ 纠正超额座位 (${curSelected} ➔ ${curSelected - 1}/${maxAllowed})，静候回退...`, 'rgba(255, 149, 0, 0.95)');
                    }
                    return;
                }

                // ---------------------------------------------------------
                // 核心控制 C：【未满额选座】（当前分子 < 分母，如 3/4 或 0/2，严格单次锁定 + 1000ms 冷却）
                // ---------------------------------------------------------
                if (curSelected < maxAllowed && now - lastSeatActionTime > 1000) {
                    // ① 优先按照通知分配的目标车厢与排号座位号精准选座 (如 2号车16C、3号车10C)
                    if (parsedTargetSeats.length > 0) {
                        for (const target of parsedTargetSeats) {
                            // 查找对应的车厢项
                            const carItem = carriageItems.find(item => {
                                const label = item.querySelector('button[class*="_carriageContainer_"], p');
                                const t = label ? (label.innerText || '').trim() : '';
                                return t.includes(`${target.car}号車`) || t.includes(`${target.car}号`);
                            });

                            if (carItem) {
                                const carBtn = carItem.querySelector('button[class*="_carriageContainer_"]');
                                const isCarExpanded = !!carItem.querySelector('svg[class*="_activeArrow_"], div[class*="_car_"]');

                                // 如果目标车厢未展开，先展开它
                                if (!isCarExpanded && carBtn) {
                                    safeClick(carBtn);
                                    lastSeatActionTime = now;
                                    showHUD(`🔍 正在展开指定车厢：${target.car} 号车...`, 'rgba(0, 122, 255, 0.95)');
                                    return;
                                }

                                // 目标车厢已展开，定位具体的排号与座位字母
                                if (isCarExpanded) {
                                    const groupSpans = Array.from(carItem.querySelectorAll('span[class*="_groupId_"]'));
                                    const matchedGroupSpan = groupSpans.find(sp => {
                                        const gNum = parseInt((sp.innerText || '').trim(), 10);
                                        return gNum === target.group;
                                    });

                                    if (matchedGroupSpan) {
                                        const groupDiv = matchedGroupSpan.closest('div[class*="_group_"]');
                                        if (groupDiv) {
                                            const seatBtns = Array.from(groupDiv.querySelectorAll('button[class*="_seatInner_"]'));
                                            const matchedSeatBtn = seatBtns.find(b => {
                                                const sLetter = (b.querySelector('span')?.innerText || b.innerText || '').trim().toUpperCase();
                                                return sLetter === target.seat;
                                            });

                                            if (matchedSeatBtn) {
                                                const isAlreadySelected = matchedSeatBtn.className.includes('_selected_');
                                                if (!isAlreadySelected && !matchedSeatBtn.disabled && !matchedSeatBtn.className.includes('_disabled_')) {
                                                    safeClick(matchedSeatBtn);
                                                    lastSeatActionTime = now;
                                                    showHUD(`🎯 命中指定目标：${target.car}号车 ${target.group}${target.seat}！`, 'rgba(40, 167, 69, 0.95)');
                                                    return;
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // ② 若目标座位已全部被锁或无指定目标，在当前展开的车厢中寻找空闲座位填充
                    const expandedCar = carriageItems.find(item => !!item.querySelector('svg[class*="_activeArrow_"], div[class*="_car_"]'));
                    if (expandedCar) {
                        const availableSeats = Array.from(expandedCar.querySelectorAll('button[class*="_seatInner_"]:not([disabled]):not([class*="_disabled_"]):not([class*="_selected_"])'));
                        if (availableSeats.length > 0) {
                            safeClick(availableSeats[0]);
                            lastSeatActionTime = now;
                            showHUD(`💺 正在锁定座位 (${curSelected + 1}/${maxAllowed})...`, 'rgba(40, 167, 69, 0.95)');
                            return;
                        }
                    }

                    // ③ 当前展开车厢无可用空位，展开下一个车厢寻找
                    for (const item of carriageItems) {
                        const isCarExpanded = !!item.querySelector('svg[class*="_activeArrow_"], div[class*="_car_"]');
                        if (!isCarExpanded) {
                            const carBtn = item.querySelector('button[class*="_carriageContainer_"]');
                            if (carBtn) {
                                safeClick(carBtn);
                                lastSeatActionTime = now;
                                showHUD('🔍 正在探索下一节车厢可用座位...', 'rgba(255, 149, 0, 0.95)');
                                return;
                            }
                        }
                    }
                }
            }

            // =========================================================
            // ④ 阶段 2.4：确认页面直接提交，直达订单支付页
            // =========================================================
            const isConfirmPage = !!document.querySelector('div[class*="_orderConfirm_"], div[class*="_carriageList_"]');
            const confirmNextBtn = document.querySelector('div[class*="_footer_"] button[class*="_filled_"], button._filled_4p3z7_30');

            if (isConfirmPage && confirmNextBtn && !confirmNextBtn.disabled && !confirmSubmitted) {
                safeClick(confirmNextBtn);
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



