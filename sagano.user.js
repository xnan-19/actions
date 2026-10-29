// ==UserScript==
// @name         嵯峨野小火车全自动秒选车次直达订单页
// @namespace    sagano-romantic-train
// @version      11.0
// @description  收到Bark通知点开后，全自动精准点选路线、设定人数、精准展开指定车厢锁定目标座位(支持多车厢与排号座位号匹配)，自适应人数终结震荡，直达订单支付页！
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

    // 解析目标座位参数（例如: "4-9-B-3,4-8-B-3" 或 "4-01-A,6-02-B"）
    function parseTargetSeats(seatsParam) {
        if (!seatsParam) return [];
        return seatsParam.split(',').map(item => {
            const parts = item.trim().split(/[-_]/);
            if (parts.length >= 3) {
                return {
                    car: parseInt(parts[0], 10),         // 车厢号 (如 4)
                    group: parseInt(parts[1], 10),       // 排号 (如 1 或 9)
                    seat: parts[2].trim().toUpperCase(), // 座位字母 (如 'A', 'B')
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
    // 阶段 2: Linktivity 车次与选座系统 (v11.0 精准目标车厢与座位 + 防震荡自愈引擎)
    // =============================================================
    if (window.location.hostname.includes('linktivity.io')) {
        showHUD('⚡ [1/4] 已进入选座系统，正在锁定车站...', 'rgba(0, 122, 255, 0.95)');

        let trainSelected = false;
        let lastSeatActionTime = 0;
        let lastStationClickTime = 0;
        let isSeatCompleted = false; // 选座完成强锁标帜：一旦满额立即封锁一切选座和反选，狂点提交
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
                            simulatePointerClick(sagaBtn);
                            showHUD('✔ 乘车站已选中：トロッコ嵯峨', 'rgba(40, 167, 69, 0.95)');
                            lastStationClickTime = now;
                            return;
                        }
                    }

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
                        const kameokaBtn = popper.querySelector('button[title="トロッコ亀岡"]:not([disabled])') ||
                                           Array.from(popper.querySelectorAll('button:not([disabled]), div[role="option"]')).find(el => (el.innerText || '').includes('トロッコ亀岡'));
                        if (kameokaBtn) {
                            simulatePointerClick(kameokaBtn);
                            showHUD('✔ 降车站已选中：トロッコ亀岡，正在查询车次...', 'rgba(40, 167, 69, 0.95)');
                            lastStationClickTime = now;
                            return;
                        }
                    }

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

                    const nextBtn = document.querySelector('div[class*="_footer_"] button[class*="_filled_"], button._filled_4p3z7_30');
                    if (nextBtn && !nextBtn.disabled) {
                        simulatePointerClick(nextBtn);
                        trainSelected = true;
                    }
                    return;
                }
            }

            // =========================================================
            // ③ 阶段 2.3：选座页面 (精准展开指定车厢锁定目标座位 + 彻底终结震荡)
            // =========================================================
            // 获取所有车厢项容器
            const carriageItems = Array.from(document.querySelectorAll('div[class*="_carriageContent_"], div[class*="_carriage_"]'));
            const countEl = document.querySelector('p[class*="_count_"], p._count_h139u_58');

            if (carriageItems.length > 0 || countEl) {
                // 1. 读取页面底部的权威真实选座计数（例如: "3/4", "4/4", "6/4", "2/2"）
                let curSelected = 0;
                let maxAllowed = targetUnits;

                if (countEl) {
                    const m = (countEl.innerText || '').match(/(\d+)\s*\/\s*(\d+)/);
                    if (m) {
                        curSelected = parseInt(m[1], 10);
                        maxAllowed = parseInt(m[2], 10); // 自适应当前页面设定的总人数（如 4 或 2）
                    }
                }

                const selectedSeats = Array.from(document.querySelectorAll('button[class*="_selected_1t8uk_"], button[class*="_selected_"]'));
                if (!countEl) curSelected = selectedSeats.length;

                const nextBtn = document.querySelector('div[class*="_footer_"] button[class*="_filled_"], button._filled_4p3z7_30');

                // ---------------------------------------------------------
                // 状态 A：【满额锁死直达】（正好选满如 4/4 或 2/2）
                // ---------------------------------------------------------
                if (curSelected === maxAllowed || isSeatCompleted) {
                    isSeatCompleted = true; // 永久强锁，绝不再执行选座或反选！
                    showHUD(`🎉 成功锁定 ${curSelected}/${maxAllowed} 个座位！正在提交直达订单页...`, 'rgba(40, 167, 69, 0.95)');

                    if (nextBtn && !nextBtn.disabled) {
                        simulatePointerClick(nextBtn);
                    }
                    return;
                }

                // ---------------------------------------------------------
                // 状态 B：【超额安全回退】（当前分子 > 分母，如 6/4）
                // ---------------------------------------------------------
                if (curSelected > maxAllowed) {
                    // 严格 800ms 防抖冷却，防止高频误伤和震荡
                    if (now - lastSeatActionTime > 800 && selectedSeats.length > 0) {
                        // 优先反选未在目标列表中指定的座位
                        let seatToUnselect = selectedSeats[selectedSeats.length - 1];
                        if (parsedTargetSeats.length > 0) {
                            const nonTargetSeat = selectedSeats.find(s => {
                                const sText = (s.innerText || '').trim();
                                const groupDiv = s.closest('div[class*="_group_"]');
                                const gText = groupDiv ? (groupDiv.querySelector('span[class*="_groupId_"]')?.innerText || '').trim() : '';
                                return !parsedTargetSeats.some(t => String(t.group) === gText && t.seat === sText);
                            });
                            if (nonTargetSeat) seatToUnselect = nonTargetSeat;
                        }

                        simulatePointerClick(seatToUnselect);
                        lastSeatActionTime = now;
                        showHUD(`⚠️ 座位超额 (${curSelected}/${maxAllowed})，正在自动反选回退...`, 'rgba(255, 149, 0, 0.95)');
                    }
                    return;
                }

                // ---------------------------------------------------------
                // 状态 C：【未满额选座】（当前分子 < 分母，如 3/4 或 0/2）
                // ---------------------------------------------------------
                if (curSelected < maxAllowed && now - lastSeatActionTime > 800) {
                    // ① 优先查找并点击链接中指定的目标座位 (如 04车 01号 A/B座)
                    if (parsedTargetSeats.length > 0) {
                        for (const target of parsedTargetSeats) {
                            // 查找对应的车厢容器 (例如 4号车)
                            const carItem = carriageItems.find(item => {
                                const label = item.querySelector('button[class*="_carriageContainer_"], p');
                                const t = label ? (label.innerText || '').trim() : '';
                                return t.includes(`${target.car}号車`) || t.includes(`${target.car}号`);
                            });

                            if (carItem) {
                                const carBtn = carItem.querySelector('button[class*="_carriageContainer_"]');
                                const isCarExpanded = !!carItem.querySelector('svg[class*="_activeArrow_"], div[class*="_car_"]');

                                // 如果目标车厢未展开，先展开该车厢
                                if (!isCarExpanded && carBtn) {
                                    simulatePointerClick(carBtn);
                                    lastSeatActionTime = now;
                                    showHUD(`🔍 正在精准展开 ${target.car} 号车厢...`, 'rgba(0, 122, 255, 0.95)');
                                    return;
                                }

                                // 目标车厢已展开，定位目标排号与座位字母
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
                                                // 检查该目标座位是否已被选中
                                                const isAlreadySelected = matchedSeatBtn.className.includes('_selected_');
                                                if (!isAlreadySelected && !matchedSeatBtn.disabled && !matchedSeatBtn.className.includes('_disabled_')) {
                                                    simulatePointerClick(matchedSeatBtn);
                                                    lastSeatActionTime = now;
                                                    showHUD(`🎯 已成功命中指定座位：${target.car}号车${target.group}${target.seat}！`, 'rgba(40, 167, 69, 0.95)');
                                                    return;
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // ② 若目标座位全部已被选或未指定目标座位，采用可用空位兜底填充
                    const expandedCar = carriageItems.find(item => !!item.querySelector('svg[class*="_activeArrow_"], div[class*="_car_"]'));
                    if (expandedCar) {
                        const availableSeats = Array.from(expandedCar.querySelectorAll('button[class*="_seatInner_"]:not([disabled]):not([class*="_disabled_"]):not([class*="_selected_"])'));
                        if (availableSeats.length > 0) {
                            simulatePointerClick(availableSeats[0]);
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
                                simulatePointerClick(carBtn);
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


