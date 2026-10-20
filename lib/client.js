window.__ModuleLoader__.load({
    id: "dsh-skill-mcp-panel",
    factory: (require) => {
        const bundleModule = { exports: {} };
        Object.defineProperty(bundleModule.exports, Symbol.toStringTag, { value: "Module" });
        // 束契约：本文件由宿主以 /plugins/dsh-skill-mcp-panel/client.js 提供，
        // 只能 require 外壳种子词（react、jsx-runtime、primitives）。
        let react_jsx_runtime = require("react/jsx-runtime");
        let react = require("react");
        let primitives = require("@deepseek-ai/dsh-client-ui-primitives");
        // 宿主 primitives 的图标名：0.2.x 起只有描边档位命名（…OutlineRegular / …OutlineMedium
        // / 裸 …Outline），尺寸由 size prop 传。0.1.x 的像素后缀旧名（…Outline16）是历史包袱，
        // 2026-10-18 起不再回退——本插件最低支持宿主 0.2.0。
        function primitiveIcon(name) {
            return primitives[name];
        }
        // ── 技能树构建：从技能条目（含 rel）构建与文件树一致的分层结构 ──────
        // 正确性：叶子只能是扫描器验证过的技能条目（含 SKILL.md 的目录）；
        // rel 中间段是分类文件夹（永远不是技能）；rel 为空 = 根层叶子。
        // 因此"非技能的嵌套文件夹"不可能成为树节点。
        function buildSkillTree(skills) {
            const root = { path: "", name: "", skills: [], folders: new Map(), count: 0 };
            const byPath = new Map();
            byPath.set("", root);
            for (const skill of skills) {
                const rel = skill?.rel ?? "";
                if (rel === "") {
                    root.skills.push(skill);
                    continue;
                }
                const segments = rel.split("/");
                const dirSegments = segments.slice(0, -1);
                let current = "";
                let node = root;
                for (const segment of dirSegments) {
                    current = current === "" ? segment : current + "/" + segment;
                    let child = byPath.get(current);
                    if (child === undefined) {
                        child = { path: current, name: segment, skills: [], folders: new Map(), count: 0 };
                        byPath.set(current, child);
                        node.folders.set(segment, child);
                    }
                    node = child;
                }
                node.skills.push(skill);
            }
            computeCounts(root);
            return root;
        }
        function computeCounts(node) {
            let total = node.skills.length;
            for (const child of node.folders.values())
                total += computeCounts(child);
            node.count = total;
            return total;
        }
        /**
         * 图标渲染：primitiveIcon 取不到导出时返回 undefined（宿主是旧命名或没有这枚图标），
         * 这时退回内置描边图形。直接渲染 undefined 会让 React 抛
         * "Element type is invalid: … but got: undefined"，插槽渲染器会把整格 retire 掉。
         * 调用点写法：hostIcon(primitiveIcon("IconXOutlineRegular"), 14, PATHS)
         */
        function hostIcon(icon, size, paths) {
            if (icon !== undefined && icon !== null)
                return (0, react_jsx_runtime.jsx)(icon, { size: size, "aria-hidden": "true" });
            return (0, react_jsx_runtime.jsx)("svg", {
                width: size,
                height: size,
                viewBox: "0 0 24 24",
                fill: "none",
                stroke: "currentColor",
                strokeWidth: 1.7,
                strokeLinecap: "round",
                strokeLinejoin: "round",
                "aria-hidden": "true",
                children: paths.map((d, index) => (0, react_jsx_runtime.jsx)("path", { d: d, key: index }))
            });
        }
        // 图标回退图形：宿主 primitives 没有该导出时使用（坐标统一 24×24，
        // 取自设计稿的描边图形，视觉与宿主图标一致）。
        const ICON_PATHS = {
            skill: ["M7 3h7l4 4v14H7z", "M14 3v4h4", "M10 13h5", "M10 17h5"],
            folder: ["M3 7h6l2 2h10v10H3z"],
            group: ["M3 7h6l2 2h10v10H3z", "M12 12v5", "M9.5 14.5h5"],
            migrate: ["M4 8h14", "M14 4l4 4-4 4", "M20 16H6", "M10 12l-4 4 4 4"],
            plus: ["M12 5v14", "M5 12h14"],
            // 布局切换：三栏 / 简洁（一根竖线把方框一分为二）
            layout: ["M4 5h16v14H4z", "M13 5v14"],
            check: ["M5 12.5l4.5 4.5L19 7.5"],
            trash: ["M5 7h14", "M10 7V4h4v3", "M7 7l1 13h8l1-13"],
            gear: ["M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z", "M12 3.5v2", "M12 18.5v2", "M20.5 12h-2", "M5.5 12h-2", "M18 6.6l-1.4 1.4", "M7.4 16 6 17.4", "M18 17.4 16.6 16", "M7.4 8 6 6.6"]
        };
        /** 文本 → base64：撤销删除时用 addSkill 把 SKILL.md 正文回填。分块避免长文件把栈打爆。 */
        function utf8ToBase64(text) {
            const bytes = new TextEncoder().encode(String(text ?? ""));
            let binary = "";
            const CHUNK = 0x8000;
            for (let index = 0; index < bytes.length; index += CHUNK) {
                binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(index, index + CHUNK)));
            }
            return btoa(binary);
        }
        /** 「打开目录」用：宿主没有「在文件管理器里打开这个目录」的 API，只能把路径交给用户。 */
        function copyTextToClipboard(text) {
            return Promise.resolve().then(() => {
                if (typeof navigator === "undefined")
                    return false;
                const clipboard = navigator.clipboard;
                if (clipboard === undefined || clipboard === null || typeof clipboard.writeText !== "function")
                    return false;
                return Promise.resolve(clipboard.writeText(text)).then(() => true, () => false);
            });
        }
        // ── 样式（按用途分组）─────────────────────────────────────────────────
        // 页面骨架：section / 状态文案 / 搜索框 / 标题行
        const cssChrome = ".SKV_section{position:relative;width:100%;max-width:760px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:14px;display:flex}.SKV_status{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px;margin:0}.SKV_failure{color:var(--dsw-alias-state-error-primary);align-items:center;gap:10px;display:flex}.SKV_failure p{margin:0}.SKV_failure button{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;background:0 0;border-radius:6px;padding:4px 10px}.SKV_catalog{flex-direction:column;gap:12px;display:flex}.SKV_catalogHeading{align-items:baseline;gap:7px;padding:0 2px;display:flex}.SKV_catalogHeading h3{font-size:13px;font-weight:600;line-height:20px;margin:0}.SKV_catalogHeading span{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;font-size:12px;line-height:18px}.SKV_searchBox{position:relative;width:100%}.SKV_searchIcon{color:var(--dsw-alias-label-tertiary);position:absolute;left:12px;top:50%;transform:translateY(-50%);display:inline-flex;align-items:center;pointer-events:none}.SKV_searchField::placeholder{color:var(--dsw-alias-label-tertiary)}.SKV_searchField:focus-visible{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-business-primary) 18%, transparent)}.SKV_searchField{box-sizing:border-box;width:100%;height:36px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:34px;outline:0;padding:0 12px 0 38px}.SKV_iconButton{box-sizing:border-box;width:28px;height:28px;color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;background:0 0;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;padding:0;display:inline-flex;align-items:center;justify-content:center}.SKV_iconButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid)}.SKV_iconButton:disabled{cursor:default;opacity:.6}.SKV_notice{border-radius:8px;align-items:center;gap:10px;padding:8px 12px;display:flex;border:1px solid transparent}.SKV_notice[data-kind=error]{border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 40%, transparent);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent)}.SKV_notice[data-kind=error] .SKV_noticeText{color:var(--dsw-alias-state-error-primary)}.SKV_notice[data-kind=info]{border-color:color-mix(in srgb, var(--dsw-alias-state-business-primary) 35%, transparent);background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 8%, transparent)}.SKV_notice[data-kind=info] .SKV_noticeText{color:var(--dsw-alias-state-business-primary)}.SKV_noticeText{font-size:12px;line-height:18px;flex:1;min-width:0}.SKV_noticeButton{font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:2px 10px;font-size:12px;line-height:18px;flex:none}.SKV_noticeButton:hover{background:var(--dsw-alias-interactive-bg-hover-solid)}.SKV_deleteButton[data-confirm=true]{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 50%, transparent);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent)}";
        // 卡片列表：卡片、状态标签、内容框、开关与删除操作
        const cssCards = ".SKV_cards{grid-template-columns:repeat(2,minmax(0,1fr));align-items:start;gap:10px;margin:0;padding:0;list-style:none;display:grid}.SKV_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:10px;min-width:0;overflow:hidden}.SKV_card[data-open=true]{border-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-shadow-lv1)}.SKV_cardContent{width:100%;align-items:center;gap:8px;font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;border:none;padding:10px 12px;display:flex;text-align:left}.SKV_cardLeading{width:16px;height:16px;color:var(--dsw-alias-label-tertiary);flex:none;justify-content:center;align-items:center;display:inline-flex}.SKV_cardTitle{min-width:0;flex:1;text-overflow:ellipsis;white-space:nowrap;overflow:hidden;font-size:13px;font-weight:500;line-height:20px;transition:color .2s ease}.SKV_cardTitle[data-disabled=true]{color:var(--dsw-alias-label-tertiary)}.SKV_cardTrailing{color:var(--dsw-alias-label-tertiary);flex:none;align-items:center;gap:7px;display:inline-flex}.SKV_statusDot{background:var(--dsw-alias-label-tertiary);border-radius:999px;flex:none;width:7px;height:7px;display:inline-block;transition:background-color .2s ease}.SKV_statusDot[data-enabled=true]{background:var(--dsw-alias-state-success-primary)}.SKV_configTag{background:var(--dsw-alias-bg-layer-1);min-height:20px;color:var(--dsw-alias-label-secondary);white-space:nowrap;border-radius:5px;align-items:center;padding:1px 6px;font-size:11px;line-height:16px;display:inline-flex;transition:background-color .2s ease,color .2s ease}.SKV_configTag[data-enabled=true]{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);color:var(--dsw-alias-state-success-primary)}.SKV_configTag[data-enabled=false]{color:var(--dsw-alias-label-tertiary)}.SKV_chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .15s}.SKV_card[data-open=true] .SKV_chevron{transform:rotate(180deg)}.SKV_cardDetails{border-top:1px solid var(--dsw-alias-border-l2);flex-direction:column;gap:8px;padding:10px 12px;display:flex}.SKV_meta{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;margin:0}.SKV_metaProvider{color:var(--dsw-alias-label-tertiary);margin-left:6px}.SKV_contentBox{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-markdown-code-block);border-radius:8px;max-height:213px;overflow:auto}.SKV_content{margin:0;padding:10px 12px;white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Consolas,Menlo,monospace;font-size:12px;line-height:18px}.SKV_failureText{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;margin:0}.SKV_cardActions{border-top:1px solid var(--dsw-alias-border-l2);align-items:center;gap:8px;padding-top:10px;display:flex}.SKV_switchRow{align-items:center;gap:8px;display:inline-flex}.SKV_switch{box-sizing:border-box;width:36px;height:20px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:999px;cursor:pointer;padding:0;position:relative;flex:none;transition:background-color .2s ease,border-color .2s ease}.SKV_switch:disabled{cursor:default;opacity:.6}.SKV_switch[data-on=true]{border-color:transparent;background:var(--dsw-alias-state-business-primary)}.SKV_switchThumb{box-sizing:border-box;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-secondary);position:absolute;top:2px;left:2px;transition:transform .22s cubic-bezier(.34,1.56,.64,1),background-color .18s ease,width .15s ease}.SKV_switch[data-on=true] .SKV_switchThumb{transform:translateX(18px);background:var(--dsw-alias-label-primary-foreground)}.SKV_switch:active:not(:disabled) .SKV_switchThumb{width:18px}.SKV_switch[data-on=true]:active:not(:disabled) .SKV_switchThumb{transform:translateX(14px)}.SKV_switchText{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}.SKV_opError{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}.SKV_deleteButton{box-sizing:border-box;height:28px;color:var(--dsw-alias-state-error-primary);font:inherit;cursor:pointer;background:0 0;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;padding:0 12px;font-size:12px;line-height:26px;margin-left:auto}.SKV_deleteButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid)}.SKV_deleteButton:disabled{cursor:default;opacity:.6}";
        // 添加技能：按钮组与状态行
        const cssAdd = ".SKV_addActions{margin-left:auto;align-items:center;gap:6px;display:inline-flex;position:relative}.SKV_addStatus{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin:0}.SKV_fileInput{display:none}.SKV_addTarget{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;white-space:nowrap;max-width:150px;overflow:hidden;text-overflow:ellipsis;flex:none}.SKV_dropHint{position:absolute;inset:0;z-index:5;pointer-events:none;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb, var(--dsw-alias-bg-layer-3) 90%, transparent);border:1px dashed var(--dsw-alias-state-business-primary);border-radius:12px;color:var(--dsw-alias-state-business-primary);font-size:13px;line-height:20px}.SKV_addMenuWrap{position:relative;display:inline-flex}.SKV_addMenu{position:absolute;right:0;top:calc(100% + 6px);z-index:30;background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;box-shadow:var(--dsw-shadow-lv2);padding:10px;display:flex;flex-direction:column;gap:8px;min-width:220px}.SKV_addMenuTitle{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);margin:0}.SKV_addMenuButton{font:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);cursor:pointer;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:7px 10px;text-align:left;display:flex;align-items:center;gap:8px}.SKV_addMenuButton:hover{background:var(--dsw-alias-interactive-bg-hover)}";
        // 作用域：横栏、迁移按钮与迁移对话框样式
        const cssScope = ".SKV_scopeOverlay{position:fixed;inset:0;background:color-mix(in srgb, rgba(0,0,0,.45) 55%, transparent);align-items:center;justify-content:center;display:flex;z-index:1000}.SKV_scopeBox{background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;box-shadow:var(--dsw-shadow-lv2);width:440px;max-width:calc(100vw - 48px);max-height:80vh;flex-direction:column;padding:16px;gap:12px;display:flex}.SKV_scopeBox h4{font-size:14px;font-weight:600;line-height:20px;margin:0}.SKV_scopeOptions{flex-direction:column;gap:8px;display:flex}.SKV_scopeOption{font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 12px;font-size:13px;line-height:20px;text-align:left;display:flex;align-items:center;gap:8px}.SKV_scopeOption[data-active=true]{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 1px color-mix(in srgb, var(--dsw-alias-state-business-primary) 30%, transparent)}.SKV_scopeOption input{margin:0;accent-color:var(--dsw-alias-state-business-primary)}.SKV_wsPath{color:var(--dsw-alias-label-tertiary);min-width:0;text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.SKV_scopeActions{align-items:center;justify-content:flex-end;gap:8px;display:flex}.SKV_scopeAction{font:inherit;cursor:pointer;border-radius:6px;padding:5px 14px;font-size:13px;line-height:20px}.SKV_scopeCancel{background:0 0;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}.SKV_scopeConfirm{background:var(--dsw-alias-state-business-primary);border:1px solid transparent;color:var(--dsw-alias-state-business-on-primary, #fff)}.SKV_scopeConfirm:disabled{opacity:.6;cursor:default}";
        // 侧栏面板字形：宿主不再替我们画图标，由 sidebar.panellist 行自己渲染；
        // 图形沿用蒙版 PNG（背景色取 currentColor，选中/折叠态自动跟随宿主）
        const cssTheme = "body[data-ds-dark-theme] .SKV_switchThumb{background:#fff}body[data-ds-dark-theme] .SKV_switch[data-on=true] .SKV_switchThumb{background:#fff}";
        // 主页主区面板（main 槽位）的整页外壳：宿主不给滚动容器与页边距，
        // 这一层就是面板自己的「页面」。
        const cssPage = ".SKV_page{box-sizing:border-box;height:100%;color:var(--dsw-alias-label-primary);flex-direction:column;align-items:center;gap:24px;padding:28px clamp(24px,4vw,48px) 48px;display:flex;overflow:auto}.SKV_page>*{width:100%;max-width:760px}.SKV_pageHead{flex-direction:column;gap:4px;display:flex}.SKV_pageTitle{margin:0;font-size:20px;font-weight:500;line-height:28px}.SKV_pageIntro{color:var(--dsw-alias-label-secondary);margin:0;font-size:13px;line-height:20px}.SKV_pageTop{min-height:20px;align-items:center;display:flex}.SKV_pageBack{font:inherit;font-size:12.5px;line-height:20px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:0;align-items:center;gap:6px;padding:0;display:inline-flex}.SKV_pageBack:hover{color:var(--dsw-alias-label-primary)}.SKV_pageBack:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.SKV_pageBack svg{flex:none}.SKV_tabs{align-items:center;gap:4px;border-bottom:1px solid var(--dsw-alias-border-l2);display:flex;flex-wrap:wrap}.SKV_tab{font:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:0;border-bottom:2px solid transparent;margin-bottom:-1px;padding:6px 12px;display:inline-flex;align-items:center}.SKV_tab:hover{color:var(--dsw-alias-label-primary)}.SKV_tab[data-active=true]{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-state-business-primary);font-weight:500}.SKV_tab:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}";
        const cssPanelIcon = ".SKV_panelIcon{flex:none;display:inline-block;background-color:currentColor}.SKV_panelIconMerged{-webkit-mask:url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48' width='96' height='96' fill='none' stroke='currentColor' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'><path d='M12 5H28L38 15V41a2 2 0 0 1-2 2H12a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z'/><path d='M28 5V13a2 2 0 0 0 2 2H38'/><path d='M17 29L23 23A2.83 2.83 0 0 1 27 27L21 33A2.83 2.83 0 0 0 25 37L31 31'/></svg>\") center/contain no-repeat;mask:url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48' width='96' height='96' fill='none' stroke='currentColor' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'><path d='M12 5H28L38 15V41a2 2 0 0 1-2 2H12a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z'/><path d='M28 5V13a2 2 0 0 0 2 2H38'/><path d='M17 29L23 23A2.83 2.83 0 0 1 27 27L21 33A2.83 2.83 0 0 0 25 37L31 31'/></svg>\") center/contain no-repeat}";
        const cssMigrate = ".SKV_scopeBar{gap:6px;padding:2px;max-width:100%;overflow-x:auto;scrollbar-width:thin;display:flex;align-items:center}.SKV_migrateSection{flex-direction:column;gap:6px;display:flex}.SKV_migrateLabel{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;margin:0}.SKV_migrateFromValue{color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;margin:0;word-break:break-all}.SKV_migrateList{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;max-height:220px;overflow-y:auto;margin:0;padding:4px;list-style:none;display:flex;flex-direction:column;gap:2px}.SKV_migrateItem{font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;border:none;border-radius:6px;padding:6px 10px;font-size:13px;line-height:20px;text-align:left;display:flex;align-items:center;gap:8px}.SKV_migrateItem:hover{background:var(--dsw-alias-interactive-bg-hover)}.SKV_migrateItem input{margin:0;accent-color:var(--dsw-alias-state-business-primary)}.SKV_migrateItemName{flex:1;min-width:0;text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.SKV_migrateItemState{color:var(--dsw-alias-label-tertiary);font-size:11px;flex:none}.SKV_migrateSelectAll{font:inherit;color:var(--dsw-alias-state-business-primary);cursor:pointer;background:0 0;border:none;padding:0;font-size:12px;line-height:18px}.SKV_migrateHint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin:0}.SKV_migrateResult{border-radius:8px;padding:8px 12px;font-size:12px;line-height:18px;margin:0}.SKV_migrateResult[data-ok=true]{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);color:var(--dsw-alias-state-success-primary)}.SKV_migrateResult[data-ok=false]{background:color-mix(in srgb, var(--dsw-alias-state-warning-primary) 10%, transparent);color:var(--dsw-alias-state-warning-primary)}.SKV_migrateResultList{margin:4px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:2px;max-height:120px;overflow-y:auto}.SKV_wsPath{min-width:0;text-overflow:ellipsis;white-space:nowrap;overflow:hidden;display:block}.SKV_migrateOptionLabel{min-width:0;text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.SKV_scopeOptions{max-height:132px;overflow-y:auto;scrollbar-width:thin}.SKV_migrateList{max-height:148px}.SKV_scopeBox{overflow-y:auto;scrollbar-width:thin}.SKV_select{width:100%;box-sizing:border-box;height:32px;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:0 8px}.SKV_select:focus-visible{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-business-primary) 18%, transparent);outline:none}.SKV_groupBody{display:flex;gap:16px;min-height:0}.SKV_groupSide{width:150px;flex:none;display:flex;flex-direction:column;gap:2px;min-width:0}.SKV_groupNewBtn{display:flex;align-items:center;gap:6px;justify-content:flex-start;font:inherit;font-size:13px;color:var(--dsw-alias-state-business-primary);cursor:pointer;background:0 0;border:1px dashed var(--dsw-alias-border-l1);border-radius:8px;padding:7px 10px;margin-bottom:6px;text-align:left}.SKV_groupNewBtn:hover{background:var(--dsw-alias-interactive-bg-hover)}.SKV_groupSideLabel{font-size:12px;color:var(--dsw-alias-label-tertiary);padding:0 10px;margin-bottom:2px}.SKV_groupSideItem{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:6px;font:inherit;font-size:13px;cursor:pointer;color:var(--dsw-alias-label-secondary);background:0 0;border:none;text-align:left;min-width:0}.SKV_groupSideItem:hover{background:var(--dsw-alias-interactive-bg-hover)}.SKV_groupSideItem[data-active=true]{background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent);color:var(--dsw-alias-state-business-primary);font-weight:500}.SKV_groupMain{flex:1;min-width:0;display:flex;flex-direction:column;gap:12px}.SKV_field{display:flex;flex-direction:column;gap:6px}.SKV_fieldLabel{font-size:12px;color:var(--dsw-alias-label-secondary);margin:0}.SKV_skillListBox{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:0 10px;max-height:220px;overflow-y:auto}.SKV_skillRow{display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:0.5px solid var(--dsw-alias-border-l2);font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;min-width:0}.SKV_skillRow:last-child{border-bottom:none}.SKV_skillRow:hover{background:var(--dsw-alias-interactive-bg-hover)}.SKV_skillRow input{margin:0;accent-color:var(--dsw-alias-state-business-primary);flex:none}.SKV_skillName{flex:1;min-width:0;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.SKV_skillBadge{font-size:12px;padding:2px 8px;border-radius:5px;white-space:nowrap;flex:none}.SKV_skillBadge[data-on=true]{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, transparent);color:var(--dsw-alias-state-success-primary)}.SKV_skillBadge[data-on=false]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-tertiary)}.SKV_countRow{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}.SKV_countText{font-size:12px;color:var(--dsw-alias-label-secondary);margin:0}.SKV_dialogFooter{display:flex;align-items:center;justify-content:space-between;margin-top:12px;padding-top:12px;border-top:0.5px solid var(--dsw-alias-border-l2)}.SKV_dangerBtn{font:inherit;font-size:13px;color:var(--dsw-alias-state-error-primary);cursor:pointer;background:0 0;border:1px solid transparent;border-radius:6px;padding:5px 10px}.SKV_dangerBtn:hover:not(:disabled){background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent)}.SKV_dangerBtn:disabled{cursor:default;opacity:.6}.SKV_textInput{width:100%;box-sizing:border-box;height:32px;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;outline:none;padding:0 10px}.SKV_textInput::placeholder{color:var(--dsw-alias-label-tertiary)}.SKV_textInput:focus-visible{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-business-primary) 18%, transparent)}.SKV_scopeBox{width:640px}.SKV_groupSide{width:170px}.SKV_groupSideItem{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.SKV_select{appearance:none;-webkit-appearance:none;width:100%;box-sizing:border-box;height:32px;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);background-color:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:0 30px 0 10px;background-image:url('data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 viewBox=%270 0 16 16%27 fill=%27none%27%3E%3Cpath d=%27M4 6l4 4 4-4%27 stroke=%27%23888%27 stroke-width=%271.6%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27/%3E%3C/svg%3E');background-repeat:no-repeat;background-position:right 10px center}.SKV_select:hover{border-color:var(--dsw-alias-border-l1)}.SKV_targetBox{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:4px;max-height:152px;overflow-y:auto;scrollbar-width:thin}.SKV_targetItem{display:flex;align-items:center;gap:8px;padding:7px 6px;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;border:none;border-bottom:0.5px solid var(--dsw-alias-border-l2);width:100%;text-align:left;min-width:0}.SKV_targetItem:last-child{border-bottom:none}.SKV_targetItem:hover{background:var(--dsw-alias-interactive-bg-hover)}.SKV_targetItem[data-active=true]{background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 8%, transparent)}.SKV_targetItem input{margin:0;accent-color:var(--dsw-alias-state-business-primary);flex:none}.SKV_skillListBox{max-height:180px};.SKV_groupBar{gap:6px;padding:2px;display:flex;flex-wrap:wrap;align-items:center}.SKV_groupItem{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:3px 11px;font-size:12px;line-height:18px;white-space:nowrap;flex:none}.SKV_groupItem:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l1)}.SKV_groupItem[data-active=true]{background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent);border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary);font-weight:500}.SKV_groupSep{display:none}.SKV_scopeSelect{display:inline-flex;align-items:center;gap:12px;box-sizing:border-box;height:36px;max-width:100%;padding:0 14px;border:none;border-radius:18px;background:var(--dsw-alias-bg-module-platform);font:inherit;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary);cursor:pointer}.SKV_scopeSelect:hover{background:var(--dsw-alias-interactive-bg-hover)}.SKV_scopeSelectLabel{min-width:0;max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.SKV_scopeSelectChevron{flex:none;color:var(--dsw-alias-label-tertiary)}";
        const cssCategory = ".SKV_categoryBar{display:flex;align-items:center;gap:6px;margin-bottom:6px;flex-wrap:wrap}.SKV_categoryLabel{font-size:12px;color:var(--dsw-alias-label-tertiary);flex:none;margin-right:2px}.SKV_categoryChip{font:inherit;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:2px 10px;white-space:nowrap;flex:none}.SKV_categoryChip:hover{background:var(--dsw-alias-interactive-bg-hover)}.SKV_categoryChip[data-active=true]{background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent);border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}";
        const cssTree = ".SKV_treeFolder{grid-column:1/-1;display:flex;flex-direction:column;gap:10px}.SKV_treeFolderHeader{display:flex;align-items:center;gap:6px;width:100%;font:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:7px 10px;text-align:left}.SKV_treeFolderHeader:hover{background:var(--dsw-alias-interactive-bg-hover)}.SKV_treeFolderName{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.SKV_treeFolderCount{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;font-size:12px;line-height:18px;flex:none}.SKV_treeChevron{transition:transform .15s;transform:rotate(-90deg)}.SKV_treeChevronOpen{transition:transform .15s;transform:rotate(0deg)}";
        const cssEffects = "@keyframes skvFadeIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}@keyframes skvFadeOnly{from{opacity:0}to{opacity:1}}@keyframes skvPopIn{from{opacity:0;transform:translateY(-4px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}@keyframes skvPulse{0%,100%{opacity:.55}50%{opacity:1}}.SKV_status{animation:skvPulse 1.6s ease-in-out infinite}.SKV_card{transition:border-color .18s cubic-bezier(.22,.61,.36,1),box-shadow .18s cubic-bezier(.22,.61,.36,1)}.SKV_card:hover{border-color:var(--dsw-alias-border-l1)}.SKV_cardContent{transition:background-color .15s ease}.SKV_cardContent:hover{background:var(--dsw-alias-interactive-bg-hover)}.SKV_cardContent:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}.SKV_cardDetails{animation:skvFadeIn .18s cubic-bezier(.22,.61,.36,1)}.SKV_cards{animation:skvFadeOnly .2s ease}.SKV_addMenu{animation:skvPopIn .15s cubic-bezier(.22,.61,.36,1)}.SKV_dropHint{animation:skvFadeOnly .15s ease}.SKV_scopeOverlay{animation:skvFadeOnly .15s ease}.SKV_scopeBox{animation:skvPopIn .18s cubic-bezier(.22,.61,.36,1)}.SKV_searchField,.SKV_textInput,.SKV_select{transition:border-color .15s ease,box-shadow .15s ease}.SKV_categoryChip,.SKV_migrateItem,.SKV_targetItem,.SKV_scopeOption{transition:background-color .15s ease,border-color .15s ease,color .15s ease}.SKV_iconButton,.SKV_addMenuButton,.SKV_deleteButton,.SKV_noticeButton,.SKV_scopeAction,.SKV_dangerBtn,.SKV_groupNewBtn,.SKV_migrateSelectAll{transition:background-color .15s ease,border-color .15s ease,transform .1s ease}.SKV_iconButton:active:not(:disabled),.SKV_deleteButton:active:not(:disabled),.SKV_scopeAction:active,.SKV_addMenuButton:active,.SKV_dangerBtn:active:not(:disabled),.SKV_groupNewBtn:active{transform:scale(.96)}.SKV_iconButton:focus-visible,.SKV_deleteButton:focus-visible,.SKV_scopeAction:focus-visible,.SKV_switch:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}.SKV_fieldLabel,.SKV_groupSideLabel,.SKV_migrateLabel,.SKV_categoryLabel{font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}.SKV_scopeBox{padding:20px;gap:14px}.SKV_groupSide{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:8px;box-sizing:border-box}.SKV_groupNewBtn{align-items:center;gap:6px}.SKV_groupNewBtn svg{flex:none}.SKV_groupDelete{align-items:center;justify-content:center}.SKV_migrateResult{display:flex;align-items:center;gap:7px}.SKV_migrateResult svg{flex:none}.SKV_dialogFooter{gap:12px}@media (prefers-reduced-motion: reduce){.SKV_page *{animation-duration:.001ms!important;animation-iteration-count:1!important}.SKV_section *{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important}}";
        // 末条规则把作用域下拉限制为最多 11 行可见（Menu 项 min-height 40px × 11 + 卡片 padding 8px = 448px），
        // 超出部分在宿主 Menu 自己的 .viewport 里滚动。Menu 以 portal 渲染到 document.body，
        // 拿不到它的 DOM 层级，故用 :has() 以「我们的下拉正打开」为条件精确限定，
        // 不影响宿主自己的其它菜单；:has() 不可用时该规则失效，退化为原来的整屏上限。
        const cssChipRefresh = ".SKV_scopeBar{gap:4px;padding:2px 2px 6px}.SKV_groupBar{gap:5px;padding:2px}.SKV_groupItem{background:transparent;border:1px solid transparent;border-radius:8px;padding:6px 12px;font-size:13px;line-height:18px}.SKV_groupItem:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:transparent;color:var(--dsw-alias-label-primary)}.SKV_groupItem[data-active=true]{background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 14%, transparent);border-color:transparent;font-weight:500}.SKV_categoryBar{gap:6px 8px}.SKV_categoryChip{background:transparent;border:1px solid transparent;border-radius:7px;padding:5px 12px;font-size:12px}.SKV_categoryChip:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:transparent}.SKV_categoryChip[data-active=true]{background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 14%, transparent);border-color:transparent;font-weight:500}body:has(.SKV_scopeSelect[aria-expanded=true])>div[role=menu]{max-height:min(448px,calc(100vh - 24px))}";
        // 分组：对话框侧栏、分组横栏 chip（含启用/总数）与卡片上方的整组启停胶囊按钮（补齐 2.0.2 的 cssGroupDelete）
        const cssGroups = ".SKV_groupItemWrap{position:relative;display:inline-flex;align-items:center;gap:2px}.SKV_groupSideItemWrap{position:relative;display:flex;align-items:center;min-width:0}.SKV_groupSideItemWrap .SKV_groupSideItem{flex:1;min-width:0}.SKV_groupDelete{display:none;width:16px;height:16px;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;line-height:14px;cursor:pointer;background:0 0;border:none;border-radius:999px;padding:0;margin-left:2px;flex:none}.SKV_groupSideItemWrap:hover .SKV_groupDelete{display:inline-flex}.SKV_groupDelete:hover{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent)}.SKV_groupDelete[data-confirm=true]{display:inline-flex;width:auto;height:18px;padding:0 7px;color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent)}.SKV_groupToggle{font:inherit;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;white-space:nowrap;cursor:pointer;background:0 0;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:1px 7px;margin-left:2px;flex:none}.SKV_groupToggle:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.SKV_groupToggle[data-on=true]{color:var(--dsw-alias-state-success-primary);border-color:color-mix(in srgb, var(--dsw-alias-state-success-primary) 40%, transparent)}.SKV_groupToggle:disabled{opacity:.6;cursor:not-allowed}.SKV_groupItem{display:inline-flex;align-items:center}.SKV_groupItemCount{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;font-size:11px;line-height:15px;margin-left:4px}.SKV_groupItem[data-active=true] .SKV_groupItemCount{color:inherit}.SKV_groupBulkRow{display:flex;align-items:center;gap:8px;margin:0 0 8px}.SKV_pluginToggle{display:inline-flex;align-items:center;gap:6px;margin-left:auto;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;cursor:pointer;white-space:nowrap}.SKV_pluginToggle input{margin:0;accent-color:var(--dsw-alias-state-business-primary)}.SKV_pluginToggle:hover{color:var(--dsw-alias-label-primary)}.SKV_groupBulkBtn{font:inherit;font-size:12px;line-height:18px;color:var(--dsw-alias-state-business-primary);cursor:pointer;background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, transparent);border:1px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 35%, transparent);border-radius:999px;padding:4px 14px;white-space:nowrap;flex:none}.SKV_groupBulkBtn:hover:not(:disabled){background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 16%, transparent)}.SKV_groupBulkBtn:disabled{cursor:default;opacity:.55}";
        // 三栏外壳（v2.1.6 重构）：左轨工作区 / 中栏「分组·来源」/ 右侧主区。
        // 颜色一律走宿主 token（--dsw-alias-*）——设计稿只是深色示意，它的十六进制值
        // 一个都不抄进来，面板才能跟着宿主的深/浅主题走。
        // 主区单独一层滚动容器（.SKV_mainScroll），这样底部批量栏与顶部 Toast 能相对
        // .SKV_mainCol 绝对定位、不随列表滚走。
        const cssShell = ".SKV_page[data-tab=skills],.SKV_page[data-tab=mcp]{align-items:stretch;gap:12px;padding:18px 0 0;overflow:hidden}.SKV_page[data-tab=skills]>.SKV_pageTop,.SKV_page[data-tab=mcp]>.SKV_pageTop{padding:0 clamp(20px,3vw,40px)}.SKV_page[data-tab=skills]>.SKV_tabs,.SKV_page[data-tab=mcp]>.SKV_tabs{gap:22px;padding:0 clamp(20px,3vw,40px)}.SKV_page[data-tab=skills]>.SKV_pageTop,.SKV_page[data-tab=skills]>.SKV_tabs,.SKV_page[data-tab=mcp]>.SKV_pageTop,.SKV_page[data-tab=mcp]>.SKV_tabs{max-width:none;width:100%;box-sizing:border-box}.SKV_page[data-tab=skills]>*{max-width:none}.SKV_page[data-tab=mcp]>.MCP_section{box-sizing:border-box;width:100%;max-width:1040px;margin:0 auto;padding:0 clamp(20px,3vw,40px) 40px;flex:1;min-height:0;overflow-y:auto}@keyframes skvTabIn{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}.SKV_page[data-tab]>.SKV_section,.SKV_page[data-tab]>.MCP_section{animation:skvTabIn .2s cubic-bezier(.3,.8,.2,1)}"
            // 页签下划线：不用边框色切换（会瞬移），改成一条从中间长出来的指示条。
            + ".SKV_tab{position:relative;padding:8px 2px 10px;font-size:13.5px;border-bottom-color:transparent!important}"
            + ".SKV_tab::after{content:\"\";position:absolute;left:2px;right:2px;bottom:-1px;height:2px;border-radius:2px;background:var(--dsw-alias-state-business-primary);transform:scaleX(0);transition:transform .28s cubic-bezier(.3,.8,.2,1)}"
            + ".SKV_tab[data-active=true]::after{transform:scaleX(1)}"
            + ".SKV_section{max-width:none;flex:1;min-height:0;flex-direction:row;gap:0;overflow:hidden}"
            + ".SKV_rail{flex:none;width:188px;display:flex;flex-direction:column;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-layer-2);border-right:1px solid var(--dsw-alias-border-l2)}"
            + ".SKV_railHead{padding:18px 22px 8px;color:var(--dsw-alias-label-tertiary);font-size:12.5px;line-height:18px}"
            + ".SKV_railList{position:relative;flex:1;min-height:0;overflow-y:auto;padding:4px 12px 14px 14px;scrollbar-width:thin}"
            + ".SKV_railItem{display:flex;align-items:center;justify-content:space-between;width:100%;height:34px;margin:2px 0;padding:0 10px;border:0;border-radius:8px;background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer;transition:background-color .18s cubic-bezier(.3,.8,.2,1),color .18s cubic-bezier(.3,.8,.2,1)}"
            + ".SKV_railItem:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}"
            + ".SKV_railItem[data-active=true]{background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 14%, transparent);color:var(--dsw-alias-label-primary)}"
            + ".SKV_railItemName{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}"
            + ".SKV_railItemCount{flex:none;margin-left:8px;font-size:11.5px;line-height:18px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary)}"
            + ".SKV_railItem[data-active=true] .SKV_railItemCount{color:inherit;opacity:.75}"
            + ".SKV_railBar{position:absolute;left:0;top:0;width:3px;height:18px;border-radius:0 3px 3px 0;background:var(--dsw-alias-state-business-primary);box-shadow:0 0 10px color-mix(in srgb, var(--dsw-alias-state-business-primary) 70%, transparent);transition:transform .3s cubic-bezier(.3,.8,.2,1);pointer-events:none}"
            + ".SKV_pane{flex:none;width:204px;display:flex;flex-direction:column;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-layer-1);border-right:1px solid var(--dsw-alias-border-l2)}"
            + ".SKV_paneHead{flex:none;display:flex;align-items:center;gap:8px;padding:18px 16px 8px}"
            + ".SKV_paneTitle{min-width:0;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:15px;font-weight:600;line-height:22px}"
            + ".SKV_paneModes{flex:none;margin-left:auto;display:inline-flex;padding:1px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-3)}"
            + ".SKV_paneMode{font:inherit;font-size:11.5px;line-height:16px;color:var(--dsw-alias-label-tertiary);background:0 0;border:0;border-radius:999px;padding:2px 8px;cursor:pointer;transition:background-color .18s cubic-bezier(.3,.8,.2,1),color .18s cubic-bezier(.3,.8,.2,1)}"
            + ".SKV_paneMode[data-active=true]{background:var(--dsw-alias-interactive-bg-hover-solid);color:var(--dsw-alias-label-primary)}"
            + ".SKV_paneMode:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}"
            + ".SKV_paneList{flex:1;min-height:0;overflow-y:auto;padding:4px 12px;display:flex;flex-direction:column;gap:2px;scrollbar-width:thin}"
            + ".SKV_paneItem{display:flex;align-items:center;justify-content:space-between;width:100%;padding:7px 12px;border:0;border-radius:8px;background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:18px;text-align:left;cursor:pointer;transition:background-color .18s cubic-bezier(.3,.8,.2,1),color .18s cubic-bezier(.3,.8,.2,1)}"
            + ".SKV_paneItem:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}"
            + ".SKV_paneItem[data-active=true]{background:var(--dsw-alias-interactive-bg-hover-solid);color:var(--dsw-alias-label-primary);font-weight:500}"
            + ".SKV_paneItem:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}"
            + ".SKV_paneItemName{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}"
            + ".SKV_paneItemCount{flex:none;margin-left:8px;font-size:11.5px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}"
            + ".SKV_paneNew{flex:none;display:flex;align-items:center;gap:8px;margin:8px 12px 16px;padding:8px 12px;border:1px dashed var(--dsw-alias-border-l1);border-radius:8px;background:0 0;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12.5px;line-height:18px;text-align:left;cursor:pointer}"
            + ".SKV_paneNew:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}"
            + ".SKV_paneNewForm{flex:none;display:flex;align-items:center;gap:8px;margin:8px 12px 16px;padding:6px 8px;border:1px solid var(--dsw-alias-state-business-primary);border-radius:8px;background:var(--dsw-alias-bg-layer-3)}"
            + ".SKV_paneNewInput{flex:1;min-width:0;height:26px;border:0;outline:0;background:0 0;color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;line-height:18px}"
            + ".SKV_paneNewInput::placeholder{color:var(--dsw-alias-label-tertiary)}"
            + ".SKV_mainCol{position:relative;flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden}"
            + ".SKV_mainScroll{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding:22px clamp(20px,3vw,40px) 96px;display:flex;flex-direction:column;align-items:center;scrollbar-width:thin}"
            + ".SKV_mainScroll>.SKV_catalog{width:100%;max-width:780px}"
            + ".SKV_toolRow{display:flex;align-items:center;justify-content:space-between;gap:12px}"
            + ".SKV_toolRow h3{margin:0;font-size:15px;font-weight:600;line-height:22px}"
            + ".SKV_toolRow h3 span{margin-left:6px;color:var(--dsw-alias-label-tertiary);font-weight:400;font-variant-numeric:tabular-nums}"
            + ".SKV_toolButtons{flex:none;display:flex;align-items:center;gap:8px}"
            + ".SKV_toolButton{position:relative;box-sizing:border-box;width:36px;height:32px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:8px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;transition:background-color .18s cubic-bezier(.3,.8,.2,1),color .18s cubic-bezier(.3,.8,.2,1)}"
            + ".SKV_toolButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid);color:var(--dsw-alias-label-primary)}"
            + ".SKV_toolButton[data-active=true]{color:var(--dsw-alias-state-business-primary)}"
            + ".SKV_toolButton:disabled{cursor:default;opacity:.5}"
            + ".SKV_toolButton:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}"
            + ".SKV_toolButton:hover:not(:disabled)::after{content:attr(aria-label);position:absolute;top:calc(100% + 6px);right:0;z-index:40;white-space:nowrap;background:var(--dsw-alias-tooltip-bg);color:var(--dsw-alias-toast-label);font-size:12px;line-height:18px;padding:3px 8px;border-radius:6px;box-shadow:var(--dsw-shadow-lv1);pointer-events:none}"
            // 简洁模式的工作区下拉：自带定位，不依赖宿主 Menu 的 portal/锚点测量
            + ".SKV_scopeMenuWrap{position:relative;display:inline-flex}"
            + ".SKV_scopeMenuOverlay{position:fixed;inset:0;z-index:29}"
            + ".SKV_scopeMenu{position:absolute;left:0;top:calc(100% + 6px);z-index:30;box-sizing:border-box;min-width:220px;max-width:min(360px,calc(100vw - 48px));max-height:min(448px,calc(100vh - 32px));overflow-y:auto;scrollbar-width:thin;display:flex;flex-direction:column;gap:2px;padding:6px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-3);box-shadow:var(--dsw-shadow-lv2)}"
            + ".SKV_scopeMenuItem{display:flex;align-items:center;gap:8px;width:100%;min-height:34px;padding:0 10px;border:0;border-radius:8px;background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer;white-space:nowrap}"
            + ".SKV_scopeMenuItem:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}"
            + ".SKV_scopeMenuItem[data-active=true]{color:var(--dsw-alias-label-primary);background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent)}"
            + ".SKV_scopeMenuItemLabel{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}"
            + ".SKV_scopeMenuItemCount{flex:none;font-size:11.5px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}"
            + ".SKV_scopeMenuItemCheck{flex:none;color:var(--dsw-alias-state-business-primary)}"
            + ".SKV_filterBar{display:flex;flex-direction:column;gap:2px;margin:2px 0 10px}"
            // 简洁模式：内容区放宽一点，卡片恢复成一行两个（旧版就是这么排的，Issue #50）
            + ".SKV_section[data-layout=compact] .SKV_mainScroll>.SKV_catalog{max-width:940px}"
            + ".SKV_section[data-layout=compact] .SKV_cards{grid-template-columns:repeat(2,minmax(0,1fr));align-items:start}"
            + "@media (max-width:900px){.SKV_section[data-layout=compact] .SKV_cards{grid-template-columns:minmax(0,1fr)}}"
            + "@media (max-width:820px){.SKV_rail{width:140px}.SKV_pane{width:150px}.SKV_mainScroll{padding:20px 20px 96px}}";
        // 卡片行（v2.1.6 重构）：[勾选框][图标][名称 + 描述][红绿灯 + 删除]。
        // 勾选框用原生 input（accent-color 跟随宿主主题），批量模式之外宽度收缩到 0。
        const cssRow = ".SKV_cards{grid-template-columns:minmax(0,1fr)}"
            + ".SKV_cardRow{display:flex;align-items:center;padding:10px 12px;transition:background-color .18s cubic-bezier(.3,.8,.2,1)}"
            + ".SKV_card[data-selected=true]{border-color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent)}"
            + ".SKV_card[data-removing=true]{pointer-events:none;opacity:0;transform:translateX(14px)}"
            + ".SKV_check{display:flex;align-items:center;flex:none;width:0;margin-right:0;overflow:hidden;transition:width .22s cubic-bezier(.3,.8,.2,1),margin .22s cubic-bezier(.3,.8,.2,1)}"
            + ".SKV_section[data-batch=true] .SKV_check{width:18px;margin-right:12px}"
            + ".SKV_checkBox{box-sizing:border-box;width:18px;height:18px;flex:none;margin:0;cursor:pointer;accent-color:var(--dsw-alias-state-business-primary)}"
            + ".SKV_rowIcon{flex:none;display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;margin-right:14px;border-radius:8px;background:color-mix(in srgb, var(--dsw-alias-label-primary) 5%, transparent);color:var(--dsw-alias-label-tertiary)}"
            + ".SKV_rowText{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;padding:2px 0;border:0;border-radius:6px;background:0 0;color:inherit;font:inherit;text-align:left;cursor:pointer}"
            + ".SKV_rowText:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}"
            + ".SKV_rowName{font-size:14px;font-weight:600;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;transition:color .2s ease}"
            + ".SKV_rowName[data-disabled=true]{color:var(--dsw-alias-label-tertiary)}"
            + ".SKV_rowDesc{color:var(--dsw-alias-label-tertiary);font-size:12.5px;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}"
            + ".SKV_rowControls{flex:none;display:flex;align-items:center;gap:8px;margin-left:14px}"
            + ".SKV_traffic{display:inline-flex;align-items:center;gap:6px;padding:9px 11px;border:0;border-radius:999px;background:color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent);cursor:pointer;transition:background-color .18s cubic-bezier(.3,.8,.2,1)}"
            + ".SKV_traffic:hover:not(:disabled){background:color-mix(in srgb, var(--dsw-alias-label-primary) 12%, transparent)}"
            + ".SKV_traffic:disabled{cursor:default;opacity:.55}"
            + ".SKV_traffic:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}"
            + ".SKV_trafficDot{display:block;width:9px;height:9px;border-radius:50%;transition:opacity .25s cubic-bezier(.3,.8,.2,1),box-shadow .25s cubic-bezier(.3,.8,.2,1)}"
            + ".SKV_trafficRed{background:var(--dsw-alias-state-error-primary);opacity:.25}"
            + ".SKV_trafficGreen{background:var(--dsw-alias-state-success-primary);opacity:.25}"
            + ".SKV_traffic[data-on=true] .SKV_trafficGreen{opacity:1;box-shadow:0 0 9px var(--dsw-alias-state-success-primary)}"
            + ".SKV_traffic[data-on=false] .SKV_trafficRed{opacity:1;box-shadow:0 0 9px var(--dsw-alias-state-error-primary)}"
            + ".SKV_rowDelete{box-sizing:border-box;width:32px;height:27px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:999px;background:color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent);color:var(--dsw-alias-label-tertiary);cursor:pointer;transition:background-color .18s cubic-bezier(.3,.8,.2,1),color .18s cubic-bezier(.3,.8,.2,1)}"
            + ".SKV_rowDelete:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}"
            + ".SKV_rowDelete:disabled{cursor:default;opacity:.5}"
            + ".SKV_rowDelete:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}"
            + ".SKV_empty{margin:0;padding:56px 0;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}"
            + ".SKV_batchBar{position:absolute;left:50%;bottom:22px;z-index:20;display:flex;align-items:center;gap:14px;padding:10px 12px 10px 18px;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-3);box-shadow:var(--dsw-shadow-lv2);white-space:nowrap;opacity:0;transform:translate(-50%,24px);pointer-events:none;transition:opacity .26s cubic-bezier(.3,.8,.2,1),transform .26s cubic-bezier(.3,.8,.2,1)}"
            + ".SKV_section[data-batch=true] .SKV_batchBar{opacity:1;transform:translate(-50%,0);pointer-events:auto}"
            + ".SKV_batchCount{font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}"
            + ".SKV_batchBtn{font:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);background:0 0;border:0;border-radius:9px;padding:7px 14px;cursor:pointer;transition:background-color .18s cubic-bezier(.3,.8,.2,1),color .18s cubic-bezier(.3,.8,.2,1)}"
            + ".SKV_batchBtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}"
            + ".SKV_batchGo{background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-on-primary, #fff)}"
            + ".SKV_batchGo:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover);color:var(--dsw-alias-state-business-on-primary, #fff)}"
            + ".SKV_batchGo:disabled{cursor:default;opacity:.4}"
            + ".SKV_toast{position:absolute;left:50%;top:20px;z-index:30;display:flex;align-items:center;gap:14px;max-width:min(680px,90%);padding:9px 16px;border-radius:10px;background:var(--dsw-alias-toast-bg);color:var(--dsw-alias-toast-label);box-shadow:var(--dsw-shadow-lv2);opacity:0;transform:translate(-50%,-12px);pointer-events:none;transition:opacity .24s cubic-bezier(.3,.8,.2,1),transform .24s cubic-bezier(.3,.8,.2,1)}"
            + ".SKV_toast[data-show=true]{opacity:1;transform:translate(-50%,0);pointer-events:auto}"
            + ".SKV_toastText{font-size:13px;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}"
            + ".SKV_toastAction{flex:none;font:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-toast-label);background:color-mix(in srgb, var(--dsw-alias-toast-label) 14%, transparent);border:0;border-radius:6px;padding:3px 10px;cursor:pointer;transition:background-color .18s cubic-bezier(.3,.8,.2,1)}"
            + ".SKV_toastAction:hover{background:color-mix(in srgb, var(--dsw-alias-toast-label) 24%, transparent)}"
            + ".SKV_toastAction:focus-visible{outline:2px solid var(--dsw-alias-toast-label);outline-offset:1px}";
        ;
        const css = cssPage + cssChrome + cssCards + cssAdd + cssScope + cssMigrate + cssCategory + cssTree + cssPanelIcon + cssTheme + cssEffects + cssChipRefresh + cssGroups + cssShell + cssRow;
        const tagId = "dsh-skill-mcp-panel/SkillsSection.module.css";
        if (typeof document !== "undefined") {
            let tag = document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]");
            if (tag === null) {
                tag = document.createElement("style");
                tag.dataset.plugin = "dsh-skill-mcp-panel";
                tag.dataset.pluginCss = tagId;
                document.head.appendChild(tag);
            }
            // 始终用当前版本的样式覆盖，避免残留旧样式标签
            tag.textContent = css;
        }
        // 类名映射（CSS 是内联手写字符串，无法走 CSS Modules）
        const c = {
            tab: "SKV_tab",
            tabs: "SKV_tabs",
            pluginToggle: "SKV_pluginToggle",
            page: "SKV_page",
            pageHead: "SKV_pageHead",
            pageTitle: "SKV_pageTitle",
            pageIntro: "SKV_pageIntro",
            pageTop: "SKV_pageTop",
            pageBack: "SKV_pageBack",
            section: "SKV_section",
            status: "SKV_status",
            failure: "SKV_failure",
            catalog: "SKV_catalog",
            searchBox: "SKV_searchBox",
            searchIcon: "SKV_searchIcon",
            searchField: "SKV_searchField",
            catalogHeading: "SKV_catalogHeading",
            cards: "SKV_cards",
            card: "SKV_card",
            cardContent: "SKV_cardContent",
            cardLeading: "SKV_cardLeading",
            cardTitle: "SKV_cardTitle",
            cardTrailing: "SKV_cardTrailing",
            statusDot: "SKV_statusDot",
            configTag: "SKV_configTag",
            chevron: "SKV_chevron",
            cardDetails: "SKV_cardDetails",
            meta: "SKV_meta",
            metaProvider: "SKV_metaProvider",
            contentBox: "SKV_contentBox",
            content: "SKV_content",
            failureText: "SKV_failureText",
            cardActions: "SKV_cardActions",
            switchRow: "SKV_switchRow",
            switch: "SKV_switch",
            switchThumb: "SKV_switchThumb",
            switchText: "SKV_switchText",
            opError: "SKV_opError",
            deleteButton: "SKV_deleteButton",
            addActions: "SKV_addActions",
            iconButton: "SKV_iconButton",
            addStatus: "SKV_addStatus",
            addTarget: "SKV_addTarget",
            dropHint: "SKV_dropHint",
            notice: "SKV_notice",
            noticeText: "SKV_noticeText",
            noticeButton: "SKV_noticeButton",
            fileInput: "SKV_fileInput",
            addMenuWrap: "SKV_addMenuWrap",
            addMenu: "SKV_addMenu",
            addMenuTitle: "SKV_addMenuTitle",
            addMenuButton: "SKV_addMenuButton",
            scopeOverlay: "SKV_scopeOverlay",
            scopeBox: "SKV_scopeBox",
            scopeOptions: "SKV_scopeOptions",
            scopeOption: "SKV_scopeOption",
            wsPath: "SKV_wsPath",
            scopeActions: "SKV_scopeActions",
            scopeAction: "SKV_scopeAction",
            scopeCancel: "SKV_scopeCancel",
            scopeConfirm: "SKV_scopeConfirm",
            scopeBar: "SKV_scopeBar",
            scopeSelect: "SKV_scopeSelect",
            scopeSelectLabel: "SKV_scopeSelectLabel",
            scopeSelectChevron: "SKV_scopeSelectChevron",
            scopeMenuWrap: "SKV_scopeMenuWrap",
            scopeMenuOverlay: "SKV_scopeMenuOverlay",
            scopeMenu: "SKV_scopeMenu",
            scopeMenuItem: "SKV_scopeMenuItem",
            scopeMenuItemLabel: "SKV_scopeMenuItemLabel",
            scopeMenuItemCount: "SKV_scopeMenuItemCount",
            scopeMenuItemCheck: "SKV_scopeMenuItemCheck",
            groupBar: "SKV_groupBar",
            groupItem: "SKV_groupItem",
            groupItemCount: "SKV_groupItemCount",
            groupBulkRow: "SKV_groupBulkRow",
            groupBulkBtn: "SKV_groupBulkBtn",
            groupDelete: "SKV_groupDelete",
            groupSep: "SKV_groupSep",
            treeFolder: "SKV_treeFolder",
            treeFolderHeader: "SKV_treeFolderHeader",
            treeFolderName: "SKV_treeFolderName",
            treeFolderCount: "SKV_treeFolderCount",
            treeChevron: "SKV_treeChevron",
            treeChevronOpen: "SKV_treeChevronOpen",
            categoryBar: "SKV_categoryBar",
            categoryLabel: "SKV_categoryLabel",
            categoryChip: "SKV_categoryChip",
            select: "SKV_select",
            groupBody: "SKV_groupBody",
            groupSide: "SKV_groupSide",
            groupNewBtn: "SKV_groupNewBtn",
            groupSideLabel: "SKV_groupSideLabel",
            groupSideItem: "SKV_groupSideItem",
            groupSideItemWrap: "SKV_groupSideItemWrap",
            groupMain: "SKV_groupMain",
            field: "SKV_field",
            fieldLabel: "SKV_fieldLabel",
            skillListBox: "SKV_skillListBox",
            skillRow: "SKV_skillRow",
            skillName: "SKV_skillName",
            skillBadge: "SKV_skillBadge",
            countRow: "SKV_countRow",
            countText: "SKV_countText",
            dialogFooter: "SKV_dialogFooter",
            dangerBtn: "SKV_dangerBtn",
            textInput: "SKV_textInput",
            targetBox: "SKV_targetBox",
            targetItem: "SKV_targetItem",
            migrateSection: "SKV_migrateSection",
            migrateLabel: "SKV_migrateLabel",
            migrateFromValue: "SKV_migrateFromValue",
            migrateList: "SKV_migrateList",
            migrateItem: "SKV_migrateItem",
            migrateItemName: "SKV_migrateItemName",
            migrateItemState: "SKV_migrateItemState",
            migrateSelectAll: "SKV_migrateSelectAll",
            migrateHint: "SKV_migrateHint",
            migrateResult: "SKV_migrateResult",
            migrateResultList: "SKV_migrateResultList",
            migrateOptionLabel: "SKV_migrateOptionLabel",
            // v2.1.6 三栏外壳
            rail: "SKV_rail",
            railHead: "SKV_railHead",
            railList: "SKV_railList",
            railItem: "SKV_railItem",
            railItemName: "SKV_railItemName",
            railItemCount: "SKV_railItemCount",
            railBar: "SKV_railBar",
            pane: "SKV_pane",
            paneHead: "SKV_paneHead",
            paneTitle: "SKV_paneTitle",
            paneModes: "SKV_paneModes",
            paneMode: "SKV_paneMode",
            paneList: "SKV_paneList",
            paneItem: "SKV_paneItem",
            paneItemName: "SKV_paneItemName",
            paneItemCount: "SKV_paneItemCount",
            paneNew: "SKV_paneNew",
            paneNewForm: "SKV_paneNewForm",
            paneNewInput: "SKV_paneNewInput",
            mainCol: "SKV_mainCol",
            mainScroll: "SKV_mainScroll",
            toolRow: "SKV_toolRow",
            toolButtons: "SKV_toolButtons",
            toolButton: "SKV_toolButton",
            filterBar: "SKV_filterBar",
            // v2.1.6 卡片行
            cardRow: "SKV_cardRow",
            check: "SKV_check",
            checkBox: "SKV_checkBox",
            rowIcon: "SKV_rowIcon",
            rowText: "SKV_rowText",
            rowName: "SKV_rowName",
            rowDesc: "SKV_rowDesc",
            rowControls: "SKV_rowControls",
            traffic: "SKV_traffic",
            trafficDot: "SKV_trafficDot",
            trafficRed: "SKV_trafficRed",
            trafficGreen: "SKV_trafficGreen",
            rowDelete: "SKV_rowDelete",
            empty: "SKV_empty",
            batchBar: "SKV_batchBar",
            batchCount: "SKV_batchCount",
            batchBtn: "SKV_batchBtn",
            batchGo: "SKV_batchGo",
            toast: "SKV_toast",
            toastText: "SKV_toastText",
            toastAction: "SKV_toastAction",
        };
        // ── 文案字典 ─────────────────────────────────────────────────────────
        const NS = "settings.skills";
        const zh = {
            nav: "技能",
            navCombined: "Skill / MCP",
            panelIntro: "管理全局与工作区里的技能：搜索、展开正文、启用/停用、删除、添加、迁移与分组。",
            back: "返回会话",
            loading: "正在读取技能…",
            error: "暂时无法读取技能。",
            retry: "重试",
            search: "搜索技能",
            catalog: "技能列表",
            empty: "暂无技能。",
            emptySearch: "没有匹配的技能。",
            contentLoading: "正在加载技能内容…",
            contentError: "技能内容加载失败。",
            contentMissing: "技能内容不可用。",
            providerLabel: "来源",
            enabledTag: "已启用",
            disabledTag: "已停用",
            switchEnable: "启用",
            switchDisable: "停用",
            deleteLabel: "删除",
            confirmDelete: "确认删除？",
            opFailed: "操作失败",
            addButton: "添加技能",
            addTarget: "添加到：",
            addSingle: "添加单文件",
            addFolderZip: "添加文件夹/zip",
            addDragHint: "松开以添加技能（支持 .md、.zip 与技能文件夹）",
            addDismiss: "知道了",
            addBusy: "正在添加技能…",
            addTooMany: "所选内容文件数量过多。",
            addDone: "已添加 {count} 个技能。",
            addSkipped: "跳过 {count} 个：",
            addWarned: "提示 {count} 条：",
            scopeGlobal: "全局",
            emptyScope: "该工作区下暂无技能。",
            migrateButton: "批量迁移",
            migrateTitle: "批量迁移技能",
            migrateFrom: "源工作区",
            migrateTo: "目标工作区（可多选）",
            migrateMode: "方式",
            migrateModeCopy: "复制（保留原技能）",
            migrateModeMove: "移动（删除原技能）",
            migrateSelectAll: "全选",
            migrateNoSkills: "该工作区下没有可迁移的技能。",
            migratePickSource: "请选择源工作区",
            migratePickTarget: "请至少选择一个目标工作区",
            migrateSameScope: "目标工作区不能与源工作区相同",
            migrateMoveSingle: "移动模式只能选择一个目标工作区（多目标请改用复制）",
            migratePickSkills: "请至少选择一个技能",
            migrateConfirm: "开始迁移",
            migrateBusy: "正在迁移…",
            migrateCancel: "取消",
            migrateDoneOk: "迁移完成：成功 ",
            migrateDoneFail: "，失败 ",
            migrateDoneSuffix: "",
            migrateErrors: "失败明细",
            migrateSourceLabel: "源作用域",
            migrateTargetLabel: "目标作用域",
            migrateClose: "关闭",
            groupAll: "全部",
            groupButton: "分组",
            groupTitle: "分组",
            groupNew: "新建分组",
            groupName: "分组名称",
            groupNamePlaceholder: "输入分组名称（必填）",
            groupPickName: "请填写分组名称",
            groupScope: "工作区",
            groupPickScope: "请选择工作区",
            groupSkills: "技能",
            groupNoSkills: "该工作区下没有可选择的技能。",
            groupEmpty: "该分组下暂无技能。",
            groupSave: "保存分组",
            groupSaving: "正在保存…",
            groupDelete: "删除分组",
            groupBulkOn: "全部启用",
            groupBulkOff: "全部停用",
            pluginSkillsToggle: "显示插件技能",
            pluginSkillsToggleHint: "部分插件会随包自带技能（不在技能文件夹里，面板改不动）；取消勾选后只看自己管理的技能",
            pluginSkillsHidden: "插件自带的 {count} 个技能已隐藏。",
            groupBulkBlocked: "组内没有可开关的技能",
            skillFilterPlaceholder: "筛选技能",
            skillCountLabel: "已选",
            selectNone: "取消全选",
            categoryQuickAdd: "按分类快速添加",
            categoryQuickAddHint: "点击按顶层目录批量勾选/取消",
            checkUpdateAvailable: "发现新版本 v",
            checkUpdateCurrent: "（当前 v",
            checkUpdateHint: "）。可在终端运行 dsh-panel update 更新",
            // ── v2.1.6 三栏外壳 / 卡片行 / 批量栏 / 偏好 ──────────────────
            railWorkspaces: "工作区",
            paneGroups: "分组",
            paneSources: "来源",
            paneUngrouped: "未分组",
            panePluginProvided: "插件自带",
            paneProviderUnknown: "未知来源",
            emptyProvider: "该来源下暂无技能。",
            // 布局开关：简洁模式 = 收起左右两栏，把工作区与分组做成列表上方的筛选条（Issue #50）
            layoutToCompact: "切换到简洁模式",
            layoutToThree: "切回三栏模式",
            emptyList: "这里还没有技能，点右上角的“添加”开始",
            toolbarOpenFolder: "打开目录",
            toolbarNewGroup: "新建分组",
            openFolderRevealed: "已在资源管理器里打开：{path}",
            openFolderCopied: "技能根路径已复制到剪贴板：{path}",
            openFolderManual: "剪贴板不可用，请手动复制技能根路径：{path}",
            openFolderUnavailable: "暂时拿不到技能根路径（该作用域还没有可读取的技能文件）。",
            batchSelect: "选择",
            batchSelected: "已选 {count} 项",
            batchMigrateTo: "迁移到…",
            batchAdvanced: "更多选项（复制 / 多目标）…",
            batchMigrated: "已迁移 {count} 项到 {target}",
            toastDeleted: "已删除 {name}",
            toastUndo: "撤销",
            toastUndoDone: "已还原 {name}",
            toastUndoFailed: "还原失败，请重新添加该技能。",
        };
        const en = {
            nav: "Skills",
            navCombined: "Skill / MCP",
            panelIntro: "Manage global and workspace skills: search, read content, enable or disable, delete, add, migrate, and group.",
            back: "Back to session",
            loading: "Reading skills…",
            error: "Skills are temporarily unavailable.",
            retry: "Retry",
            search: "Search skills",
            catalog: "Skills",
            empty: "No skills are available.",
            emptySearch: "No matching skills.",
            contentLoading: "Loading skill content…",
            contentError: "Skill content failed to load.",
            contentMissing: "Skill content is unavailable.",
            providerLabel: "Provider",
            enabledTag: "Enabled",
            disabledTag: "Disabled",
            switchEnable: "Enable",
            switchDisable: "Disable",
            deleteLabel: "Delete",
            confirmDelete: "Confirm delete?",
            opFailed: "Operation failed",
            addButton: "Add skill",
            addTarget: "Add to: ",
            addSingle: "Add files",
            addFolderZip: "Add folder/ZIP",
            addDragHint: "Drop to add skills (.md, .zip or skill folders)",
            addDismiss: "Dismiss",
            addBusy: "Adding skills…",
            addTooMany: "Too many files in the selection.",
            addDone: "Added {count} skill(s).",
            addSkipped: "Skipped {count}:",
            addWarned: "{count} notice(s):",
            scopeGlobal: "Global",
            emptyScope: "No skills in this workspace yet.",
            migrateButton: "Batch migrate",
            migrateTitle: "Batch migrate skills",
            migrateFrom: "From workspace",
            migrateTo: "To workspaces (multiple allowed)",
            migrateMode: "Mode",
            migrateModeCopy: "Copy (keep the original)",
            migrateModeMove: "Move (delete the original)",
            migrateSelectAll: "Select all",
            migrateNoSkills: "No skills to migrate in this workspace.",
            migratePickSource: "Pick a source workspace",
            migratePickTarget: "Pick at least one target workspace",
            migrateSameScope: "A target workspace must differ from the source",
            migrateMoveSingle: "Move mode allows exactly one target workspace (use Copy for several)",
            migratePickSkills: "Pick at least one skill",
            migrateConfirm: "Start migration",
            migrateBusy: "Migrating…",
            migrateCancel: "Cancel",
            migrateDoneOk: "Migration finished: ",
            migrateDoneFail: " succeeded, ",
            migrateDoneSuffix: " failed",
            migrateErrors: "Failed items",
            migrateSourceLabel: "From",
            migrateTargetLabel: "To",
            migrateClose: "Close",
            groupAll: "All",
            groupButton: "Groups",
            groupTitle: "Groups",
            groupNew: "New group",
            groupName: "Group name",
            groupNamePlaceholder: "Group name (required)",
            groupPickName: "Pick a group name",
            groupScope: "Workspace",
            groupPickScope: "Pick a workspace",
            groupSkills: "Skills",
            groupNoSkills: "No skills to pick in this workspace.",
            groupEmpty: "No skills in this group.",
            groupSave: "Save group",
            groupSaving: "Saving…",
            groupDelete: "Delete group",
            groupBulkOn: "Enable all",
            groupBulkOff: "Disable all",
            pluginSkillsToggle: "Show plugin skills",
            pluginSkillsToggleHint: "Some plugins ship their own skills; uncheck to see only the ones you manage",
            pluginSkillsHidden: "{count} plugin-provided skill(s) hidden.",
            groupBulkBlocked: "No toggleable skills in this group",
            skillFilterPlaceholder: "Filter skills",
            skillCountLabel: "Selected",
            categoryQuickAdd: "Quick add by category",
            categoryQuickAddHint: "Click to select/deselect all skills in a category",
            selectNone: "Select none",
            checkUpdateAvailable: "Update available: v",
            checkUpdateCurrent: " (current v",
            checkUpdateHint: "). Run dsh-panel update in a terminal to install it",
            // ── v2.1.6 three-column shell / card row / batch bar / preferences ──
            railWorkspaces: "Workspaces",
            paneGroups: "Groups",
            paneSources: "Sources",
            paneUngrouped: "Ungrouped",
            panePluginProvided: "Plugin-provided",
            paneProviderUnknown: "Unknown source",
            emptyProvider: "No skills from this source yet.",
            layoutToCompact: "Switch to the compact layout",
            layoutToThree: "Switch back to the three-column layout",
            emptyList: "No skills yet — start with “Add” in the top-right corner.",
            toolbarOpenFolder: "Open folder",
            toolbarNewGroup: "New group",
            openFolderRevealed: "Opened in the file manager: {path}",
            openFolderCopied: "Skill root copied to the clipboard: {path}",
            openFolderManual: "Clipboard unavailable — copy the skill root manually: {path}",
            openFolderUnavailable: "The skill root is unavailable right now (no readable skill file in this scope).",
            batchSelect: "Select",
            batchSelected: "{count} selected",
            batchMigrateTo: "Migrate to…",
            batchAdvanced: "More options (copy / multiple targets)…",
            batchMigrated: "Moved {count} item(s) to {target}",
            toastDeleted: "Deleted {name}",
            toastUndo: "Undo",
            toastUndoDone: "Restored {name}",
            toastUndoFailed: "Restore failed — please add the skill again.",
        };
        // ── 远程贡献 ─────────────────────────────────────────────────────────
        // 客户端 codec：schema 用 parse 直通即可（严格校验由服务端 manifest 承担，
        // 无需引入 zod 依赖）。0.2.x 宿主只读 create().parse()；0.1.x 时代的 schema
        // 字段是历史包袱，已删。本文件是浏览器束（不能 import），故与 src/codec.ts 的
        // strictCodec 保持同形：mode + typeSymbol + create。
        const identity = (value) => value;
        const strictSchema = { parse: identity };
        const codec = (symbol) => ({ mode: "strict", typeSymbol: symbol, create: () => strictSchema });
        const CONTRIBUTION = {
            package: "dsh-skill-mcp-panel",
            descriptors: [
                {
                    id: "dsh-skill-mcp-panel#skillsViewer/list",
                    service: "skillsViewer",
                    namespace: "skillsViewer",
                    method: "list",
                    invocation: { kind: "direct" },
                    parameters: [
                        { name: "sessionId", wire: "sessionId", source: "json", acceptsUndefined: true, codec: codec("dsh-skill-mcp-panel#sessionId") }
                    ],
                    result: codec("dsh-skill-mcp-panel#SkillListResult")
                },
                {
                    id: "dsh-skill-mcp-panel#skillsViewer/workspaces",
                    service: "skillsViewer",
                    namespace: "skillsViewer",
                    method: "workspaces",
                    invocation: { kind: "direct" },
                    parameters: [],
                    result: codec("dsh-skill-mcp-panel#WorkspacesResult")
                },
                {
                    id: "dsh-skill-mcp-panel#skillsViewer/openFolder",
                    service: "skillsViewer",
                    namespace: "skillsViewer",
                    method: "openFolder",
                    invocation: { kind: "direct" },
                    parameters: [
                        { name: "path", wire: "path", source: "json", codec: codec("dsh-skill-mcp-panel#FilePath") }
                    ],
                    result: codec("dsh-skill-mcp-panel#OpenFolderResult")
                },
                {
                    id: "dsh-skill-mcp-panel#skillsViewer/groups",
                    service: "skillsViewer",
                    namespace: "skillsViewer",
                    method: "groups",
                    invocation: { kind: "direct" },
                    parameters: [],
                    result: codec("dsh-skill-mcp-panel#GroupsResult")
                },
                {
                    id: "dsh-skill-mcp-panel#skillsViewer/saveGroup",
                    service: "skillsViewer",
                    namespace: "skillsViewer",
                    method: "saveGroup",
                    invocation: { kind: "direct" },
                    parameters: [
                        { name: "payload", wire: "payload", source: "json", codec: codec("dsh-skill-mcp-panel#SaveGroupPayload") }
                    ],
                    result: codec("dsh-skill-mcp-panel#GroupsResult")
                },
                {
                    id: "dsh-skill-mcp-panel#skillsViewer/deleteGroup",
                    service: "skillsViewer",
                    namespace: "skillsViewer",
                    method: "deleteGroup",
                    invocation: { kind: "direct" },
                    parameters: [
                        { name: "payload", wire: "payload", source: "json", codec: codec("dsh-skill-mcp-panel#DeleteGroupPayload") }
                    ],
                    result: codec("dsh-skill-mcp-panel#GroupsResult")
                },
                {
                    id: "dsh-skill-mcp-panel#skillsViewer/checkUpdate",
                    service: "skillsViewer",
                    namespace: "skillsViewer",
                    method: "checkUpdate",
                    invocation: { kind: "direct" },
                    parameters: [],
                    result: codec("dsh-skill-mcp-panel#CheckUpdateResult")
                },
                {
                    id: "dsh-skill-mcp-panel#skillsViewer/migrate",
                    service: "skillsViewer",
                    namespace: "skillsViewer",
                    method: "migrate",
                    invocation: { kind: "direct" },
                    parameters: [
                        { name: "name", wire: "name", source: "json", codec: codec("dsh-skill-mcp-panel#SkillName") },
                        { name: "sessionId", wire: "sessionId", source: "json", acceptsUndefined: true, codec: codec("dsh-skill-mcp-panel#sessionId") },
                        { name: "payload", wire: "payload", source: "json", codec: codec("dsh-skill-mcp-panel#MigratePayload") }
                    ],
                    result: codec("dsh-skill-mcp-panel#MigrateResult")
                },
                {
                    id: "dsh-skill-mcp-panel#skillsViewer/batchMigrate",
                    service: "skillsViewer",
                    namespace: "skillsViewer",
                    method: "batchMigrate",
                    invocation: { kind: "direct" },
                    parameters: [
                        { name: "sessionId", wire: "sessionId", source: "json", acceptsUndefined: true, codec: codec("dsh-skill-mcp-panel#sessionId") },
                        { name: "payload", wire: "payload", source: "json", codec: codec("dsh-skill-mcp-panel#BatchMigratePayload") }
                    ],
                    result: codec("dsh-skill-mcp-panel#BatchMigrateResult")
                },
                {
                    id: "dsh-skill-mcp-panel#skillsViewer/content",
                    service: "skillsViewer",
                    namespace: "skillsViewer",
                    method: "content",
                    invocation: { kind: "direct" },
                    parameters: [
                        { name: "name", wire: "name", source: "json", codec: codec("dsh-skill-mcp-panel#SkillName") },
                        { name: "sessionId", wire: "sessionId", source: "json", acceptsUndefined: true, codec: codec("dsh-skill-mcp-panel#sessionId") },
                        { name: "scope", wire: "scope", source: "json", acceptsUndefined: true, codec: codec("dsh-skill-mcp-panel#SkillScope") }
                    ],
                    result: codec("dsh-skill-mcp-panel#SkillContent")
                },
                {
                    id: "dsh-skill-mcp-panel#skillsViewer/setEnabled",
                    service: "skillsViewer",
                    namespace: "skillsViewer",
                    method: "setEnabled",
                    invocation: { kind: "direct" },
                    parameters: [
                        { name: "name", wire: "name", source: "json", codec: codec("dsh-skill-mcp-panel#SkillName") },
                        { name: "sessionId", wire: "sessionId", source: "json", acceptsUndefined: true, codec: codec("dsh-skill-mcp-panel#sessionId") },
                        { name: "enabled", wire: "enabled", source: "json", codec: codec("dsh-skill-mcp-panel#EnabledFlag") },
                        { name: "scope", wire: "scope", source: "json", acceptsUndefined: true, codec: codec("dsh-skill-mcp-panel#SkillScope") }
                    ],
                    result: codec("dsh-skill-mcp-panel#SetEnabledResult")
                },
                {
                    id: "dsh-skill-mcp-panel#skillsViewer/deleteSkill",
                    service: "skillsViewer",
                    namespace: "skillsViewer",
                    method: "deleteSkill",
                    invocation: { kind: "direct" },
                    parameters: [
                        { name: "name", wire: "name", source: "json", codec: codec("dsh-skill-mcp-panel#SkillName") },
                        { name: "sessionId", wire: "sessionId", source: "json", acceptsUndefined: true, codec: codec("dsh-skill-mcp-panel#sessionId") },
                        { name: "scope", wire: "scope", source: "json", acceptsUndefined: true, codec: codec("dsh-skill-mcp-panel#SkillScope") }
                    ],
                    result: codec("dsh-skill-mcp-panel#DeleteSkillResult")
                },
                {
                    id: "dsh-skill-mcp-panel#skillsViewer/addSkill",
                    service: "skillsViewer",
                    namespace: "skillsViewer",
                    method: "addSkill",
                    invocation: { kind: "direct" },
                    parameters: [
                        { name: "sessionId", wire: "sessionId", source: "json", acceptsUndefined: true, codec: codec("dsh-skill-mcp-panel#sessionId") },
                        { name: "payload", wire: "payload", source: "json", codec: codec("dsh-skill-mcp-panel#AddPayload") }
                    ],
                    result: codec("dsh-skill-mcp-panel#AddResult")
                },
                {
                    id: "dsh-skill-mcp-panel#mcpManager/list",
                    service: "mcpManager",
                    namespace: "mcpManager",
                    method: "list",
                    invocation: { kind: "direct" },
                    parameters: [],
                    result: codec("dsh-skill-mcp-panel#McpListResult")
                },
                {
                    id: "dsh-skill-mcp-panel#mcpManager/save",
                    service: "mcpManager",
                    namespace: "mcpManager",
                    method: "save",
                    invocation: { kind: "direct" },
                    parameters: [
                        { name: "payload", wire: "payload", source: "json", codec: codec("dsh-skill-mcp-panel#McpSavePayload") }
                    ],
                    result: codec("dsh-skill-mcp-panel#McpSaveResult")
                },
                {
                    id: "dsh-skill-mcp-panel#mcpManager/removeServer",
                    service: "mcpManager",
                    namespace: "mcpManager",
                    method: "removeServer",
                    invocation: { kind: "direct" },
                    parameters: [
                        { name: "payload", wire: "payload", source: "json", codec: codec("dsh-skill-mcp-panel#McpRemovePayload") }
                    ],
                    result: codec("dsh-skill-mcp-panel#McpRemoveResult")
                },
                {
                    id: "dsh-skill-mcp-panel#mcpManager/setEnabled",
                    service: "mcpManager",
                    namespace: "mcpManager",
                    method: "setEnabled",
                    invocation: { kind: "direct" },
                    parameters: [
                        { name: "payload", wire: "payload", source: "json", codec: codec("dsh-skill-mcp-panel#McpSetEnabledPayload") }
                    ],
                    result: codec("dsh-skill-mcp-panel#McpSaveResult")
                },
                {
                    id: "dsh-skill-mcp-panel#mcpManager/test",
                    service: "mcpManager",
                    namespace: "mcpManager",
                    method: "test",
                    invocation: { kind: "direct" },
                    parameters: [
                        { name: "payload", wire: "payload", source: "json", codec: codec("dsh-skill-mcp-panel#McpTestPayload") }
                    ],
                    result: codec("dsh-skill-mcp-panel#McpTestResult")
                },
                {
                    id: "dsh-skill-mcp-panel#mcpManager/reload",
                    service: "mcpManager",
                    namespace: "mcpManager",
                    method: "reload",
                    invocation: { kind: "direct" },
                    parameters: [],
                    result: codec("dsh-skill-mcp-panel#McpListResult")
                },
                // 下面 7 条必须与 src/mcp/wire.ts 的 MCP_MANIFEST 一一对应：客户端只认得
                // 自己 $mount 过的描述符，漏一条就是运行期 "remote[method] is not a function"
                // （Issue #51：单工具禁用面板与卡片上的 OAuth 按钮都因此点不动）。
                // 守卫：test-client-contribution.mjs 做全量比对。
                {
                    id: "dsh-skill-mcp-panel#mcpManager/listTools",
                    service: "mcpManager",
                    namespace: "mcpManager",
                    method: "listTools",
                    invocation: { kind: "direct" },
                    parameters: [
                        { name: "payload", wire: "payload", source: "json", codec: codec("dsh-skill-mcp-panel#McpToolsPayload") }
                    ],
                    result: codec("dsh-skill-mcp-panel#McpToolsResult")
                },
                {
                    id: "dsh-skill-mcp-panel#mcpManager/getToolFilter",
                    service: "mcpManager",
                    namespace: "mcpManager",
                    method: "getToolFilter",
                    invocation: { kind: "direct" },
                    parameters: [],
                    result: codec("dsh-skill-mcp-panel#McpToolFilterResult")
                },
                {
                    id: "dsh-skill-mcp-panel#mcpManager/setToolFilter",
                    service: "mcpManager",
                    namespace: "mcpManager",
                    method: "setToolFilter",
                    invocation: { kind: "direct" },
                    parameters: [
                        { name: "payload", wire: "payload", source: "json", codec: codec("dsh-skill-mcp-panel#McpToolFilterPayload") }
                    ],
                    result: codec("dsh-skill-mcp-panel#McpToolFilterResult")
                },
                {
                    id: "dsh-skill-mcp-panel#mcpManager/evacuateForeign",
                    service: "mcpManager",
                    namespace: "mcpManager",
                    method: "evacuateForeign",
                    invocation: { kind: "direct" },
                    parameters: [],
                    result: codec("dsh-skill-mcp-panel#McpEvacuateResult")
                },
                {
                    id: "dsh-skill-mcp-panel#mcpManager/oauthStart",
                    service: "mcpManager",
                    namespace: "mcpManager",
                    method: "oauthStart",
                    invocation: { kind: "direct" },
                    parameters: [
                        { name: "payload", wire: "payload", source: "json", codec: codec("dsh-skill-mcp-panel#McpOAuthStartPayload") }
                    ],
                    result: codec("dsh-skill-mcp-panel#McpOAuthStartResult")
                },
                {
                    id: "dsh-skill-mcp-panel#mcpManager/oauthPoll",
                    service: "mcpManager",
                    namespace: "mcpManager",
                    method: "oauthPoll",
                    invocation: { kind: "direct" },
                    parameters: [
                        { name: "payload", wire: "payload", source: "json", codec: codec("dsh-skill-mcp-panel#McpOAuthPollPayload") }
                    ],
                    result: codec("dsh-skill-mcp-panel#McpOAuthPollResult")
                },
                {
                    id: "dsh-skill-mcp-panel#mcpManager/oauthStatus",
                    service: "mcpManager",
                    namespace: "mcpManager",
                    method: "oauthStatus",
                    invocation: { kind: "direct" },
                    parameters: [
                        { name: "payload", wire: "payload", source: "json", codec: codec("dsh-skill-mcp-panel#McpOAuthServerPayload") }
                    ],
                    result: codec("dsh-skill-mcp-panel#McpOAuthStatusResult")
                },
                {
                    id: "dsh-skill-mcp-panel#mcpManager/oauthDisconnect",
                    service: "mcpManager",
                    namespace: "mcpManager",
                    method: "oauthDisconnect",
                    invocation: { kind: "direct" },
                    parameters: [
                        { name: "payload", wire: "payload", source: "json", codec: codec("dsh-skill-mcp-panel#McpOAuthServerPayload") }
                    ],
                    result: codec("dsh-skill-mcp-panel#McpOAuthDisconnectResult")
                }
            ]
        };
        // ── 分组编辑对话框（左侧分组列表，右侧名称/工作区/技能）──────────────
        function GroupDialog({ t, options, groups, groupId, setGroupId, name, setName, scope, setScope, skills, selected, toggle, selectAll, busy, error, onSave, onDelete, onCancel }) {
            const known = Array.isArray(options) ? options : [];
            const rows = Array.isArray(groups) ? groups : [];
            const [query, setQuery] = react.useState("");
            // 删除分组的行内二次确认：3 秒未确认自动还原；切换分组时一并还原。
            const [confirmingDelete, setConfirmingDelete] = react.useState(false);
            const [deleteConfirmId, setDeleteConfirmId] = react.useState(null);
            react.useEffect(() => {
                setConfirmingDelete(false);
                setDeleteConfirmId(null);
            }, [groupId]);
            react.useEffect(() => {
                if (!confirmingDelete)
                    return;
                const timer = setTimeout(() => setConfirmingDelete(false), 3000);
                return () => clearTimeout(timer);
            }, [confirmingDelete]);
            const q = query.trim().toLowerCase();
            const visible = skills.filter((skill) => skill.name.toLowerCase().includes(q));
            const allChecked = skills.length > 0 && selected.size === skills.length;
            // 分类快速添加：从 rel 顶层段派生分类（如 lark-cli / mattpocock / opencli）。
            // 纯前端辅助——不改动手动分组机制，点击 chip 按目录批量勾选/取消。
            const categoryCount = (category) => skills.filter((skill) => (skill.rel ?? "").split("/")[0] === category).length;
            // 只显示 >= 2 个技能的分类：单技能分类直接勾选即可（chip 节省 0 次点击，无增量价值）；
            // 全扁平用户（无 >= 2 分类）整行隐藏，零影响——通用规则，不依赖具体树形。
            const categories = [...new Set(skills.map((skill) => (skill.rel ?? "").split("/")[0]).filter((category) => category !== ""))].filter((category) => categoryCount(category) >= 2);
            const categoryAllIn = (category) => {
                const inCat = skills.filter((skill) => (skill.rel ?? "").split("/")[0] === category);
                return inCat.length > 0 && inCat.every((skill) => selected.has(skill.name));
            };
            const toggleCategory = (category) => {
                const inCat = skills.filter((skill) => (skill.rel ?? "").split("/")[0] === category);
                const allIn = categoryAllIn(category);
                for (const skill of inCat) {
                    if (allIn ? selected.has(skill.name) : !selected.has(skill.name))
                        toggle(skill.name);
                }
            };
            return (0, react_jsx_runtime.jsx)("div", {
                className: c.scopeOverlay,
                role: "dialog",
                "aria-modal": "true",
                children: (0, react_jsx_runtime.jsxs)("div", {
                    className: c.scopeBox,
                    children: [(0, react_jsx_runtime.jsx)("h4", { children: t("groupTitle") }), (0, react_jsx_runtime.jsxs)("div", {
                            className: c.groupBody,
                            children: [(0, react_jsx_runtime.jsxs)("div", {
                                    className: c.groupSide,
                                    children: [(0, react_jsx_runtime.jsxs)("button", {
                                            type: "button",
                                            className: c.groupNewBtn,
                                            onClick: () => {
                                                setGroupId(null, "");
                                            },
                                            children: ["+ ", t("groupNew")]
                                        }), (0, react_jsx_runtime.jsx)("p", {
                                            className: c.groupSideLabel,
                                            children: t("groupTitle")
                                        }), ...rows.map((group) => (0, react_jsx_runtime.jsxs)("span", {
                                            className: c.groupSideItemWrap,
                                            children: [(0, react_jsx_runtime.jsx)("button", {
                                                    type: "button",
                                                    className: c.groupSideItem,
                                                    "data-active": groupId === group.id ? "true" : void 0,
                                                    onClick: () => {
                                                        setGroupId(group.id, group.name);
                                                    },
                                                    children: group.name
                                                }, group.id), (0, react_jsx_runtime.jsx)("button", {
                                                    type: "button",
                                                    className: c.groupDelete,
                                                    "data-confirm": deleteConfirmId === group.id ? "true" : void 0,
                                                    "aria-label": deleteConfirmId === group.id ? t("confirmDelete") : t("deleteLabel"),
                                                    title: deleteConfirmId === group.id ? t("confirmDelete") : t("deleteLabel"),
                                                    onClick: (event) => {
                                                        event.stopPropagation();
                                                        setGroupId(group.id, group.name);
                                                        if (deleteConfirmId === group.id)
                                                            onDelete();
                                                        else
                                                            setDeleteConfirmId(group.id);
                                                    },
                                                    children: deleteConfirmId === group.id ? t("confirmDelete") : "×"
                                                })]
                                        }, group.id))]
                                }), (0, react_jsx_runtime.jsxs)("div", {
                                    className: c.groupMain,
                                    children: [(0, react_jsx_runtime.jsxs)("div", {
                                            className: c.field,
                                            children: [(0, react_jsx_runtime.jsx)("label", {
                                                    className: c.fieldLabel,
                                                    children: t("groupName")
                                                }), (0, react_jsx_runtime.jsx)("input", {
                                                    className: c.textInput,
                                                    type: "text",
                                                    value: name,
                                                    placeholder: t("groupNamePlaceholder"),
                                                    onChange: (event) => {
                                                        setName(event.currentTarget.value);
                                                    }
                                                })]
                                        }), (0, react_jsx_runtime.jsxs)("div", {
                                            className: c.field,
                                            children: [(0, react_jsx_runtime.jsx)("label", {
                                                    className: c.fieldLabel,
                                                    children: t("groupScope")
                                                }), (0, react_jsx_runtime.jsxs)("select", {
                                                    className: c.select,
                                                    value: scope,
                                                    onChange: (event) => {
                                                        setScope(event.currentTarget.value);
                                                    },
                                                    children: [(0, react_jsx_runtime.jsx)("option", {
                                                            value: "global",
                                                            children: t("scopeGlobal")
                                                        }), ...known.map((option) => (0, react_jsx_runtime.jsx)("option", {
                                                            value: option.path,
                                                            children: option.label + " — " + option.path
                                                        }, option.path))]
                                                })]
                                        }), (0, react_jsx_runtime.jsxs)("div", {
                                            className: c.field,
                                            children: [(0, react_jsx_runtime.jsxs)("div", {
                                                    className: c.countRow,
                                                    children: [(0, react_jsx_runtime.jsx)("p", {
                                                            className: c.countText,
                                                            children: t("skillCountLabel") + " " + selected.size + "/" + skills.length
                                                        }), (0, react_jsx_runtime.jsx)("button", {
                                                            type: "button",
                                                            className: c.migrateSelectAll,
                                                            onClick: selectAll,
                                                            children: allChecked ? t("selectNone") : t("migrateSelectAll")
                                                        })]
                                                }), categories.length > 0 ? (0, react_jsx_runtime.jsxs)("div", {
                                                    className: c.categoryBar,
                                                    children: [(0, react_jsx_runtime.jsx)("span", {
                                                            className: c.categoryLabel,
                                                            children: t("categoryQuickAdd")
                                                        }), ...categories.map((category) => (0, react_jsx_runtime.jsx)("button", {
                                                            type: "button",
                                                            className: c.categoryChip,
                                                            "data-active": categoryAllIn(category) ? "true" : void 0,
                                                            title: t("categoryQuickAddHint") + "：" + category,
                                                            onClick: () => {
                                                                toggleCategory(category);
                                                            },
                                                            children: category + " (" + categoryCount(category) + ")"
                                                        }, category))]
                                                }, "cat-quick-add") : null, (0, react_jsx_runtime.jsx)("input", {
                                                    className: c.textInput,
                                                    type: "text",
                                                    value: query,
                                                    placeholder: t("skillFilterPlaceholder"),
                                                    onChange: (event) => {
                                                        setQuery(event.currentTarget.value);
                                                    }
                                                }), (0, react_jsx_runtime.jsxs)("div", {
                                                    className: c.skillListBox,
                                                    children: skills.length === 0 ? [(0, react_jsx_runtime.jsx)("p", {
                                                            className: c.migrateHint,
                                                            children: t("groupNoSkills")
                                                        }, "no-skills")] : visible.length === 0 ? [(0, react_jsx_runtime.jsx)("p", {
                                                            className: c.migrateHint,
                                                            children: t("emptySearch")
                                                        }, "no-match")] : visible.map((skill) => (0, react_jsx_runtime.jsxs)("label", {
                                                        className: c.skillRow,
                                                        children: [(0, react_jsx_runtime.jsx)("input", {
                                                                type: "checkbox",
                                                                checked: selected.has(skill.name),
                                                                onChange: () => {
                                                                    toggle(skill.name);
                                                                }
                                                            }), (0, react_jsx_runtime.jsx)("span", {
                                                                className: c.skillName,
                                                                children: skill.name
                                                            }), (0, react_jsx_runtime.jsx)("span", {
                                                                className: c.skillBadge,
                                                                "data-on": skill.enabled !== false ? "true" : "false",
                                                                children: skill.enabled !== false ? t("enabledTag") : t("disabledTag")
                                                            })]
                                                    }, skill.name))
                                                })]
                                        })]
                                })]
                        }), error !== null && error !== undefined ? (0, react_jsx_runtime.jsx)("p", {
                            className: c.migrateHint,
                            role: "alert",
                            children: error
                        }) : null, (0, react_jsx_runtime.jsxs)("div", {
                            className: c.dialogFooter,
                            children: [groupId !== null && groupId !== undefined ? (0, react_jsx_runtime.jsx)("button", {
                                    type: "button",
                                    className: c.dangerBtn,
                                    disabled: busy,
                                    onClick: () => {
                                        if (!confirmingDelete) {
                                            setConfirmingDelete(true);
                                            return;
                                        }
                                        onDelete();
                                    },
                                    children: confirmingDelete ? t("confirmDelete") : t("groupDelete")
                                }) : (0, react_jsx_runtime.jsx)("span", {}), (0, react_jsx_runtime.jsxs)("div", {
                                    className: c.scopeActions,
                                    children: [(0, react_jsx_runtime.jsx)("button", {
                                            type: "button",
                                            className: c.scopeAction + " " + c.scopeCancel,
                                            disabled: busy,
                                            onClick: onCancel,
                                            children: t("migrateCancel")
                                        }), (0, react_jsx_runtime.jsx)("button", {
                                            type: "button",
                                            className: c.scopeAction + " " + c.scopeConfirm,
                                            disabled: busy || (name ?? "").trim() === "" || selected.size === 0 || scope === "",
                                            onClick: onSave,
                                            children: busy ? t("groupSaving") : t("groupSave")
                                        })]
                                })]
                        })]
                })
            });
        }
        // ── 批量迁移对话框（源/目标均为下拉表单，目标可多选）───────────────────
        function MigrateDialog({ t, options, from, setFrom, targets, toggleTarget, mode, setMode, skills, selected, toggle, selectAll, busy, result, error, onConfirm, onCancel, onClose }) {
            const known = Array.isArray(options) ? options : [];
            const [query, setQuery] = react.useState("");
            const q = query.trim().toLowerCase();
            const visible = skills.filter((skill) => skill.name.toLowerCase().includes(q));
            const allChecked = skills.length > 0 && selected.size === skills.length;
            const okCount = Array.isArray(result) ? result.filter((item) => item.ok === true).length : 0;
            const failCount = Array.isArray(result) ? result.length - okCount : 0;
            const targetLabelOf = (value) => {
                if (value === null || value === undefined || value === "global")
                    return t("scopeGlobal");
                const hit = known.find((option) => option.path === value);
                return hit !== undefined && typeof hit.label === "string" && hit.label !== "" ? hit.label : value;
            };
            return (0, react_jsx_runtime.jsx)("div", {
                className: c.scopeOverlay,
                role: "dialog",
                "aria-modal": "true",
                children: (0, react_jsx_runtime.jsxs)("div", {
                    className: c.scopeBox,
                    children: [(0, react_jsx_runtime.jsx)("h4", { children: t("migrateTitle") }), (0, react_jsx_runtime.jsxs)("div", {
                            className: c.field,
                            children: [(0, react_jsx_runtime.jsx)("label", {
                                    className: c.fieldLabel,
                                    children: t("migrateFrom")
                                }), (0, react_jsx_runtime.jsxs)("div", {
                                    className: c.targetBox,
                                    children: [(0, react_jsx_runtime.jsxs)("button", {
                                            type: "button",
                                            className: c.targetItem,
                                            "data-active": from === "global" ? "true" : void 0,
                                            onClick: () => { setFrom("global"); },
                                            children: [(0, react_jsx_runtime.jsx)("input", {
                                                    type: "radio",
                                                    name: "migrate-from",
                                                    checked: from === "global",
                                                    readOnly: true
                                                }), (0, react_jsx_runtime.jsx)("span", {
                                                    className: c.skillName,
                                                    children: t("scopeGlobal")
                                                })]
                                        }, "from-global"), ...known.map((option) => (0, react_jsx_runtime.jsxs)("button", {
                                            type: "button",
                                            className: c.targetItem,
                                            "data-active": from === option.path ? "true" : void 0,
                                            onClick: () => { setFrom(option.path); },
                                            children: [(0, react_jsx_runtime.jsx)("input", {
                                                    type: "radio",
                                                    name: "migrate-from",
                                                    checked: from === option.path,
                                                    readOnly: true
                                                }), (0, react_jsx_runtime.jsx)("span", {
                                                    className: c.migrateOptionLabel,
                                                    children: option.label
                                                }), (0, react_jsx_runtime.jsx)("span", {
                                                    className: c.wsPath,
                                                    title: option.path,
                                                    children: option.path
                                                })]
                                        }, option.path))]
                                }), from === "" ? (0, react_jsx_runtime.jsx)("p", {
                                    className: c.migrateHint,
                                    children: t("migratePickSource")
                                }) : null]
                        }),
                        (0, react_jsx_runtime.jsxs)("div", {
                            className: c.field,
                            children: [(0, react_jsx_runtime.jsx)("label", {
                                    className: c.fieldLabel,
                                    children: t("migrateTo")
                                }), (0, react_jsx_runtime.jsxs)("div", {
                                    className: c.targetBox,
                                    children: [(0, react_jsx_runtime.jsxs)("button", {
                                            type: "button",
                                            className: c.targetItem,
                                            "data-active": targets.has("global") ? "true" : void 0,
                                            onClick: () => {
                                                toggleTarget("global");
                                            },
                                            children: [(0, react_jsx_runtime.jsx)("input", {
                                                    type: "checkbox",
                                                    checked: targets.has("global"),
                                                    readOnly: true
                                                }), (0, react_jsx_runtime.jsx)("span", {
                                                    className: c.skillName,
                                                    children: t("scopeGlobal")
                                                })]
                                        }), ...known.map((option) => (0, react_jsx_runtime.jsxs)("button", {
                                            type: "button",
                                            className: c.targetItem,
                                            "data-active": targets.has(option.path) ? "true" : void 0,
                                            onClick: () => {
                                                toggleTarget(option.path);
                                            },
                                            children: [(0, react_jsx_runtime.jsx)("input", {
                                                    type: "checkbox",
                                                    checked: targets.has(option.path),
                                                    readOnly: true
                                                }), (0, react_jsx_runtime.jsx)("span", {
                                                    className: c.migrateOptionLabel,
                                                    children: option.label
                                                }), (0, react_jsx_runtime.jsx)("span", {
                                                    className: c.wsPath,
                                                    title: option.path,
                                                    children: option.path
                                                })]
                                        }, option.path))]
                                })]
                        }), mode === "move" && targets.size > 1 ? (0, react_jsx_runtime.jsx)("p", {
                            className: c.migrateHint,
                            children: t("migrateMoveSingle")
                        }) : null, (0, react_jsx_runtime.jsxs)("div", {
                            className: c.field,
                            children: [(0, react_jsx_runtime.jsx)("p", {
                                    className: c.fieldLabel,
                                    children: t("migrateMode")
                                }), (0, react_jsx_runtime.jsxs)("div", {
                                    className: c.scopeOptions,
                                    children: [(0, react_jsx_runtime.jsxs)("button", {
                                            type: "button",
                                            className: c.scopeOption,
                                            "data-active": mode === "move" ? "true" : void 0,
                                            onClick: () => {
                                                setMode("move");
                                            },
                                            children: [(0, react_jsx_runtime.jsx)("input", {
                                                    type: "radio",
                                                    name: "migrate-mode",
                                                    checked: mode === "move",
                                                    readOnly: true
                                                }), (0, react_jsx_runtime.jsx)("span", { children: t("migrateModeMove") })]
                                        }), (0, react_jsx_runtime.jsxs)("button", {
                                            type: "button",
                                            className: c.scopeOption,
                                            "data-active": mode === "copy" ? "true" : void 0,
                                            onClick: () => {
                                                setMode("copy");
                                            },
                                            children: [(0, react_jsx_runtime.jsx)("input", {
                                                    type: "radio",
                                                    name: "migrate-mode",
                                                    checked: mode === "copy",
                                                    readOnly: true
                                                }), (0, react_jsx_runtime.jsx)("span", { children: t("migrateModeCopy") })]
                                        })]
                                })]
                        }), from === "" ? null : result === null ? (0, react_jsx_runtime.jsxs)("div", {
                            className: c.field,
                            children: [(0, react_jsx_runtime.jsxs)("div", {
                                    className: c.countRow,
                                    children: [(0, react_jsx_runtime.jsx)("p", {
                                            className: c.countText,
                                            children: t("skillCountLabel") + " " + selected.size + "/" + skills.length
                                        }), (0, react_jsx_runtime.jsx)("button", {
                                            type: "button",
                                            className: c.migrateSelectAll,
                                            onClick: selectAll,
                                            children: allChecked ? t("selectNone") : t("migrateSelectAll")
                                        })]
                                }),
                                (0, react_jsx_runtime.jsx)("input", {
                                    className: c.textInput,
                                    type: "text",
                                    value: query,
                                    placeholder: t("skillFilterPlaceholder"),
                                    onChange: (event) => {
                                        setQuery(event.currentTarget.value);
                                    }
                                }), (0, react_jsx_runtime.jsxs)("div", {
                                    className: c.skillListBox,
                                    children: skills.length === 0 ? [(0, react_jsx_runtime.jsx)("p", {
                                            className: c.migrateHint,
                                            children: t("migrateNoSkills")
                                        }, "no-skills")] : visible.length === 0 ? [(0, react_jsx_runtime.jsx)("p", {
                                            className: c.migrateHint,
                                            children: t("emptySearch")
                                        }, "no-match")] : visible.map((skill) => (0, react_jsx_runtime.jsxs)("label", {
                                        className: c.skillRow,
                                        children: [(0, react_jsx_runtime.jsx)("input", {
                                                type: "checkbox",
                                                checked: selected.has(skill.name),
                                                onChange: () => {
                                                    toggle(skill.name);
                                                }
                                            }), (0, react_jsx_runtime.jsx)("span", {
                                                className: c.skillName,
                                                children: skill.name
                                            }), (0, react_jsx_runtime.jsx)("span", {
                                                className: c.skillBadge,
                                                "data-on": skill.enabled !== false ? "true" : "false",
                                                children: skill.enabled !== false ? t("enabledTag") : t("disabledTag")
                                            })]
                                    }, skill.name))
                                })]
                        }) : null, error !== null && error !== undefined ? (0, react_jsx_runtime.jsx)("p", {
                            className: c.migrateHint,
                            role: "alert",
                            children: error
                        }) : null, result !== null ? (0, react_jsx_runtime.jsxs)("div", {
                            className: c.migrateSection,
                            children: [(0, react_jsx_runtime.jsxs)("p", {
                                    className: c.migrateResult,
                                    "data-ok": failCount === 0 ? "true" : "false",
                                    children: [failCount === 0 ? (0, react_jsx_runtime.jsxs)("svg", {
                                            width: "13",
                                            height: "13",
                                            viewBox: "0 0 16 16",
                                            fill: "none",
                                            "aria-hidden": "true",
                                            children: [(0, react_jsx_runtime.jsx)("circle", { cx: "8", cy: "8", r: "6.5", stroke: "currentColor", strokeWidth: 1.3 }), (0, react_jsx_runtime.jsx)("path", { d: "M5.5 8.2l1.8 1.8 3.2-4", stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round", strokeLinejoin: "round" })]
                                        }) : (0, react_jsx_runtime.jsxs)("svg", {
                                            width: "13",
                                            height: "13",
                                            viewBox: "0 0 16 16",
                                            fill: "none",
                                            "aria-hidden": "true",
                                            children: [(0, react_jsx_runtime.jsx)("path", { d: "M8 2.5l6.5 11.2h-13z", stroke: "currentColor", strokeWidth: 1.3, strokeLinejoin: "round" }), (0, react_jsx_runtime.jsx)("path", { d: "M8 6.5v3.2", stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round" }), (0, react_jsx_runtime.jsx)("circle", { cx: "8", cy: "11.6", r: "0.6", fill: "currentColor" })]
                                        }), t("migrateDoneOk") + okCount + t("migrateDoneFail") + failCount + t("migrateDoneSuffix")]
                                }), failCount > 0 ? (0, react_jsx_runtime.jsxs)("div", {
                                    children: [(0, react_jsx_runtime.jsx)("p", { className: c.migrateLabel, children: t("migrateErrors") }), (0, react_jsx_runtime.jsxs)("ul", {
                                            className: c.migrateResultList,
                                            children: result.filter((item) => item.ok !== true).map((item) => (0, react_jsx_runtime.jsx)("li", {
                                                key: item.name + "-" + (item.target ?? ""),
                                                children: item.name + (item.target === null || item.target === undefined ? "" : " → " + targetLabelOf(item.target)) + "：" + (item.error ?? "")
                                            }, item.name + "-" + (item.target ?? "")))
                                        })]
                                }) : null]
                        }) : null, (0, react_jsx_runtime.jsxs)("div", {
                            className: c.dialogFooter,
                            children: [(0, react_jsx_runtime.jsx)("span", {}), (0, react_jsx_runtime.jsxs)("div", {
                                    className: c.scopeActions,
                                    children: result === null ? [(0, react_jsx_runtime.jsx)("button", {
                                            type: "button",
                                            className: c.scopeAction + " " + c.scopeCancel,
                                            disabled: busy,
                                            onClick: onCancel,
                                            children: t("migrateCancel")
                                        }), (0, react_jsx_runtime.jsx)("button", {
                                            type: "button",
                                            className: c.scopeAction + " " + c.scopeConfirm,
                                            disabled: busy || from === "" || targets.size === 0 || selected.size === 0 || targets.has(from) || (mode === "move" && targets.size > 1),
                                            onClick: onConfirm,
                                            children: busy ? t("migrateBusy") : t("migrateConfirm")
                                        })] : [(0, react_jsx_runtime.jsx)("button", {
                                            type: "button",
                                            className: c.scopeAction + " " + c.scopeConfirm,
                                            onClick: onClose,
                                            children: t("migrateClose")
                                        })]
                                })]
                        })]
                })
            });
        }
        function SkillsSection(props) {
            const { t, currentSessionId, subscribeSession, useSessions, listSkills, loadContent, setSkillEnabled, removeSkill, addSkill, listWorkspaces, openFolder, batchMigrateSkill, listGroups, saveGroupSkill, deleteGroupSkill, checkUpdateRemote } = props;
            // 当前会话 id，仅用于会话级项目作用域与「随会话刷新列表」，
            // 不再门控任何 UI：技能页在没有会话时同样正常显示（服务端回退全局注册表）。
            // 宿主客户端以「主视图引用计数」定义当前会话，判据是
            //   sessions.list 快照 byId[id].retainedBy.mainView > 0
            //（settings-general、layout、workspace 等宿主自己的代码用的都是这一条）。
            // 该快照既没有 current 也没有 sessionId 字段，早先按 currentProvideInfo →
            // selection → list.current 逐级探测的写法在本版恒为 undefined。
            //
            // 首选宿主为 root 作用域槽位注入的标准 hook prop useSessions（响应式，会话
            // 切换自动重渲染）；旧外壳若未注入，则退回自行订阅 sessions.list 快照。
            const selectMainSessionId = (state) => {
                const rows = state !== null && typeof state === "object" ? state.byId : undefined;
                if (rows === null || typeof rows !== "object")
                    return undefined;
                for (const id of Object.keys(rows)) {
                    const row = rows[id];
                    if (((row && row.retainedBy && row.retainedBy.mainView) || 0) > 0)
                        return id;
                }
                return undefined;
            };
            const useHostSessions = typeof useSessions === "function";
            const hostSessionId = useHostSessions ? useSessions(selectMainSessionId) : undefined;
            const [fallbackSessionId, setFallbackSessionId] = react.useState(() => currentSessionId());
            react.useEffect(() => {
                if (useHostSessions)
                    return undefined;
                const sync = () => setFallbackSessionId(currentSessionId());
                sync();
                return subscribeSession(sync);
            }, [useHostSessions]);
            const sessionId = useHostSessions ? hostSessionId : fallbackSessionId;
            const [query, setQuery] = react.useState("");
            const [listState, setListState] = react.useState({ status: "loading" });
            const [request, setRequest] = react.useState(0);
            const [expanded, setExpanded] = react.useState(null);
            // 树形折叠状态（默认全部展开；路径为 key）。
            const [collapsed, setCollapsed] = react.useState(() => new Set());
            const toggleCollapsed = (path) => {
                setCollapsed((prev) => {
                    const next = new Set(prev);
                    if (next.has(path))
                        next.delete(path);
                    else
                        next.add(path);
                    return next;
                });
            };
            const [bodies, setBodies] = react.useState({});
            const [ops, setOps] = react.useState({});
            const [adding, setAdding] = react.useState({ status: "idle" });
            const [dragActive, setDragActive] = react.useState(false);
            const [wsOptions, setWsOptions] = react.useState(null);
            const [scopeFilter, setScopeFilter] = react.useState("global");
            const [migrator, setMigrator] = react.useState(null);
            const [groupsList, setGroupsList] = react.useState(null);
            const [groupFilter, setGroupFilter] = react.useState("all");
            const [groupEditor, setGroupEditor] = react.useState(null);
            const [bulkGroup, setBulkGroup] = react.useState(null);
            const [updateBanner, setUpdateBanner] = react.useState(null);
            const [addMenuOpen, setAddMenuOpen] = react.useState(false);
            const inflight = react.useRef(new Set());
            const singleFileInput = react.useRef(null);
            const zipFileInput = react.useRef(null);
            // 插件自带技能（随包提供、不在技能文件夹里）默认跟随列表显示，可一键隐藏。
            // 勾选状态记在 localStorage（Issue #59 附带问题：此前每次重进都回到默认勾选）。
            const SHOW_PLUGIN_SKILLS_KEY = "dsh-skill-mcp-panel:show-plugin-skills";
            const [showPluginSkills, setShowPluginSkills] = react.useState(() => {
                try {
                    return typeof localStorage === "undefined" || localStorage.getItem(SHOW_PLUGIN_SKILLS_KEY) !== "off";
                }
                catch {
                    return true;
                }
            });
            const toggleShowPluginSkills = (next) => {
                setShowPluginSkills(next);
                try {
                    if (typeof localStorage !== "undefined")
                        localStorage.setItem(SHOW_PLUGIN_SKILLS_KEY, next ? "on" : "off");
                }
                catch {
                    // 存不了就只在本次会话生效，不影响功能。
                }
            };
            // ── v2.1.6 三栏外壳相关状态 ───────────────────────────────────────
            // 中栏两种维度（分组 / 来源）；两者各自记筛选值，切换回来不丢。
            const [paneMode, setPaneMode] = react.useState("groups");
            const [providerFilter, setProviderFilter] = react.useState("all");
            // 批量模式：勾选框 + 底部操作栏（迁移到… / 取消）。
            const [batchMode, setBatchMode] = react.useState(false);
            const [selected, setSelected] = react.useState(() => new Set());
            const [batchMenuOpen, setBatchMenuOpen] = react.useState(false);
            // 正在淡出右移、等 RPC 落地的行（key = opKeyOf）。
            const [removing, setRemoving] = react.useState(() => new Set());
            // 顶部居中 Toast：{ text, action: { label, run } | null }。
            const [toast, setToast] = react.useState(null);
            const toastTimer = react.useRef(null);
            // 通知条（打开目录的回显、迁移结果等）。
            const [shellNotice, setShellNotice] = react.useState(null);
            // 中栏底部「＋ 新建分组」的内联输入框：null = 收起。
            const [inlineGroup, setInlineGroup] = react.useState(null);
            const [inlineBusy, setInlineBusy] = react.useState(false);
            // #27 入口位置偏好（前端读写骨架 + 设置浮层）。
            const railListRef = react.useRef(null);
            // 左轨竖条位置：行高 34px + 上下各 2px 外边距 = 38px 节距，
            // 列表 padding-top 4px（与 cssShell 的 .SKV_railItem / .SKV_railList 对齐）。
            const RAIL_LIST_PAD_TOP = 4;
            const RAIL_ITEM_PITCH = 38;
            const [railBarY, setRailBarY] = react.useState(RAIL_LIST_PAD_TOP + 8);
            // ── 布局开关（Issue #50）：三栏 / 简洁 ────────────────────────────
            // 简洁模式 = 收起左轨（工作区）与中栏（分组），把两者做成列表上方的两条筛选条，
            // 卡片、批量、撤销、迁移、添加全部沿用同一套组件——只有外壳不同，不写第二套前端。
            // 选择记在 localStorage，键与页签同一个前缀；读不到就当三栏（默认）。
            const LAYOUT_KEY = "dsh-skill-mcp-panel:layout";
            const [layoutCompact, setLayoutCompact] = react.useState(() => {
                try {
                    return typeof localStorage !== "undefined" && localStorage.getItem(LAYOUT_KEY) === "compact";
                }
                catch {
                    return false;
                }
            });
            // 简洁模式里工作区下拉的展开状态（宿主 Menu 以 portal 渲染）。
            const [scopeMenuOpen, setScopeMenuOpen] = react.useState(false);
            const toggleLayout = () => {
                const next = !layoutCompact;
                // 简洁模式下没有「分组 / 来源」切换入口，口径统一到分组维度，
                // 否则会出现「筛选条显示的是分组、列表却按来源过滤」的错位。
                if (next && paneMode !== "groups")
                    setPaneMode("groups");
                setScopeMenuOpen(false);
                setLayoutCompact(next);
                try {
                    if (typeof localStorage !== "undefined")
                        localStorage.setItem(LAYOUT_KEY, next ? "compact" : "three");
                }
                catch {
                    // 存不了就只在本次会话生效，不影响功能。
                }
            };
            // 列表拉取：首次显示加载态；此后静默刷新，保留旧列表避免闪烁。
            // 合并结果按名称排序——启停切换不会改变卡片位置。
            react.useEffect(() => {
                let current = true;
                setListState((prev) => (prev.status === "ready" ? prev : { status: "loading" }));
                Promise.resolve().then(() => listSkills()).then((snapshot) => {
                    if (!current)
                        return;
                    const skills = snapshot !== null && typeof snapshot === "object" && Array.isArray(snapshot.skills) ? [...snapshot.skills].sort((a, b) => a.name.localeCompare(b.name)) : [];
                    setListState({ status: "ready", skills });
                }, () => {
                    if (current)
                        setListState({ status: "error" });
                });
                return () => {
                    current = false;
                };
                // 会话变化后重取：listSkills 现在会把会话 id 传给服务端，用于解析会话级项目作用域。
            }, [listSkills, request, sessionId]);
            // 工作区列表与分组列表：加载一次，供两条横栏与各对话框使用。
            react.useEffect(() => {
                let current = true;
                Promise.all([Promise.resolve().then(() => listWorkspaces()), Promise.resolve().then(() => listGroups())]).then(([wsSnapshot, groupSnapshot]) => {
                    if (!current)
                        return;
                    setWsOptions(wsSnapshot !== null && typeof wsSnapshot === "object" && Array.isArray(wsSnapshot.workspaces) ? wsSnapshot.workspaces : []);
                    setGroupsList(groupSnapshot !== null && typeof groupSnapshot === "object" && Array.isArray(groupSnapshot.groups) ? groupSnapshot.groups : []);
                }, () => {
                    if (current)
                        setWsOptions([]);
                    if (current)
                        setGroupsList([]);
                });
                return () => {
                    current = false;
                };
            }, [listWorkspaces, listGroups]);
            // 错误态“重试”与显式全量刷新。
            const refresh = () => {
                setBodies({});
                setExpanded(null);
                setRequest((value) => value + 1);
            };
            // 热操作后延迟静默刷新：等网关文件监听器（约 200ms 防抖）失效缓存。
            const reloadAfterHot = () => {
                setTimeout(() => setRequest((value) => value + 1), 450);
            };
            // 启用/停用（设定目标值）：乐观更新本地状态，随后后台对齐。
            // 整组开关复用这一条 RPC 路径，只是不在这里逐次挂热刷新。
            const runSetEnabled = (skill, target) => {
                setOps((prev) => ({ ...prev, [opKeyOf(skill)]: { status: "busy" } }));
                return Promise.resolve().then(() => setSkillEnabled(skill.name, target, scopeOf(skill))).then(() => {
                    setListState((prev) => (prev.status === "ready" ? { status: "ready", skills: prev.skills.map((s) => (s.name === skill.name && scopeOf(s) === scopeOf(skill) ? { ...s, enabled: target } : s)) } : prev));
                    setOps((prev) => ({ ...prev, [opKeyOf(skill)]: { status: "ok" } }));
                    return true;
                }, () => {
                    setOps((prev) => ({ ...prev, [opKeyOf(skill)]: { status: "error" } }));
                    return false;
                });
            };
            // 单卡开关：按当前状态取反。
            const applySetEnabled = (skill) => {
                runSetEnabled(skill, skill.enabled !== true).then((ok) => {
                    if (ok)
                        reloadAfterHot();
                });
            };
            // ── Toast / 通知条 ────────────────────────────────────────────────
            // 顶部居中 Toast，3.8s 自动消失；action 存在时带一个按钮（目前只用于「撤销」）。
            const dismissToast = () => {
                if (toastTimer.current !== null)
                    clearTimeout(toastTimer.current);
                toastTimer.current = null;
                setToast(null);
            };
            const showToast = (text, action = null) => {
                if (toastTimer.current !== null)
                    clearTimeout(toastTimer.current);
                setToast({ text: text, action: action });
                toastTimer.current = setTimeout(() => {
                    toastTimer.current = null;
                    setToast(null);
                }, 3800);
            };
            // ── 删除：乐观删除 + Toast「撤销」，不再二次确认（v2.1.6）─────────
            // 为什么撤销是「尽力还原」而不是「原样恢复」：
            //   宿主只给了 deleteSkill / addSkill 两条 RPC，没有「读原始技能目录里的任意
            //   文件」的能力——content 只回 SKILL.md 正文。所以撤销走 addSkill 把删除前
            //   抓到的正文按原来的 rel 路径回填：单文件技能与「只有一个 SKILL.md 的技能
            //   目录」能完整回来，带脚本/资源的技能目录只能拿回 SKILL.md。
            //   正文也抓不到（技能在删除前的 content 调用就失败）时不做假承诺，
            //   Toast 的撤销按钮会明确回报「还原失败，请重新添加」。
            const sameKeySelected = (rows, key) => rows.filter((s) => opKeyOf(s) !== key);
            const undoDelete = (snapshot) => {
                if (snapshot.content === null) {
                    showToast(t("toastUndoFailed"));
                    return;
                }
                const files = [{ path: snapshot.rel === "" ? snapshot.name + "/SKILL.md" : snapshot.rel, base64: utf8ToBase64(snapshot.content) }];
                Promise.resolve().then(() => addSkill({ kind: "auto", files: files, workspace: snapshot.scope === "global" ? null : snapshot.scope })).then((result) => {
                    const added = result !== null && typeof result === "object" && Array.isArray(result.added) ? result.added : [];
                    if (added.length === 0) {
                        showToast(t("toastUndoFailed"));
                        return;
                    }
                    showToast(t("toastUndoDone").replace("{name}", snapshot.name));
                    reloadAfterHot();
                }, () => {
                    showToast(t("toastUndoFailed"));
                });
            };
            const applyRemove = (skill) => {
                const key = opKeyOf(skill);
                // 删除前把「还原所需的一切」抓在手里：名称、作用域、rel 路径，以及正文。
                const snapshot = {
                    name: skill.name,
                    scope: scopeOf(skill),
                    rel: String(skill.rel ?? "").replaceAll("\\", "/").replace(/^\/+/, ""),
                    content: bodies[key] !== undefined && bodies[key].status === "ready" && typeof bodies[key].skill?.content === "string" ? bodies[key].skill.content : null
                };
                setOps((prev) => ({ ...prev, [key]: { status: "busy" } }));
                // 乐观：行立刻淡出右移（cssRow .SKV_card[data-removing=true]）。
                setRemoving((prev) => {
                    const next = new Set(prev);
                    next.add(key);
                    return next;
                });
                const contentReady = snapshot.content !== null
                    ? Promise.resolve(snapshot.content)
                    : Promise.resolve().then(() => loadContent(snapshot.name, snapshot.scope)).then((body) => (body !== null && typeof body === "object" && typeof body.content === "string" ? body.content : null), () => null);
                contentReady.then((content) => {
                    snapshot.content = content;
                    return Promise.resolve().then(() => removeSkill(snapshot.name, snapshot.scope)).then(() => {
                        setListState((prev) => (prev.status === "ready" ? { status: "ready", skills: sameKeySelected(prev.skills, key) } : prev));
                        setOps((prev) => ({ ...prev, [key]: { status: "ok" } }));
                        setRemoving((prev) => {
                            const next = new Set(prev);
                            next.delete(key);
                            return next;
                        });
                        setSelected((prev) => {
                            if (!prev.has(snapshot.name))
                                return prev;
                            const next = new Set(prev);
                            next.delete(snapshot.name);
                            return next;
                        });
                        setExpanded((current) => (current === key ? null : current));
                        showToast(t("toastDeleted").replace("{name}", snapshot.name), { label: t("toastUndo"), run: () => { undoDelete(snapshot); } });
                        reloadAfterHot();
                    }, () => {
                        setRemoving((prev) => {
                            const next = new Set(prev);
                            next.delete(key);
                            return next;
                        });
                        setOps((prev) => ({ ...prev, [key]: { status: "error" } }));
                    });
                });
            };
            // ── 添加技能：读取本地文件并上传（宿主负责校验与落盘）──────────────
            const readFileAsBase64 = (file) => new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => {
                    const bytes = new Uint8Array(reader.result);
                    let binary = "";
                    for (let i = 0; i < bytes.length; i++)
                        binary += String.fromCharCode(bytes[i]);
                    resolve(btoa(binary));
                };
                reader.onerror = () => reject(new Error("file read failed"));
                reader.readAsArrayBuffer(file);
            });
            // 把宿主的业务报错从 RPC 信封前缀里剥出来（提示语已经是面向用户的中文）。
            const cleanHostError = (error) => String(error?.message ?? error).replace(/^skillsViewer\.[a-zA-Z]+ failed: [a-zA-Z0-9_-]+: /, "");
            // 同名技能可能存在于多个作用域：操作状态与目标都按（名称, 作用域）区分。
            const opKeyOf = (skill) => skill.name + "\u0000" + (skill.scope !== undefined && skill.scope !== null && skill.scope.kind === "workspace" ? skill.scope.path : "global");
            // 三个入口（单文件 / 文件夹·zip / 拖放）共用同一条路径：只负责把
            // 原始选择上传，结构完全由宿主的统一分类器判定（kind 恒为 "auto"）。
            const summarizeAdd = (result) => {
                const added = result !== null && typeof result === "object" && Array.isArray(result.added) ? result.added : [];
                const skipped = result !== null && typeof result === "object" && Array.isArray(result.skipped) ? result.skipped : [];
                const warnings = result !== null && typeof result === "object" && Array.isArray(result.warnings) ? result.warnings : [];
                let message = t("addDone").replace("{count}", String(added.length));
                if (warnings.length > 0) {
                    const detail = warnings.slice(0, 3).map((item) => item.name + "（" + item.reason + "）").join("；");
                    message += t("addWarned").replace("{count}", String(warnings.length)) + detail + (warnings.length > 3 ? "；…" : "");
                }
                if (skipped.length > 0) {
                    const detail = skipped.slice(0, 3).map((item) => item.name + "（" + item.reason + "）").join("；");
                    message += t("addSkipped").replace("{count}", String(skipped.length)) + detail + (skipped.length > 3 ? "；…" : "");
                }
                return message;
            };
            const runAdd = (items) => {
                if (items.length === 0)
                    return;
                if (items.length > 200) {
                    setAdding({ status: "error", message: t("addTooMany") });
                    return;
                }
                setAdding({ status: "busy" });
                const workspace = scopeFilter === "global" ? null : scopeFilter;
                Promise.all(items.map((item) => readFileAsBase64(item.file))).then((blobs) => {
                    const payloadFiles = items.map((item, index) => ({ path: item.path.replaceAll("\\", "/"), base64: blobs[index] }));
                    return addSkill({ kind: "auto", files: payloadFiles, workspace });
                }).then((result) => {
                    setAdding({ status: "ok", message: summarizeAdd(result) });
                    setTimeout(() => setRequest((value) => value + 1), 700);
                    setTimeout(() => setAdding((prev) => (prev.status === "ok" ? { status: "idle" } : prev)), 8000);
                }, (error) => {
                    setAdding({ status: "error", message: cleanHostError(error) });
                });
            };
            // 无论来源（选择器/拖放）、无论类型（.md/.zip/文件夹），统一交给宿主。
            const ingestItems = (items) => {
                runAdd(items);
            };
            // 批量迁移：打开对话框，源/目标/技能均由用户手动选择。
            // prefill：批量栏的「更多选项…」把当前作用域与已勾选项带进对话框，
            // 想复制或多目标时不用再选一遍；工具栏直接打开时仍是一切空白。
            const openMigrator = (prefill = null) => {
                setMigrator({
                    from: prefill !== null && typeof prefill.from === "string" ? prefill.from : "",
                    targets: prefill !== null && prefill.targets instanceof Set ? prefill.targets : new Set(),
                    mode: "move",
                    selected: prefill !== null && prefill.selected instanceof Set ? prefill.selected : new Set(),
                    busy: false,
                    result: null,
                    error: null
                });
            };
            const applyBatchMigrate = () => {
                const m = migrator;
                if (m === null)
                    return;
                if (m.from === "") {
                    setMigrator({ ...m, error: t("migratePickSource") });
                    return;
                }
                if (m.targets.size === 0) {
                    setMigrator({ ...m, error: t("migratePickTarget") });
                    return;
                }
                if (m.targets.has(m.from)) {
                    setMigrator({ ...m, error: t("migrateSameScope") });
                    return;
                }
                if (m.mode === "move" && m.targets.size > 1) {
                    setMigrator({ ...m, error: t("migrateMoveSingle") });
                    return;
                }
                if (m.selected.size === 0) {
                    setMigrator({ ...m, error: t("migratePickSkills") });
                    return;
                }
                setMigrator({ ...m, busy: true, error: null });
                const payload = {
                    from: m.from === "global" ? null : m.from,
                    targets: [...m.targets].map((value) => (value === "global" ? null : value)),
                    mode: m.mode,
                    names: [...m.selected]
                };
                Promise.resolve().then(() => batchMigrateSkill(payload)).then((snapshot) => {
                    const results = snapshot !== null && typeof snapshot === "object" && Array.isArray(snapshot.results) ? snapshot.results : [];
                    setMigrator((prev) => (prev === null ? prev : { ...prev, busy: false, result: results }));
                    reloadAfterHot();
                }, (error) => {
                    setMigrator((prev) => (prev === null ? prev : { ...prev, busy: false, error: cleanHostError(error) }));
                });
            };
            // 进入页面时后台静默检查更新；仅在有新版本时提示，网络失败不打扰。
            react.useEffect(() => {
                let current = true;
                Promise.resolve().then(() => checkUpdateRemote()).then((snapshot) => {
                    if (!current)
                        return;
                    const currentV = snapshot !== null && typeof snapshot === "object" && typeof snapshot.current === "string" ? snapshot.current : "";
                    const latest = snapshot !== null && typeof snapshot === "object" && typeof snapshot.latest === "string" ? snapshot.latest : null;
                    if (latest !== null && snapshot.updateAvailable === true)
                        setUpdateBanner(t("checkUpdateAvailable") + latest + t("checkUpdateCurrent") + currentV + t("checkUpdateHint"));
                }, () => {
                    // 网络不可达或超时：静默忽略
                });
                return () => {
                    current = false;
                };
            }, [checkUpdateRemote]);
            // 分组：打开编辑器（新建分组）。
            const openGroupEditor = () => {
                setGroupEditor({ groupId: null, name: "", scope: scopeFilter, selected: new Set(), busy: false, error: null });
            };
            const applyGroupSave = () => {
                const editor = groupEditor;
                if (editor === null)
                    return;
                if ((editor.name ?? "").trim() === "") {
                    setGroupEditor({ ...editor, error: t("groupPickName") });
                    return;
                }
                if (editor.scope === "") {
                    setGroupEditor({ ...editor, error: t("groupPickScope") });
                    return;
                }
                if (editor.selected.size === 0) {
                    setGroupEditor({ ...editor, error: t("migratePickSkills") });
                    return;
                }
                setGroupEditor({ ...editor, busy: true, error: null });
                const payload = {
                    id: editor.groupId ?? undefined,
                    name: editor.name,
                    scope: editor.scope === "global" ? null : editor.scope,
                    names: [...editor.selected]
                };
                Promise.resolve().then(() => saveGroupSkill(payload)).then((snapshot) => {
                    const rows = snapshot !== null && typeof snapshot === "object" && Array.isArray(snapshot.groups) ? snapshot.groups : [];
                    setGroupsList(rows);
                    setGroupFilter("all");
                    setGroupEditor(null);
                    reloadAfterHot();
                }, (error) => {
                    setGroupEditor((prev) => (prev === null ? prev : { ...prev, busy: false, error: cleanHostError(error) }));
                });
            };
            const applyGroupDelete = () => {
                const editor = groupEditor;
                if (editor === null || editor.groupId === null || editor.groupId === undefined)
                    return;
                setGroupEditor({ ...editor, busy: true, error: null });
                Promise.resolve().then(() => deleteGroupSkill({ id: editor.groupId })).then((snapshot) => {
                    const rows = snapshot !== null && typeof snapshot === "object" && Array.isArray(snapshot.groups) ? snapshot.groups : [];
                    setGroupsList(rows);
                    if (groupFilter === editor.name)
                        setGroupFilter("all");
                    setGroupEditor(null);
                    reloadAfterHot();
                }, (error) => {
                    setGroupEditor((prev) => (prev === null ? prev : { ...prev, busy: false, error: cleanHostError(error) }));
                });
            };
            // 文件选择：单文件入口。
            const pickSingleFiles = (event) => {
                const input = event.currentTarget;
                const files = [...input.files];
                input.value = "";
                setAddMenuOpen(false);
                if (files.length === 0)
                    return;
                ingestItems(files.map((file) => ({ name: file.name, path: file.name, file })));
            };
            const pickZipFiles = (event) => {
                const input = event.currentTarget;
                const files = [...input.files];
                input.value = "";
                if (files.length === 0)
                    return;
                ingestItems(files.map((file) => ({ name: file.name, path: file.name, file })));
            };
            // 文件夹 / zip 入口：优先使用 File System Access API 选择文件夹；
            // 取消或不可用时回退到 .zip 文件选择，最终交给宿主自动识别结构。
            const readHandleDir = async (handle, prefix, out) => {
                for await (const [name, child] of handle.entries()) {
                    if (child.kind === "file") {
                        const file = await child.getFile();
                        out.push({ name, path: prefix === "" ? name : prefix + "/" + name, file });
                    }
                    else if (child.kind === "directory") {
                        await readHandleDir(child, prefix === "" ? name : prefix + "/" + name, out);
                    }
                }
            };
            const pickFolderOrZip = async () => {
                setAddMenuOpen(false);
                const picker = window.showDirectoryPicker;
                if (typeof picker === "function") {
                    try {
                        const dir = await picker.call(window, { mode: "read" });
                        const items = [];
                        // 相对路径必须带被选中文件夹自己的名字：这样「文件夹选择器」
                        // 与「拖放」得到的选择范围完全一致（否则技能包会被误判）。
                        await readHandleDir(dir, dir.name ?? "", items);
                        if (items.length > 0)
                            ingestItems(items);
                        return;
                    }
                    catch (error) {
                        // 用户取消：回退到 zip 文件选择。
                        zipFileInput.current?.click();
                        return;
                    }
                }
                zipFileInput.current?.click();
            };
            // 拖放：支持拖入 .md / .zip 文件与技能文件夹（自动识别结构）。
            const readDirEntries = (dirEntry) => new Promise((resolve, reject) => {
                const reader = dirEntry.createReader();
                const all = [];
                const readBatch = () => reader.readEntries((batch) => {
                    if (batch.length === 0)
                        resolve(all);
                    else {
                        all.push(...batch);
                        readBatch();
                    }
                }, reject);
                readBatch();
            });
            const collectDropItems = async (dataTransfer) => {
                const items = [];
                const walk = async (entry, prefix) => {
                    if (entry.isFile) {
                        const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
                        items.push({ name: entry.name, path: prefix + entry.name, file });
                    }
                    else if (entry.isDirectory) {
                        for (const child of await readDirEntries(entry))
                            await walk(child, prefix + entry.name + "/");
                    }
                };
                const entries = [];
                for (const item of dataTransfer.items) {
                    const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
                    if (entry !== null)
                        entries.push(entry);
                }
                if (entries.length === 0) {
                    for (const file of dataTransfer.files)
                        items.push({ name: file.name, path: file.name, file });
                }
                else {
                    for (const entry of entries)
                        await walk(entry, "");
                }
                return items;
            };
            const onDrop = (event) => {
                event.preventDefault();
                setDragActive(false);
                if (adding.status === "busy" || event.dataTransfer === null)
                    return;
                collectDropItems(event.dataTransfer).then((items) => {
                    if (items.length > 0)
                        ingestItems(items);
                }, (error) => {
                    setAdding({ status: "error", message: cleanHostError(error) });
                });
            };
            const onDragOver = (event) => {
                event.preventDefault();
                if (adding.status !== "busy")
                    setDragActive(true);
            };
            const onDragLeave = (event) => {
                if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))
                    return;
                setDragActive(false);
            };
            const normalizedQuery = query.trim().toLocaleLowerCase();
            const skills = listState.status === "ready" ? listState.skills : [];
            const scopeOf = (skill) => (skill.scope !== undefined && skill.scope !== null && skill.scope.kind === "workspace" ? skill.scope.path : "global");
            const labelOf = (path) => {
                // 优先用 DSH 注册表的工作区名称（与文件夹名解耦），取不到回退文件夹名。
                const hit = (Array.isArray(wsOptions) ? wsOptions : []).find((workspace) => workspace.path === path);
                if (hit !== undefined && typeof hit.label === "string" && hit.label !== "")
                    return hit.label;
                const parts = String(path).replaceAll("\\", "/").split("/").filter(Boolean);
                return parts.length > 0 ? parts[parts.length - 1] : String(path);
            };
            const knownPaths = (Array.isArray(wsOptions) ? wsOptions : []).map((workspace) => workspace.path);
            const scopeKeys = ["global", ...knownPaths.filter((path) => path !== "global")];
            if (scopeFilter !== "global" && !scopeKeys.includes(scopeFilter))
                scopeKeys.push(scopeFilter);
            // 插件自带技能由宿主打标（pluginProvided）：它们在技能文件夹之外，面板也改不动，
            // 默认显示，但可以一键隐藏——只留下自己管理的文件技能。
            const scopedAll = skills.filter((skill) => scopeOf(skill) === scopeFilter);
            const hiddenPluginCount = showPluginSkills ? 0 : scopedAll.reduce((sum, skill) => sum + (skill.pluginProvided === true ? 1 : 0), 0);
            const scoped = showPluginSkills ? scopedAll : scopedAll.filter((skill) => skill.pluginProvided !== true);
            // ── 左轨：工作区（全局恒显示，其余只显示计数 > 0 的）+ 发光竖条 ────
            // 计数与中栏「全部」一致：按当前作用域统计，插件技能被隐藏时同步扣掉。
            // 分组的中栏数据源：当前作用域里建过组的分组（与 2.0.2 语义一致）；
            // 另外把「一个成员都还没有的分组」也放进来——中栏底部「＋ 新建分组」建的
            // 就是这种空组，宿主侧 upsertGroup 在 names 为空时不会写 scope 键，
            // 不放行的话用户新建完就什么也看不见（计数恒为 0，点进去是空态）。
            const scopeGroupRows = (Array.isArray(groupsList) ? groupsList : []).filter((group) => group.scopes !== undefined && group.scopes !== null && (Object.prototype.hasOwnProperty.call(group.scopes, scopeFilter) || Object.keys(group.scopes).length === 0));
            // 组成员：取 scopes[当前作用域] 里的名字，且该技能确实在当前作用域中。
            const membersOfGroup = (group) => {
                const names = group !== undefined && group.scopes !== undefined && Array.isArray(group.scopes[scopeFilter]) ? group.scopes[scopeFilter] : [];
                return scoped.filter((skill) => names.includes(skill.name));
            };
            const countInScope = (scopeKey) => skills.reduce((sum, skill) => sum + (scopeOf(skill) === scopeKey && (showPluginSkills || skill.pluginProvided !== true) ? 1 : 0), 0);
            // 左轨列出**全部**工作区（全局恒在首位），计数为 0 的也列——列表放不下就滚动，
            // 不再用「计数 > 0」过滤 + 「其他工作区」菜单兜底（用户 2026-10-15 定案：
            // 元素太多、菜单不如直接滚；藏起来的工作区还会让「往新工作区加技能」没有入口）。
            const railEntries = [{ key: "global", label: t("scopeGlobal"), count: countInScope("global") }];
            for (const path of knownPaths) {
                if (path === "global")
                    continue;
                if (railEntries.some((entry) => entry.key === path))
                    continue;
                railEntries.push({ key: path, label: labelOf(path), count: countInScope(path) });
            }
            // 会话锚定的工作区可能还没进 knownPaths：补一行，别让当前作用域在界面上消失。
            if (!railEntries.some((entry) => entry.key === scopeFilter))
                railEntries.push({ key: scopeFilter, label: labelOf(scopeFilter), count: countInScope(scopeFilter) });
            const countOfScope = (scopeKey) => (scopeKey === "global" ? t("scopeGlobal") : labelOf(scopeKey));
            // ── 中栏：分组（默认）或来源（#42）────────────────────────────────
            // 来源 = 技能的 provider；pluginProvided 的技能归到「插件自带」一组。
            const PROVIDER_PLUGIN = "\u0000plugin";
            const PROVIDER_PREFIX = "\u0000provider:";
            const providerKeyOf = (skill) => (skill.pluginProvided === true ? PROVIDER_PLUGIN : PROVIDER_PREFIX + (typeof skill.provider === "string" && skill.provider !== "" ? skill.provider : t("paneProviderUnknown")));
            const providerLabelOf = (key) => (key === PROVIDER_PLUGIN ? t("panePluginProvided") : key.slice(PROVIDER_PREFIX.length));
            const sourceCounts = new Map();
            for (const skill of scoped) {
                const key = providerKeyOf(skill);
                sourceCounts.set(key, (sourceCounts.get(key) ?? 0) + 1);
            }
            const grouped = paneMode === "provider"
                ? (providerFilter === "all" ? scoped : scoped.filter((skill) => providerKeyOf(skill) === providerFilter))
                : (groupFilter === "all" ? scoped : scoped.filter((skill) => (Array.isArray(skill.groups) ? skill.groups : []).includes(groupFilter)));
            // 「未分组」：不属于当前作用域里任何一个分组的技能。
            const groupedNames = new Set();
            for (const group of scopeGroupRows) {
                const names = group.scopes !== undefined && group.scopes !== null && Array.isArray(group.scopes[scopeFilter]) ? group.scopes[scopeFilter] : [];
                for (const name of names)
                    groupedNames.add(name);
            }
            const groupFiltered = paneMode !== "groups" || groupFilter === "all" ? scoped : groupFilter === "" ? scoped.filter((skill) => !groupedNames.has(skill.name)) : grouped;
            const activeList = paneMode === "provider" ? grouped : groupFiltered;
            const filtered = activeList.filter((skill) => skill.name.toLocaleLowerCase().includes(normalizedQuery));
            // 中栏行：全部 / 各分组（或各来源）/ 未分组，行尾都带计数。
            // 「未分组」只在**有意义**时出现：这个作用域确实建过分组，且真的还有没进分组的技能。
            // 没建分组时它等于「全部」，全部分组后它点进去是空列表——两种都是纯噪音。
            const ungroupedCount = scoped.reduce((sum, skill) => sum + (groupedNames.has(skill.name) ? 0 : 1), 0);
            const showUngrouped = paneMode === "groups" && scopeGroupRows.length > 0 && ungroupedCount > 0;
            const paneRows = paneMode === "provider"
                ? [
                    { key: "all", label: t("groupAll"), count: scoped.length },
                    ...[...sourceCounts.entries()]
                        .sort((left, right) => right[1] - left[1] || providerLabelOf(left[0]).localeCompare(providerLabelOf(right[0])))
                        .map(([key, count]) => ({ key: key, label: providerLabelOf(key), count: count }))
                ]
                : [
                    { key: "all", label: t("groupAll"), count: scoped.length },
                    ...scopeGroupRows.map((group) => ({ key: group.name, label: group.name, count: membersOfGroup(group).length })),
                    ...(showUngrouped ? [{ key: "", label: t("paneUngrouped"), count: ungroupedCount }] : [])
                ];
            const activePaneKey = paneMode === "provider" ? providerFilter : groupFilter;
            // 「未分组」行消失时不能把列表留在那个看不见的筛选上：所有技能都进了分组、
            // 或者用户把分组删光了，都要退回「全部」。
            react.useEffect(() => {
                if (paneMode === "groups" && groupFilter === "" && !showUngrouped)
                    setGroupFilter("all");
            }, [paneMode, groupFilter, showUngrouped]);
            const selectPaneRow = (key) => {
                if (paneMode === "provider")
                    setProviderFilter(key);
                else
                    setGroupFilter(key);
                setBatchMenuOpen(false);
            };
            // ── 批量模式：勾选 / 迁移 ─────────────────────────────────────────
            const exitBatch = () => {
                setBatchMode(false);
                setSelected(new Set());
                setBatchMenuOpen(false);
            };
            // 「迁移到…」菜单：除当前工作区外的全部工作区（全局恒在），末项回落到完整的
            // 批量迁移对话框（复制模式 / 多目标 / 失败明细）。
            // 宿主 Menu 的条目契约是 { id, label }——别把内部用的 key 直接塞进去，
            // 否则菜单能画出来但 onSelect 拿到 undefined。哨兵用 ASCII：它会作为
            // item.id 进宿主的渲染层，不要塞控制字符；工作区路径不可能是这个值。
            const BATCH_ADVANCED = "panel:advanced";
            const targetWorkspaces = [{ id: "global", label: t("scopeGlobal") }, ...knownPaths.filter((path) => path !== "global").map((path) => ({ id: path, label: labelOf(path) }))].filter((entry) => entry.id !== scopeFilter);
            const toggleSelected = (name) => {
                setSelected((prev) => {
                    const next = new Set(prev);
                    if (next.has(name))
                        next.delete(name);
                    else
                        next.add(name);
                    return next;
                });
            };
            // 快捷迁移：单目标、移动模式（多目标/复制仍走完整的批量迁移对话框）。
            const runQuickMigrate = (targetKey) => {
                const names = [...selected];
                if (names.length === 0)
                    return;
                const payload = {
                    from: scopeFilter === "global" ? null : scopeFilter,
                    targets: [targetKey === "global" ? null : targetKey],
                    mode: "move",
                    names: names
                };
                Promise.resolve().then(() => batchMigrateSkill(payload)).then((snapshot) => {
                    const results = snapshot !== null && typeof snapshot === "object" && Array.isArray(snapshot.results) ? snapshot.results : [];
                    const done = results.filter((row) => row !== null && typeof row === "object" && row.ok !== false).map((row) => row.name);
                    const moved = done.length > 0 ? done : names;
                    setListState((prev) => (prev.status === "ready" ? { status: "ready", skills: prev.skills.filter((skill) => !(scopeOf(skill) === scopeFilter && moved.includes(skill.name))) } : prev));
                    showToast(t("batchMigrated").replace("{count}", String(moved.length)).replace("{target}", countOfScope(targetKey)));
                    exitBatch();
                    reloadAfterHot();
                }, (error) => {
                    setShellNotice({ kind: "error", text: cleanHostError(error) });
                });
            };
            // ── 中栏底部「＋ 新建分组」：内联输入框（Enter 新建 / Esc 取消）────
            // 空分组名由宿主侧 upsertGroup 兜底校验；这里新建的是成员为空的组，
            // 想同时挑成员就用工具栏的「新建分组」（完整的分组编辑器）。
            const submitInlineGroup = () => {
                const editor = inlineGroup;
                if (editor === null)
                    return;
                const name = String(editor.value ?? "").trim();
                if (name === "" || inlineBusy)
                    return;
                setInlineBusy(true);
                Promise.resolve().then(() => saveGroupSkill({ name: name, scope: scopeFilter === "global" ? null : scopeFilter, names: [] })).then((snapshot) => {
                    const rows = snapshot !== null && typeof snapshot === "object" && Array.isArray(snapshot.groups) ? snapshot.groups : [];
                    setGroupsList(rows);
                    setPaneMode("groups");
                    setGroupFilter(name);
                    setProviderFilter("all");
                    setInlineGroup(null);
                    setInlineBusy(false);
                    reloadAfterHot();
                }, (error) => {
                    setInlineBusy(false);
                    setShellNotice({ kind: "error", text: cleanHostError(error) });
                });
            };
            // ── 「打开目录」（宿主没有打开文件管理器的 API）──────────────────
            // 宿主既没有「在系统文件管理器里打开路径」的 RPC，也没有回传技能根路径的接口，
            // 所以这一版把根路径复制到剪贴板、并在通知条里回显，用户自己粘贴到资源管理器。
            //
            // 关键点：`rel` 是**相对技能根的目录路径**（"cat/beta"，目录型技能包），
            // 扁平 `.md` 技能则是空串；而 `content` 回的是 SKILL.md 的绝对路径。
            // 早先只按「path 以 rel 结尾」判断，两者对不上，于是每个工作区都报
            // 「暂时拿不到技能根路径」（2026-10-19 用户复现）。
            const skillRootOf = (filePath, rel) => {
                const normalized = String(filePath ?? "").replaceAll("\\", "/");
                if (normalized === "")
                    return null;
                const lower = normalized.toLocaleLowerCase();
                const suffix = String(rel ?? "").replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/+$/, "");
                const cut = (tail) => normalized.slice(0, normalized.length - tail.length - 1).replace(/\/+$/, "");
                if (suffix !== "") {
                    for (const tail of [suffix + "/SKILL.md", suffix + "/SKILL.md.disabled", suffix]) {
                        if (lower.endsWith("/" + tail.toLocaleLowerCase()))
                            return cut(tail);
                    }
                }
                // 根层的扁平技能：rel 为空，根目录就是文件所在目录。
                if (suffix === "")
                    return normalized.replace(/\/[^/]+$/, "");
                return null;
            };
            const resolveSkillRoot = () => {
                // 1) 已经展开过的技能正文里带着 SKILL.md 的绝对路径。
                for (const skill of scopedAll) {
                    const body = bodies[opKeyOf(skill)];
                    if (body === undefined || body.status !== "ready")
                        continue;
                    const root = skillRootOf(body.skill?.path, skill.rel);
                    if (root)
                        return Promise.resolve(root);
                }
                // 2) 没展开过：拿当前作用域里第一个技能调一次 content，只为读它的 path。
                //    失败不早退——继续走第 3 步的兜底，否则（只要有技能存在）兜底永远走不到。
                const probe = scopedAll.find((skill) => typeof skill.name === "string" && skill.name !== "");
                const probeRoot = probe === undefined
                    ? Promise.resolve(null)
                    : Promise.resolve().then(() => loadContent(probe.name, scopeOf(probe))).then((body) => skillRootOf(body?.path, probe.rel), () => null);
                return probeRoot.then((root) => {
                    if (root)
                        return root;
                    // 3) 兜底：工作区作用域按 src/scope.ts 的规则拼 <工作区根>/.dsh/skills；
                    //    全局作用域没有可推导的锚点，宁可直说拿不到，也不猜一个路径给用户。
                    if (scopeFilter !== "global")
                        return String(scopeFilter).replaceAll("\\", "/").replace(/\/+$/, "") + "/.dsh/skills";
                    return null;
                });
            };
            const openSkillFolder = () => {
                resolveSkillRoot().then((root) => {
                    if (root === null || root === "") {
                        setShellNotice({ kind: "error", text: t("openFolderUnavailable") });
                        return;
                    }
                    // 宿主侧真的去弹资源管理器；宿主打不开（目录还没建出来、没有 xdg-open 等）
                    // 再退回「复制路径」，不让按钮变成死路。
                    // 提示条里的路径用宿主回传的那份：宿主会把它换成本机分隔符
                    // （Windows 的 explorer.exe 不认正斜杠，见 src/reveal.ts），
                    // 这里跟着显示同一份，用户复制出来粘进资源管理器也直接可用。
                    return openFolder(root).then((result) => {
                        const opened = result !== null && typeof result === "object" && typeof result.opened === "string" && result.opened !== "" ? result.opened : root;
                        setShellNotice({ kind: "info", text: t("openFolderRevealed").replace("{path}", opened) });
                    }, () => copyTextToClipboard(root).then((ok) => {
                        setShellNotice({ kind: "info", text: (ok ? t("openFolderCopied") : t("openFolderManual")).replace("{path}", root) });
                    }));
                });
            };
            // 切换工作区：分组/来源筛选归位，批量选择作废（选择是按作用域算的）。
            react.useEffect(() => {
                setGroupFilter("all");
                setProviderFilter("all");
                setSelected(new Set());
                setBatchMode(false);
                setBatchMenuOpen(false);
                setInlineGroup(null);
            }, [scopeFilter]);
            // 左轨竖条位置：优先按 DOM 实测（字体/缩放下最稳），实测不到时用节距推算。
            react.useEffect(() => {
                const host = railListRef.current;
                if (host === null || typeof host.querySelector !== "function")
                    return undefined;
                const active = host.querySelector("[data-active=true]");
                if (active === null)
                    return undefined;
                const offset = typeof active.offsetTop === "number" ? active.offsetTop : 0;
                const height = typeof active.offsetHeight === "number" && active.offsetHeight > 0 ? active.offsetHeight : 34;
                setRailBarY(offset + (height - 18) / 2);
                return undefined;
            }, [scopeFilter, railEntries.length, showPluginSkills]);
            // ── 树形渲染（嵌套技能按文件树显示；搜索时扁平化）──────────────────
            const querying = normalizedQuery.trim() !== "";
            const treeRoot = buildSkillTree(filtered);
            // 卡片行（v2.1.6）：[勾选框][图标][名称 + 描述][红绿灯 + 删除]。
            // 展开详情的入口是中间那块文字按钮；批量模式下点它等于勾选（与设计稿一致）。
            const renderCard = (skill) => {
                const key = opKeyOf(skill);
                const open = expanded === key;
                const body = bodies[key];
                const enabled = skill.enabled !== false;
                const editable = skill.source !== "bundled" && skill.source !== "runtime";
                const op = ops[key];
                const checked = selected.has(skill.name);
                return (0, react_jsx_runtime.jsxs)("li", {
                    key: skill.name,
                    className: c.card,
                    "data-skill-name": skill.name,
                    "data-open": open ? "true" : void 0,
                    "data-selected": batchMode && checked ? "true" : void 0,
                    "data-removing": removing.has(key) ? "true" : void 0,
                    children: [(0, react_jsx_runtime.jsxs)("div", {
                            className: c.cardRow,
                            children: [(0, react_jsx_runtime.jsx)("span", {
                                    className: c.check,
                                    children: (0, react_jsx_runtime.jsx)("input", {
                                        type: "checkbox",
                                        className: c.checkBox,
                                        checked: checked,
                                        tabIndex: batchMode ? 0 : -1,
                                        "aria-label": t("batchSelect") + " " + skill.name,
                                        onChange: () => {
                                            toggleSelected(skill.name);
                                        }
                                    })
                                }), (0, react_jsx_runtime.jsx)("span", {
                                    className: c.rowIcon,
                                    "aria-hidden": "true",
                                    children: hostIcon(primitiveIcon("IconSkillOutlineRegular"), 16, ICON_PATHS.skill)
                                }), (0, react_jsx_runtime.jsxs)("button", {
                                    type: "button",
                                    className: c.rowText,
                                    title: skill.name,
                                    "aria-expanded": batchMode ? void 0 : open,
                                    onClick: () => {
                                        if (batchMode)
                                            toggleSelected(skill.name);
                                        else
                                            toggle(skill);
                                    },
                                    children: [(0, react_jsx_runtime.jsx)("span", {
                                            className: c.rowName,
                                            "data-disabled": enabled ? void 0 : "true",
                                            children: skill.name
                                        }), typeof skill.description === "string" && skill.description !== "" ? (0, react_jsx_runtime.jsx)("span", {
                                            className: c.rowDesc,
                                            children: skill.description
                                        }) : null]
                                }), (0, react_jsx_runtime.jsxs)("span", {
                                    className: c.rowControls,
                                    children: [editable ? (0, react_jsx_runtime.jsxs)("button", {
                                            type: "button",
                                            role: "switch",
                                            className: c.traffic,
                                            "data-on": enabled ? "true" : "false",
                                            "aria-checked": enabled,
                                            "aria-label": (enabled ? t("switchDisable") : t("switchEnable")) + " " + skill.name,
                                            title: enabled ? t("switchDisable") : t("switchEnable"),
                                            disabled: op?.status === "busy",
                                            onClick: () => {
                                                applySetEnabled(skill);
                                            },
                                            children: [(0, react_jsx_runtime.jsx)("i", { className: c.trafficDot + " " + c.trafficRed }), (0, react_jsx_runtime.jsx)("i", { className: c.trafficDot + " " + c.trafficGreen })]
                                        }) : (0, react_jsx_runtime.jsx)("span", {
                                            className: c.configTag,
                                            "data-enabled": enabled ? "true" : "false",
                                            children: enabled ? t("enabledTag") : t("disabledTag")
                                        }), op?.status === "error" ? (0, react_jsx_runtime.jsx)("span", {
                                            className: c.opError,
                                            children: t("opFailed")
                                        }) : null, editable ? (0, react_jsx_runtime.jsx)("button", {
                                            type: "button",
                                            className: c.rowDelete,
                                            "aria-label": t("deleteLabel") + " " + skill.name,
                                            title: t("deleteLabel"),
                                            disabled: op?.status === "busy",
                                            onClick: () => {
                                                applyRemove(skill);
                                            },
                                            children: hostIcon(primitiveIcon("IconTrashOutlineRegular"), 14, ICON_PATHS.trash)
                                        }) : null]
                                })]
                        }), open ? (0, react_jsx_runtime.jsxs)("div", {
                            className: c.cardDetails,
                            children: [(0, react_jsx_runtime.jsxs)("p", {
                                    className: c.meta,
                                    children: [skill.description, (0, react_jsx_runtime.jsx)("span", {
                                            className: c.metaProvider,
                                            children: t("providerLabel") + ": " + skill.provider
                                        })]
                                }), body === undefined || body.status === "loading" ? (0, react_jsx_runtime.jsx)("p", {
                                    className: c.status,
                                    children: t("contentLoading")
                                }) : null,
                                body !== undefined && body.status === "error" ? (0, react_jsx_runtime.jsx)("p", {
                                    className: c.failureText,
                                    children: t("contentError")
                                }) : null,
                                body !== undefined && body.status === "missing" ? (0, react_jsx_runtime.jsx)("p", {
                                    className: c.failureText,
                                    children: t("contentMissing")
                                }) : null,
                                body !== undefined && body.status === "ready" ? (0, react_jsx_runtime.jsx)("div", {
                                    className: c.contentBox,
                                    children: (0, react_jsx_runtime.jsx)("pre", {
                                        className: c.content,
                                        children: body.skill.content
                                    })
                                }) : null]
                        }) : null]
                }, skill.name);
            };
            const renderFolder = (folder) => (0, react_jsx_runtime.jsxs)("li", {
                className: c.treeFolder,
                children: [(0, react_jsx_runtime.jsx)("button", {
                        type: "button",
                        className: c.treeFolderHeader,
                        "aria-expanded": !collapsed.has(folder.path),
                        onClick: () => {
                            toggleCollapsed(folder.path);
                        },
                        children: [(0, react_jsx_runtime.jsx)(primitiveIcon("IconChevronDownOutlineRegular"), {
                                className: collapsed.has(folder.path) ? c.treeChevron : c.treeChevronOpen,
                                size: 12,
                                "aria-hidden": "true"
                            }), (0, react_jsx_runtime.jsx)("span", {
                                className: c.treeFolderName,
                                children: folder.name
                            }), (0, react_jsx_runtime.jsx)("span", {
                                className: c.treeFolderCount,
                                children: String(folder.count)
                            })]
                    }), !collapsed.has(folder.path) ? (0, react_jsx_runtime.jsx)("ul", {
                        className: c.cards,
                        children: [...folder.folders.values()].map(renderFolder).concat(folder.skills.map(renderCard))
                    }) : null]
            }, folder.path);
            // scopeGroupRows / membersOfGroup 已上移到中栏数据区（paneRows 需要它们）。
            // 可编辑判定：bundled / runtime 技能随部署或运行时提供，宿主会拒绝启停。
            const isEditableSkill = (skill) => skill.source !== "bundled" && skill.source !== "runtime";
            const countOf = (rows) => ({
                total: rows.length,
                on: rows.reduce((sum, skill) => sum + (skill.enabled === true ? 1 : 0), 0),
                editable: rows.reduce((sum, skill) => sum + (isEditableSkill(skill) ? 1 : 0), 0)
            });
            const groupCount = (group) => countOf(membersOfGroup(group));
            const allCounts = countOf(scoped);
            // 整组开关的作用对象跟随中栏当前那一样（分组 → 该组成员；来源 → 该来源的技能；
            // 未分组 → 未归入任何分组的技能）。
            const activeGroup = paneMode === "groups" && groupFilter !== "all" && groupFilter !== "" ? scopeGroupRows.find((group) => group.name === groupFilter) : undefined;
            const activeSkills = activeGroup !== undefined ? membersOfGroup(activeGroup) : activeList;
            const activeCounts = countOf(activeSkills);
            const bulkKey = paneMode + ":" + activePaneKey;
            // 整组开关：统一设成目标值（可编辑成员并非全部开启 → 全开，否则全关）。
            // 只对可编辑成员发 RPC；整批只挂一次热刷新；逐项失败记进 ops，成功的继续。
            const applyBulkToggle = (rows, key) => {
                const editable = rows.filter(isEditableSkill);
                if (editable.length === 0)
                    return;
                const target = !editable.every((skill) => skill.enabled === true);
                const pending = editable.filter((skill) => (skill.enabled === true) !== target);
                if (pending.length === 0)
                    return;
                setBulkGroup(key);
                Promise.all(pending.map((skill) => runSetEnabled(skill, target))).then((results) => {
                    setBulkGroup(null);
                    if (results.some((ok) => ok === true))
                        reloadAfterHot();
                });
            };
            const applyActiveToggle = () => applyBulkToggle(activeSkills, bulkKey);
            // 编辑器的组成员（按分组 id + 作用域取该作用域下的名字）。
            const membersOfGroupById = (groupId, scopeKey) => {
                if (groupId === null || groupId === undefined)
                    return [];
                const group = (Array.isArray(groupsList) ? groupsList : []).find((item) => item.id === groupId);
                return group !== undefined && Array.isArray(group.scopes[scopeKey]) ? group.scopes[scopeKey] : [];
            };
            const groupEditorSkills = groupEditor !== null ? skills.filter((skill) => scopeOf(skill) === groupEditor.scope) : [];
            const migratorSkills = migrator !== null ? skills.filter((skill) => scopeOf(skill) === migrator.from) : [];
            // 搜索过滤掉已展开项时自动收起。
            react.useEffect(() => {
                if (expanded !== null && !filtered.some((skill) => opKeyOf(skill) === expanded))
                    setExpanded(null);
            }, [expanded, filtered]);
            // 展开/收起：展开时懒加载内容并缓存。缓存键与操作键一致，按
            // （名称+作用域）区分——同名技能在不同作用域各有独立展开与正文。
            const toggle = (skill) => {
                const key = opKeyOf(skill);
                const next = expanded === key ? null : key;
                setExpanded(next);
                if (next === null || bodies[key] !== undefined || inflight.current.has(key))
                    return;
                inflight.current.add(key);
                setBodies((prev) => ({ ...prev, [key]: { status: "loading" } }));
                Promise.resolve().then(() => loadContent(skill.name, scopeOf(skill))).then((skillBody) => {
                    inflight.current.delete(key);
                    setBodies((prev) => ({ ...prev, [key]: { status: skillBody === null ? "missing" : "ready", skill: skillBody } }));
                }, () => {
                    inflight.current.delete(key);
                    setBodies((prev) => ({ ...prev, [key]: { status: "error" } }));
                });
            };
            // ── 三栏外壳：左轨（工作区）/ 中栏（分组·来源）/ 主区 ────────────────
            // 加载态与错误态只占主区：外壳不闪、切页签回来也不用重新认路。
            // 简洁模式的工作区选择器：折叠式下拉表单。
            // 自带定位（wrap 用 relative + 菜单 absolute），不依赖宿主 Menu 的 portal/锚点测量——
            // 用宿主 Menu 时菜单会跑到页面最右侧（截图复现，2026-10-19）。
            // 打开时铺一层透明遮罩接住外部点击，菜单最多 11 行、超出在自身滚动。
            const compactWorkspacePicker = (0, react_jsx_runtime.jsxs)("div", {
                className: c.scopeMenuWrap,
                children: [(0, react_jsx_runtime.jsxs)("button", {
                        type: "button",
                        className: c.scopeSelect,
                        "aria-haspopup": "menu",
                        "aria-expanded": scopeMenuOpen,
                        onClick: () => {
                            setScopeMenuOpen((value) => !value);
                        },
                        children: [(0, react_jsx_runtime.jsx)("span", {
                                className: c.scopeSelectLabel,
                                children: scopeFilter === "global" ? t("scopeGlobal") : labelOf(scopeFilter)
                            }), (0, react_jsx_runtime.jsx)(primitiveIcon("IconChevronDownOutlineRegular"), {
                                size: 14,
                                className: c.scopeSelectChevron
                            })]
                    }), scopeMenuOpen ? (0, react_jsx_runtime.jsx)("div", {
                        className: c.scopeMenuOverlay,
                        "aria-hidden": "true",
                        onClick: () => {
                            setScopeMenuOpen(false);
                        }
                    }) : null, scopeMenuOpen ? (0, react_jsx_runtime.jsx)("div", {
                        className: c.scopeMenu,
                        role: "menu",
                        "aria-label": t("railWorkspaces"),
                        children: railEntries.map((entry) => (0, react_jsx_runtime.jsxs)("button", {
                            type: "button",
                            key: entry.key,
                            role: "menuitemradio",
                            "aria-checked": scopeFilter === entry.key,
                            className: c.scopeMenuItem,
                            "data-active": scopeFilter === entry.key ? "true" : void 0,
                            title: entry.label,
                            onClick: () => {
                                setScopeFilter(entry.key);
                                setScopeMenuOpen(false);
                            },
                            children: [(0, react_jsx_runtime.jsx)("span", {
                                    className: c.scopeMenuItemLabel,
                                    children: entry.label
                                }), (0, react_jsx_runtime.jsx)("span", {
                                    className: c.scopeMenuItemCount,
                                    children: String(entry.count)
                                }), scopeFilter === entry.key ? (0, react_jsx_runtime.jsx)("span", {
                                    className: c.scopeMenuItemCheck,
                                    children: hostIcon(primitiveIcon("IconCheckOutlineRegular"), 14, ICON_PATHS.check)
                                }) : null]
                        }, entry.key))
                    }) : null]
            });
            const mainColumnBody = (0, react_jsx_runtime.jsx)("div", {
                className: c.mainScroll,
                children: listState.status === "loading" ? (0, react_jsx_runtime.jsx)("p", {
                    className: c.status,
                    children: t("loading")
                }) : listState.status === "error" ? (0, react_jsx_runtime.jsxs)("div", {
                    className: c.failure,
                    children: [(0, react_jsx_runtime.jsx)("p", {
                            role: "alert",
                            children: t("error")
                        }), (0, react_jsx_runtime.jsx)("button", {
                            type: "button",
                            onClick: refresh,
                            children: t("retry")
                        })]
                }) : (0, react_jsx_runtime.jsxs)("div", {
                    className: c.catalog,
                    children: [
                        dragActive ? (0, react_jsx_runtime.jsx)("div", {
                            className: c.dropHint,
                            children: t("addDragHint")
                        }) : null,
                        updateBanner !== null ? (0, react_jsx_runtime.jsxs)("div", {
                            className: c.notice,
                            "data-kind": "info",
                            role: "status",
                            children: [(0, react_jsx_runtime.jsx)("span", {
                                    className: c.noticeText,
                                    children: updateBanner
                                }), (0, react_jsx_runtime.jsx)("button", {
                                    type: "button",
                                    className: c.noticeButton,
                                    onClick: () => {
                                        setUpdateBanner(null);
                                    },
                                    children: t("addDismiss")
                                })]
                        }) : null,
                        // 「打开目录」等外壳动作的回显（剪贴板写不进去时把路径摊开给用户手抄）。
                        shellNotice !== null ? (0, react_jsx_runtime.jsxs)("div", {
                            className: c.notice,
                            "data-kind": shellNotice.kind === "error" ? "error" : "info",
                            role: shellNotice.kind === "error" ? "alert" : "status",
                            children: [(0, react_jsx_runtime.jsx)("span", {
                                    className: c.noticeText,
                                    children: shellNotice.text
                                }), (0, react_jsx_runtime.jsx)("button", {
                                    type: "button",
                                    className: c.noticeButton,
                                    onClick: () => {
                                        setShellNotice(null);
                                    },
                                    children: t("addDismiss")
                                })]
                        }) : null,
                        (0, react_jsx_runtime.jsxs)("div", {
                            className: c.searchBox,
                            children: [(0, react_jsx_runtime.jsx)("span", {
                                    className: c.searchIcon,
                                    "aria-hidden": "true",
                                    children: (0, react_jsx_runtime.jsx)(primitiveIcon("IconSearchOutlineRegular"), {})
                                }), (0, react_jsx_runtime.jsx)("input", {
                                    type: "search",
                                    className: c.searchField,
                                    value: query,
                                    placeholder: t("search"),
                                    "aria-label": t("search"),
                                    onChange: (event) => {
                                        setQuery(event.currentTarget.value);
                                    }
                                })]
                        }),
                        (0, react_jsx_runtime.jsxs)("div", {
                            className: c.toolRow,
                            children: [(0, react_jsx_runtime.jsxs)("h3", {
                                    children: [t("catalog"), (0, react_jsx_runtime.jsx)("span", {
                                            "data-skill-count": filtered.length,
                                            children: filtered.length
                                        })]
                                }), (0, react_jsx_runtime.jsxs)("span", {
                                    className: c.toolButtons,
                                    children: [(0, react_jsx_runtime.jsx)("button", {
                                            type: "button",
                                            className: c.toolButton,
                                            "aria-label": t("toolbarOpenFolder"),
                                            onClick: openSkillFolder,
                                            children: hostIcon(primitiveIcon("IconFolderOpenOutlineRegular"), 15, ICON_PATHS.folder)
                                        }), (0, react_jsx_runtime.jsx)("button", {
                                            type: "button",
                                            className: c.toolButton,
                                            "data-active": batchMode ? "true" : void 0,
                                            "aria-label": t("migrateButton"),
                                            "aria-pressed": batchMode,
                                            disabled: listState.status !== "ready" || skills.length === 0,
                                            onClick: () => {
                                                if (batchMode)
                                                    exitBatch();
                                                else
                                                    setBatchMode(true);
                                            },
                                            children: hostIcon(primitiveIcon("IconCopyOutlineRegular"), 15, ICON_PATHS.migrate)
                                        }), (0, react_jsx_runtime.jsx)("button", {
                                            type: "button",
                                            className: c.toolButton,
                                            "aria-label": t("toolbarNewGroup"),
                                            disabled: listState.status !== "ready" || skills.length === 0,
                                            onClick: openGroupEditor,
                                            children: hostIcon(primitiveIcon("IconProjectAddOutlineRegular"), 15, ICON_PATHS.group)
                                        }), (0, react_jsx_runtime.jsxs)("span", {
                                            className: c.addMenuWrap,
                                            children: [(0, react_jsx_runtime.jsx)("button", {
                                                    type: "button",
                                                    className: c.toolButton,
                                                    "aria-label": t("addButton"),
                                                    "aria-expanded": addMenuOpen,
                                                    disabled: adding.status === "busy",
                                                    onClick: () => { setAddMenuOpen((value) => !value); },
                                                    children: hostIcon(primitiveIcon("IconPlusOutlineRegular"), 15, ICON_PATHS.plus)
                                                }), addMenuOpen ? (0, react_jsx_runtime.jsxs)("div", {
                                                    className: c.addMenu,
                                                    children: [(0, react_jsx_runtime.jsx)("p", {
                                                            className: c.addMenuTitle,
                                                            children: t("addTarget") + (scopeFilter === "global" ? t("scopeGlobal") : labelOf(scopeFilter))
                                                        }), (0, react_jsx_runtime.jsx)("button", {
                                                            type: "button",
                                                            className: c.addMenuButton,
                                                            onClick: () => { singleFileInput.current?.click(); },
                                                            children: t("addSingle")
                                                        }), (0, react_jsx_runtime.jsx)("button", {
                                                            type: "button",
                                                            className: c.addMenuButton,
                                                            onClick: () => { pickFolderOrZip(); },
                                                            children: t("addFolderZip")
                                                        })]
                                                }) : null]
                                        }), (0, react_jsx_runtime.jsx)("button", {
                                            type: "button",
                                            className: c.toolButton,
                                            "data-layout-toggle": "true",
                                            "data-active": layoutCompact ? "true" : void 0,
                                            "aria-pressed": layoutCompact,
                                            "aria-label": layoutCompact ? t("layoutToThree") : t("layoutToCompact"),
                                            onClick: toggleLayout,
                                            children: hostIcon(primitiveIcon("IconSettingsOutlineRegular"), 15, ICON_PATHS.layout)
                                        })]
                                })]
                        }),
                        // ── 简洁模式（Issue #50）────────────────────────────────────────────
                        // 照旧版（v2.1.x）的两条横栏来：工作区是**折叠式下拉表单**（宿主 Menu，超 11 项滚动），
                        // 分组是横排 chip。两者与三栏共用同一份筛选状态，切回三栏不会丢选择。
                        layoutCompact ? (0, react_jsx_runtime.jsx)("div", {
                            className: c.filterBar,
                            children: [compactWorkspacePicker, paneRows.length > 1 ? (0, react_jsx_runtime.jsx)("div", {
                                    className: c.groupBar,
                                    role: "group",
                                    "aria-label": t("paneGroups"),
                                    children: paneRows.map((row) => (0, react_jsx_runtime.jsxs)("button", {
                                        type: "button",
                                        className: c.groupItem,
                                        "data-active": activePaneKey === row.key ? "true" : void 0,
                                        "aria-pressed": activePaneKey === row.key,
                                        title: row.label,
                                        onClick: () => {
                                            selectPaneRow(row.key);
                                        },
                                        children: [row.label, (0, react_jsx_runtime.jsx)("span", {
                                                className: c.groupItemCount,
                                                children: String(row.count)
                                            })]
                                    }, "grp:" + row.key))
                                }) : null]
                        }) : null,
                        adding.status === "busy" ? (0, react_jsx_runtime.jsx)("p", {
                            className: c.addStatus,
                            children: t("addBusy")
                        }) : null,
                        adding.status === "ok" ? (0, react_jsx_runtime.jsxs)("div", {
                            className: c.notice,
                            "data-kind": "info",
                            role: "status",
                            children: [(0, react_jsx_runtime.jsx)("span", {
                                    className: c.noticeText,
                                    children: adding.message
                                }), (0, react_jsx_runtime.jsx)("button", {
                                    type: "button",
                                    className: c.noticeButton,
                                    onClick: () => {
                                        setAdding({ status: "idle" });
                                    },
                                    children: t("addDismiss")
                                })]
                        }) : null,
                        adding.status === "error" ? (0, react_jsx_runtime.jsxs)("div", {
                            className: c.notice,
                            "data-kind": "error",
                            role: "alert",
                            children: [(0, react_jsx_runtime.jsx)("span", {
                                    className: c.noticeText,
                                    children: adding.message
                                }), (0, react_jsx_runtime.jsx)("button", {
                                    type: "button",
                                    className: c.noticeButton,
                                    onClick: () => {
                                        setAdding({ status: "idle" });
                                    },
                                    children: t("addDismiss")
                                })]
                        }) : null,
                        // 技能列表不再依赖「是否打开了会话」——没有会话时服务端回退全局注册表。
                        // 一个技能都没有时用居中的空态（设计稿文案）；其余空态仍逐条区分原因。
                        skills.length === 0 ? (0, react_jsx_runtime.jsx)("p", {
                            className: c.empty,
                            children: t("emptyList")
                        }) : null,
                        skills.length > 0 && scoped.length === 0 && hiddenPluginCount > 0 ? (0, react_jsx_runtime.jsx)("p", {
                            className: c.status,
                            children: t("pluginSkillsHidden").replace("{count}", String(hiddenPluginCount))
                        }) : null,
                        skills.length > 0 && scoped.length === 0 ? (0, react_jsx_runtime.jsx)("p", {
                            className: c.status,
                            children: t("emptyScope")
                        }) : null,
                        scoped.length > 0 && activeList.length === 0 ? (0, react_jsx_runtime.jsx)("p", {
                            className: c.status,
                            children: paneMode === "provider" ? t("emptyProvider") : t("groupEmpty")
                        }) : null,
                        activeList.length > 0 && filtered.length === 0 ? (0, react_jsx_runtime.jsx)("p", {
                            className: c.status,
                            children: t("emptySearch")
                        }) : null,
                        scopedAll.length > 0 ? (0, react_jsx_runtime.jsxs)("div", {
                            className: c.groupBulkRow,
                            children: [activeSkills.length > 0 && filtered.length > 0 ? (0, react_jsx_runtime.jsx)("button", {
                                    type: "button",
                                    className: c.groupBulkBtn,
                                    disabled: activeCounts.editable === 0 || bulkGroup === bulkKey,
                                    title: activeCounts.editable === 0 ? t("groupBulkBlocked") : undefined,
                                    onClick: applyActiveToggle,
                                    children: (activeCounts.editable > 0 && activeCounts.on === activeCounts.total ? t("groupBulkOff") : t("groupBulkOn")) + " · " + activeCounts.on + "/" + activeCounts.total
                                }) : null, (0, react_jsx_runtime.jsxs)("label", {
                                    className: c.pluginToggle,
                                    title: t("pluginSkillsToggleHint"),
                                    children: [(0, react_jsx_runtime.jsx)("input", {
                                            type: "checkbox",
                                            checked: showPluginSkills,
                                            onChange: (event) => toggleShowPluginSkills(event.target.checked)
                                        }), (0, react_jsx_runtime.jsx)("span", { children: t("pluginSkillsToggle") })]
                                })]
                        }) : null,
                        filtered.length > 0 ? (0, react_jsx_runtime.jsx)("ul", {
                            className: c.cards,
                            children: querying ? filtered.map(renderCard) : [...treeRoot.folders.values()].map(renderFolder).concat(treeRoot.skills.map(renderCard))
                        }) : null,
                        (0, react_jsx_runtime.jsx)("input", {
                            ref: singleFileInput,
                            className: c.fileInput,
                            type: "file",
                            accept: ".md,text/markdown",
                            multiple: true,
                            onChange: pickSingleFiles
                        }), (0, react_jsx_runtime.jsx)("input", {
                            ref: zipFileInput,
                            className: c.fileInput,
                            type: "file",
                            accept: ".zip,application/zip,application/x-zip-compressed",
                            multiple: true,
                            onChange: pickZipFiles
                        }),
                        groupEditor !== null ? (0, react_jsx_runtime.jsx)(GroupDialog, {
                            t,
                            options: wsOptions,
                            groups: groupsList,
                            groupId: groupEditor.groupId,
                            setGroupId: (value, presetName) => {
                                setGroupEditor((prev) => (prev === null ? prev : { ...prev, groupId: value, name: value === null ? "" : presetName, selected: new Set(membersOfGroupById(value, prev.scope)), error: null }));
                            },
                            name: groupEditor.name,
                            setName: (value) => {
                                setGroupEditor((prev) => (prev === null ? prev : { ...prev, name: value, error: null }));
                            },
                            scope: groupEditor.scope,
                            setScope: (value) => {
                                setGroupEditor((prev) => (prev === null ? prev : { ...prev, scope: value, selected: new Set(membersOfGroupById(prev.groupId, value)), error: null }));
                            },
                            skills: groupEditorSkills,
                            selected: groupEditor.selected,
                            toggle: (skillName) => {
                                setGroupEditor((prev) => {
                                    if (prev === null)
                                        return prev;
                                    const next = new Set(prev.selected);
                                    if (next.has(skillName))
                                        next.delete(skillName);
                                    else
                                        next.add(skillName);
                                    return { ...prev, selected: next };
                                });
                            },
                            selectAll: () => {
                                setGroupEditor((prev) => {
                                    if (prev === null)
                                        return prev;
                                    const all = new Set(groupEditorSkills.map((skill) => skill.name));
                                    return { ...prev, selected: prev.selected.size === all.size ? new Set() : all };
                                });
                            },
                            busy: groupEditor.busy,
                            error: groupEditor.error,
                            onSave: applyGroupSave,
                            onDelete: applyGroupDelete,
                            onCancel: () => {
                                setGroupEditor(null);
                            }
                        }) : null,
                        migrator !== null ? (0, react_jsx_runtime.jsx)(MigrateDialog, {
                            t,
                            options: wsOptions,
                            from: migrator.from,
                            setFrom: (value) => {
                                // 换源工作区时清空已选项：选择是按（源作用域, 技能名）算的，
                                // 留着上一份名单会把不属于该作用域的名字发出去。
                                setMigrator((prev) => (prev === null ? prev : { ...prev, from: value, selected: prev.from === value ? prev.selected : new Set(), error: null }));
                            },
                            targets: migrator.targets,
                            toggleTarget: (value) => {
                                setMigrator((prev) => {
                                    if (prev === null)
                                        return prev;
                                    const next = new Set(prev.targets);
                                    if (next.has(value))
                                        next.delete(value);
                                    else
                                        next.add(value);
                                    return { ...prev, targets: next, error: null, ...(next.size > 1 && prev.mode === "move" ? { mode: "copy" } : {}) };
                                });
                            },
                            mode: migrator.mode,
                            setMode: (value) => {
                                setMigrator((prev) => (prev === null ? prev : { ...prev, mode: value }));
                            },
                            skills: migratorSkills,
                            selected: migrator.selected,
                            toggle: (skillName) => {
                                setMigrator((prev) => {
                                    if (prev === null)
                                        return prev;
                                    const next = new Set(prev.selected);
                                    if (next.has(skillName))
                                        next.delete(skillName);
                                    else
                                        next.add(skillName);
                                    return { ...prev, selected: next };
                                });
                            },
                            selectAll: () => {
                                setMigrator((prev) => {
                                    if (prev === null)
                                        return prev;
                                    const all = new Set(migratorSkills.map((skill) => skill.name));
                                    return { ...prev, selected: prev.selected.size === all.size ? new Set() : all };
                                });
                            },
                            busy: migrator.busy,
                            result: migrator.result,
                            error: migrator.error,
                            onConfirm: applyBatchMigrate,
                            onCancel: () => {
                                setMigrator(null);
                            },
                            onClose: () => {
                                setMigrator(null);
                            }
                        }) : null
                    ]
                })
            });
            // ── 左轨：工作区列表 + 跟随选中项滑动的发光竖条 ──────────────────
            // 竖条位置优先用 DOM 实测（见上面的 effect），点选时立即按被点元素校正一次，
            // 这样连续点选不会等一次渲染。
            const railNode = (0, react_jsx_runtime.jsxs)("nav", {
                className: c.rail,
                "aria-label": t("railWorkspaces"),
                children: [(0, react_jsx_runtime.jsx)("div", {
                        className: c.railHead,
                        children: t("railWorkspaces")
                    }), (0, react_jsx_runtime.jsxs)("div", {
                        className: c.railList,
                        ref: railListRef,
                        children: [(0, react_jsx_runtime.jsx)("i", {
                                className: c.railBar,
                                "aria-hidden": "true",
                                style: { transform: "translateY(" + railBarY + "px)" }
                            }), ...railEntries.map((entry) => (0, react_jsx_runtime.jsxs)("button", {
                                type: "button",
                                className: c.railItem,
                                "data-active": scopeFilter === entry.key ? "true" : void 0,
                                "aria-pressed": scopeFilter === entry.key,
                                title: entry.label,
                                onClick: (event) => {
                                    const node = event.currentTarget;
                                    if (node !== null && typeof node.offsetTop === "number")
                                        setRailBarY(node.offsetTop + ((node.offsetHeight || 34) - 18) / 2);
                                    setScopeFilter(entry.key);
                                },
                                children: [(0, react_jsx_runtime.jsx)("span", {
                                        className: c.railItemName,
                                        children: entry.label
                                    }), (0, react_jsx_runtime.jsx)("small", {
                                        className: c.railItemCount,
                                        children: String(entry.count)
                                    })]
                            }, entry.key))]
                    })]
            });
            // ── 中栏：分组 / 来源 + 内联新建分组 ──────────────────────────────
            const paneNode = (0, react_jsx_runtime.jsxs)("aside", {
                className: c.pane,
                "aria-label": paneMode === "provider" ? t("paneSources") : t("paneGroups"),
                children: [(0, react_jsx_runtime.jsxs)("div", {
                        className: c.paneHead,
                        children: [(0, react_jsx_runtime.jsx)("h3", {
                                className: c.paneTitle,
                                title: countOfScope(scopeFilter),
                                children: countOfScope(scopeFilter)
                            }), (0, react_jsx_runtime.jsxs)("span", {
                                className: c.paneModes,
                                children: [(0, react_jsx_runtime.jsx)("button", {
                                        type: "button",
                                        className: c.paneMode,
                                        "data-active": paneMode === "groups" ? "true" : void 0,
                                        "aria-pressed": paneMode === "groups",
                                        onClick: () => {
                                            setPaneMode("groups");
                                        },
                                        children: t("paneGroups")
                                    }), (0, react_jsx_runtime.jsx)("button", {
                                        type: "button",
                                        className: c.paneMode,
                                        "data-active": paneMode === "provider" ? "true" : void 0,
                                        "aria-pressed": paneMode === "provider",
                                        onClick: () => {
                                            setPaneMode("provider");
                                        },
                                        children: t("paneSources")
                                    })]
                            })]
                    }), (0, react_jsx_runtime.jsx)("div", {
                        className: c.paneList,
                        children: paneRows.map((row) => (0, react_jsx_runtime.jsxs)("button", {
                            type: "button",
                            className: c.paneItem,
                            "data-active": activePaneKey === row.key ? "true" : void 0,
                            "aria-pressed": activePaneKey === row.key,
                            onClick: () => {
                                selectPaneRow(row.key);
                            },
                            children: [(0, react_jsx_runtime.jsx)("span", {
                                    className: c.paneItemName,
                                    children: row.label
                                }), (0, react_jsx_runtime.jsx)("span", {
                                    className: c.paneItemCount,
                                    children: String(row.count)
                                })]
                        }, paneMode + "\u0000" + row.key))
                    }), paneMode === "groups" ? (inlineGroup !== null ? (0, react_jsx_runtime.jsx)("div", {
                        className: c.paneNewForm,
                        children: (0, react_jsx_runtime.jsx)("input", {
                            className: c.paneNewInput,
                            value: inlineGroup.value,
                            placeholder: t("groupName"),
                            "aria-label": t("groupName"),
                            disabled: inlineBusy,
                            autoFocus: true,
                            onChange: (event) => {
                                setInlineGroup({ value: event.currentTarget.value });
                            },
                            onKeyDown: (event) => {
                                if (event.key === "Enter")
                                    submitInlineGroup();
                                else if (event.key === "Escape")
                                    setInlineGroup(null);
                            },
                            onBlur: () => {
                                // 失焦即收起：与设计稿一致；保存中不打断，避免输入框先消失。
                                if (!inlineBusy)
                                    setInlineGroup(null);
                            }
                        })
                    }) : (0, react_jsx_runtime.jsx)("button", {
                        type: "button",
                        className: c.paneNew,
                        onClick: () => {
                            setInlineGroup({ value: "" });
                        },
                        children: ["＋ ", t("groupNew")]
                    })) : null]
            });
            // ── 主区：滚动区 + 底部居中批量栏 + 顶部居中 Toast ─────────────────
            const batchBar = (0, react_jsx_runtime.jsxs)("div", {
                className: c.batchBar,
                role: "region",
                "aria-label": t("batchSelected").replace("{count}", String(selected.size)),
                children: [(0, react_jsx_runtime.jsx)("span", {
                        className: c.batchCount,
                        children: t("batchSelected").replace("{count}", String(selected.size))
                    }), (0, react_jsx_runtime.jsx)(primitives.Menu, {
                        open: batchMenuOpen,
                        onClose: () => {
                            setBatchMenuOpen(false);
                        },
                        items: [...targetWorkspaces, { id: BATCH_ADVANCED, label: t("batchAdvanced") }],
                        onSelect: (key) => {
                            setBatchMenuOpen(false);
                            if (key === BATCH_ADVANCED) {
                                const carry = new Set(selected);
                                exitBatch();
                                openMigrator({ from: scopeFilter, selected: carry });
                                return;
                            }
                            runQuickMigrate(key);
                        },
                        align: "end",
                        portal: true,
                        anchor: (0, react_jsx_runtime.jsx)("button", {
                            type: "button",
                            className: c.batchBtn + " " + c.batchGo,
                            "aria-haspopup": "menu",
                            "aria-expanded": batchMenuOpen,
                            disabled: selected.size === 0,
                            onClick: () => {
                                setBatchMenuOpen((value) => !value);
                            },
                            children: t("batchMigrateTo")
                        })
                    }), (0, react_jsx_runtime.jsx)("button", {
                        type: "button",
                        className: c.batchBtn,
                        onClick: exitBatch,
                        children: t("migrateCancel")
                    })]
            });
            const toastNode = (0, react_jsx_runtime.jsxs)("div", {
                className: c.toast,
                "data-show": toast !== null ? "true" : "false",
                role: "status",
                "aria-live": "polite",
                children: [toast !== null ? (0, react_jsx_runtime.jsx)("span", {
                        className: c.toastText,
                        children: toast.text
                    }) : null, toast !== null && toast.action !== null && toast.action !== undefined ? (0, react_jsx_runtime.jsx)("button", {
                        type: "button",
                        className: c.toastAction,
                        onClick: () => {
                            const action = toast.action;
                            dismissToast();
                            if (action !== null && action !== undefined)
                                action.run();
                        },
                        children: toast.action.label
                    }) : null]
            });
            return (0, react_jsx_runtime.jsx)("div", {
                className: c.section,
                "aria-busy": listState.status === "loading",
                "data-batch": batchMode ? "true" : void 0,
                "data-dragging": dragActive ? "true" : void 0,
                "data-layout": layoutCompact ? "compact" : "three",
                onDragOver: onDragOver,
                onDragLeave: onDragLeave,
                onDrop: onDrop,
                children: [layoutCompact ? null : railNode, layoutCompact ? null : paneNode, (0, react_jsx_runtime.jsxs)("div", {
                        className: c.mainCol,
                        children: [mainColumnBody, batchBar, toastNode]
                    })]
            });
        }
        // ── MCP 面板：字典 / 样式 / 表单 / 卡片 ────────────────────────────
        const MCP_NS = "settings.mcp";
        const mcpZh = {
            nav: "MCP",
            back: "返回会话",
            title: "MCP 服务器",
            subtitle: "在 profile cordis.patch.yml 的受管块中维护 MCP 服务器，保存后由 DSH HMR 热加载。",
            docButton: "注册机制",
            docTitle: "DSH 的 MCP 注册机制",
            docLead: "DSH 的 MCP 能力来自官方插件 @deepseek-ai/dsh-mcp-client：它读的不是单独的 MCP 配置文件，而是所在 profile 的 cordis.patch.yml 里的一条 loader entry ——",
            docWhere: "本面板就是那条 entry 的可视化编辑器：受管 entry 写在 BEGIN / END 两条标记之间，块外内容逐字节保留；保存即写文件，DSH 的 loader 监听到变化后热加载，不需要重启。",
            docTools: "注册成功后，工具在模型侧叫 mcp__<serverName>__<原工具名>；serverName 只能 1-32 位字母、数字、下划线或连字符。",
            docEnv: "环境变量：DSH 的配置层没有 ${VAR} 字符串插值，唯一的机制是 YAML 的 !!js 表达式（宿主装载时求值）。所以这里直接写 ${NAME} 就行，保存时自动格式化成 !!js 模板：",
            docEnvCode: "Authorization=Bearer ${MCP_TOKEN}\n        ↓ 保存后写入 cordis.patch.yml\nAuthorization: !!js '`Bearer ${process.env.MCP_TOKEN}`'",
            docEnvNote: "变量来自 DSH 进程自己的环境：放 ~/.dsh/.env（桌面端读这一份）或启动环境里都行，改完要重启 DSH。stdio 子进程不会继承名字带 KEY / PASSWORD / SECRET / TOKEN 的环境变量，所以要显式写进 env。",
            docSecret: "env / headers 的值只写不读：页面与 RPC 都只回传键名，编辑时对应键留空即保持原值；也可以用 !!js 前缀直接写任意 JS 表达式。",
            docCode: "- id: panel-mcp-github\n  name: '@deepseek-ai/dsh-mcp-client'\n  config:\n    serverName: github\n    transport: stdio\n    command: npx\n    args: ['-y', '@modelcontextprotocol/server-github']\n    env:\n      GITHUB_TOKEN: !!js '`${process.env.GITHUB_TOKEN}`'",
            add: "+ 添加服务器",
            refresh: "刷新",
            empty: "还没有 MCP 服务器。",
            loading: "正在读取 MCP 服务器…",
            loadError: "暂时无法读取 MCP 服务器。",
            retry: "重试",
            newTitle: "添加 MCP 服务器",
            editTitle: "编辑 MCP 服务器",
            save: "保存",
            cancel: "取消",
            close: "关闭",
            test: "测试连接",
            testing: "测试中…",
            testOk: "连接成功，发现 {count} 个工具：",
            testFailed: "连接失败：",
            enable: "启用",
            disable: "停用",
            stateEnabled: "已启用",
            stateDisabled: "已停用",
            delete: "删除",
            confirmDelete: "确认删除？",
            external: "外部管理",
            orphan: "受管块外",
            orphanHint: "该行的 id 属于面板（panel-mcp-*），但不在 begin/end 受管块内，面板只改写受管块，所以这里只读。把这些 MCP 行用 begin/end 标记包住即可在这里启停。",
            patchBroken: "cordis.patch.yml 不可用：",
            reconciled: "已写入，等待 HMR 生效…",
            reconcileTimeout: "配置已写入，但 HMR 确认超时，请稍后刷新。",
            fieldServerName: "名称",
            nameHint: "只能包含字母、数字、下划线或连字符，1-32 位（不支持空格、点、中文）",
            nameRequired: "请填写名称",
            fieldTransport: "调用方式",
            transportStdio: "STDIO",
            transportHttp: "HTTP",
            fieldCommand: "命令",
            fieldArgs: "参数（每行一个）",
            fieldEnv: "环境变量（每行 键=值；已配置的键留空保持不变）",
            fieldCwd: "工作目录（留空使用默认）",
            fieldUrl: "服务器地址",
            fieldHeaders: "请求头（每行 键=值；已配置的键留空保持不变）",
            phCommand: "npx",
            phArgs: "-y\n@modelcontextprotocol/server-github",
            phEnv: "GITHUB_TOKEN=${GITHUB_TOKEN}",
            phCwd: "C:/projects/my-mcp-server",
            phUrl: "https://example.com/mcp",
            phHeaders: "Authorization=Bearer ${MCP_TOKEN}",
            hintJs: "值里写 ${NAME} 即读取环境变量 NAME（DSH 只认 !!js 表达式，面板自动格式化成 !!js '`${process.env.NAME}`'）；也可以用 !!js 前缀直接写任意 JS 表达式",
            fieldTimeout: "单次调用超时",
            fieldFailOnStartup: "启动失败时报错",
            fieldReconnect: "自动重连",
            fieldInitialDelay: "首次重连延迟",
            fieldMaxDelay: "最大重连延迟",
            fieldMaxAttempts: "最大重连次数",
            configuredKeys: "已配置的密钥：",
            deleteSecret: "删除",
            stateActive: "运行中",
            stateLoading: "加载中",
            statePending: "等待中",
            stateFailed: "启动失败",
            stateStopped: "已停用",
            stateUnknown: "未知",
            toolCount: "{count} 个工具",
            advanced: "高级设置",
            currentVersion: "dsh-skill-mcp-panel",
            checkUpdateAvailable: "发现新版本 v",
            checkUpdateCurrent: "（当前 v",
            checkUpdateHint: "）。可在终端运行 dsh-panel update 更新",
            // #46：受管块里的外来行可见化（面板永不改写它们，但必须让用户看见）
            foreignOthers: "受管块内还有 {count} 条不属于面板的行（{list}），面板不会改动它们。",
            foreignMine: "另有 {count} 条面板行被放在外来 insert 列表里（{list}），面板暂不管理它们。",
            foreignEvacuate: "移出受管块",
            foreignEvacuating: "正在移出…",
            foreignEvacuated: "已把 {count} 条外来行移到受管块外。",
            foreignEvacuateNone: "块内已经没有外来行了。",
            foreignEvacuateFailed: "移出失败：",
            foreignDoc: "查看机制",
            foreignDocTitle: "受管块与「外来行」",
            foreignDocWhat: "面板在 profile 的 cordis.patch.yml 里用两行注释（begin / end）圈出自己管理的一段，每次保存只重写这一段，圈外的内容一个字节都不碰。",
            foreignDocWhy: "圈里可能出现不属于面板的行：DSH 自己的配置编辑器给某个插件首次写配置时会往文件末尾追加一行，而 end 注释正好是最后一行，序列化后这行就落在圈内了（例如「权限预设」的 permission 行）。",
            foreignDocEffect: "留在块里没有任何功能影响：DSH 是整份列表读取的，行的位置不改变语义。「移出受管块」只是把那条行原样搬到 begin 之前，内容一字不改，权限预设照常生效。",
            foreignDocKeep: "面板不会自动搬动它们：改写别人的行曾经把 dsh-market 的更新整体回滚（Issue #46），所以现在的规矩是「只碰 panel-mcp-*，其余原样保留，并且让你看得见」。",
            oauthLogin: "OAuth 登录",
            oauthRelogin: "重新登录",
            oauthWorking: "登录中…",
            oauthDisconnect: "断开登录",
            oauthHint: "用 OAuth 2.0 拿到令牌，写进这一行的 Authorization 头（重启后仍有效）",
            oauthDone: "登录成功，令牌已写入并热加载。",
            oauthDisconnected: "已断开：Authorization 头与本地令牌都清掉了。",
            oauthFailed: "登录失败。",
            oauthTimeout: "等待授权超时，请重新点一次登录。",
            fieldAuth: "认证",
            authNone: "无",
            authBearer: "Bearer 令牌",
            authOAuth: "OAuth 登录",
            authNoneHint: "不额外加认证头（有些内网服务器不需要）。",
            authBearerHint: "会写成 Authorization=Bearer <令牌>；令牌里可以写 ${ENV} 读取环境变量。",
            authOauthHint: "保存后在这一行的卡片上点「OAuth 登录」，由面板跑完授权并把令牌写进 Authorization。",
            phAuthToken: "eyJ… 或 ${MCP_TOKEN}",
            authBadge: "已认证",
            authBadgeHint: "这一行已经带 Authorization 头（OAuth 登录或手工填写）。",
            toolsButton: "工具",
            toolsButtonHint: "按工具名禁用（被禁的工具会从模型工具表里消失，真正省上下文）",
            toolsScopeHint: "这份禁用列表对所有会话生效；取消勾选 = 禁用该工具。",
            toolsLoading: "正在读取工具…",
            toolsEmpty: "这台服务器还没注册任何工具（可能没连上）。",
            toolsDisconnected: "服务器未连接：先启用它，工具清单才有内容。",
            toolsDisabledCount: "已禁用 {count} 个",
            toolsSave: "保存禁用列表",
            toolsSaving: "保存中…",
            toolsSaved: "已保存：{count} 个工具被禁用，当前 {applied} 个会话已生效。",
            authStdioHint: "stdio 服务器的令牌没有单独的认证项——写在这里的环境变量里（例如 GITHUB_TOKEN=…），stdio 子进程只继承这些显式变量。",
            foreignMore: "等"
        };
        const mcpEn = {
            nav: "MCP",
            back: "Back to session",
            title: "MCP Servers",
            subtitle: "MCP servers are maintained in the managed block of profile cordis.patch.yml and hot-applied by DSH HMR.",
            docButton: "How it works",
            docTitle: "How DSH registers MCP servers",
            docLead: "DSH's MCP support comes from the official @deepseek-ai/dsh-mcp-client plugin: it reads no separate MCP config file, only a loader entry inside the profile's cordis.patch.yml —",
            docWhere: "This panel is the visual editor for those entries. Managed entries live between the BEGIN / END markers and everything outside them is preserved byte for byte; saving writes the file, the DSH loader notices and hot-reloads — no restart.",
            docTools: "Once registered, the model sees tools as mcp__<serverName>__<original name>; serverName allows 1-32 letters, digits, underscore or hyphen.",
            docEnv: "Environment variables: the DSH config layer has no ${VAR} string interpolation — the only mechanism is a YAML !!js expression, evaluated by the host at load time. So just write ${NAME} here and the panel formats it for you:",
            docEnvCode: "Authorization=Bearer ${MCP_TOKEN}\n        ↓ written to cordis.patch.yml on save\nAuthorization: !!js '`Bearer ${process.env.MCP_TOKEN}`'",
            docEnvNote: "The value comes from the DSH process environment: ~/.dsh/.env (what the desktop app reads) or the launching environment; restart DSH after changing it. Stdio children never inherit names containing KEY / PASSWORD / SECRET / TOKEN, so pass those explicitly in env.",
            docSecret: "env / headers values are write-only: the UI and RPC only return key names, and leaving a configured key blank keeps its current value. A !!js prefix passes a raw JS expression.",
            docCode: "- id: panel-mcp-github\n  name: '@deepseek-ai/dsh-mcp-client'\n  config:\n    serverName: github\n    transport: stdio\n    command: npx\n    args: ['-y', '@modelcontextprotocol/server-github']\n    env:\n      GITHUB_TOKEN: !!js '`${process.env.GITHUB_TOKEN}`'",
            add: "+ Add server",
            refresh: "Refresh",
            empty: "No MCP servers yet.",
            loading: "Loading MCP servers…",
            loadError: "Unable to load MCP servers.",
            retry: "Retry",
            newTitle: "Add MCP server",
            editTitle: "Edit MCP server",
            save: "Save",
            cancel: "Cancel",
            close: "Close",
            test: "Test connection",
            testing: "Testing…",
            testOk: "Connected, {count} tools found:",
            testFailed: "Connection failed:",
            enable: "Enable",
            disable: "Disable",
            stateEnabled: "Enabled",
            stateDisabled: "Disabled",
            delete: "Delete",
            confirmDelete: "Confirm delete?",
            external: "External",
            orphan: "Outside block",
            orphanHint: "This row carries a panel id (panel-mcp-*) but sits outside the managed block, and the panel only rewrites that block, so it stays read-only here. Wrap those MCP rows with the begin/end markers to manage it from this page.",
            patchBroken: "cordis.patch.yml is unavailable:",
            reconciled: "Written, waiting for HMR…",
            reconcileTimeout: "Config written, but HMR confirmation timed out. Refresh later.",
            fieldServerName: "serverName",
            nameHint: "Letters, digits, underscore or hyphen only, 1-32 characters (no spaces, dots or non-ASCII)",
            nameRequired: "Name is required",
            fieldTransport: "Transport",
            transportStdio: "STDIO",
            transportHttp: "HTTP",
            fieldCommand: "command",
            fieldArgs: "args (one per line)",
            fieldEnv: "env (KEY=VALUE per line; leave configured keys blank to keep them)",
            fieldCwd: "cwd (blank for default)",
            fieldUrl: "url",
            fieldHeaders: "headers (KEY=VALUE per line; leave configured keys blank to keep them)",
            phCommand: "npx",
            phArgs: "-y\n@modelcontextprotocol/server-github",
            phEnv: "GITHUB_TOKEN=${GITHUB_TOKEN}",
            phCwd: "C:/projects/my-mcp-server",
            phUrl: "https://example.com/mcp",
            phHeaders: "Authorization=Bearer ${MCP_TOKEN}",
            hintJs: "Write ${NAME} in a value to read the environment variable NAME (DSH only understands !!js expressions; the panel formats it as !!js '`${process.env.NAME}`'). A !!js prefix passes a raw JS expression.",
            fieldTimeout: "toolCallTimeoutMs",
            fieldFailOnStartup: "Fail on startup error",
            fieldReconnect: "Auto reconnect",
            fieldInitialDelay: "initialDelayMs",
            fieldMaxDelay: "maxDelayMs",
            fieldMaxAttempts: "maxAttempts",
            configuredKeys: "Configured secrets:",
            deleteSecret: "Delete",
            stateActive: "Running",
            stateLoading: "Loading",
            statePending: "Pending",
            stateFailed: "Startup failed",
            stateStopped: "Stopped",
            stateUnknown: "Unknown",
            toolCount: "{count} tools",
            advanced: "Advanced",
            currentVersion: "dsh-skill-mcp-panel",
            checkUpdateAvailable: "Update available: v",
            checkUpdateCurrent: " (current v",
            checkUpdateHint: "). Run dsh-panel update in a terminal to install it",
            // #46: surface foreign rows inside the managed block (never rewritten by the panel)
            foreignOthers: "{count} row(s) in the managed block do not belong to this panel ({list}); the panel leaves them untouched.",
            foreignMine: "{count} panel row(s) sit inside a foreign insert list ({list}); the panel does not manage them yet.",
            foreignEvacuate: "Move out of block",
            foreignEvacuating: "Moving…",
            foreignEvacuated: "Moved {count} foreign row(s) out of the managed block.",
            foreignEvacuateNone: "No foreign rows are left in the block.",
            foreignEvacuateFailed: "Move failed: ",
            foreignDoc: "How this works",
            foreignDocTitle: "The managed block and “foreign rows”",
            foreignDocWhat: "The panel fences off its own slice of the profile's cordis.patch.yml with two comment lines (begin / end) and only ever rewrites that slice; bytes outside the fence are never touched.",
            foreignDocWhy: "Rows that are not the panel's can end up inside the fence: when DSH's own config editor writes an entry for a plugin the first time, it appends to the YAML list, and since our end comment is the last line of the file the appended row is serialized before it (that is where the permission-presets row came from).",
            foreignDocEffect: "Leaving it inside changes nothing: DSH reads the whole list, so a row's position does not alter its meaning. “Move out of block” only copies that row verbatim to just before the begin marker — the permission presets keep working.",
            foreignDocKeep: "The panel never moves them automatically: rewriting someone else's rows once rolled back every dsh-market update (issue #46), so the rule is “only touch panel-mcp-*, keep everything else as-is, and show it to you”.",
            oauthLogin: "OAuth sign-in",
            oauthRelogin: "Sign in again",
            oauthWorking: "Signing in…",
            oauthDisconnect: "Disconnect",
            oauthHint: "Runs OAuth 2.0 and writes the token into this row's Authorization header (survives restarts).",
            oauthDone: "Signed in — the token is written and hot-loaded.",
            oauthDisconnected: "Disconnected: the Authorization header and the local token are gone.",
            oauthFailed: "Sign-in failed.",
            oauthTimeout: "Timed out waiting for authorization — click sign-in again.",
            fieldAuth: "Authentication",
            authNone: "None",
            authBearer: "Bearer token",
            authOAuth: "OAuth sign-in",
            authNoneHint: "Adds no auth header (some intranet servers need none).",
            authBearerHint: "Saved as Authorization=Bearer <token>; write ${ENV} inside the token to read an environment variable.",
            authOauthHint: "After saving, click “OAuth sign-in” on this server's card — the panel runs the flow and writes the token into Authorization.",
            phAuthToken: "eyJ… or ${MCP_TOKEN}",
            authBadge: "Authenticated",
            authBadgeHint: "This row already carries an Authorization header (OAuth or hand-written).",
            toolsButton: "Tools",
            toolsButtonHint: "Disable tools by name — a disabled tool disappears from the model's tool list and saves context",
            toolsScopeHint: "This list applies to every session; uncheck a tool to disable it.",
            toolsLoading: "Loading tools…",
            toolsEmpty: "This server has no registered tools yet (probably not connected).",
            toolsDisconnected: "Server not connected: enable it first so its tools appear.",
            toolsDisabledCount: "{count} disabled",
            toolsSave: "Save disabled list",
            toolsSaving: "Saving…",
            toolsSaved: "Saved: {count} tool(s) disabled; applied to {applied} session(s).",
            authStdioHint: "stdio servers have no separate auth field — put the token in the environment above (e.g. GITHUB_TOKEN=…); the child process only inherits what you list here.",
            foreignMore: "…"
        };
        const cssMcpEffects = "@keyframes skvFadeIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}@keyframes skvFadeOnly{from{opacity:0}to{opacity:1}}.MCP_card{transition:border-color .18s cubic-bezier(.22,.61,.36,1),box-shadow .18s ease}.MCP_card:hover{border-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-shadow-lv1)}.MCP_dot{transition:background-color .2s ease}.MCP_input,.MCP_textarea{transition:border-color .15s ease,box-shadow .15s ease}.MCP_transportBtn{transition:background-color .15s ease,border-color .15s ease,color .15s ease}.MCP_actionBtn,.MCP_dangerBtn,.MCP_iconBtn,.MCP_add,.MCP_advancedToggle{transition:background-color .15s ease,border-color .15s ease,transform .1s ease}.MCP_actionBtn:active:not(:disabled),.MCP_dangerBtn:active:not(:disabled),.MCP_iconBtn:active,.MCP_add:active{transform:scale(.96)}.MCP_actionBtn:focus-visible,.MCP_dangerBtn:focus-visible,.MCP_iconBtn:focus-visible,.MCP_add:focus-visible,.MCP_transportBtn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}.MCP_cards{animation:skvFadeOnly .2s ease}.MCP_result{animation:skvFadeIn .18s ease}@media (prefers-reduced-motion: reduce){.MCP_section *{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important}}.MCP_doc{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:8px;animation:skvFadeIn .18s ease}.MCP_doc h4{font-size:13px;font-weight:600;line-height:20px;margin:0}.MCP_doc p{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:19px}.MCP_docCode{margin:0;background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 10px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-primary);white-space:pre-wrap;word-break:break-all;overflow-x:auto}";
        const cssMcp = ".MCP_section{position:relative;width:100%;max-width:760px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:14px}.MCP_head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.MCP_head h3{font-size:14px;font-weight:600;line-height:20px;margin:0}.MCP_sub{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin:0}.MCP_toolbar{display:flex;align-items:center;gap:8px}.MCP_add{font:inherit;color:var(--dsw-alias-state-business-primary);cursor:pointer;background:0 0;border:1px dashed var(--dsw-alias-border-l1);border-radius:8px;padding:7px 16px;font-size:13px;line-height:20px;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box}.MCP_add:hover{background:var(--dsw-alias-interactive-bg-hover)}.MCP_cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.MCP_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:8px;min-width:0}.MCP_cardTop{display:flex;align-items:center;gap:8px;min-width:0}.MCP_name{font-size:13px;font-weight:600;line-height:20px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.MCP_badges{display:inline-flex;align-items:center;gap:6px;flex:none}.MCP_badge{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);border-radius:5px;padding:1px 6px;font-size:11px;line-height:16px}.MCP_meta{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}.MCP_dot{width:7px;height:7px;border-radius:999px;background:var(--dsw-alias-label-tertiary);flex:none}.MCP_dot[data-on=true]{background:var(--dsw-alias-state-success-primary)}.MCP_dot[data-err=true]{background:var(--dsw-alias-state-error-primary)}.MCP_actions{display:flex;align-items:center;gap:8px;border-top:1px solid var(--dsw-alias-border-l2);padding-top:8px;flex-wrap:wrap}.MCP_spacer{flex:1}.MCP_form{display:grid;grid-template-columns:1fr 1fr;gap:10px}.MCP_field{display:flex;flex-direction:column;gap:5px}.MCP_field[data-wide=true]{grid-column:1 / -1}.MCP_label{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);margin:0}.MCP_input{box-sizing:border-box;width:100%;height:32px;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:0 8px}.MCP_input:focus-visible,.MCP_textarea:focus-visible{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-business-primary) 18%, transparent);outline:none}.MCP_textarea{box-sizing:border-box;width:100%;min-height:64px;font:inherit;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 8px;resize:vertical}.MCP_transportRow{display:flex;gap:8px}.MCP_transportBtn{font:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:4px 14px}.MCP_transportBtn[data-active=true]{color:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent)}.MCP_secretKeys{display:flex;flex-wrap:wrap;gap:6px}.MCP_key{display:inline-flex;align-items:center;gap:6px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:2px 8px;font-size:11px;line-height:16px}.MCP_key button{font:inherit;color:var(--dsw-alias-state-error-primary);cursor:pointer;background:0 0;border:none;padding:0}.MCP_checkRow{display:flex;align-items:center;gap:8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}.MCP_result{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 10px;font-size:12px;line-height:18px;max-height:160px;overflow:auto}.MCP_actionBtn{font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;padding:0 12px;font-size:12px;line-height:26px;height:28px;display:inline-flex;align-items:center;justify-content:center;white-space:nowrap;box-sizing:border-box}.MCP_actionBtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid)}.MCP_actionBtn:disabled{cursor:default;opacity:.6}.MCP_dangerBtn{font:inherit;color:var(--dsw-alias-state-error-primary);cursor:pointer;background:0 0;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;padding:0 12px;font-size:12px;line-height:26px;height:28px;display:inline-flex;align-items:center;justify-content:center;white-space:nowrap;box-sizing:border-box}.MCP_dangerBtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid)}.MCP_iconBtn{width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:0;flex:none}.MCP_iconBtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.MCP_advancedToggle{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:1px dashed var(--dsw-alias-border-l1);border-radius:8px;padding:6px 12px;font-size:13px;line-height:20px}.MCP_advancedToggle:hover{background:var(--dsw-alias-interactive-bg-hover)}.MCP_result[data-ok=true]{border-color:color-mix(in srgb, var(--dsw-alias-state-success-primary) 40%, transparent);background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 8%, transparent)}.MCP_result[data-ok=false]{border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 40%, transparent);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent)}.MCP_hint{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);margin:0}.MCP_hint[data-error=true]{color:var(--dsw-alias-state-error-primary)}.MCP_authBox{display:flex;flex-direction:column;gap:6px}.MCP_toolsPanel{display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--dsw-alias-border-l2);padding-top:8px}.MCP_toolsList{display:flex;flex-direction:column;gap:2px;max-height:200px;overflow-y:auto;scrollbar-width:thin;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:4px 8px}.MCP_toolRow{display:flex;align-items:center;gap:8px;font-size:12px;line-height:18px;padding:3px 0;cursor:pointer;min-width:0}.MCP_toolRow input{margin:0;accent-color:var(--dsw-alias-state-business-primary);flex:none}.MCP_toolName{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Consolas,Menlo,monospace;font-size:11.5px}.MCP_toolsActions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}" + cssMcpEffects;
        const mcpTagId = "dsh-skill-mcp-panel/McpSection.module.css";
        if (typeof document !== "undefined") {
            let mcpTag = document.querySelector("style[data-plugin-css=" + JSON.stringify(mcpTagId) + "]");
            if (mcpTag === null) {
                mcpTag = document.createElement("style");
                mcpTag.dataset.plugin = "dsh-skill-mcp-panel";
                mcpTag.dataset.pluginCss = mcpTagId;
                document.head.appendChild(mcpTag);
            }
            mcpTag.textContent = cssMcp;
        }
        const m = {
            section: "MCP_section",
            head: "MCP_head",
            sub: "MCP_sub",
            toolbar: "MCP_toolbar",
            add: "MCP_add",
            cards: "MCP_cards",
            card: "MCP_card",
            cardTop: "MCP_cardTop",
            name: "MCP_name",
            badges: "MCP_badges",
            badge: "MCP_badge",
            meta: "MCP_meta",
            dot: "MCP_dot",
            actions: "MCP_actions",
            spacer: "MCP_spacer",
            form: "MCP_form",
            field: "MCP_field",
            label: "MCP_label",
            input: "MCP_input",
            textarea: "MCP_textarea",
            transportRow: "MCP_transportRow",
            transportBtn: "MCP_transportBtn",
            secretKeys: "MCP_secretKeys",
            key: "MCP_key",
            checkRow: "MCP_checkRow",
            result: "MCP_result",
            actionBtn: "MCP_actionBtn",
            dangerBtn: "MCP_dangerBtn",
            iconBtn: "MCP_iconBtn",
            advancedToggle: "MCP_advancedToggle",
            hint: "MCP_hint",
            authBox: "MCP_authBox",
            toolsPanel: "MCP_toolsPanel",
            toolsList: "MCP_toolsList",
            toolRow: "MCP_toolRow",
            toolName: "MCP_toolName",
            toolsActions: "MCP_toolsActions",
            doc: "MCP_doc",
            docCode: "MCP_docCode"
        };
        /**
         * 服务名校验规则，必须与 src/mcp/model.ts 的 SERVER_NAME_RE 完全一致：
         * 客户端 bundle 只能 require 外壳种子词，无法 import 宿主侧模块，
         * 所以两边各写一份字面量，由 test-mcp-naming.mjs 交叉校验。
         */
        const MCP_NAME_RE = /^[A-Za-z0-9_-]{1,32}$/;
        /** 剥掉宿主 RPC 信封前缀，只留我们自己抛的中文错误。 */
        const cleanMcpError = (error) => String(error?.message ?? error)
            .replace(/^[A-Za-z]+Manager\.[A-Za-z]+ failed: /, "")
            .replace(/^[a-z]+\/[a-z-]+: typert gateway: [^:]+: /, "");
        function mcpParseLines(text) {
            return String(text ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        }
        /**
         * 面板里的写法：值里写 ${NAME} 就是「读环境变量 NAME」。
         *
         * DSH 的 cordis 配置层没有 ${VAR} 字符串插值，唯一的机制是 YAML 的 !!js 表达式，
         * 所以这里把直觉写法格式化成 `!!js` + 反引号模板再落盘；以 "!!js " 开头的值按
         * 进阶写法原样透传。规则必须与 src/mcp/model.ts 的 parseWireScalar 一致：浏览器束
         * 只能 require 外壳种子词，无法 import 宿主模块，所以两边各写一份字面量（测试交叉校验）。
         */
        const MCP_JS_EXPR_PREFIX = "!!js";
        const MCP_ENV_REF_RE = /\$\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}/g;
        function mcpEnvRefs(value) {
            return value.replace(MCP_ENV_REF_RE, (match, name) => "${process.env." + name + "}");
        }
        function mcpWireScalar(text) {
            const raw = String(text ?? "");
            const trimmed = raw.trim();
            if (trimmed === MCP_JS_EXPR_PREFIX || trimmed.startsWith(MCP_JS_EXPR_PREFIX + " ")) {
                const expression = trimmed.slice(MCP_JS_EXPR_PREFIX.length).trim();
                return expression === "" ? raw : { __jsExpr: expression };
            }
            if (trimmed.indexOf("${") === -1)
                return raw;
            if (trimmed.length > 1 && trimmed.startsWith("`") && trimmed.endsWith("`"))
                return { __jsExpr: mcpEnvRefs(trimmed) };
            return { __jsExpr: "`" + mcpEnvRefs(raw) + "`" };
        }
        function mcpParsePairs(text) {
            const out = {};
            for (const line of mcpParseLines(text)) {
                const index = line.indexOf("=");
                if (index <= 0)
                    continue;
                const key = line.slice(0, index).trim();
                if (key !== "")
                    out[key] = mcpWireScalar(line.slice(index + 1).trim());
            }
            return out;
        }
        /** 参数：每行一个，逐个走 !!js 规则。 */
        function mcpParseScalarLines(text) {
            return mcpParseLines(text).map((line) => mcpWireScalar(line));
        }
        function mcpNumber(value, fallback) {
            const n = parseInt(String(value ?? ""), 10);
            return Number.isFinite(n) && n > 0 ? n : fallback;
        }
        function defaultMcpForm() {
            return {
                serverName: "",
                transport: "stdio",
                command: "",
                argsText: "",
                envText: "",
                cwd: "",
                url: "",
                headersText: "",
                // 认证方式（只有 streamable-http 用）：none / bearer / oauth
                authMode: "none",
                authToken: "",
                timeout: "60000",
                failOnStartup: false,
                reconnectEnabled: true,
                initialDelay: "500",
                maxDelay: "30000",
                maxAttempts: "10"
            };
        }
        function formFromServer(server) {
            const form = defaultMcpForm();
            form.serverName = server.serverName ?? "";
            form.transport = server.transport === "streamable-http" ? "streamable-http" : "stdio";
            form.command = server.command ?? "";
            form.argsText = Array.isArray(server.args) ? server.args.join("\n") : "";
            form.cwd = server.cwd ?? "";
            form.url = server.url ?? "";
            form.timeout = String(server.toolCallTimeoutMs ?? 60000);
            form.failOnStartup = !!server.failOnStartupError;
            form.reconnectEnabled = server.reconnect?.enabled !== false;
            form.initialDelay = String(server.reconnect?.initialDelayMs ?? 500);
            form.maxDelay = String(server.reconnect?.maxDelayMs ?? 30000);
            form.maxAttempts = String(server.reconnect?.maxAttempts ?? 10);
            // 已经有 Authorization 头就默认选中「Bearer 令牌」；令牌本身不回显（只显示在请求头里）。
            if (form.transport === "streamable-http" && Array.isArray(server.headerKeys) && server.headerKeys.includes("Authorization")) {
                form.authMode = "bearer";
            }
            return form;
        }
        function buildMcpInput(form, deletedEnv, deletedHeaders) {
            const reconnect = {
                enabled: !!form.reconnectEnabled,
                initialDelayMs: mcpNumber(form.initialDelay, 500),
                maxDelayMs: mcpNumber(form.maxDelay, 30000),
                maxAttempts: mcpNumber(form.maxAttempts, 10)
            };
            const common = {
                serverName: String(form.serverName ?? "").trim(),
                toolCallTimeoutMs: mcpNumber(form.timeout, 60000),
                failOnStartupError: !!form.failOnStartup,
                reconnect
            };
            if (form.transport === "streamable-http") {
                const headers = mcpParsePairs(form.headersText);
                for (const key of deletedHeaders)
                    headers[key] = null;
                return { ...common, transport: "streamable-http", url: mcpWireScalar(String(form.url ?? "").trim()), headers };
            }
            const env = mcpParsePairs(form.envText);
            for (const key of deletedEnv)
                env[key] = null;
            return { ...common, transport: "stdio", command: mcpWireScalar(String(form.command ?? "").trim()), args: mcpParseScalarLines(form.argsText), env, cwd: mcpWireScalar(String(form.cwd ?? "").trim()) };
        }
        function McpFormDialog({ t, initial, onSave, onCancel, busy, error }) {
            const editing = initial !== null && initial !== undefined;
            const [form, setForm] = react.useState(() => editing ? formFromServer(initial) : defaultMcpForm());
            const [deletedEnv, setDeletedEnv] = react.useState(() => new Set());
            const [deletedHeaders, setDeletedHeaders] = react.useState(() => new Set());
            const [advancedOpen, setAdvancedOpen] = react.useState(false);
            const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));
            // 名称规则最终由宿主边界校验，撞上只会得到一句泛化错误；
            // 这里提前拦截并把规则写在字段下面，别让用户对着天书猜。
            const trimmedName = String(form.serverName ?? "").trim();
            const nameIssue = trimmedName === "" ? t("nameRequired") : MCP_NAME_RE.test(trimmedName) ? null : t("nameHint");
            const envKeys = editing && Array.isArray(initial.envKeys) ? initial.envKeys.filter((key) => !deletedEnv.has(key)) : [];
            const headerKeys = editing && Array.isArray(initial.headerKeys) ? initial.headerKeys.filter((key) => !deletedHeaders.has(key)) : [];
            const submit = () => {
                if (nameIssue !== null)
                    return;
                // 「Bearer 令牌」不是独立字段：保存时并成一行 Authorization=Bearer …（支持 ${ENV}），
                // 与手写请求头走同一条落盘路径，避免两套真相。
                let toSave = form;
                const token = String(form.authToken ?? "").trim();
                if (form.transport === "streamable-http" && form.authMode === "bearer" && token !== "") {
                    const kept = String(form.headersText ?? "")
                        .split("\n")
                        .filter((line) => line.trim() !== "" && !/^\s*Authorization\s*[=:]/i.test(line));
                    toSave = { ...form, headersText: [...kept, "Authorization=Bearer " + token].join("\n") };
                }
                onSave(buildMcpInput(toSave, deletedEnv, deletedHeaders), editing ? initial.serverName : undefined);
            };
            const label = (text) => (0, react_jsx_runtime.jsx)("span", { className: m.label, children: text });
            const field = (text, node, wide, hint = null) => (0, react_jsx_runtime.jsxs)("label", {
                className: m.field,
                "data-wide": wide ? "true" : void 0,
                children: [label(text), node, hint !== undefined && hint !== null ? (0, react_jsx_runtime.jsx)("span", {
                        className: m.hint,
                        "data-error": hint.error ? "true" : void 0,
                        role: hint.error ? "alert" : void 0,
                        children: hint.text
                    }) : null]
            });
            const textInput = (value, onChange, placeholder = "") => (0, react_jsx_runtime.jsx)("input", {
                className: m.input,
                value,
                placeholder,
                onChange: (event) => onChange(event.target.value)
            });
            const textArea = (value, onChange, placeholder = "") => (0, react_jsx_runtime.jsx)("textarea", {
                className: m.textarea,
                value,
                placeholder,
                onChange: (event) => onChange(event.target.value)
            });
            const secretEditor = (keys, deleted, setDeleted, text, setText, placeholder) => (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
                children: [
                    keys.length > 0 ? (0, react_jsx_runtime.jsx)("div", {
                        className: m.secretKeys,
                        children: keys.map((key) => (0, react_jsx_runtime.jsxs)("span", {
                            className: m.key,
                            children: [
                                key,
                                (0, react_jsx_runtime.jsx)("button", {
                                    type: "button",
                                    onClick: () => {
                                        const next = new Set(deleted);
                                        next.add(key);
                                        setDeleted(next);
                                    },
                                    children: t("deleteSecret")
                                })
                            ]
                        }, key))
                    }) : null,
                    textArea(text, setText, placeholder)
                ]
            });
            const fields = [
                field(t("fieldServerName"), textInput(form.serverName, (value) => set({ serverName: value }), "MCP Server"), false, nameIssue === null ? { text: t("nameHint"), error: false } : { text: nameIssue, error: true }),
                field(t("fieldTransport"), (0, react_jsx_runtime.jsxs)("div", {
                    className: m.transportRow,
                    children: [
                        (0, react_jsx_runtime.jsx)("button", {
                            type: "button",
                            className: m.transportBtn,
                            "data-active": form.transport === "stdio" ? "true" : "false",
                            onClick: () => set({ transport: "stdio" }),
                            children: t("transportStdio")
                        }),
                        (0, react_jsx_runtime.jsx)("button", {
                            type: "button",
                            className: m.transportBtn,
                            "data-active": form.transport === "streamable-http" ? "true" : "false",
                            onClick: () => set({ transport: "streamable-http" }),
                            children: t("transportHttp")
                        })
                    ]
                }), false)
            ];
            if (form.transport === "stdio") {
                fields.push(field(t("fieldCommand"), textInput(form.command, (value) => set({ command: value }), t("phCommand")), true));
                fields.push(field(t("fieldArgs"), textArea(form.argsText, (value) => set({ argsText: value }), t("phArgs")), true));
                fields.push(field(t("fieldEnv"), secretEditor(envKeys, deletedEnv, setDeletedEnv, form.envText, (value) => set({ envText: value }), t("phEnv")), true, { text: t("hintJs") + " " + t("authStdioHint") }));
                fields.push(field(t("fieldCwd"), textInput(form.cwd, (value) => set({ cwd: value }), t("phCwd")), false));
            }
            else {
                fields.push(field(t("fieldUrl"), textInput(form.url, (value) => set({ url: value }), t("phUrl")), true));
                // 认证：只有 streamable-http 有意义。三种方式——无 / Bearer 令牌 / OAuth 登录。
                // Bearer 只是「往请求头里写一行 Authorization」的快捷方式；OAuth 要保存后
                // 在卡片上点「OAuth 登录」（授权流程需要已落盘的那一行配置）。
                fields.push(field(t("fieldAuth"), (0, react_jsx_runtime.jsxs)("div", {
                    className: m.authBox,
                    children: [
                        (0, react_jsx_runtime.jsxs)("div", {
                            className: m.transportRow,
                            children: [
                                (0, react_jsx_runtime.jsx)("button", { type: "button", className: m.transportBtn, "data-active": form.authMode === "none" ? "true" : "false", onClick: () => set({ authMode: "none" }), children: t("authNone") }),
                                (0, react_jsx_runtime.jsx)("button", { type: "button", className: m.transportBtn, "data-active": form.authMode === "bearer" ? "true" : "false", onClick: () => set({ authMode: "bearer" }), children: t("authBearer") }),
                                (0, react_jsx_runtime.jsx)("button", { type: "button", className: m.transportBtn, "data-active": form.authMode === "oauth" ? "true" : "false", onClick: () => set({ authMode: "oauth" }), children: t("authOAuth") })
                            ]
                        }),
                        form.authMode === "bearer" ? textInput(form.authToken, (value) => set({ authToken: value }), t("phAuthToken")) : null,
                        (0, react_jsx_runtime.jsx)("span", {
                            className: m.hint,
                            children: form.authMode === "bearer" ? t("authBearerHint") : form.authMode === "oauth" ? t("authOauthHint") : t("authNoneHint")
                        })
                    ]
                }), true));
                fields.push(field(t("fieldHeaders"), secretEditor(headerKeys, deletedHeaders, setDeletedHeaders, form.headersText, (value) => set({ headersText: value }), t("phHeaders")), true, { text: t("hintJs") }));
            }
            fields.push((0, react_jsx_runtime.jsx)("div", {
                className: m.field,
                "data-wide": "true",
                children: (0, react_jsx_runtime.jsx)("button", {
                    type: "button",
                    className: m.advancedToggle,
                    onClick: () => setAdvancedOpen((value) => !value),
                    children: (advancedOpen ? "▾ " : "▸ ") + t("advanced")
                })
            }));
            if (advancedOpen) {
                fields.push(field(t("fieldFailOnStartup"), (0, react_jsx_runtime.jsxs)("label", {
                    className: m.checkRow,
                    children: [
                        (0, react_jsx_runtime.jsx)("input", {
                            type: "checkbox",
                            checked: !!form.failOnStartup,
                            onChange: (event) => set({ failOnStartup: event.target.checked })
                        }),
                        t("fieldFailOnStartup")
                    ]
                }), false));
                fields.push(field(t("fieldReconnect"), (0, react_jsx_runtime.jsxs)("label", {
                    className: m.checkRow,
                    children: [
                        (0, react_jsx_runtime.jsx)("input", {
                            type: "checkbox",
                            checked: !!form.reconnectEnabled,
                            onChange: (event) => set({ reconnectEnabled: event.target.checked })
                        }),
                        t("fieldReconnect")
                    ]
                }), false));
                fields.push(field(t("fieldTimeout"), textInput(form.timeout, (value) => set({ timeout: value }), "60000"), false));
                fields.push(field(t("fieldInitialDelay"), textInput(form.initialDelay, (value) => set({ initialDelay: value }), "500"), false));
                fields.push(field(t("fieldMaxDelay"), textInput(form.maxDelay, (value) => set({ maxDelay: value }), "30000"), false));
                fields.push(field(t("fieldMaxAttempts"), textInput(form.maxAttempts, (value) => set({ maxAttempts: value }), "10"), false));
            }
            return (0, react_jsx_runtime.jsx)("div", {
                className: c.scopeOverlay,
                role: "dialog",
                "aria-modal": "true",
                children: (0, react_jsx_runtime.jsxs)("div", {
                    className: c.scopeBox,
                    children: [
                        (0, react_jsx_runtime.jsx)("h4", { children: editing ? t("editTitle") : t("newTitle") }),
                        (0, react_jsx_runtime.jsx)("div", {
                            className: m.form,
                            children: fields
                        }),
                        error !== undefined && error !== null ? (0, react_jsx_runtime.jsx)("div", {
                            className: c.notice,
                            "data-kind": "error",
                            children: (0, react_jsx_runtime.jsx)("span", { className: c.noticeText, children: String(error) })
                        }) : null,
                        (0, react_jsx_runtime.jsxs)("div", {
                            className: c.scopeActions,
                            children: [
                                (0, react_jsx_runtime.jsx)("button", {
                                    type: "button",
                                    className: c.scopeAction + " " + c.scopeCancel,
                                    disabled: busy,
                                    onClick: onCancel,
                                    children: t("cancel")
                                }),
                                (0, react_jsx_runtime.jsx)("button", {
                                    type: "button",
                                    className: c.scopeAction + " " + c.scopeConfirm,
                                    disabled: busy || nameIssue !== null,
                                    onClick: submit,
                                    children: t("save")
                                })
                            ]
                        })
                    ]
                })
            });
        }
        function McpSection({ t, listMcp, saveMcp, removeMcp, setEnabledMcp, testMcp, reloadMcp, checkUpdateRemote, oauthStart, oauthPoll, oauthDisconnect, listMcpTools, getToolFilter, setToolFilter, evacuateForeign }) {
            const [loadState, setLoadState] = react.useState({ kind: "loading" });
            const [data, setData] = react.useState(null);
            const [request, setRequest] = react.useState(0);
            const [editing, setEditing] = react.useState(null);
            const [dialogBusy, setDialogBusy] = react.useState(false);
            const [updateBanner, setUpdateBanner] = react.useState(null);
            const [dialogError, setDialogError] = react.useState(null);
            const [confirming, setConfirming] = react.useState(null);
            const [testing, setTesting] = react.useState(null);
            const [testResult, setTestResult] = react.useState(null);
            const [docOpen, setDocOpen] = react.useState(false);
            // MCP OAuth 登录（Issue #45）：一次只跑一条流程，轮询到 done/failed 为止。
            const [oauthBusy, setOauthBusy] = react.useState(null);
            const [oauthNotice, setOauthNotice] = react.useState(null);
            // 单工具禁用（Issue #44）：展开哪一台、它的工具清单、勾掉的集合与忙碌态。
            const [toolsOpen, setToolsOpen] = react.useState(null);
            const [toolsPanel, setToolsPanel] = react.useState(null);
            const [toolsBusy, setToolsBusy] = react.useState(false);
            // 受管块里的外来行（#46 后续）：展开「查看机制」说明、移出结果与忙碌态。
            const [foreignDocOpen, setForeignDocOpen] = react.useState(false);
            const [evacNotice, setEvacNotice] = react.useState(null);
            const [evacBusy, setEvacBusy] = react.useState(false);
            react.useEffect(() => {
                let cancelled = false;
                listMcp().then((value) => {
                    if (cancelled)
                        return;
                    setData(value);
                    setLoadState({ kind: "ready" });
                }).catch((error) => {
                    if (cancelled)
                        return;
                    setLoadState({ kind: "error", message: String(error?.message ?? error) });
                });
                return () => { cancelled = true; };
            }, [listMcp, request]);
            react.useEffect(() => {
                if (confirming === null)
                    return;
                const timer = setTimeout(() => setConfirming(null), 3000);
                return () => clearTimeout(timer);
            }, [confirming]);
            react.useEffect(() => {
                let current = true;
                Promise.resolve().then(() => checkUpdateRemote()).then((snapshot) => {
                    if (!current)
                        return;
                    const currentV = snapshot !== null && typeof snapshot === "object" && typeof snapshot.current === "string" ? snapshot.current : "";
                    const latest = snapshot !== null && typeof snapshot === "object" && typeof snapshot.latest === "string" ? snapshot.latest : null;
                    if (latest !== null && snapshot.updateAvailable === true)
                        setUpdateBanner(t("checkUpdateAvailable") + latest + t("checkUpdateCurrent") + currentV + t("checkUpdateHint"));
                }, () => { });
                return () => { current = false; };
            }, [checkUpdateRemote, t]);
            const servers = data?.servers ?? [];
            const external = data?.externalServers ?? [];
            const patch = data?.patch ?? {};
            /**
             * #46 受管块里的外来行可见化。
             * patch.foreign 的元素是 { id?, name?, managed }：
             *   managed === false → 块内一条不属于面板的行（面板永不改写，但要让人看见）；
             *   managed === true  → 面板自己的某一行被挪进了外来 insert 列表，面板暂不管理它。
             * 两类各出一句，最多各列 3 个标识，避免把通知条撑爆。
             */
            const describeForeignRow = (entry) => String(entry?.id ?? entry?.name ?? "?");
            const foreignListText = (rows) => rows.slice(0, 3).map(describeForeignRow).join("、") + (rows.length > 3 ? " " + (t !== null ? t("foreignMore") : "…") : "");
            const foreignOthers = (Array.isArray(patch.foreign) ? patch.foreign : []).filter((entry) => entry !== null && typeof entry === "object" && entry.managed !== true);
            const foreignMine = (Array.isArray(patch.foreign) ? patch.foreign : []).filter((entry) => entry !== null && typeof entry === "object" && entry.managed === true);
            const foreignNotice = [
                foreignOthers.length > 0 && t !== null ? t("foreignOthers").replace("{count}", String(foreignOthers.length)).replace("{list}", foreignListText(foreignOthers)) : null,
                foreignMine.length > 0 && t !== null ? t("foreignMine").replace("{count}", String(foreignMine.length)).replace("{list}", foreignListText(foreignMine)) : null
            ].filter((line) => line !== null);
            const refresh = (quiet) => setRequest((value) => value + 1);
            // 把受管块里的外来行原样搬到块外（语义不变），然后刷新列表让提醒消失。
            const applyEvacuate = () => {
                if (evacBusy)
                    return;
                setEvacBusy(true);
                setEvacNotice(null);
                Promise.resolve().then(() => evacuateForeign()).then((result) => {
                    setEvacBusy(false);
                    const moved = Number(result?.moved ?? 0);
                    setEvacNotice(t !== null ? t(moved > 0 ? "foreignEvacuated" : "foreignEvacuateNone").replace("{count}", String(moved)) : "");
                    refresh(true);
                }, (error) => {
                    setEvacBusy(false);
                    setEvacNotice(t !== null ? t("foreignEvacuateFailed") + String(error?.message ?? error) : String(error?.message ?? error));
                });
            };
            const stateLabel = (server) => {
                if (!server.enabled)
                    return t !== null ? "stateStopped" : "";
                const phase = server.fiberPhase;
                if (phase === "active")
                    return "stateActive";
                if (phase === "loading" || phase === "unloading")
                    return "stateLoading";
                if (phase === "failed")
                    return "stateFailed";
                if (phase === "pending")
                    return "statePending";
                return "stateUnknown";
            };
            const applySave = async (input, previousServerName) => {
                setDialogBusy(true);
                setDialogError(null);
                try {
                    const result = await saveMcp(input, previousServerName);
                    setEditing(null);
                    setTimeout(() => refresh(true), 500);
                }
                catch (error) {
                    setDialogError(cleanMcpError(error));
                }
                finally {
                    setDialogBusy(false);
                }
            };
            const applyToggle = async (server) => {
                const previous = server.enabled;
                const wanted = !previous;
                setData((prev) => prev === null ? prev : { ...prev, servers: prev.servers.map((item) => item.serverName === server.serverName ? { ...item, enabled: wanted } : item) });
                try {
                    const next = await setEnabledMcp(server.serverName, wanted);
                    setData((prev) => prev === null ? prev : { ...prev, servers: prev.servers.map((item) => item.serverName === next.serverName ? next : item) });
                }
                catch (error) {
                    setData((prev) => prev === null ? prev : { ...prev, servers: prev.servers.map((item) => item.serverName === server.serverName ? { ...item, enabled: previous } : item) });
                    setLoadState({ kind: "error", message: String(error?.message ?? error) });
                }
            };
            const applyRemove = async (server) => {
                if (confirming !== server.serverName) {
                    setConfirming(server.serverName);
                    return;
                }
                setConfirming(null);
                try {
                    await removeMcp(server.serverName);
                    setData((prev) => prev === null ? prev : { ...prev, servers: prev.servers.filter((item) => item.serverName !== server.serverName) });
                }
                catch (error) {
                    setLoadState({ kind: "error", message: String(error?.message ?? error) });
                }
            };
            const applyTest = async (server) => {
                setTesting(server.serverName);
                setTestResult(null);
                try {
                    const result = await testMcp({ serverName: server.serverName });
                    setTestResult({ serverName: server.serverName, result });
                }
                catch (error) {
                    setTestResult({ serverName: server.serverName, result: { ok: false, error: String(error?.message ?? error), tools: [] } });
                }
                finally {
                    setTesting(null);
                }
            };
            // 点「OAuth 登录」：起流程 → 系统浏览器打开授权页 → 每 1.5s 轮询一次。
            // 授权页由外部浏览器承载，回调落在宿主进程监听的 127.0.0.1 端口上，因此这里
            // 只需要等轮询结果，不依赖任何外部回调服务。
            const applyOAuth = async (server) => {
                setOauthBusy(server.serverName);
                setOauthNotice(null);
                try {
                    const start = await oauthStart({ serverName: server.serverName });
                    try {
                        window.open(start.authUrl, "_blank", "noopener,noreferrer");
                    }
                    catch {
                        // 弹窗被拦时把授权地址直接给用户。
                        setOauthNotice({ serverName: server.serverName, ok: true, text: start.authUrl });
                    }
                    for (let attempt = 0; attempt < 240; attempt += 1) {
                        await new Promise((resolve) => setTimeout(resolve, 1500));
                        const poll = await oauthPoll({ flowId: start.flowId });
                        if (poll.status === "pending")
                            continue;
                        if (poll.status === "failed")
                            throw new Error(String(poll.error ?? t("oauthFailed")));
                        setOauthNotice({ serverName: server.serverName, ok: true, text: t("oauthDone") });
                        setData(await reloadMcp());
                        return;
                    }
                    throw new Error(t("oauthTimeout"));
                }
                catch (error) {
                    setOauthNotice({ serverName: server.serverName, ok: false, text: String(error?.message ?? error) });
                }
                finally {
                    setOauthBusy(null);
                }
            };
            const applyOAuthDisconnect = async (server) => {
                setOauthBusy(server.serverName);
                setOauthNotice(null);
                try {
                    await oauthDisconnect({ serverName: server.serverName });
                    setOauthNotice({ serverName: server.serverName, ok: true, text: t("oauthDisconnected") });
                    setData(await reloadMcp());
                }
                catch (error) {
                    setOauthNotice({ serverName: server.serverName, ok: false, text: String(error?.message ?? error) });
                }
                finally {
                    setOauthBusy(null);
                }
            };
            // 单工具禁用：读「这一台的工具」+「全局禁用列表」，勾选后写回全局列表。
            // 宿主的 restrict() 只接受整份 deny，而面板按 agent 施加同一份列表，所以这一台的
            // 勾选要合并进同一份 deny，其它服务器的条目保持不动。
            const openTools = async (server) => {
                if (toolsOpen === server.serverName) {
                    setToolsOpen(null);
                    return;
                }
                setToolsOpen(server.serverName);
                setToolsPanel({ serverName: server.serverName, loading: true });
                try {
                    const [tools, filter] = await Promise.all([listMcpTools({ serverName: server.serverName }), getToolFilter()]);
                    const deny = new Set(Array.isArray(filter?.deny) ? filter.deny : []);
                    const rows = Array.isArray(tools?.tools) ? tools.tools : [];
                    setToolsPanel({
                        serverName: server.serverName,
                        loading: false,
                        connected: tools?.connected !== false,
                        tools: rows,
                        globalDeny: deny,
                        disabled: new Set(rows.filter((tool) => Array.isArray(tools.disabled) && tools.disabled.includes(tool.name)).map((tool) => tool.name))
                    });
                }
                catch (error) {
                    setToolsPanel({ serverName: server.serverName, loading: false, error: String(error?.message ?? error) });
                }
            };
            const toggleTool = (name) => {
                setToolsPanel((prev) => {
                    if (prev === null)
                        return prev;
                    const next = new Set(prev.disabled);
                    if (next.has(name))
                        next.delete(name);
                    else
                        next.add(name);
                    return { ...prev, disabled: next };
                });
            };
            const saveTools = async () => {
                const panel = toolsPanel;
                if (panel === null || panel.globalDeny === undefined)
                    return;
                setToolsBusy(true);
                try {
                    const mine = new Set((panel.tools ?? []).map((tool) => tool.name));
                    const deny = [...panel.globalDeny].filter((name) => !mine.has(name)).concat([...panel.disabled]).sort();
                    const result = await setToolFilter({ deny });
                    setOauthNotice({ serverName: panel.serverName, ok: true, text: t("toolsSaved").replace("{count}", String(deny.length)).replace("{applied}", String(result?.applied ?? 0)) });
                    setToolsOpen(null);
                }
                catch (error) {
                    setOauthNotice({ serverName: panel.serverName, ok: false, text: String(error?.message ?? error) });
                }
                finally {
                    setToolsBusy(false);
                }
            };
            const toolPanel = (server) => {
                const panel = toolsPanel;
                if (panel === null || panel.serverName !== server.serverName)
                    return null;
                if (panel.loading) {
                    return (0, react_jsx_runtime.jsx)("div", { className: m.toolsPanel, children: (0, react_jsx_runtime.jsx)("p", { className: m.hint, children: t("toolsLoading") }) });
                }
                if (panel.error !== undefined) {
                    return (0, react_jsx_runtime.jsx)("div", { className: m.toolsPanel, children: (0, react_jsx_runtime.jsx)("p", { className: m.hint, "data-error": "true", children: panel.error }) });
                }
                const rows = panel.tools ?? [];
                if (rows.length === 0) {
                    return (0, react_jsx_runtime.jsxs)("div", {
                        className: m.toolsPanel,
                        children: [(0, react_jsx_runtime.jsx)("p", { className: m.hint, children: panel.connected === false ? t("toolsDisconnected") : t("toolsEmpty") }), (0, react_jsx_runtime.jsx)("p", { className: m.hint, children: t("toolsScopeHint") })]
                    });
                }
                return (0, react_jsx_runtime.jsxs)("div", {
                    className: m.toolsPanel,
                    children: [
                        (0, react_jsx_runtime.jsx)("p", { className: m.hint, children: t("toolsScopeHint") }),
                        (0, react_jsx_runtime.jsx)("div", {
                            className: m.toolsList,
                            children: rows.map((tool) => (0, react_jsx_runtime.jsxs)("label", {
                                className: m.toolRow,
                                title: tool.description ?? tool.name,
                                children: [
                                    (0, react_jsx_runtime.jsx)("input", { type: "checkbox", checked: !panel.disabled.has(tool.name), onChange: () => toggleTool(tool.name) }),
                                    (0, react_jsx_runtime.jsx)("span", { className: m.toolName, children: tool.name })
                                ]
                            }, tool.name))
                        }),
                        (0, react_jsx_runtime.jsxs)("div", {
                            className: m.toolsActions,
                            children: [
                                (0, react_jsx_runtime.jsx)("button", { type: "button", className: m.actionBtn, disabled: toolsBusy, onClick: saveTools, children: toolsBusy ? t("toolsSaving") : t("toolsSave") }),
                                (0, react_jsx_runtime.jsx)("button", { type: "button", className: m.actionBtn, disabled: toolsBusy, onClick: () => setToolsOpen(null), children: t("cancel") }),
                                (0, react_jsx_runtime.jsx)("span", { className: m.hint, children: t("toolsDisabledCount").replace("{count}", String(panel.disabled.size)) })
                            ]
                        })
                    ]
                });
            };
            const gearIcon = (0, react_jsx_runtime.jsxs)("svg", {
                width: 14,
                height: 14,
                viewBox: "0 0 24 24",
                fill: "none",
                stroke: "currentColor",
                strokeWidth: 1.8,
                strokeLinecap: "round",
                strokeLinejoin: "round",
                children: [
                    (0, react_jsx_runtime.jsx)("circle", { cx: 12, cy: 12, r: 3 }),
                    (0, react_jsx_runtime.jsx)("path", { d: "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" })
                ]
            });
            const serverCard = (server, isExternal) => {
                const state = stateLabel(server);
                const dotOn = server.enabled && server.fiberPhase === "active";
                const dotErr = server.fiberPhase === "failed";
                return (0, react_jsx_runtime.jsxs)("div", {
                    className: m.card,
                    children: [(0, react_jsx_runtime.jsxs)("div", {
                            className: m.cardTop,
                            children: [(0, react_jsx_runtime.jsx)("span", { className: m.name, children: server.serverName }), (0, react_jsx_runtime.jsxs)("span", {
                                    className: m.badges,
                                    children: [(0, react_jsx_runtime.jsx)("span", { className: m.badge, children: server.transport === "streamable-http" ? "HTTP" : "STDIO" }), server.transport === "streamable-http" && (server.headerKeys ?? []).includes("Authorization") ? (0, react_jsx_runtime.jsx)("span", { className: m.badge, title: t("authBadgeHint"), children: t("authBadge") }) : null, isExternal ? (0, react_jsx_runtime.jsx)("span", {
                                            className: m.badge,
                                            title: server.orphan ? t("orphanHint") : void 0,
                                            children: server.orphan ? t("orphan") : t("external")
                                        }) : null]
                                }), (0, react_jsx_runtime.jsx)("span", { className: m.spacer }), isExternal ? null : (0, react_jsx_runtime.jsx)("button", {
                                    type: "button",
                                    className: m.iconBtn,
                                    "aria-label": t("editTitle"),
                                    onClick: () => { setDialogError(null); setEditing({ server }); },
                                    children: gearIcon
                                })]
                        }), (0, react_jsx_runtime.jsxs)("div", {
                            className: m.meta,
                            children: [(0, react_jsx_runtime.jsx)("span", {
                                    className: m.dot,
                                    "data-on": server.enabled ? "true" : "false",
                                    "data-err": server.fiberPhase === "failed" ? "true" : "false"
                                }), (0, react_jsx_runtime.jsx)("span", { children: t !== null ? t("toolCount").replace("{count}", String(server.toolCount ?? 0)) : "" })]
                        }), isExternal ? null : (0, react_jsx_runtime.jsxs)("div", {
                            className: m.actions,
                            children: [(0, react_jsx_runtime.jsxs)("span", {
                                    className: c.switchRow,
                                    children: [(0, react_jsx_runtime.jsx)("button", {
                                            type: "button",
                                            role: "switch",
                                            className: c.switch,
                                            "data-on": server.enabled ? "true" : void 0,
                                            "aria-checked": server.enabled,
                                            "aria-label": server.enabled ? t("disable") : t("enable"),
                                            onClick: () => applyToggle(server),
                                            children: (0, react_jsx_runtime.jsx)("span", { className: c.switchThumb })
                                        }), (0, react_jsx_runtime.jsx)("span", { className: c.switchText, children: t !== null ? (server.enabled ? t("stateEnabled") : t("stateDisabled")) : "" })]
                                }), (0, react_jsx_runtime.jsx)("span", { className: m.spacer }), (server.transport === "streamable-http") ? (0, react_jsx_runtime.jsx)("button", {
                                    type: "button",
                                    className: m.actionBtn,
                                    disabled: oauthBusy === server.serverName,
                                    title: t !== null ? t("oauthHint") : "",
                                    onClick: () => applyOAuth(server),
                                    children: oauthBusy === server.serverName ? (t !== null ? t("oauthWorking") : "") : ((server.headerKeys ?? []).includes("Authorization") ? (t !== null ? t("oauthRelogin") : "") : (t !== null ? t("oauthLogin") : ""))
                                }) : null, ((server.transport === "streamable-http") && (server.headerKeys ?? []).includes("Authorization")) ? (0, react_jsx_runtime.jsx)("button", {
                                    type: "button",
                                    className: m.actionBtn,
                                    disabled: oauthBusy === server.serverName,
                                    onClick: () => applyOAuthDisconnect(server),
                                    children: t !== null ? t("oauthDisconnect") : ""
                                }) : null, (0, react_jsx_runtime.jsx)("button", {
                                    type: "button",
                                    className: m.actionBtn,
                                    disabled: testing === server.serverName,
                                    onClick: () => applyTest(server),
                                    children: testing === server.serverName ? t !== null ? t("testing") : "" : t !== null ? t("test") : ""
                                }), (0, react_jsx_runtime.jsx)("button", {
                                    type: "button",
                                    className: m.actionBtn,
                                    "data-active": toolsOpen === server.serverName ? "true" : void 0,
                                    title: t("toolsButtonHint"),
                                    onClick: () => { openTools(server); },
                                    children: t("toolsButton")
                                }), confirming === server.serverName ? (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
                                    children: [
                                        (0, react_jsx_runtime.jsx)("button", {
                                            type: "button",
                                            className: m.actionBtn,
                                            onClick: () => setConfirming(null),
                                            children: t !== null ? t("cancel") : ""
                                        }),
                                        (0, react_jsx_runtime.jsx)("button", {
                                            type: "button",
                                            className: m.dangerBtn,
                                            "data-confirm": "true",
                                            onClick: () => applyRemove(server),
                                            children: t !== null ? t("confirmDelete") : ""
                                        })
                                    ]
                                }) : (0, react_jsx_runtime.jsx)("button", {
                                    type: "button",
                                    className: m.dangerBtn,
                                    onClick: () => applyRemove(server),
                                    children: t !== null ? t("delete") : ""
                                })]
                        }), oauthNotice?.serverName === server.serverName ? (0, react_jsx_runtime.jsx)("div", {
                            className: m.result,
                            "data-ok": oauthNotice.ok ? "true" : "false",
                            children: oauthNotice.text
                        }) : null, toolsOpen === server.serverName ? toolPanel(server) : null, testResult?.serverName === server.serverName ? (0, react_jsx_runtime.jsxs)("div", {
                            className: m.result,
                            "data-ok": testResult.result.ok ? "true" : "false",
                            children: [testResult.result.ok ? t !== null ? t("testOk").replace("{count}", String(testResult.result.tools?.length ?? 0)) : "" : t !== null ? t("testFailed") + " " + (testResult.result.error ?? "") : "", testResult.result.ok && Array.isArray(testResult.result.tools) ? (0, react_jsx_runtime.jsx)("div", { children: testResult.result.tools.map((tool) => tool.name).join(", ") }) : null]
                        }) : null]
                }, server.serverName + (isExternal ? ":external" : ""));
            };
            return (0, react_jsx_runtime.jsxs)("div", {
                className: m.section,
                children: [(0, react_jsx_runtime.jsxs)("div", {
                        className: m.head,
                        children: [(0, react_jsx_runtime.jsx)("h3", { children: t !== null ? t("title") : "" }), (0, react_jsx_runtime.jsx)("button", {
                                type: "button",
                                className: m.actionBtn,
                                "aria-expanded": docOpen,
                                onClick: () => { setDocOpen((value) => !value); },
                                children: t !== null ? t("docButton") : ""
                            }), (0, react_jsx_runtime.jsx)("button", {
                                type: "button",
                                className: m.actionBtn,
                                onClick: () => { reloadMcp().then((value) => { setData(value); }).catch(() => refresh(true)); },
                                children: t !== null ? t("refresh") : ""
                            })]
                    }), (0, react_jsx_runtime.jsx)("p", { className: m.sub, children: t !== null ? t("subtitle") : "" }),
                    docOpen ? (0, react_jsx_runtime.jsxs)("div", {
                        className: m.doc,
                        children: [(0, react_jsx_runtime.jsx)("h4", { children: t !== null ? t("docTitle") : "" }), (0, react_jsx_runtime.jsx)("p", { children: t !== null ? t("docLead") : "" }), (0, react_jsx_runtime.jsx)("pre", { className: m.docCode, children: t !== null ? t("docCode") : "" }), (0, react_jsx_runtime.jsx)("p", { children: t !== null ? t("docWhere") : "" }), (0, react_jsx_runtime.jsx)("p", { children: t !== null ? t("docTools") : "" }), (0, react_jsx_runtime.jsx)("p", { children: t !== null ? t("docEnv") : "" }), (0, react_jsx_runtime.jsx)("pre", { className: m.docCode, children: t !== null ? t("docEnvCode") : "" }), (0, react_jsx_runtime.jsx)("p", { children: t !== null ? t("docEnvNote") : "" }), (0, react_jsx_runtime.jsx)("p", { children: t !== null ? t("docSecret") : "" })]
                    }) : null, updateBanner !== null ? (0, react_jsx_runtime.jsxs)("div", {
                        className: c.notice,
                        "data-kind": "info",
                        role: "status",
                        children: [(0, react_jsx_runtime.jsx)("span", { className: c.noticeText, children: updateBanner }), (0, react_jsx_runtime.jsx)("button", {
                                type: "button",
                                className: c.noticeButton,
                                onClick: () => { setUpdateBanner(null); },
                                children: t !== null ? t("close") : ""
                            })]
                    }) : null, patch?.ok === false ? (0, react_jsx_runtime.jsxs)("div", {
                        className: c.notice,
                        "data-kind": "error",
                        children: [(0, react_jsx_runtime.jsx)("span", { className: c.noticeText, children: t !== null ? t("patchBroken") + " " + (patch.error ?? "") : "" }), (0, react_jsx_runtime.jsx)("button", {
                                type: "button",
                                className: c.noticeButton,
                                onClick: () => refresh(true),
                                children: t !== null ? t("retry") : ""
                            })]
                    }) : null, foreignNotice.length > 0 ? (0, react_jsx_runtime.jsxs)("div", {
                        className: c.notice,
                        "data-kind": "info",
                        role: "status",
                        children: [(0, react_jsx_runtime.jsx)("span", {
                                className: c.noticeText,
                                children: foreignNotice.map((line, index) => (0, react_jsx_runtime.jsx)("span", {
                                    style: { display: "block" },
                                    children: line
                                }, index))
                            }), foreignOthers.length > 0 ? (0, react_jsx_runtime.jsx)("button", {
                                type: "button",
                                className: c.noticeButton,
                                "data-action": "evacuate",
                                disabled: evacBusy,
                                onClick: applyEvacuate,
                                children: t !== null ? t(evacBusy ? "foreignEvacuating" : "foreignEvacuate") : ""
                            }) : null, (0, react_jsx_runtime.jsx)("button", {
                                type: "button",
                                className: c.noticeButton,
                                "data-action": "foreign-doc",
                                "aria-expanded": foreignDocOpen,
                                onClick: () => { setForeignDocOpen((value) => !value); },
                                children: t !== null ? t("foreignDoc") : ""
                            }), (0, react_jsx_runtime.jsx)("button", {
                                type: "button",
                                className: c.noticeButton,
                                onClick: () => { setRequest((value) => value + 1); },
                                children: t !== null ? t("refresh") : ""
                            })]
                    }) : null, foreignNotice.length > 0 && foreignDocOpen ? (0, react_jsx_runtime.jsxs)("div", {
                        className: m.doc,
                        children: [(0, react_jsx_runtime.jsx)("h4", { children: t !== null ? t("foreignDocTitle") : "" }), (0, react_jsx_runtime.jsx)("p", { children: t !== null ? t("foreignDocWhat") : "" }), (0, react_jsx_runtime.jsx)("p", { children: t !== null ? t("foreignDocWhy") : "" }), (0, react_jsx_runtime.jsx)("p", { children: t !== null ? t("foreignDocEffect") : "" }), (0, react_jsx_runtime.jsx)("p", { children: t !== null ? t("foreignDocKeep") : "" })]
                    }) : null, evacNotice !== null ? (0, react_jsx_runtime.jsxs)("div", {
                        className: c.notice,
                        "data-kind": "info",
                        role: "status",
                        children: [(0, react_jsx_runtime.jsx)("span", { className: c.noticeText, children: evacNotice }), (0, react_jsx_runtime.jsx)("button", {
                                type: "button",
                                className: c.noticeButton,
                                onClick: () => { setEvacNotice(null); },
                                children: t !== null ? t("close") : ""
                            })]
                    }) : null, loadState.kind === "error" ? (0, react_jsx_runtime.jsxs)("div", {
                        className: c.notice,
                        "data-kind": "error",
                        children: [(0, react_jsx_runtime.jsx)("span", { className: c.noticeText, children: loadState.message }), (0, react_jsx_runtime.jsx)("button", {
                                type: "button",
                                className: c.noticeButton,
                                onClick: () => refresh(true),
                                children: t !== null ? t("retry") : ""
                            })]
                    }) : null, (0, react_jsx_runtime.jsx)("div", {
                        className: m.toolbar,
                        children: (0, react_jsx_runtime.jsx)("button", {
                            type: "button",
                            className: m.add,
                            onClick: () => { setDialogError(null); setEditing({ server: null }); },
                            children: t !== null ? t("add") : ""
                        })
                    }), loadState.kind === "loading" && servers.length === 0 ? (0, react_jsx_runtime.jsx)("p", { className: m.sub, children: t !== null ? t("loading") : "" }) : null, servers.length === 0 && external.length === 0 && loadState.kind === "ready" ? (0, react_jsx_runtime.jsx)("p", { className: m.sub, children: t !== null ? t("empty") : "" }) : null, (0, react_jsx_runtime.jsxs)("div", {
                        className: m.cards,
                        children: [...servers.map((server) => serverCard(server, false)), ...external.map((server) => serverCard(server, true))]
                    }), editing !== null ? (0, react_jsx_runtime.jsx)(McpFormDialog, {
                        t: t !== null ? t : (key) => key,
                        initial: editing.server,
                        onSave: applySave,
                        onCancel: () => setEditing(null),
                        busy: dialogBusy,
                        error: dialogError
                    }) : null]
            });
        }
        // ── 主页全局面板（sidebar.panellist + main）───────────────────────────
        // 宿主侧栏的「插件」那一行就是这两个槽位的产物：一个 list 槽位放图标/标题，
        // 一个 keyed 槽位放中央主区的整页内容。这里以同款方式把「技能」「MCP」挂进
        // 侧栏，点击即把中央主区切到对应页面（不是设置页那种模态框）。
        // 侧栏只占一行：技能与 MCP 合成一个入口（Skill/MCP），页签在面板内部切换。
        const PANEL_ID = "skill-mcp";
        /** 上次停留的页签；localStorage 不可用时静默退化为「技能」。 */
        const PANEL_TAB_KEY = "dsh-skill-mcp-panel:last-tab";
        function readLastTab() {
            try {
                return typeof localStorage !== "undefined" && localStorage.getItem(PANEL_TAB_KEY) === "mcp" ? "mcp" : "skills";
            }
            catch {
                return "skills";
            }
        }
        function writeLastTab(tab) {
            try {
                if (typeof localStorage !== "undefined")
                    localStorage.setItem(PANEL_TAB_KEY, tab);
            }
            catch {
                // 隐私模式等场景：记不住就算了，不影响面板本身。
            }
        }
        /**
         * 侧栏面板字形：技能 / MCP 合并成一个入口后共用同一枚图标。
         * 图形是内联 SVG 蒙版（见 cssPanelIcon），背景取 currentColor，
         * 尺寸与颜色都跟随宿主侧栏行（选中 / 折叠态自动变换）。
         */
        function PanelGlyph({ size }) {
            const edge = typeof size === "number" && size > 0 ? size : 16;
            return (0, react_jsx_runtime.jsx)("span", {
                className: "SKV_panelIcon SKV_panelIconMerged",
                "aria-hidden": "true",
                style: { width: edge, height: edge }
            });
        }
        function PanelIcon(props) {
            return (0, react_jsx_runtime.jsx)(PanelGlyph, { size: props.size });
        }
        /**
         * 页面左上角的返回箭头：回到会话视图。宿主 layout 服务的 `selectPanel(null)` 就是
         * 「把主区还给 Conversation」，而且它不改当前选中会话——面板本来也没换过会话，
         * 所以返回的就是进来之前那个会话。沿用宿主「面包屑」的外观（14px 左向折角 + 文案）。
         */
        function PageBack({ label, onBack }) {
            const chevron = primitiveIcon("IconChevronLeftOutlineRegular");
            const glyph = chevron !== void 0
                ? (0, react_jsx_runtime.jsx)(chevron, { size: 14 })
                : (0, react_jsx_runtime.jsx)("svg", {
                    width: 14,
                    height: 14,
                    viewBox: "0 0 16 16",
                    fill: "none",
                    "aria-hidden": "true",
                    children: (0, react_jsx_runtime.jsx)("path", { d: "M10 3.5 5.5 8l4.5 4.5", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" })
                });
            return (0, react_jsx_runtime.jsxs)("button", {
                type: "button",
                className: c.pageBack,
                title: label,
                onClick: onBack,
                children: [glyph, (0, react_jsx_runtime.jsx)("span", { children: label })]
            });
        }
        /** 技能页：返回箭头 + 页头 + 既有的技能面板。 */
        /**
         * 合并面板：返回箭头 + 「技能 / MCP」页签 + 当前页签的正文。
         *
         * 侧栏空间宝贵，两个面板本来就常一起用，所以只占一行；页签选择记在 localStorage，
         * 下次点开侧栏这一行时停在上次离开的那一页。
         */
        function CombinedPanelPage(props) {
            const t = props.t;
            const mt = props.mt;
            const [tab, setTab] = react.useState(readLastTab);
            const select = (next) => {
                setTab(next);
                writeLastTab(next);
            };
            const tabButton = (id, label) => (0, react_jsx_runtime.jsx)("button", {
                type: "button",
                className: c.tab,
                "data-active": tab === id ? "true" : "false",
                "aria-pressed": tab === id,
                onClick: () => select(id),
                children: label
            }, id);
            // data-tab 只是给外壳样式用（cssShell）：
            //   技能页签 → 去掉页面内边距、整页交给三栏自己排版；
            //   MCP 页签 → 单列、内容放宽到 ~1040px（左轨与中栏随技能页签一起卸载）。
            // 页头与页签保持为页面的第 1、2 个孩子（槽位契约：test-panel-slots.mjs）。
            return (0, react_jsx_runtime.jsxs)("div", {
                className: c.page,
                "data-tab": tab,
                children: [(0, react_jsx_runtime.jsx)("div", {
                        className: c.pageTop,
                        children: (0, react_jsx_runtime.jsx)(PageBack, { label: t !== null && t !== undefined ? t("back") : "", onBack: props.backToConversation })
                    }), (0, react_jsx_runtime.jsxs)("div", {
                        className: c.tabs,
                        role: "tablist",
                        children: [tabButton("skills", t("nav")), tabButton("mcp", mt("nav"))]
                    }), tab === "mcp" ? (0, react_jsx_runtime.jsx)(McpSection, { ...props, t: mt }) : (0, react_jsx_runtime.jsx)(SkillsSection, { ...props })]
            });
        }
        // ── cordis 插件体 ─────────────────────────────────────────────────────
        const inject = ["slots", "locale", "remote", "sessions", "layout"];
        function apply(ctx) {
            // 字典注册（生命周期随插件 fiber）
            ctx.effect(() => ctx.locale.register(NS, { zh, en }), "ui-skill-mcp-panel: skill dictionaries");
            ctx.effect(() => ctx.locale.register(MCP_NS, { zh: mcpZh, en: mcpEn }), "ui-skill-mcp-panel: mcp dictionaries");
            const t = ctx.locale.bind(NS);
            const mt = ctx.locale.bind(MCP_NS);
            // 挂载远程贡献；所有远程调用都等待挂载完成后再取命名空间服务。
            const mount = ctx.remote.$mount(CONTRIBUTION);
            // 当前会话 id，仅用于把会话级项目作用域传给服务端；技能页不再以「是否
            // 打开会话」门控 UI。宿主客户端以「主视图引用计数」定义当前会话：
            //   sessions.list 快照的 byId[id].retainedBy.mainView > 0
            // （dsh-client-ui-session 的 isMain、settings-general 等用的都是这条判据）。
            // 该快照既没有 current 也没有 sessionId 字段，早先按
            // currentProvideInfo → selection → list.current 逐级探测的写法在本版恒为
            // undefined。这里按 mainView 引用判定，并保留历史探测作为其它外壳的兜底。
            // 都取不到时返回 undefined：服务端把 sessionId 视为可选，会回退全局注册表并
            // 自行枚举工作区，仅丢失会话级项目作用域，功能仍可用。
            const currentSessionId = () => {
                const sessions = ctx.get("sessions");
                const snapshotOf = (store) => store !== null && typeof store === "object" && typeof store.getSnapshot === "function" ? store.getSnapshot() : undefined;
                try {
                    const rows = snapshotOf(sessions?.list)?.byId;
                    if (rows) {
                        for (const id of Object.keys(rows)) {
                            const row = rows[id];
                            if (((row && row.retainedBy && row.retainedBy.mainView) || 0) > 0)
                                return id;
                        }
                    }
                }
                catch {
                    // 快照不可用：继续走下面的历史探测
                }
                for (const store of [sessions?.currentProvideInfo, sessions?.selection, sessions?.list]) {
                    const snapshot = snapshotOf(store);
                    const direct = snapshot?.sessionId;
                    if (typeof direct === "string" && direct !== "")
                        return direct;
                    const current = snapshot?.current;
                    if (typeof current === "string" && current !== "")
                        return current;
                }
                return undefined;
            };
            // 订阅「当前会话」变化：宿主 list 快照没有 current 字段，只能订阅它自行推导。
            const subscribeSession = (listener) => {
                const store = ctx.get("sessions")?.list;
                if (store === null || typeof store !== "object" || typeof store.subscribe !== "function")
                    return () => { };
                const dispose = store.subscribe(listener);
                return typeof dispose === "function" ? dispose : () => { };
            };
            const callRemote = async (method, ...args) => {
                await mount;
                const remote = ctx.get("remote.skillsViewer");
                const result = await remote[method](...args);
                if (!result.ok)
                    throw new Error("skillsViewer." + method + " failed: " + result.error.code + ": " + result.error.message);
                return result.value;
            };
            const callMcp = async (method, ...args) => {
                await mount;
                const remote = ctx.get("remote.mcpManager");
                const result = await remote[method](...args);
                if (!result.ok)
                    throw new Error("mcpManager." + method + " failed: " + result.error.code + ": " + result.error.message);
                return result.value;
            };
            // 返回会话：layout 服务由宿主 shell 提供（已声明进 inject）；取不到时箭头是空操作，
            // 不影响其它功能。
            const backToConversation = () => {
                const layout = ctx.get("layout");
                if (layout === null || typeof layout !== "object")
                    return;
                if (typeof layout.selectPanel === "function")
                    layout.selectPanel(null);
            };
            const sectionFace = () => ({
                backToConversation,
                currentSessionId,
                subscribeSession,
                listSkills: () => callRemote("list", currentSessionId()),
                listWorkspaces: () => callRemote("workspaces"),
                openFolder: (path) => callRemote("openFolder", path),
                loadContent: (name, scope) => callRemote("content", name, currentSessionId(), scope),
                setSkillEnabled: (name, enabled, scope) => callRemote("setEnabled", name, currentSessionId(), enabled, scope),
                batchMigrateSkill: (payload) => callRemote("batchMigrate", currentSessionId(), payload),
                listGroups: () => callRemote("groups"),
                saveGroupSkill: (payload) => callRemote("saveGroup", payload),
                deleteGroupSkill: (payload) => callRemote("deleteGroup", payload),
                checkUpdateRemote: () => callRemote("checkUpdate"),
                removeSkill: (name, scope) => callRemote("deleteSkill", name, currentSessionId(), scope),
                addSkill: (payload) => callRemote("addSkill", currentSessionId(), payload)
            });
            const mcpSectionFace = () => ({
                backToConversation,
                listMcp: () => callMcp("list"),
                saveMcp: (input, previousServerName) => callMcp("save", { input, previousServerName }),
                removeMcp: (serverName) => callMcp("removeServer", { serverName }),
                setEnabledMcp: (serverName, enabled) => callMcp("setEnabled", { serverName, enabled }),
                testMcp: (payload) => callMcp("test", payload),
                reloadMcp: () => callMcp("reload"),
                oauthStart: (payload) => callMcp("oauthStart", payload),
                oauthPoll: (payload) => callMcp("oauthPoll", payload),
                oauthDisconnect: (payload) => callMcp("oauthDisconnect", payload),
                listMcpTools: (payload) => callMcp("listTools", payload),
                getToolFilter: () => callMcp("getToolFilter"),
                setToolFilter: (payload) => callMcp("setToolFilter", payload),
                evacuateForeign: () => callMcp("evacuateForeign"),
            });
            // 技能与 MCP 合成一个侧栏入口：注入面同时带两边的动作与字典绑定，
            // 页面内部的页签决定渲染哪一个 section。
            const combinedFace = () => ({
                ...sectionFace(),
                ...mcpSectionFace(),
                t,
                mt
            });
            // 侧栏面板行：order 1 紧跟在宿主「插件」行（order 0）下方；
            // 行标题由侧栏从 label 投影，locale 变化时会重新投影。
            // 2026-10-15 定案：**只做侧栏一个入口**。曾经试过「入口位置开关 + 设置页页签」，
            // 但面板元素太多、设置页塞不下，两处渲染等于要维护两套前端，直接不要了。
            ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
                name: "sidebar.panellist",
                id: PANEL_ID,
                order: 1,
                label: () => t("navCombined"),
                locale: NS
            }, PanelIcon));
            // 中央主区页面：key 必须与上面的行 id 一致，选中缺失 key 宿主会直接抛错。
            ctx.slots.inject("main", () => ctx.slots.register({
                name: "main",
                key: PANEL_ID,
                locale: NS,
                inject: combinedFace
            }, CombinedPanelPage));
        }
        bundleModule.exports.NS = NS;
        bundleModule.exports.apply = apply;
        bundleModule.exports.inject = inject;
        return bundleModule.exports;
    }
});
