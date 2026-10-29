// ==UserScript==
// @name         嵯峨野小火车全自动秒选车次直达订单页
// @namespace    sagano-romantic-train
// @version      16.0
// @description  全车厢全局智能选座：偶数连座 => 偶数前后座 => 同车偶数分开 => 跨车偶数座，遇到被抢自动降级不卡死，直达官方Visa支付！
// @author       Antigravity
// @match        *://ars-saganokanko.triplabo.jp/*
// @match        *://file.sagano.linktivity.io/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    // 屏幕居中悬浮状态提示条 (HUD)
    function showHUD(text, bgColor) {
        let hud = document.getElementById('sagano-hud');
        if (!hud) {
            hud = document.createElement('div');
            hud.id = 'sagano-hud';
            hud.style.cssText = 'position:fixed;top:18%;left:5%;width:90%;z-index:2147483647;padding:16px 20px;font-size:16px;font-weight:bold;text-align:center;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,0.5);pointer-events:none;transition:all 0.3s ease;';
            (document.body || document.documentElement).appendChild(hud);
        }
        hud.style.background = bgColor || 'rgba(0, 122, 255, 0.95)';
        hud.style.color = '#ffffff';
        hud.innerHTML = text;
    }

    // 单一真实安全点击触发器
    function safeClick(element) {
        if (!element) return;
        try {
            const rect = element.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            const eventProps = {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: x,
                clientY: y
            };
            element.dispatchEvent(new PointerEvent('pointerdown', Object.assign({ pointerType: 'touch' }, eventProps)));
            element.dispatchEvent(new MouseEvent('mousedown', eventProps));
            element.dispatchEvent(new PointerEvent('pointerup', Object.assign({ pointerType: 'touch' }, eventProps)));
            element.dispatchEvent(new MouseEvent('mouseup', eventProps));
            element.click();
        } catch (e) {
            try { element.click(); } catch (err) {}
        }
    }

    // 智能座位计算引擎 (偶数连座 > 偶数前后座 > 偶数分开坐 > 跨车偶数座 > 任意连座)
    function evaluateBestSeats(carInventories, targetCount = 2) {
        const allVacant = [];
        (carInventories || []).forEach(car => {
            const carId = parseInt(car.logical_car_id || car.logicalCarId, 10);
            (car.arrangements || []).forEach(arr => {
                const isArrangeable = (arr.arrangement_state || arr.arrangementState) === 'ARRANGEABLE';
                const isVacant = (arr.reservation_state || arr.reservationState) === 'VACANT';
                if (isArrangeable && isVacant) {
                    const group = parseInt(arr.seat_group_id || arr.seatGroupId, 10);
                    const seat = (arr.seat_id || arr.seatId || '').trim().toUpperCase();
                    const isEven = (group % 2 === 0);
                    allVacant.push({
                        carId,
                        group,
                        seat,
                        isEven,
                        key: `${carId}-${group}-${seat}`
                    });
                }
            });
        });

        if (allVacant.length === 0) return null;
        if (allVacant.length < targetCount) return { pair: allVacant, desc: '部分可用席位' };

        let bestPair = null;
        let highestScore = -1;
        let bestType = '';

        for (let i = 0; i < allVacant.length; i++) {
            for (let j = i + 1; j < allVacant.length; j++) {
                const s1 = allVacant[i];
                const s2 = allVacant[j];
                let score = 0;
                let typeName = '';

                const sameCar = (s1.carId === s2.carId);
                const bothEven = (s1.isEven && s2.isEven);
                const sameGroup = (s1.group === s2.group);
                const isAdjacentGroup = (Math.abs(s1.group - s2.group) === 2);

                const isPairSeat = sameGroup && (
                    (s1.seat === 'A' && s2.seat === 'B') || (s1.seat === 'B' && s2.seat === 'A') ||
                    (s1.seat === 'C' && s2.seat === 'D') || (s1.seat === 'D' && s2.seat === 'C')
                );

                const isSameSide = (
                    (['A', 'B'].includes(s1.seat) && ['A', 'B'].includes(s2.seat)) ||
                    (['C', 'D'].includes(s1.seat) && ['C', 'D'].includes(s2.seat))
                );

                if (sameCar) {
                    if (bothEven) {
                        if (isPairSeat) {
                            score = 10000;
                            typeName = `🎯 偶数连座 (${s1.carId}号车 ${s1.group}${s1.seat}+${s2.seat})`;
                        } else if (isAdjacentGroup && isSameSide) {
                            score = 8000;
                            typeName = `🎯 偶数前后座 (${s1.carId}号车 ${s1.group}${s1.seat}+${s2.group}${s2.seat})`;
                        } else {
                            score = 6000;
                            typeName = `🎯 同车偶数座 (${s1.carId}号车 ${s1.group}${s1.seat}+${s2.group}${s2.seat})`;
                        }
                    } else if (isPairSeat) {
                        score = 2500;
                        typeName = `💺 普通连座 (${s1.carId}号车 ${s1.group}${s1.seat}+${s2.seat})`;
                    } else {
                        score = 1000;
                        typeName = `💺 同车席位 (${s1.carId}号车)`;
                    }
                } else {
                    if (bothEven) {
                        score = 4000;
                        typeName = `🎯 跨车偶数座 (${s1.carId}车${s1.group}${s1.seat} + ${s2.carId}车${s2.group}${s2.seat})`;
                    } else {
                        score = 500;
                        typeName = `💺 跨车席位 (${s1.carId}车 + ${s2.carId}车)`;
                    }
                }

                if (score > highestScore) {
                    highestScore = score;
                    bestPair = [s1, s2];
                    bestType = typeName;
                }
            }
        }

        return { pair: bestPair, score: highestScore, desc: bestType };
    }

    // 全局库存数据缓存
    let globalInventoryData = null;
    let globalBestTarget = null;

    // 劫持 Fetch 实时截获所有车厢座位库存
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        const response = await originalFetch.apply(this, args);
        try {
            const urlStr = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
            if (urlStr.includes('/v1/inventories/')) {
                const clone = response.clone();
                clone.json().then(data => {
                    if (data && data.car_inventories) {
                        globalInventoryData = data.car_inventories;
                        const res = evaluateBestSeats(globalInventoryData, 2);
                        if (res && res.pair) {
                            globalBestTarget = res;
                            console.log('[嵯峨野助手] ⚡ 智能计算最佳选座方案:', res.desc, res.pair);
                            showHUD(`💡 智能锁定最优席位：${res.desc}`, 'rgba(40, 167, 69, 0.95)');
                        }
                    }
                }).catch(() => {});
            }
        } catch (e) {}
        return response;
    };

    // 参数读取
    const url = new URL(window.location.href);
    const params = url.searchParams;
    const targetDate = params.get('date') || (typeof GM_getValue !== 'undefined' ? GM_getValue('sagano_date') : null) || sessionStorage.getItem('sagano_date') || '2026-10-31';
    const targetService = params.get('serviceId') || (typeof GM_getValue !== 'undefined' ? GM_getValue('sagano_service') : null) || sessionStorage.getItem('sagano_service') || '';
    const targetUnits = parseInt(params.get('unitsCount') || '2', 10);

    // 持久化存储
    if (params.get('date')) {
        try { sessionStorage.setItem('sagano_date', params.get('date')); } catch(e){}
        if (typeof GM_setValue !== 'undefined') GM_setValue('sagano_date', params.get('date'));
    }
    if (params.get('serviceId')) {
        try { sessionStorage.setItem('sagano_service', params.get('serviceId')); } catch(e){}
        if (typeof GM_setValue !== 'undefined') GM_setValue('sagano_service', params.get('serviceId'));
    }
    if (params.get('unitsCount')) {
        try { sessionStorage.setItem('sagano_units', params.get('unitsCount')); } catch(e){}
        if (typeof GM_setValue !== 'undefined') GM_setValue('sagano_units', params.get('unitsCount'));
    }

    // =============================================================
    // 阶段 1: 官方活动详情页 (自动选路线、翻月、选日期、选人数、进入选座)
    // =============================================================
    if (window.location.pathname.includes('/activity/')) {
        showHUD('⚡【全自动抢票已启动】正在检索车票...', 'rgba(0, 122, 255, 0.95)');

        let targetMonth = '10月';
        let targetDay = '31';
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
            // ① 自动翻到目标月份
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
                    routeDone = true;
                    showHUD('✔ 路线已成功选中：嵯峨/岚山 ➔ 龟冈', 'rgba(40, 167, 69, 0.95)');
                }
            }

            // ③ 自动设定人数
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

            // ④ 自动点击「予約手続きへ」进入选座流程
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
        }, 200);

        setTimeout(() => clearInterval(mainTimer), 30000);
    }

    // =============================================================
    // 阶段 2: Linktivity 外部选座系统 (v16.0 智能全车厢偶数优先 & 绝不卡死引擎)
    // =============================================================
    if (window.location.hostname.includes('linktivity.io')) {
        showHUD('⚡ [1/4] 已进入选座系统，正在锁定车站...', 'rgba(0, 122, 255, 0.95)');

        let trainSelected = false;
        let isActionPending = false;
        let isSeatLocked = false;
        let lastActionTime = 0;
        let confirmSubmitted = false;

        const linktivityTimer = setInterval(() => {
            const now = Date.now();

            // 1. 车站选择阶段
            let fromCombobox = null;
            let toCombobox = null;
            const allLabels = Array.from(document.querySelectorAll('p[class*="_label_"], p, label'));
            for (const lbl of allLabels) {
                const t = (lbl.innerText || lbl.textContent || '').trim();
                if (t === '乗車駅') fromCombobox = lbl.nextElementSibling;
                else if (t === '降車駅') toCombobox = lbl.nextElementSibling;
            }
            if (!fromCombobox || !toCombobox) {
                const boxes = Array.from(document.querySelectorAll('div[role="combobox"]'));
                if (boxes.length >= 2) {
                    if (!fromCombobox) fromCombobox = boxes[0];
                    if (!toCombobox) toCombobox = boxes[1];
                }
            }

            if (fromCombobox && toCombobox) {
                const fromDone = (fromCombobox.innerText || '').includes('嵯峨');
                const toDone = (toCombobox.innerText || '').includes('亀岡');

                if (!fromDone) {
                    const popper = document.querySelector('div[role="dialog"], div[class*="_popper_"]');
                    if (popper) {
                        const sagaBtn = Array.from(popper.querySelectorAll('button, div[role="option"]')).find(el => (el.innerText || '').includes('トロッコ嵯峨'));
                        if (sagaBtn) {
                            safeClick(sagaBtn);
                            showHUD('✔ 乘车站已选中：トロッコ嵯峨', 'rgba(40, 167, 69, 0.95)');
                            return;
                        }
                    }
                    if (now - lastActionTime > 600) {
                        safeClick(fromCombobox);
                        lastActionTime = now;
                    }
                    return;
                }

                if (fromDone && !toDone) {
                    const popper = document.querySelector('div[role="dialog"], div[class*="_popper_"]');
                    if (popper) {
                        const kameokaBtn = Array.from(popper.querySelectorAll('button:not([disabled]), div[role="option"]')).find(el => (el.innerText || '').includes('トロッコ亀岡'));
                        if (kameokaBtn) {
                            safeClick(kameokaBtn);
                            showHUD('✔ 降车站已选中：トロッコ亀岡', 'rgba(40, 167, 69, 0.95)');
                            return;
                        }
                    }
                    if (now - lastActionTime > 600) {
                        safeClick(toCombobox);
                        lastActionTime = now;
                    }
                    return;
                }

                if (fromDone && toDone) {
                    const stationNextBtn = document.querySelector('div[class*="_footer_"] button:not([class*="outlined"]), footer button:last-child');
                    if (stationNextBtn && !stationNextBtn.disabled) {
                        safeClick(stationNextBtn);
                    }
                }
            }

            // 2. 车次选择阶段
            if (!trainSelected) {
                const trainBtns = Array.from(document.querySelectorAll('button')).filter(b => {
                    const t = (b.innerText || b.textContent || '').trim();
                    return t.includes('嵯峨野') && t.includes('号') && !b.disabled;
                });

                if (trainBtns.length > 0) {
                    let targetTrain = trainBtns[0];
                    if (targetService) {
                        const matched = trainBtns.find(b => (b.outerHTML || '').includes(targetService) || (b.innerText || '').includes(targetService));
                        if (matched) targetTrain = matched;
                    }

                    safeClick(targetTrain);
                    const trainText = (targetTrain.innerText || '').split('\n')[0].trim();
                    showHUD(`✔ [2/4] 已选定车次：${trainText}，正在选座...`, 'rgba(40, 167, 69, 0.95)');

                    const nextBtn = document.querySelector('div[class*="_footer_"] button:not([class*="outlined"]), footer button:last-child');
                    if (nextBtn && !nextBtn.disabled) {
                        safeClick(nextBtn);
                        trainSelected = true;
                    }
                    return;
                }
            }

            // 3. 核心智能选座阶段 (全车厢最优策略调度)
            const countEl = document.querySelector('p[class*="_count_"], [class*="count"]');
            const carriageContainers = Array.from(document.querySelectorAll('button[class*="_carriageContainer_"], [class*="carriage"] button'));

            if (countEl || carriageContainers.length > 0) {
                let curSelected = 0;
                let maxAllowed = targetUnits;

                if (countEl) {
                    const m = (countEl.innerText || '').match(/(\d+)\s*\/\s*(\d+)/);
                    if (m) {
                        curSelected = parseInt(m[1], 10);
                        maxAllowed = parseInt(m[2], 10);
                    }
                }

                const selectedSeats = Array.from(document.querySelectorAll('button[class*="_selected_"]'));
                if (!countEl) curSelected = selectedSeats.length;

                // 满额绝对强锁：一旦正好选满 2/2，停止一切操作，死按提交
                if (curSelected === maxAllowed || isSeatLocked) {
                    isSeatLocked = true;
                    showHUD(`🎉 成功锁定 ${curSelected}/${maxAllowed} 席位！正在全力提交直达支付...`, 'rgba(40, 167, 69, 0.95)');
                    const submitBtn = document.querySelector('div[class*="_footer_"] button:not([class*="outlined"]), footer button:last-child');
                    if (submitBtn) {
                        safeClick(submitBtn);
                    }
                    return;
                }

                // 800ms 原子冷却保护
                if (isActionPending && (now - lastActionTime < 800)) {
                    return;
                }
                isActionPending = false;

                // 超额安全回退
                if (curSelected > maxAllowed && selectedSeats.length > 0) {
                    const extraSeat = selectedSeats[selectedSeats.length - 1];
                    isActionPending = true;
                    lastActionTime = now;
                    safeClick(extraSeat);
                    showHUD(`⚠️ 纠正多选座位 (${curSelected} ➔ ${maxAllowed})，冷却中...`, 'rgba(255, 149, 0, 0.95)');
                    return;
                }

                // 未满额：执行全车最优选座
                if (curSelected < maxAllowed) {
                    // ① 如果已通过拦截截获全车最优席位 (如 4号车 4C+4D)
                    if (globalBestTarget && globalBestTarget.pair && globalBestTarget.pair.length >= maxAllowed) {
                        // 寻找下一个尚未被选中的目标座位
                        const nextTarget = globalBestTarget.pair.find(target => {
                            const selectedKeys = selectedSeats.map(s => {
                                const span = s.querySelector('span') || s;
                                const seatLetter = (span.innerText || '').trim().toUpperCase();
                                const groupDiv = s.closest('div[class*="_group_"]');
                                const groupNum = groupDiv ? parseInt(groupDiv.querySelector('span[class*="_groupId_"]')?.innerText || '0', 10) : 0;
                                return `${groupNum}-${seatLetter}`;
                            });
                            return !selectedKeys.includes(`${target.group}-${target.seat}`);
                        });

                        if (nextTarget) {
                            // 检查该目标所在车厢是否展开
                            const targetCarBtn = carriageContainers.find(b => (b.innerText || '').includes(`${nextTarget.carId}号`));
                            const isTargetCarExpanded = targetCarBtn ? !!targetCarBtn.closest('div[class*="_carriageContent_"], div')?.querySelector('div[class*="_car_"]') : false;

                            if (targetCarBtn && !isTargetCarExpanded) {
                                isActionPending = true;
                                lastActionTime = now;
                                safeClick(targetCarBtn);
                                showHUD(`🔍 展开目标车厢：${nextTarget.carId} 号车...`, 'rgba(0, 122, 255, 0.95)');
                                return;
                            }

                            // 目标车厢已展开，定位具体排号和座位
                            if (isTargetCarExpanded && targetCarBtn) {
                                const carContent = targetCarBtn.closest('div[class*="_carriageContent_"], div');
                                const groupSpans = Array.from(carContent.querySelectorAll('span[class*="_groupId_"]'));
                                const matchedGroupSpan = groupSpans.find(sp => parseInt((sp.innerText || '').trim(), 10) === nextTarget.group);

                                if (matchedGroupSpan) {
                                    const groupDiv = matchedGroupSpan.closest('div[class*="_group_"]');
                                    if (groupDiv) {
                                        const seatBtns = Array.from(groupDiv.querySelectorAll('button[class*="_seatInner_"]'));
                                        const matchedSeatBtn = seatBtns.find(b => {
                                            const sLetter = (b.querySelector('span')?.innerText || b.innerText || '').trim().toUpperCase();
                                            return sLetter === nextTarget.seat;
                                        });

                                        if (matchedSeatBtn) {
                                            const isAlreadySelected = matchedSeatBtn.className.includes('_selected_');
                                            const isDisabled = matchedSeatBtn.disabled || matchedSeatBtn.className.includes('_disabled_');

                                            if (!isAlreadySelected && !isDisabled) {
                                                isActionPending = true;
                                                lastActionTime = now;
                                                safeClick(matchedSeatBtn);
                                                showHUD(`🎯 命中：${nextTarget.carId}号车 ${nextTarget.group}${nextTarget.seat}！`, 'rgba(40, 167, 69, 0.95)');
                                                return;
                                            } else if (isDisabled) {
                                                // 发现该座已被别人抢走，立刻清空缓存重新计算下一最优！
                                                console.warn('[嵯峨野助手] 目标座位已被占，重新寻找下一最优！', nextTarget);
                                                if (globalInventoryData) {
                                                    // 标记该座不可用
                                                    const car = globalInventoryData.find(c => parseInt(c.logical_car_id, 10) === nextTarget.carId);
                                                    if (car) {
                                                        const arr = (car.arrangements || []).find(a => parseInt(a.seat_group_id, 10) === nextTarget.group && a.seat_id === nextTarget.seat);
                                                        if (arr) arr.reservation_state = 'OCCUPIED';
                                                    }
                                                    globalBestTarget = evaluateBestSeats(globalInventoryData, 2);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // ② DOM 动态巡检兜底：优先选偶数排座位
                    const expandedCar = carriageContainers.find(b => !!b.closest('div[class*="_carriageContent_"], div')?.querySelector('div[class*="_car_"]'));
                    if (expandedCar) {
                        const carContent = expandedCar.closest('div[class*="_carriageContent_"], div');
                        const groups = Array.from(carContent.querySelectorAll('div[class*="_group_"]'));

                        // 优先寻找偶数排的空位 (如 2, 4, 6, 8, 10...)
                        const evenGroups = groups.filter(g => {
                            const gNum = parseInt(g.querySelector('span[class*="_groupId_"]')?.innerText || '0', 10);
                            return gNum > 0 && (gNum % 2 === 0);
                        });

                        for (const g of evenGroups) {
                            const avail = g.querySelector('button[class*="_seatInner_"]:not([disabled]):not([class*="_disabled_"]):not([class*="_selected_"])');
                            if (avail) {
                                isActionPending = true;
                                lastActionTime = now;
                                safeClick(avail);
                                showHUD(`🎯 锁定偶数排座位 (${curSelected + 1}/${maxAllowed})...`, 'rgba(40, 167, 69, 0.95)');
                                return;
                            }
                        }

                        // 若偶数排无空位，选该车厢任意空位
                        const anyAvail = carContent.querySelector('button[class*="_seatInner_"]:not([disabled]):not([class*="_disabled_"]):not([class*="_selected_"])');
                        if (anyAvail) {
                            isActionPending = true;
                            lastActionTime = now;
                            safeClick(anyAvail);
                            showHUD(`💺 锁定席位 (${curSelected + 1}/${maxAllowed})...`, 'rgba(40, 167, 69, 0.95)');
                            return;
                        }
                    }

                    // ③ 当前车厢无可用空位，展开下一节车厢探查
                    for (const b of carriageContainers) {
                        const isExpanded = !!b.closest('div[class*="_carriageContent_"], div')?.querySelector('div[class*="_car_"]');
                        if (!isExpanded) {
                            isActionPending = true;
                            lastActionTime = now;
                            safeClick(b);
                            showHUD('🔍 正在探索其他车厢可用座位...', 'rgba(255, 149, 0, 0.95)');
                            return;
                        }
                    }
                }
            }

            // 4. 选座确认页提交
            const isConfirmStep = !!document.querySelector('div[class*="_orderConfirm_"], div[class*="_carriageList_"]');
            const confirmNextBtn = document.querySelector('div[class*="_footer_"] button:not([class*="outlined"]), footer button:last-child');
            if (isConfirmStep && confirmNextBtn && !confirmNextBtn.disabled && !confirmSubmitted) {
                confirmSubmitted = true;
                safeClick(confirmNextBtn);
                showHUD('🎉 选座锁定成功！正在进入官方订单填写与支付页...', 'rgba(40, 167, 69, 0.95)');
                clearInterval(linktivityTimer);
            }
        }, 200);

        setTimeout(() => clearInterval(linktivityTimer), 45000);
    }

    // =============================================================
    // 阶段 3: 官方订单填写与支付页面 (自动填姓名、邮箱、电话，直达Visa卡输入)
    // =============================================================
    if (window.location.pathname.includes('/booking/pay')) {
        showHUD('📝 正在为您自动填写官方乘车人与联系信息...', 'rgba(0, 122, 255, 0.95)');

        let formFilled = false;
        const payTimer = setInterval(() => {
            const lastNameInput = document.querySelector('input[name="lastName"], input[placeholder*="姓"], [class*="lastName"] input');
            const firstNameInput = document.querySelector('input[name="firstName"], input[placeholder*="名"], [class*="firstName"] input');
            const emailInput = document.querySelector('input[type="email"], input[name="email"], input[placeholder*="mail"]');
            const telInput = document.querySelector('input[type="tel"], input[name="tel"], input[placeholder*="tel"], input[placeholder*="电话"]');

            if (lastNameInput && !lastNameInput.value) {
                lastNameInput.value = 'WANG';
                lastNameInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
            if (firstNameInput && !firstNameInput.value) {
                firstNameInput.value = 'XIN';
                firstNameInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
            if (emailInput && !emailInput.value) {
                emailInput.value = 'xnan_19@163.com';
                emailInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
            if (telInput && !telInput.value) {
                telInput.value = '+8617671856274';
                telInput.dispatchEvent(new Event('input', { bubbles: true }));
            }

            const termsCheckbox = document.querySelector('input[type="checkbox"]');
            if (termsCheckbox && !termsCheckbox.checked) {
                termsCheckbox.click();
            }

            const confirmBtn = document.querySelector('button[class*="confirmButton"], button[class*="button_"]');
            if (confirmBtn && !confirmBtn.disabled && !formFilled) {
                const btnText = (confirmBtn.innerText || '').trim();
                if (btnText.includes('確認') || btnText.includes('次へ') || btnText.includes('進む')) {
                    formFilled = true;
                    safeClick(confirmBtn);
                    showHUD('🎉 信息已就绪！请在下方官方输入框输入 Visa 信用卡付款！', 'rgba(40, 167, 69, 0.95)');
                    clearInterval(payTimer);
                }
            }
        }, 300);

        setTimeout(() => clearInterval(payTimer), 20000);
    }
})();
