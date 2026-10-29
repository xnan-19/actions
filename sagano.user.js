// ==UserScript==
// @name         嵯峨野小火车全自动秒选车次直达订单页
// @namespace    sagano-romantic-train
// @version      17.3
// @description  终极执行版：恢复经实战检验的阶段1路线与人数逻辑；直选GitHub推荐精确席位；毫秒差候补偶数座；直达Visa支付！
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

    // 严谨判断车厢折叠容器是否已展开
    function getCarCard(carBtn) {
        let p = carBtn.parentElement;
        while (p && p !== document.body) {
            if (p.classList && Array.from(p.classList).some(c => c.toLowerCase().includes('carriage') || c.toLowerCase().includes('card'))) {
                return p;
            }
            p = p.parentElement;
        }
        return carBtn.parentElement?.parentElement || carBtn.parentElement;
    }

    function isCarriageExpanded(carBtn) {
        if (!carBtn) return false;
        if (carBtn.getAttribute('aria-expanded') === 'true') return true;
        const card = getCarCard(carBtn);
        if (!card) return false;
        // 检查该卡片下是否有排号或座位元素且处于可见状态 (offsetHeight > 0)
        const seatEl = card.querySelector('button[class*="_seatInner_"]');
        if (seatEl && seatEl.offsetParent !== null) return true;
        const groupEl = card.querySelector('div[class*="_group_"]');
        if (groupEl && groupEl.offsetParent !== null) return true;
        return false;
    }

    // 参数读取与全生命周期持久化
    const url = new URL(window.location.href);
    const params = url.searchParams;

    const targetDate = params.get('date') || (typeof GM_getValue !== 'undefined' ? GM_getValue('sagano_date') : null) || sessionStorage.getItem('sagano_date') || '2026-10-31';
    const targetService = params.get('serviceId') || (typeof GM_getValue !== 'undefined' ? GM_getValue('sagano_service') : null) || sessionStorage.getItem('sagano_service') || '';
    const targetUnits = parseInt(params.get('unitsCount') || (typeof GM_getValue !== 'undefined' ? GM_getValue('sagano_units') : null) || sessionStorage.getItem('sagano_units') || '2', 10);
    const targetSeatsParam = params.get('seats') || (typeof GM_getValue !== 'undefined' ? GM_getValue('sagano_seats') : null) || sessionStorage.getItem('sagano_seats') || '';

    // 持久化存储到 sessionStorage 和 GM 存储
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
    if (params.get('seats')) {
        try { sessionStorage.setItem('sagano_seats', params.get('seats')); } catch(e){}
        if (typeof GM_setValue !== 'undefined') GM_setValue('sagano_seats', params.get('seats'));
    }

    // 解析预设目标座位 (由 GitHub Actions 扫描推荐)
    let plannedSeats = [];
    if (targetSeatsParam) {
        plannedSeats = targetSeatsParam.split(',').map(s => {
            const p = s.trim().split('-');
            if (p.length >= 3) {
                return {
                    carId: parseInt(p[0], 10),
                    group: parseInt(p[1], 10),
                    seat: p[2].trim().toUpperCase(),
                    isUnavailable: false
                };
            }
            return null;
        }).filter(Boolean);
        console.log('[嵯峨野助手] 🎯 成功载入 GitHub 扫描推荐精确座位:', plannedSeats);
    }

    // =============================================================
    // 阶段 1: 官方活动详情页 (自动选日期、选路线、选人数、进入选座)
    // =============================================================
    if (window.location.pathname.includes('/activity/')) {
        showHUD('⚡【全自动抢票已启动】正在检索车票...', 'rgba(0, 122, 255, 0.95)');

        let targetMonthStr = '10';
        let targetDayStr = '31';
        if (targetDate && targetDate.includes('-')) {
            const parts = targetDate.split('-');
            if (parts.length === 3) {
                targetMonthStr = String(parseInt(parts[1], 10));
                targetDayStr = String(parseInt(parts[2], 10));
            }
        }

        let dateDone = false;
        let routeDone = false;
        let unitCount = 0;
        let submitDone = false;
        let lastCalendarAction = 0;

        const mainTimer = setInterval(() => {
            const now = Date.now();

            // ① 选日期：多层级容错匹配
            if (!dateDone) {
                // 1. 检查是否已经处于选中状态 (是否有 active/selected 的日期等于 targetDayStr)
                const selectedDayEl = Array.from(document.querySelectorAll('[class*="selected"], [class*="active"], [aria-selected="true"]')).find(el => {
                    const txt = (el.innerText || el.textContent || '').trim();
                    const lines = txt.split('\n').map(s => s.trim());
                    return lines.some(l => l === targetDayStr || l === `0${targetDayStr}`);
                });

                if (selectedDayEl) {
                    dateDone = true;
                    showHUD(`✔ 目标日期已选定：${targetMonthStr}月${targetDayStr}日`, 'rgba(40, 167, 69, 0.95)');
                } else {
                    // 2. 检查月份是否需要翻月
                    const monthEls = Array.from(document.querySelectorAll('[class*="month"], [class*="Month"], [class*="dateTableHead"], [class*="header"] p, h2, h3, p'));
                    const currentMonthEl = monthEls.find(el => {
                        const t = (el.innerText || el.textContent || '').trim();
                        return (t.includes('年') || t.includes('/') || t.includes('-')) && (t.includes('月') || /\d{4}/.test(t));
                    });

                    let needFlipMonth = false;
                    if (currentMonthEl) {
                        const mText = (currentMonthEl.innerText || currentMonthEl.textContent || '').trim();
                        const matchCurrentMonth = mText.includes(`${targetMonthStr}月`) || mText.includes(`/${targetMonthStr}`) || mText.includes(`-${targetMonthStr}`);
                        if (!matchCurrentMonth && (now - lastCalendarAction > 600)) {
                            needFlipMonth = true;
                        }
                    }

                    if (needFlipMonth) {
                        const nextMonthBtns = Array.from(document.querySelectorAll('button[class*="Next"], button[class*="next"], [class*="dateTableHead"] button, button[aria-label*="next"]'));
                        if (nextMonthBtns.length > 0) {
                            const nextBtn = nextMonthBtns[nextMonthBtns.length - 1];
                            safeClick(nextBtn);
                            lastCalendarAction = now;
                            showHUD(`📅 正在切换月份到 ${targetMonthStr} 月...`, 'rgba(255, 149, 0, 0.95)');
                            return;
                        }
                    }

                    // 3. 在日历单元格中寻找目标日期
                    const dayCandidates = Array.from(document.querySelectorAll('button, td, div[role="button"], [class*="dateTableDayButton"], [class*="dateTableBodyCell"] button, [class*="day"] button'));
                    const matchedBtn = dayCandidates.find(b => {
                        const dataDate = b.getAttribute('data-date') || b.getAttribute('data-day') || '';
                        if (dataDate && (dataDate === targetDate || dataDate.endsWith(`-${targetDayStr}`) || dataDate.endsWith(`-0${targetDayStr}`))) {
                            return true;
                        }
                        const txt = (b.innerText || b.textContent || '').trim();
                        const lines = txt.split('\n').map(s => s.trim()).filter(Boolean);
                        if (lines.length > 0) {
                            return lines[0] === targetDayStr || lines[0] === `0${targetDayStr}` || lines.some(l => l === targetDayStr);
                        }
                        return false;
                    });

                    if (matchedBtn) {
                        safeClick(matchedBtn);
                        dateDone = true;
                        lastCalendarAction = now;
                        showHUD(`✔ 成功点击选中日期：${targetMonthStr}月${targetDayStr}日`, 'rgba(40, 167, 69, 0.95)');
                    }
                }
            }

            // ② 自动选择路线：必须精准点击路线卡片
            if (!routeDone) {
                const routeButtons = Array.from(document.querySelectorAll('button[class*="PlanPicker"], button')).filter(b => {
                    const t = (b.innerText || '').trim();
                    return (t.includes('嵯峨駅') && t.includes('亀岡駅')) || (t.includes('嵯峨') && t.includes('亀岡')) || t.includes('嵯峨野') || t.includes('トロッコ');
                });

                if (routeButtons.length > 0) {
                    const targetBtn = routeButtons[0];
                    targetBtn.click();
                    targetBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                    targetBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                    targetBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

                    routeDone = true;
                    showHUD('✔ 路线已成功选中：嵯峨/岚山 ➔ 龟冈', 'rgba(40, 167, 69, 0.95)');
                }
            }

            // ③ 自动设定人数：点击加号按钮直到达到目标人数 (安全遍历，绝不使用非法CSS选择器)
            if (unitCount < targetUnits) {
                const allButtons = Array.from(document.querySelectorAll('button'));
                const plusBtn = allButtons.find(b => {
                    const use = b.querySelector('use');
                    const href = use ? (use.getAttribute('xlink:href') || use.getAttribute('href') || '') : '';
                    const cls = (b.className || '').toLowerCase();
                    const aria = (b.getAttribute('aria-label') || '').toLowerCase();
                    const txt = (b.innerText || '').trim();
                    return href.includes('plus') || cls.includes('plus') || aria.includes('plus') || txt === '+';
                });

                if (plusBtn && !plusBtn.disabled) {
                    plusBtn.click();
                    plusBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                    unitCount++;
                    showHUD(`👥 已设定人数: ${unitCount}/${targetUnits} 人`, 'rgba(40, 167, 69, 0.95)');
                }
            }

            // ④ 自动点击「予約手続きへ」进入车次/选座流程
            if (unitCount >= targetUnits && !submitDone) {
                const allBtns = Array.from(document.querySelectorAll('button'));
                const submitBtn = allBtns.find(b => {
                    const txt = (b.innerText || b.textContent || '').trim();
                    return (txt.includes('予約手続き') || txt.includes('予約へ進む') || txt.includes('次へ') || txt.includes('日程の確定') || txt.includes('Checkout')) && !b.disabled && !b.hasAttribute('disabled');
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
    }

    // =============================================================
    // 阶段 2: 官方选座 iframe / 选座主页面
    // =============================================================
    if (window.location.hostname.includes('linktivity.io') || window.location.pathname.includes('/booking/seat')) {
        let trainSelected = false;
        let lastActionTime = 0;
        let isSeatLocked = false;
        let isActionPending = false;
        let fallbackSwitchedCarId = null;

        const linktivityTimer = setInterval(() => {
            const now = Date.now();

            // 1. 车站选择阶段 (トロッコ嵯峨 ➔ トロッコ亀岡)
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

            // 3. 核心选座阶段 (优先直选推荐席位；毫秒差被抢时自动候补)
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

                // 满额绝对强锁：只要正好选满 2/2，停止任何其他动作，死死提交下一步
                if (curSelected === maxAllowed || isSeatLocked) {
                    isSeatLocked = true;
                    showHUD(`🎉 成功锁定 ${curSelected}/${maxAllowed} 席位！正在全力提交直达支付...`, 'rgba(40, 167, 69, 0.95)');
                    const submitBtn = document.querySelector('div[class*="_footer_"] button:not([class*="outlined"]), footer button:last-child');
                    if (submitBtn) {
                        safeClick(submitBtn);
                    }
                    return;
                }

                // 600ms 原子操作防抖冷却
                if (isActionPending && (now - lastActionTime < 600)) {
                    return;
                }
                isActionPending = false;

                // 超额安全纠偏
                if (curSelected > maxAllowed && selectedSeats.length > 0) {
                    const extraSeat = selectedSeats[selectedSeats.length - 1];
                    isActionPending = true;
                    lastActionTime = now;
                    safeClick(extraSeat);
                    showHUD(`⚠️ 纠正多选座位 (${curSelected} ➔ ${maxAllowed})...`, 'rgba(255, 149, 0, 0.95)');
                    return;
                }

                // =========================================================
                // 模式 A: 执行 GitHub 扫描推荐的精确席位 (Direct Execution)
                // =========================================================
                const availablePlannedTarget = plannedSeats.find(t => !t.isUnavailable);
                if (availablePlannedTarget) {
                    // 检查已选座位是否包含该目标
                    const isAlreadyPicked = selectedSeats.some(s => {
                        const span = s.querySelector('span') || s;
                        const sLetter = (span.innerText || '').trim().toUpperCase();
                        const groupDiv = s.closest('div[class*="_group_"]');
                        const groupNum = groupDiv ? parseInt(groupDiv.querySelector('span[class*="_groupId_"]')?.innerText || '0', 10) : 0;
                        return groupNum === availablePlannedTarget.group && sLetter === availablePlannedTarget.seat;
                    });

                    if (isAlreadyPicked) {
                        // 标记已完成，找下一个
                        const nextTarget = plannedSeats.find(t => !t.isUnavailable && t !== availablePlannedTarget);
                        if (!nextTarget) return;
                    }

                    const target = isAlreadyPicked ? plannedSeats.find(t => !t.isUnavailable && t !== availablePlannedTarget) : availablePlannedTarget;
                    if (target) {
                        const targetCarBtn = carriageContainers.find(b => (b.innerText || '').includes(`${target.carId}号`));
                        const isExpanded = targetCarBtn ? isCarriageExpanded(targetCarBtn) : false;

                        // 1. 若目标车厢未展开：只点击一次展开，并冷却等待渲染！绝不重复点！
                        if (targetCarBtn && !isExpanded) {
                            isActionPending = true;
                            lastActionTime = now;
                            safeClick(targetCarBtn);
                            showHUD(`🔍 展开目标车厢：${target.carId} 号车...`, 'rgba(0, 122, 255, 0.95)');
                            return;
                        }

                        // 2. 目标车厢已展开：直接定位目标座位
                        if (targetCarBtn && isExpanded) {
                            const carCard = getCarCard(targetCarBtn);
                            const groupSpans = Array.from(carCard.querySelectorAll('span[class*="_groupId_"]'));
                            const matchedGroupSpan = groupSpans.find(sp => parseInt((sp.innerText || '').trim(), 10) === target.group);

                            if (matchedGroupSpan) {
                                const groupDiv = matchedGroupSpan.closest('div[class*="_group_"]');
                                if (groupDiv) {
                                    const seatBtns = Array.from(groupDiv.querySelectorAll('button[class*="_seatInner_"]'));
                                    const matchedSeatBtn = seatBtns.find(b => {
                                        const sLetter = (b.querySelector('span')?.innerText || b.innerText || '').trim().toUpperCase();
                                        return sLetter === target.seat;
                                    });

                                    if (matchedSeatBtn) {
                                        const isSelected = matchedSeatBtn.className.includes('_selected_');
                                        const isDisabled = matchedSeatBtn.disabled || matchedSeatBtn.className.includes('_disabled_');

                                        if (!isSelected && !isDisabled) {
                                            isActionPending = true;
                                            lastActionTime = now;
                                            safeClick(matchedSeatBtn);
                                            showHUD(`🎯 锁定推荐席位：${target.carId}号车 ${target.group}${target.seat}！`, 'rgba(40, 167, 69, 0.95)');
                                            return;
                                        } else if (isDisabled) {
                                            // 毫秒差发生！目标座位被占，标记失效转入 Fallback
                                            console.warn('[嵯峨野助手] 目标座位已被占，转入智能候补:', target);
                                            showHUD(`⚠️ 席位 ${target.carId}车${target.group}${target.seat} 已被他人选定，正在为您候补最优偶数席位...`, 'rgba(255, 149, 0, 0.95)');
                                            target.isUnavailable = true;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                // =========================================================
                // 模式 B: 毫秒差保底候补逻辑 (Fallback Mode)
                // 严格遵循：偶数连座 => 偶数前后座 => 偶数分开坐 => 切换有票车厢
                // =========================================================
                const currentExpandedCarBtn = carriageContainers.find(b => isCarriageExpanded(b));
                if (currentExpandedCarBtn) {
                    const carCard = getCarCard(currentExpandedCarBtn);
                    const groups = Array.from(carCard.querySelectorAll('div[class*="_group_"]'));

                    // 偶数排方桌优先
                    const evenGroups = groups.filter(g => {
                        const gNum = parseInt(g.querySelector('span[class*="_groupId_"]')?.innerText || '0', 10);
                        return gNum > 0 && (gNum % 2 === 0);
                    });

                    // 1. 尝试找偶数连座 (同桌 A+B 或 C+D)
                    for (const g of evenGroups) {
                        const availSeats = Array.from(g.querySelectorAll('button[class*="_seatInner_"]:not([disabled]):not([class*="_disabled_"]):not([class*="_selected_"])'));
                        const letters = availSeats.map(b => (b.querySelector('span')?.innerText || b.innerText || '').trim().toUpperCase());
                        
                        let pick = null;
                        if (letters.includes('A') && letters.includes('B')) pick = availSeats.find(b => ['A', 'B'].includes((b.querySelector('span')?.innerText || b.innerText || '').trim().toUpperCase()));
                        else if (letters.includes('C') && letters.includes('D')) pick = availSeats.find(b => ['C', 'D'].includes((b.querySelector('span')?.innerText || b.innerText || '').trim().toUpperCase()));

                        if (pick) {
                            isActionPending = true;
                            lastActionTime = now;
                            safeClick(pick);
                            showHUD(`🎯 候补锁定：偶数连座席位！`, 'rgba(40, 167, 69, 0.95)');
                            return;
                        }
                    }

                    // 2. 尝试找偶数前后座 (同桌对坐 A+D 或 B+C)
                    for (const g of evenGroups) {
                        const availSeats = Array.from(g.querySelectorAll('button[class*="_seatInner_"]:not([disabled]):not([class*="_disabled_"]):not([class*="_selected_"])'));
                        const letters = availSeats.map(b => (b.querySelector('span')?.innerText || b.innerText || '').trim().toUpperCase());
                        
                        let pick = null;
                        if (letters.includes('A') && letters.includes('D')) pick = availSeats.find(b => ['A', 'D'].includes((b.querySelector('span')?.innerText || b.innerText || '').trim().toUpperCase()));
                        else if (letters.includes('B') && letters.includes('C')) pick = availSeats.find(b => ['B', 'C'].includes((b.querySelector('span')?.innerText || b.innerText || '').trim().toUpperCase()));

                        if (pick) {
                            isActionPending = true;
                            lastActionTime = now;
                            safeClick(pick);
                            showHUD(`🎯 候补锁定：偶数前后对坐席位！`, 'rgba(40, 167, 69, 0.95)');
                            return;
                        }
                    }

                    // 3. 选当前车厢任意偶数排座位
                    for (const g of evenGroups) {
                        const avail = g.querySelector('button[class*="_seatInner_"]:not([disabled]):not([class*="_disabled_"]):not([class*="_selected_"])');
                        if (avail) {
                            isActionPending = true;
                            lastActionTime = now;
                            safeClick(avail);
                            showHUD(`🎯 候补锁定：偶数排席位...`, 'rgba(40, 167, 69, 0.95)');
                            return;
                        }
                    }

                    // 4. 当前车厢若完全没有可用偶数座位：平滑切换到其他车厢探查 (单向切换，防震荡)
                    const otherCarBtn = carriageContainers.find(b => b !== currentExpandedCarBtn && !isCarriageExpanded(b));
                    if (otherCarBtn && fallbackSwitchedCarId !== otherCarBtn.innerText) {
                        fallbackSwitchedCarId = otherCarBtn.innerText;
                        isActionPending = true;
                        lastActionTime = now;
                        safeClick(otherCarBtn);
                        showHUD(`🔄 当前车厢无可用偶数座，正在平滑切换到其他车厢...`, 'rgba(255, 149, 0, 0.95)');
                        return;
                    }

                    // 5. 保底：选当前车厢任意剩余空位
                    const anyAvail = carCard.querySelector('button[class*="_seatInner_"]:not([disabled]):not([class*="_disabled_"]):not([class*="_selected_"])');
                    if (anyAvail) {
                        isActionPending = true;
                        lastActionTime = now;
                        safeClick(anyAvail);
                        showHUD(`💺 锁定席位 (${curSelected + 1}/${maxAllowed})...`, 'rgba(40, 167, 69, 0.95)');
                        return;
                    }
                } else if (carriageContainers.length > 0) {
                    // 没有展开任何车厢时，默认展开 4 号车或 1 号车
                    const car4 = carriageContainers.find(b => (b.innerText || '').includes('4号'));
                    const targetBtn = car4 || carriageContainers[0];
                    if (targetBtn) {
                        isActionPending = true;
                        lastActionTime = now;
                        safeClick(targetBtn);
                        showHUD(`🔍 正在初始化展开车厢...`, 'rgba(0, 122, 255, 0.95)');
                        return;
                    }
                }
            }
        }, 300);
    }

    // =============================================================
    // 阶段 3: 乘车人信息填写与直达 Visa 信用卡输入框
    // =============================================================
    if (window.location.pathname.includes('/booking/participant') || window.location.pathname.includes('/booking/order')) {
        showHUD('✍️ 正在全自动填报乘车人信息并勾选条款...', 'rgba(0, 122, 255, 0.95)');

        const passengerInfo = {
            firstName: 'XIN',
            lastName: 'WANG',
            email: 'xnan_19@163.com',
            tel: '17671856274',
            country: 'China'
        };

        const fillTimer = setInterval(() => {
            let filledCount = 0;

            const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]), select'));
            inputs.forEach(inp => {
                const name = (inp.name || inp.id || inp.getAttribute('placeholder') || '').toLowerCase();
                const type = (inp.type || '').toLowerCase();

                if (type === 'checkbox') {
                    if (!inp.checked) {
                        inp.checked = true;
                        inp.dispatchEvent(new Event('change', { bubbles: true }));
                        inp.click();
                    }
                    return;
                }

                if (name.includes('first') || name.includes('mei') || name.includes('名')) {
                    if (inp.value !== passengerInfo.firstName) {
                        inp.value = passengerInfo.firstName;
                        inp.dispatchEvent(new Event('input', { bubbles: true }));
                        inp.dispatchEvent(new Event('change', { bubbles: true }));
                        filledCount++;
                    }
                } else if (name.includes('last') || name.includes('sei') || name.includes('姓')) {
                    if (inp.value !== passengerInfo.lastName) {
                        inp.value = passengerInfo.lastName;
                        inp.dispatchEvent(new Event('input', { bubbles: true }));
                        inp.dispatchEvent(new Event('change', { bubbles: true }));
                        filledCount++;
                    }
                } else if (name.includes('mail')) {
                    if (inp.value !== passengerInfo.email) {
                        inp.value = passengerInfo.email;
                        inp.dispatchEvent(new Event('input', { bubbles: true }));
                        inp.dispatchEvent(new Event('change', { bubbles: true }));
                        filledCount++;
                    }
                } else if (name.includes('tel') || name.includes('phone')) {
                    if (inp.value !== passengerInfo.tel) {
                        inp.value = passengerInfo.tel;
                        inp.dispatchEvent(new Event('input', { bubbles: true }));
                        inp.dispatchEvent(new Event('change', { bubbles: true }));
                        filledCount++;
                    }
                }
            });

            // 自动勾选所有同意框
            const checkboxes = document.querySelectorAll('input[type="checkbox"]');
            checkboxes.forEach(cb => {
                if (!cb.checked) {
                    cb.checked = true;
                    cb.dispatchEvent(new Event('change', { bubbles: true }));
                }
            });

            // 自动点击“次へ / 支払いに進む / 注文を確定する”直达官方 Visa 支付框
            const nextBtns = Array.from(document.querySelectorAll('button')).filter(b => {
                const t = (b.innerText || '').trim();
                return (t.includes('次へ') || t.includes('支払') || t.includes('確認') || t.includes('確定')) && !b.disabled;
            });

            if (nextBtns.length > 0) {
                safeClick(nextBtns[nextBtns.length - 1]);
                showHUD('💳 乘车人已填报，已直达官方信用卡支付框！请准备付款！', 'rgba(40, 167, 69, 0.95)');
                clearInterval(fillTimer);
            }
        }, 500);
    }
})();
