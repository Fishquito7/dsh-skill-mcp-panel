window.__ModuleLoader__.load({
	id: "dsh-skill-viewer",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		// Bundle contract: this file is served by the host at
		// /plugins/dsh-skill-viewer/client.js and must only require
		// the shell seed words (react, jsx-runtime, primitives).
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let primitives = require("@deepseek-ai/dsh-client-ui-primitives");

		// ── styles (grouped for readability) ───────────────────────────────────
		// 页面骨架：section / 状态文案 / 搜索框 / 标题行
		const cssChrome = ".SKV_section{width:100%;max-width:760px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:14px;display:flex}.SKV_status{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px;margin:0}.SKV_failure{color:var(--dsw-alias-state-error-primary);align-items:center;gap:10px;display:flex}.SKV_failure p{margin:0}.SKV_failure button{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;background:0 0;border-radius:6px;padding:4px 10px}.SKV_catalog{flex-direction:column;gap:12px;display:flex}.SKV_search{width:100%;color:var(--dsw-alias-label-tertiary);align-items:center;display:flex;position:relative}.SKV_search>svg{pointer-events:none;position:absolute;left:12px}.SKV_search input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);width:100%;height:36px;color:var(--dsw-alias-label-primary);font:inherit;border-radius:8px;outline:none;padding:0 34px 0 36px;font-size:13px}.SKV_search input::placeholder{color:var(--dsw-alias-label-tertiary)}.SKV_search input:focus-visible{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-business-primary) 18%, transparent)}.SKV_catalogHeading{align-items:baseline;gap:7px;padding:0 2px;display:flex}.SKV_catalogHeading h3{font-size:13px;font-weight:600;line-height:20px;margin:0}.SKV_catalogHeading span{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;font-size:12px;line-height:18px}";
		// 卡片列表：卡片、状态标签、内容框、开关与删除操作
		const cssCards = ".SKV_cards{grid-template-columns:repeat(2,minmax(0,1fr));align-items:start;gap:10px;margin:0;padding:0;list-style:none;display:grid}.SKV_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:10px;min-width:0;overflow:hidden}.SKV_card[data-open=true]{border-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-shadow-lv1)}.SKV_cardContent{width:100%;align-items:center;gap:8px;font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;border:none;padding:10px 12px;display:flex;text-align:left}.SKV_cardLeading{width:16px;height:16px;color:var(--dsw-alias-label-tertiary);flex:none;justify-content:center;align-items:center;display:inline-flex}.SKV_cardTitle{min-width:0;flex:1;text-overflow:ellipsis;white-space:nowrap;overflow:hidden;font-size:13px;font-weight:500;line-height:20px;transition:color .2s ease}.SKV_cardTitle[data-disabled=true]{color:var(--dsw-alias-label-tertiary)}.SKV_cardTrailing{color:var(--dsw-alias-label-tertiary);flex:none;align-items:center;gap:7px;display:inline-flex}.SKV_statusDot{background:var(--dsw-alias-label-tertiary);border-radius:999px;flex:none;width:7px;height:7px;display:inline-block;transition:background-color .2s ease}.SKV_statusDot[data-enabled=true]{background:var(--dsw-alias-state-success-primary)}.SKV_configTag{background:var(--dsw-alias-bg-layer-1);min-height:20px;color:var(--dsw-alias-label-secondary);white-space:nowrap;border-radius:5px;align-items:center;padding:1px 6px;font-size:11px;line-height:16px;display:inline-flex;transition:background-color .2s ease,color .2s ease}.SKV_configTag[data-enabled=true]{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);color:var(--dsw-alias-state-success-primary)}.SKV_configTag[data-enabled=false]{color:var(--dsw-alias-label-tertiary)}.SKV_chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .15s}.SKV_card[data-open=true] .SKV_chevron{transform:rotate(180deg)}.SKV_cardDetails{border-top:1px solid var(--dsw-alias-border-l2);flex-direction:column;gap:8px;padding:10px 12px;display:flex}.SKV_meta{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;margin:0}.SKV_metaProvider{color:var(--dsw-alias-label-tertiary);margin-left:6px}.SKV_contentBox{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-markdown-code-block);border-radius:8px;max-height:213px;overflow:auto}.SKV_content{margin:0;padding:10px 12px;white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Consolas,Menlo,monospace;font-size:12px;line-height:18px}.SKV_failureText{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;margin:0}.SKV_cardActions{border-top:1px solid var(--dsw-alias-border-l2);align-items:center;gap:8px;padding-top:10px;display:flex}.SKV_switchRow{align-items:center;gap:8px;display:inline-flex}.SKV_switch{box-sizing:border-box;width:36px;height:20px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:999px;cursor:pointer;padding:0;position:relative;flex:none;transition:background-color .2s ease,border-color .2s ease}.SKV_switch:disabled{cursor:default;opacity:.6}.SKV_switch[data-on=true]{border-color:transparent;background:var(--dsw-alias-state-business-primary)}.SKV_switchThumb{box-sizing:border-box;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-secondary);position:absolute;top:2px;left:2px;transition:transform .22s cubic-bezier(.34,1.56,.64,1),background-color .18s ease,width .15s ease}.SKV_switch[data-on=true] .SKV_switchThumb{transform:translateX(18px);background:var(--dsw-alias-label-primary-foreground)}.SKV_switch:active:not(:disabled) .SKV_switchThumb{width:18px}.SKV_switch[data-on=true]:active:not(:disabled) .SKV_switchThumb{transform:translateX(14px)}.SKV_switchText{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}.SKV_opError{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}.SKV_deleteButton{box-sizing:border-box;height:28px;color:var(--dsw-alias-state-error-primary);font:inherit;cursor:pointer;background:0 0;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;padding:0 12px;font-size:12px;line-height:26px;margin-left:auto}.SKV_deleteButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid)}.SKV_deleteButton:disabled{cursor:default;opacity:.6}";
		// 添加技能：按钮组与状态行
		const cssAdd = ".SKV_addActions{margin-left:auto;align-items:center;gap:6px;display:inline-flex;position:relative}.SKV_addButton{box-sizing:border-box;width:28px;height:28px;color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;background:0 0;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;padding:0;display:inline-flex;align-items:center;justify-content:center}.SKV_addButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid)}.SKV_addButton:disabled{cursor:default;opacity:.6}.SKV_addMenu{position:absolute;top:calc(100% + 4px);right:0;background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;box-shadow:var(--dsw-shadow-lv1);flex-direction:column;padding:4px;display:flex;z-index:10}.SKV_addMenuItem{font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;border:none;border-radius:6px;padding:6px 12px;font-size:13px;line-height:20px;text-align:left;white-space:nowrap}.SKV_addMenuItem:hover{background:var(--dsw-alias-interactive-bg-hover)}.SKV_addStatus{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin:0}.SKV_addErrorBanner{border:1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 40%, transparent);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);border-radius:8px;align-items:center;gap:10px;padding:8px 12px;display:flex}.SKV_addErrorText{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;flex:1;min-width:0}.SKV_addDismiss{font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:2px 10px;font-size:12px;line-height:18px;flex:none}.SKV_addDismiss:hover{background:var(--dsw-alias-interactive-bg-hover-solid)}.SKV_fileInput{display:none}";
		// 作用域：卡片标签、作用域编辑弹层
		const cssScope = ".SKV_scopeTag{background:var(--dsw-alias-bg-layer-1);min-height:20px;color:var(--dsw-alias-label-secondary);white-space:nowrap;border-radius:5px;align-items:center;padding:1px 6px;font-size:11px;line-height:16px;display:inline-flex}.SKV_scopeTag[data-scoped=true]{background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent);color:var(--dsw-alias-state-business-primary)}.SKV_scopeTag[data-scoped=true][data-zero=true]{background:color-mix(in srgb, var(--dsw-alias-state-warning-primary) 12%, transparent);color:var(--dsw-alias-state-warning-primary)}.SKV_scopeEditButton{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:3px 10px;font-size:12px;line-height:18px}.SKV_scopeEditButton:hover{background:var(--dsw-alias-interactive-bg-hover-solid)}.SKV_scopeOverlay{position:fixed;inset:0;background:color-mix(in srgb, rgba(0,0,0,.45) 55%, transparent);align-items:center;justify-content:center;display:flex;z-index:1000}.SKV_scopeBox{background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;box-shadow:var(--dsw-shadow-lv2);width:440px;max-width:calc(100vw - 48px);max-height:80vh;flex-direction:column;padding:16px;gap:12px;display:flex}.SKV_scopeBox h4{font-size:14px;font-weight:600;line-height:20px;margin:0}.SKV_scopeOptions{flex-direction:column;gap:8px;display:flex}.SKV_scopeOption{font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 12px;font-size:13px;line-height:20px;text-align:left;display:flex;align-items:center;gap:8px}.SKV_scopeOption[data-active=true]{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 1px color-mix(in srgb, var(--dsw-alias-state-business-primary) 30%, transparent)}.SKV_scopeOption input{margin:0;accent-color:var(--dsw-alias-state-business-primary)}.SKV_wsList{flex-direction:column;gap:4px;max-height:200px;overflow:auto;padding:0;margin:0;list-style:none;display:flex}.SKV_wsItem{font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;border:none;border-radius:6px;padding:5px 8px;font-size:12px;line-height:18px;text-align:left;display:flex;align-items:center;gap:8px}.SKV_wsItem:hover{background:var(--dsw-alias-interactive-bg-hover)}.SKV_wsItem input{margin:0;flex:none;accent-color:var(--dsw-alias-state-business-primary)}.SKV_wsPath{color:var(--dsw-alias-label-tertiary);min-width:0;text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.SKV_manualRow{align-items:center;gap:6px;display:flex}.SKV_manualInput{flex:1;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);height:30px;color:var(--dsw-alias-label-primary);font:inherit;border-radius:6px;outline:none;padding:0 8px;font-size:12px}.SKV_manualInput:focus-visible{border-color:var(--dsw-alias-state-business-primary)}.SKV_manualAdd{font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:3px 10px;font-size:12px;flex:none}.SKV_scopeHint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin:0}.SKV_scopeWarning{color:var(--dsw-alias-state-warning-primary);font-size:12px;line-height:18px;margin:0}.SKV_scopeActions{align-items:center;justify-content:flex-end;gap:8px;display:flex}.SKV_scopeAction{font:inherit;cursor:pointer;border-radius:6px;padding:5px 14px;font-size:13px;line-height:20px}.SKV_scopeCancel{background:0 0;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}.SKV_scopeConfirm{background:var(--dsw-alias-state-business-primary);border:1px solid transparent;color:var(--dsw-alias-state-business-on-primary, #fff)}.SKV_scopeConfirm:disabled{opacity:.6;cursor:default}";
		const cssUtils = ".SKV_visuallyHidden{position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;clip:rect(0 0 0 0);overflow:hidden;white-space:nowrap}";
		// 设置页导航图标（外壳硬编码图标，无扩展点：打标记 + CSS 蒙版绘制）
		const cssIcon = "button[data-skills-nav]>svg{display:none}button[data-skills-nav]::before{content:\"\";width:16px;height:16px;flex:none;display:inline-block;background-color:currentColor;-webkit-mask:url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAfxSURBVHhe7Vtbq2RHFY5JUIPXaIh4efBdAl6iDyFM4pNEIoLgPzAmoCBkjAFBQx589Af4mssQEBI1JoJnxpnM0dwmo4LOJRNfzJmZZAjMOWeOPb2+tdauHVZ1VXftNd3n9Om9d59DzAeLql27dl2+XmtV1dq7r7vufbyPuSEi94jI48xyGsBbAN6OQllodN2US8zsyyZizxXXInKBmZ/a3Ayf9v3vGba2tj6jzH+olwhV/efW1tatfixLh01eRE7boJi5BuDH2hmIKGSxa2b+x5UrV27xY1oqADwfBzccBhWJA2XwRRE5zsyHARxh4AiAv5gwc8yP06KcEcuO2HP2TK4D4LBATjBzABBAFMX6EpGTGxsbn/LjWgqGw+G30i9RC0tdVZWp5sEQwsd93bYIIdwWJ2xalgjImiCqJ/dEE4joUFbNlP7C1+kKzHx7HUIkIPcXQoialzThRAhhuZoA4GweCIPfuXTp0kd9nUVR1/UHTPI1M389VEaAmJaZrzHzeGdkfmNzOLG+Xn+y2VKPAHAhGr2ZAfHf/f0uwQO+3UzMCEhm9yMAX1XV/zkSXqvr+mb/fC8AcL4g4DV/v0sw89dCk4BfWvlwOLxbVbdGJIzN4eWlOEYG1goC+tUAbmoAMUUCDFevXr1LVQeOhFcuX778iWYrHaNBAPeuAYkAzv1Fh5v9hAzFNCGaw7Agoa7r/khg5jEBAF7197uEmUBDA4geyfcyCaU5FCS81Js5lD6AiE74+12Cmb8RV5ukAZkAv1okc7hGE9bX17tfHUoC+taAAQ9GBKStNtHIB5STzzASKq0ajlFFX63rjpfIBgE9awCAr1Q68QEAfmXlXgMykjkkxzhaIlX1lc3Nze5OkbxEExgMBp8DcNX8QCLgZV/HUBIiIt8c7xPS7tFI2NjY6Gaf4EygVwIMAP6a+hpNhvlBX8cDwJdV9WKlWhONnrMdYyckLHMjZADw/dgXMHaGzPykiHw3hHAHM9/JzAeSWP5OMx1bMkVE4mlycoq0JbIdCctcBTIY+K31B5qQsBMACIj0mlOkyIutTq57QUBd1x9m5t/nfk0bLAhjZETBKDVnWV6DJnGEMp5ARI/5PuaGc4K9m0AJVf1xVem53P9uYKtJ1gIAF33bc6MkANS/E/QIIXwohHBAVR9Q1oeY+SFV/amlSSz/M2Z+OKUPKutBZn7TjtSJgPO+3bnR3Acsn4BFAWB1PO42BDCWdxYo4Tc+0zZDuayUfA/AS8W418rndgXnBHslwE/Cw9/3k59FgP2I40Z2i2VuhXdCOcntiDIAeHE87jYm0NQAPunv942dJjoLoNIEuCsCaOkELIqGCXALE2DmyVa454hQlxBI6QQX14DmRmhiAtNUczgcflFEDgF4Ib3tOQrCUSI6NkpxDBgJEa0S0XEiesHuWwqKz42EsArgeK6fyo+LyN+qqnraXqL4/kt05gMYEw0oT4PTCMiv0JYBe2dY1/X1fgwZdpTOdUG44O/PDXs4N1SeBWYQcGw8wp7BzG/UdX2DH0OG8wGLa4BzgmMfMGPtvU1VV1T1NDNPBEgp2zcFlj/DzKcAnErlZ4TFyk/J5DnLnxKWKHbNjLMicrbSalVE7h4Pcgq6M4EiKkxFPMBP3qMg6PqSrCllls9SXk+rf8N2v3qJhgm0IaCxEVpCRKgrdKYBto/ODe3FMug1bTutK9HcCHVFwIyQmB/kfoA7DLUiYFcmEEL4Ugjhrhy3Cxxy/O6AxfKLeF6ZnynWlgU9fT87AdTwAS12gsU+YKeQGDM/UFVVjMJ0DQC/9v1th840wBHQMAGv9sz879hhCmZuKymOd424cmsrTeKKRYfK/sqVoiw3EJFFhNsTUJrAdj7AUnuTk+t2DSJ6ctpEZ5HglsHFTWBeH5AHICL3WvyOmX+owH2WArgPwA8sZeb7k1h5LMtS1I352Ibq/SLyvbqub/R9bgcQdWMC74XjcCsCSh/Q9T5glvp2gc7iAQ0f0DEBfYKIxj6gSwL2hQnMozHUhw/wYXGvwoPB4AtVVf1GVf/E4OcsPpDE8n8E8KyJvfZK+Xi/qiore6Su6w+W7c/CPASg1IDuYoITAvzkDcz8u1x3ETDt/CrcMBcBjbB4Cw1ovBgp3gxNIwBE8d3+ohCRR8cdtwSIOjoNEk01gZKATIJ95aWqq8x8DsDrAM4xOKYpf8Y+vbV7KShi16+rql0f2s2XXp58j3Ij1EoDytOgD4nNGkQKXNzoxMossBGDGl58G21R+oB2GjBjGZxGwDQy9gpuK7x4ULT8UnTaVtgT4EnxKOtsV68tOiNgnoBIxryTWhIB5WlwcQLMcVkj6f8Cb4cQbvJ1Suw0qXLifZFgY7R/n9mYEwFv+Dpzg4ieio1Mvrf5ua+z30BEB9PE8ycyz/g6c4OI7o3qDw4WoFDRoKoPhxA+5uvuNUIIH1HVn6iqfTEXgyvpR/uOr7srENGKNWQfJquMv7tZS+///gxghS0l+H+QWRrLkqwU+XjN4BVQfOZwzI/qWJk9NxIiEyuze9Zf7DOLjS+1918bm30blL8fJqKjfj67RgjhsyJir6IiqzlMtR9BRONfnpn/Y5/f+vksBGtIVZ/zHe5XqOrzg8Hg834erUFE3xaRx5j5X7ZHsI1SFIqpXa8RUb4+b3lK+SRrIBrVSfWz2LnDnkv3zoPoQvHcNX2M68UyftPeH1ZV9URrm/9/w7uta8ACW3GakwAAAABJRU5ErkJggg==) center/16px 16px no-repeat;mask:url(data:image/png;base64,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) center/16px 16px no-repeat}body[data-ds-dark-theme] .SKV_switchThumb{background:#fff}body[data-ds-dark-theme] .SKV_switch[data-on=true] .SKV_switchThumb{background:#fff}";
		const css = cssChrome + cssCards + cssAdd + cssScope + cssUtils + cssIcon;
		const tagId = "dsh-skill-viewer/SkillsSection.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-skill-viewer";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}

		// 类名映射（CSS 是内联手写字符串，无法走 CSS Modules）
		const c = {
			section: "SKV_section",
			status: "SKV_status",
			failure: "SKV_failure",
			catalog: "SKV_catalog",
			search: "SKV_search",
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
			addButton: "SKV_addButton",
			addStatus: "SKV_addStatus",
			addMenu: "SKV_addMenu",
			addMenuItem: "SKV_addMenuItem",
			addErrorBanner: "SKV_addErrorBanner",
			addErrorText: "SKV_addErrorText",
			addDismiss: "SKV_addDismiss",
			fileInput: "SKV_fileInput",
			visuallyHidden: "SKV_visuallyHidden",
			scopeTag: "SKV_scopeTag",
			scopeEditButton: "SKV_scopeEditButton",
			scopeOverlay: "SKV_scopeOverlay",
			scopeBox: "SKV_scopeBox",
			scopeOptions: "SKV_scopeOptions",
			scopeOption: "SKV_scopeOption",
			wsList: "SKV_wsList",
			wsItem: "SKV_wsItem",
			wsPath: "SKV_wsPath",
			manualRow: "SKV_manualRow",
			manualInput: "SKV_manualInput",
			manualAdd: "SKV_manualAdd",
			scopeHint: "SKV_scopeHint",
			scopeWarning: "SKV_scopeWarning",
			scopeActions: "SKV_scopeActions",
			scopeAction: "SKV_scopeAction",
			scopeCancel: "SKV_scopeCancel",
			scopeConfirm: "SKV_scopeConfirm"
		};

		// ── locale ─────────────────────────────────────────────────────────────
		const NS = "settings.skills";

		const zh = {
			nav: "技能",
			loading: "正在读取技能…",
			error: "暂时无法读取技能。",
			retry: "重试",
			search: "搜索技能",
			catalog: "技能列表",
			empty: "暂无技能。",
			emptySearch: "没有匹配的技能。",
			noSession: "打开一个会话后即可查看该会话的技能。",
			contentLoading: "正在加载技能内容…",
			contentError: "技能内容加载失败。",
			contentMissing: "技能内容不可用。",
			providerLabel: "来源",
			enabledTag: "已启用",
			disabledTag: "已停用",
			switchEnable: "启用",
			switchDisable: "停用",
			deleteLabel: "删除",
			deleteConfirm: "确定要删除技能 ",
			deleteConfirmSuffix: " 吗？此操作不可恢复。",
			opFailed: "操作失败",
			addButton: "添加技能",
			addMenuFolder: "选择目录束",
			addMenuFile: "选择单文件",
			addDismiss: "知道了",
			addBusy: "正在添加技能…",
			addTooMany: "所选内容文件数量过多。",
			addFolderUnsupported: "当前浏览器不支持选择文件夹，请改用“选择技能文件”。",
			addNoSkillFile: "所选文件夹不是有效的技能目录：缺少顶层的 SKILL.md 文件。",
			scopeGlobal: "全局",
			scopeScopedPrefix: "",
			scopeScopedSuffix: " 个工作区",
			scopeEditLabel: "作用域",
			scopeDialogTitle: "技能作用域",
			scopeGlobalOption: "全局（所有工作区可用）",
			scopeScopedOption: "仅限以下工作区",
			scopeNoWorkspaces: "暂无已打开的工作区，可在下方手动输入路径",
			scopeManualPlaceholder: "手动输入工作区路径",
			scopeManualAdd: "添加",
			scopeConfirm: "确认",
			scopeCancel: "取消",
			scopeSave: "保存",
			scopeSaving: "正在保存作用域…",
			scopeZeroWarning: "该技能当前没有任何生效的工作区，所有会话都看不到它。请重新选择工作区或改为全局。"
		};

		const en = {
			nav: "Skills",
			loading: "Reading skills…",
			error: "Skills are temporarily unavailable.",
			retry: "Retry",
			search: "Search skills",
			catalog: "Skills",
			empty: "No skills are available.",
			emptySearch: "No matching skills.",
			noSession: "Open a session to view its skills.",
			contentLoading: "Loading skill content…",
			contentError: "Skill content failed to load.",
			contentMissing: "Skill content is unavailable.",
			providerLabel: "Provider",
			enabledTag: "Enabled",
			disabledTag: "Disabled",
			switchEnable: "Enable",
			switchDisable: "Disable",
			deleteLabel: "Delete",
			deleteConfirm: "Delete skill ",
			deleteConfirmSuffix: "? This cannot be undone.",
			opFailed: "Operation failed",
			addButton: "Add skill",
			addMenuFolder: "Choose directory bundle",
			addMenuFile: "Choose single file",
			addDismiss: "Dismiss",
			addBusy: "Adding skill…",
			addTooMany: "Too many files in the selection.",
			addFolderUnsupported: "This browser cannot pick folders — use Choose skill file instead.",
			addNoSkillFile: "Not a valid skill folder: missing a top-level SKILL.md file.",
			scopeGlobal: "Global",
			scopeScopedPrefix: "",
			scopeScopedSuffix: " workspaces",
			scopeEditLabel: "Scope",
			scopeDialogTitle: "Skill scope",
			scopeGlobalOption: "Global (available in every workspace)",
			scopeScopedOption: "Only these workspaces",
			scopeNoWorkspaces: "No workspaces seen yet — enter a path manually below",
			scopeManualPlaceholder: "Enter a workspace path",
			scopeManualAdd: "Add",
			scopeConfirm: "Confirm",
			scopeCancel: "Cancel",
			scopeSave: "Save",
			scopeSaving: "Saving scope…",
			scopeZeroWarning: "This skill has no effective workspace right now — no session can see it. Pick workspaces again or switch to Global."
		};

		// ── remote contribution ───────────────────────────────────────────────
		// 手写 codec：客户端边界只要求 parse()，服务端 manifest 负责严格校验。
		const identity = (value) => value;
		const codec = (symbol) => ({ mode: "strict", typeSymbol: symbol, schema: { parse: identity } });

		const CONTRIBUTION = {
			package: "dsh-skill-viewer",
			descriptors: [
				{
					id: "dsh-skill-viewer#skillsViewer/list",
					service: "skillsViewer",
					namespace: "skillsViewer",
					method: "list",
					invocation: { kind: "direct" },
					parameters: [
						{ name: "sessionId", wire: "sessionId", source: "json", acceptsUndefined: true, codec: codec("dsh-skill-viewer#sessionId") }
					],
					result: codec("dsh-skill-viewer#SkillListResult")
				},
				{
					id: "dsh-skill-viewer#skillsViewer/workspaces",
					service: "skillsViewer",
					namespace: "skillsViewer",
					method: "workspaces",
					invocation: { kind: "direct" },
					parameters: [],
					result: codec("dsh-skill-viewer#WorkspacesResult")
				},
				{
					id: "dsh-skill-viewer#skillsViewer/setScope",
					service: "skillsViewer",
					namespace: "skillsViewer",
					method: "setScope",
					invocation: { kind: "direct" },
					parameters: [
						{ name: "name", wire: "name", source: "json", codec: codec("dsh-skill-viewer#SkillName") },
						{ name: "sessionId", wire: "sessionId", source: "json", acceptsUndefined: true, codec: codec("dsh-skill-viewer#sessionId") },
						{ name: "workspaces", wire: "workspaces", source: "json", codec: codec("dsh-skill-viewer#WorkspaceList") }
					],
					result: codec("dsh-skill-viewer#SetScopeResult")
				},
				{
					id: "dsh-skill-viewer#skillsViewer/content",
					service: "skillsViewer",
					namespace: "skillsViewer",
					method: "content",
					invocation: { kind: "direct" },
					parameters: [
						{ name: "name", wire: "name", source: "json", codec: codec("dsh-skill-viewer#SkillName") },
						{ name: "sessionId", wire: "sessionId", source: "json", acceptsUndefined: true, codec: codec("dsh-skill-viewer#sessionId") }
					],
					result: codec("dsh-skill-viewer#SkillContent")
				},
				{
					id: "dsh-skill-viewer#skillsViewer/setEnabled",
					service: "skillsViewer",
					namespace: "skillsViewer",
					method: "setEnabled",
					invocation: { kind: "direct" },
					parameters: [
						{ name: "name", wire: "name", source: "json", codec: codec("dsh-skill-viewer#SkillName") },
						{ name: "sessionId", wire: "sessionId", source: "json", acceptsUndefined: true, codec: codec("dsh-skill-viewer#sessionId") },
						{ name: "enabled", wire: "enabled", source: "json", codec: codec("dsh-skill-viewer#EnabledFlag") }
					],
					result: codec("dsh-skill-viewer#SetEnabledResult")
				},
				{
					id: "dsh-skill-viewer#skillsViewer/deleteSkill",
					service: "skillsViewer",
					namespace: "skillsViewer",
					method: "deleteSkill",
					invocation: { kind: "direct" },
					parameters: [
						{ name: "name", wire: "name", source: "json", codec: codec("dsh-skill-viewer#SkillName") },
						{ name: "sessionId", wire: "sessionId", source: "json", acceptsUndefined: true, codec: codec("dsh-skill-viewer#sessionId") }
					],
					result: codec("dsh-skill-viewer#DeleteSkillResult")
				},
				{
					id: "dsh-skill-viewer#skillsViewer/addSkill",
					service: "skillsViewer",
					namespace: "skillsViewer",
					method: "addSkill",
					invocation: { kind: "direct" },
					parameters: [
						{ name: "sessionId", wire: "sessionId", source: "json", acceptsUndefined: true, codec: codec("dsh-skill-viewer#sessionId") },
						{ name: "payload", wire: "payload", source: "json", codec: codec("dsh-skill-viewer#AddPayload") }
					],
					result: codec("dsh-skill-viewer#AddResult")
				}
			]
		};

		// ── 作用域选择对话框（添加技能与编辑作用域共用）─────────────────────
		function ScopeDialog({ t, options, initial, busy, onConfirm, onCancel }) {
			const initialPaths = initial !== null && initial !== undefined && initial.kind === "workspaces" && Array.isArray(initial.workspaces) ? initial.workspaces.map((workspace) => workspace.path) : [];
			const [mode, setMode] = react.useState(initialPaths.length > 0 ? "scoped" : "global");
			const [selected, setSelected] = react.useState(initialPaths);
			const [manual, setManual] = react.useState("");
			const known = Array.isArray(options) ? options : [];
			const extras = selected.filter((path) => !known.some((option) => option.path.toLowerCase() === path.toLowerCase()));
			const togglePath = (path) => {
				setSelected((prev) => prev.includes(path) ? prev.filter((item) => item !== path) : [...prev, path]);
			};
			const addManual = () => {
				const value = manual.trim();
				if (value === "") return;
				setSelected((prev) => prev.some((item) => item.toLowerCase() === value.toLowerCase()) ? prev : [...prev, value]);
				setManual("");
			};
			const submit = () => {
				if (mode === "scoped" && selected.length === 0) return;
				onConfirm(mode === "global" ? null : selected);
			};
			const labelOf = (path) => {
				const parts = path.replaceAll("\\", "/").split("/").filter(Boolean);
				return parts.length > 0 ? parts[parts.length - 1] : path;
			};
			return (0, react_jsx_runtime.jsx)("div", {
				className: c.scopeOverlay,
				role: "dialog",
				"aria-modal": "true",
				children: (0, react_jsx_runtime.jsxs)("div", {
					className: c.scopeBox,
					children: [(0, react_jsx_runtime.jsx)("h4", { children: t("scopeDialogTitle") }), (0, react_jsx_runtime.jsxs)("div", {
						className: c.scopeOptions,
						children: [(0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: c.scopeOption,
							"data-active": mode === "global" ? "true" : void 0,
							onClick: () => {
								setMode("global");
							},
							children: [(0, react_jsx_runtime.jsx)("input", {
								type: "radio",
								name: "scope-mode",
								checked: mode === "global",
								readOnly: true
							}), (0, react_jsx_runtime.jsx)("span", { children: t("scopeGlobalOption") })]
						}), (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: c.scopeOption,
							"data-active": mode === "scoped" ? "true" : void 0,
							onClick: () => {
								setMode("scoped");
							},
							children: [(0, react_jsx_runtime.jsx)("input", {
								type: "radio",
								name: "scope-mode",
								checked: mode === "scoped",
								readOnly: true
							}), (0, react_jsx_runtime.jsx)("span", { children: t("scopeScopedOption") })]
						})]
					}), mode === "scoped" ? known.length === 0 && extras.length === 0 ? (0, react_jsx_runtime.jsx)("p", {
						className: c.scopeHint,
						children: t("scopeNoWorkspaces")
					}) : (0, react_jsx_runtime.jsxs)("ul", {
						className: c.wsList,
						children: known.map((option) => {
							const checked = selected.includes(option.path);
							return (0, react_jsx_runtime.jsxs)("li", {
								key: option.path,
								children: [(0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: c.wsItem,
									onClick: () => {
										togglePath(option.path);
									},
									children: [(0, react_jsx_runtime.jsx)("input", {
										type: "checkbox",
										checked,
										readOnly: true
									}), (0, react_jsx_runtime.jsx)("span", { children: option.label }), (0, react_jsx_runtime.jsx)("span", {
										className: c.wsPath,
										title: option.path,
										children: option.path
									})]
								})]
							}, option.path);
						}).concat(extras.map((path) => (0, react_jsx_runtime.jsxs)("li", {
							key: path,
							children: [(0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: c.wsItem,
								onClick: () => {
									togglePath(path);
								},
								children: [(0, react_jsx_runtime.jsx)("input", {
									type: "checkbox",
									checked: true,
									readOnly: true
								}), (0, react_jsx_runtime.jsx)("span", { children: labelOf(path) }), (0, react_jsx_runtime.jsx)("span", {
									className: c.wsPath,
									title: path,
									children: path
								})]
							})]
						}, path)))
					}) : null, mode === "scoped" ? (0, react_jsx_runtime.jsxs)("div", {
						className: c.manualRow,
						children: [(0, react_jsx_runtime.jsx)("input", {
							className: c.manualInput,
							type: "text",
							value: manual,
							placeholder: t("scopeManualPlaceholder"),
							onChange: (event) => {
								setManual(event.currentTarget.value);
							},
							onKeyDown: (event) => {
								if (event.key === "Enter") {
									event.preventDefault();
									addManual();
								}
							}
						}), (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: c.manualAdd,
							onClick: addManual,
							children: t("scopeManualAdd")
						})]
					}) : null, mode === "scoped" && selected.length === 0 ? (0, react_jsx_runtime.jsx)("p", {
						className: c.scopeWarning,
						children: t("scopeZeroWarning")
					}) : null, (0, react_jsx_runtime.jsxs)("div", {
						className: c.scopeActions,
						children: [(0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: c.scopeAction + " " + c.scopeCancel,
							disabled: busy,
							onClick: onCancel,
							children: t("scopeCancel")
						}), (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: c.scopeAction + " " + c.scopeConfirm,
							disabled: busy || (mode === "scoped" && selected.length === 0),
							onClick: submit,
							children: busy ? t("scopeSaving") : initial !== null && initial !== undefined ? t("scopeSave") : t("scopeConfirm")
						})]
					})]
				})
			});
		}

		function SkillsSection(props) {
			const { t, currentSessionId, listSkills, loadContent, setSkillEnabled, removeSkill, addSkill, listWorkspaces, setSkillScope } = props;
			const [query, setQuery] = react.useState("");
			const [listState, setListState] = react.useState({ status: "loading" });
			const [request, setRequest] = react.useState(0);
			const [expanded, setExpanded] = react.useState(null);
			const [bodies, setBodies] = react.useState({});
			const [ops, setOps] = react.useState({});
			const [adding, setAdding] = react.useState({ status: "idle" });
			const [addMenuOpen, setAddMenuOpen] = react.useState(false);
			const [pendingAdd, setPendingAdd] = react.useState(null);
			const [scopeEditor, setScopeEditor] = react.useState(null);
			const [scopeBusy, setScopeBusy] = react.useState(false);
			const [wsOptions, setWsOptions] = react.useState(null);
			const inflight = react.useRef(new Set());
			const folderInput = react.useRef(null);
			const fileInput = react.useRef(null);

			// 列表拉取：首次显示加载态；此后静默刷新，保留旧列表避免闪烁。
			// 合并结果按名称排序——启停切换不会改变卡片位置。
			react.useEffect(() => {
				let current = true;
				setListState((prev) => (prev.status === "ready" ? prev : { status: "loading" }));
				Promise.resolve().then(() => listSkills()).then((snapshot) => {
					if (!current) return;
					const skills = snapshot !== null && typeof snapshot === "object" && Array.isArray(snapshot.skills) ? [...snapshot.skills].sort((a, b) => a.name.localeCompare(b.name)) : [];
					setListState({ status: "ready", skills });
				}, () => {
					if (current) setListState({ status: "error" });
				});
				return () => {
					current = false;
				};
			}, [listSkills, request]);

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

			// 启用/停用：乐观更新本地状态，随后后台对齐。
			const applySetEnabled = (skill) => {
				const target = skill.enabled !== true;
				setOps((prev) => ({ ...prev, [skill.name]: { status: "busy" } }));
				Promise.resolve().then(() => setSkillEnabled(skill.name, target)).then(() => {
					setListState((prev) => (prev.status === "ready" ? { status: "ready", skills: prev.skills.map((s) => (s.name === skill.name ? { ...s, enabled: target } : s)) } : prev));
					setOps((prev) => ({ ...prev, [skill.name]: { status: "ok" } }));
					reloadAfterHot();
				}, () => {
					setOps((prev) => ({ ...prev, [skill.name]: { status: "error" } }));
				});
			};

			// 删除：确认后乐观移除卡片，后台对齐。
			const applyRemove = (skill) => {
				if (typeof window !== "undefined" && !window.confirm(t("deleteConfirm") + skill.name + t("deleteConfirmSuffix"))) return;
				setOps((prev) => ({ ...prev, [skill.name]: { status: "busy" } }));
				Promise.resolve().then(() => removeSkill(skill.name)).then(() => {
					setListState((prev) => (prev.status === "ready" ? { status: "ready", skills: prev.skills.filter((s) => s.name !== skill.name) } : prev));
					setOps((prev) => ({ ...prev, [skill.name]: { status: "ok" } }));
					setExpanded((current) => (current === skill.name ? null : current));
					reloadAfterHot();
				}, () => {
					setOps((prev) => ({ ...prev, [skill.name]: { status: "error" } }));
				});
			};

			// ── 添加技能：读取本地文件并上传（宿主负责校验与落盘）──────────────
			const readFileAsBase64 = (file) => new Promise((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = () => {
					const bytes = new Uint8Array(reader.result);
					let binary = "";
					for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
					resolve(btoa(binary));
				};
				reader.onerror = () => reject(new Error("file read failed"));
				reader.readAsArrayBuffer(file);
			});

			// 把宿主的业务报错从 RPC 信封前缀里剥出来（提示语已经是面向用户的中文）。
			const cleanHostError = (error) => String(error?.message ?? error).replace(/^skillsViewer\.[a-zA-Z]+ failed: [a-z-]+: /, "");

			const runAdd = (kind, files) => {
				if (files.length === 0) return;
				if (files.length > 200) {
					setAdding({ status: "error", message: t("addTooMany") });
					return;
				}
				if (kind === "bundle" && !files.some((file) => {
					const parts = file.webkitRelativePath.replaceAll("\\", "/").split("/");
					return parts.length === 2 && parts[1] === "SKILL.md";
				})) {
					setAdding({ status: "error", message: t("addNoSkillFile") });
					return;
				}
				setAdding({ status: "busy" });
				Promise.all(files.map(readFileAsBase64)).then((items) => {
					const payloadFiles = items.map((base64, index) => ({ path: (files[index].webkitRelativePath || files[index].name).replaceAll("\\", "/"), base64 }));
					if (wsOptions === null) {
						Promise.resolve().then(() => listWorkspaces()).then((snapshot) => {
							const list = snapshot !== null && typeof snapshot === "object" && Array.isArray(snapshot.workspaces) ? snapshot.workspaces : [];
							setWsOptions(list);
							setPendingAdd({ kind, payloadFiles });
						}, () => {
							setWsOptions([]);
							setPendingAdd({ kind, payloadFiles });
						});
					} else {
						setPendingAdd({ kind, payloadFiles });
					}
				}, (error) => {
					setAdding({ status: "error", message: cleanHostError(error) });
				});
			};

			// 作用域选择完成后真正上传。
			const submitPendingAdd = (workspaces) => {
				const payload = pendingAdd;
				setPendingAdd(null);
				setAdding({ status: "busy" });
				Promise.resolve().then(() => addSkill({ kind: payload.kind, files: payload.payloadFiles, workspaces })).then(() => {
					setAdding({ status: "ok" });
					setTimeout(() => setRequest((value) => value + 1), 700);
					setTimeout(() => setAdding({ status: "idle" }), 2500);
				}, (error) => {
					setAdding({ status: "error", message: cleanHostError(error) });
				});
			};

			// 编辑作用域：打开弹层并预载工作区选项。
			const openScopeEditor = (skill) => {
				setScopeBusy(false);
				setScopeEditor({ name: skill.name, scope: skill.scope ?? null });
				if (wsOptions === null) {
					Promise.resolve().then(() => listWorkspaces()).then((snapshot) => {
						const list = snapshot !== null && typeof snapshot === "object" && Array.isArray(snapshot.workspaces) ? snapshot.workspaces : [];
						setWsOptions(list);
					}, () => {
						setWsOptions([]);
					});
				}
			};

			const applySetScope = (name, workspaces) => {
				setScopeBusy(true);
				setOps((prev) => ({ ...prev, [name]: { status: "busy" } }));
				Promise.resolve().then(() => setSkillScope(name, workspaces)).then(() => {
					setScopeBusy(false);
					setScopeEditor(null);
					setOps((prev) => ({ ...prev, [name]: { status: "ok" } }));
					reloadAfterHot();
				}, (error) => {
					setScopeBusy(false);
					setOps((prev) => ({ ...prev, [name]: { status: "error" } }));
					setAdding({ status: "error", message: cleanHostError(error) });
				});
			};

			const onPickFolder = (event) => {
				const input = event.currentTarget;
				const files = [...input.files];
				input.value = "";
				if (files.length === 0) return;
				if (!files[0].webkitRelativePath) {
					setAdding({ status: "error", message: t("addFolderUnsupported") });
					return;
				}
				runAdd("bundle", files);
			};

			const onPickFile = (event) => {
				const input = event.currentTarget;
				const files = [...input.files];
				input.value = "";
				if (files.length !== 1) return;
				runAdd("flat", files);
			};

			// 点击菜单外部时收起。
			react.useEffect(() => {
				if (!addMenuOpen || typeof document === "undefined") return;
				const close = (event) => {
					if (event.target instanceof Element && event.target.closest("[data-add-menu]")) return;
					setAddMenuOpen(false);
				};
				document.addEventListener("click", close);
				return () => document.removeEventListener("click", close);
			}, [addMenuOpen]);

			const normalizedQuery = query.trim().toLocaleLowerCase();
			const skills = listState.status === "ready" ? listState.skills : [];
			const filtered = skills.filter((skill) => skill.name.toLocaleLowerCase().includes(normalizedQuery));

			// 作用域标签文案。
			const scopeInfo = (skill) => {
				const scope = skill.scope;
				if (scope === undefined || scope === null) return null;
				if (scope.kind === "global") return { text: t("scopeGlobal"), scoped: false, zero: false, title: t("scopeGlobalOption") };
				const workspaces = Array.isArray(scope.workspaces) ? scope.workspaces : [];
				return {
					text: t("scopeScopedPrefix") + workspaces.length + t("scopeScopedSuffix"),
					scoped: true,
					zero: workspaces.length === 0,
					title: workspaces.map((workspace) => workspace.path).join("\n")
				};
			};

			// 搜索过滤掉已展开项时自动收起。
			react.useEffect(() => {
				if (expanded !== null && !filtered.some((skill) => skill.name === expanded)) setExpanded(null);
			}, [expanded, filtered]);

			// 展开/收起：展开时懒加载内容并缓存。
			const toggle = (skill) => {
				const next = expanded === skill.name ? null : skill.name;
				setExpanded(next);
				if (next === null || bodies[skill.name] !== undefined || inflight.current.has(skill.name)) return;
				inflight.current.add(skill.name);
				setBodies((prev) => ({ ...prev, [skill.name]: { status: "loading" } }));
				Promise.resolve().then(() => loadContent(skill.name)).then((skillBody) => {
					inflight.current.delete(skill.name);
					setBodies((prev) => ({ ...prev, [skill.name]: { status: skillBody === null ? "missing" : "ready", skill: skillBody } }));
				}, () => {
					inflight.current.delete(skill.name);
					setBodies((prev) => ({ ...prev, [skill.name]: { status: "error" } }));
				});
			};

			return (0, react_jsx_runtime.jsx)("div", {
				className: c.section,
				"aria-busy": listState.status === "loading",
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
						(0, react_jsx_runtime.jsxs)("label", {
							className: c.search,
							children: [(0, react_jsx_runtime.jsx)(primitives.IconSearchOutline16, { "aria-hidden": "true" }), (0, react_jsx_runtime.jsx)("span", {
								className: c.visuallyHidden,
								children: t("search")
							}), (0, react_jsx_runtime.jsx)("input", {
								type: "search",
								value: query,
								placeholder: t("search"),
								"aria-label": t("search"),
								onChange: (event) => {
									setQuery(event.currentTarget.value);
								}
							})]
						}),
						(0, react_jsx_runtime.jsxs)("div", {
							className: c.catalogHeading,
							children: [(0, react_jsx_runtime.jsx)("h3", { children: t("catalog") }), (0, react_jsx_runtime.jsx)("span", {
								"data-skill-count": filtered.length,
								children: filtered.length
							}), (0, react_jsx_runtime.jsxs)("span", {
								className: c.addActions,
								"data-add-menu": "1",
								children: [(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: c.addButton,
									"aria-label": t("addButton"),
									title: t("addButton"),
									disabled: adding.status === "busy",
									onClick: () => {
										setAddMenuOpen((value) => !value);
									},
									children: (0, react_jsx_runtime.jsxs)("svg", {
										width: "14",
										height: "14",
										viewBox: "0 0 16 16",
										fill: "none",
										"aria-hidden": "true",
										children: [(0, react_jsx_runtime.jsx)("path", {
											d: "M8 3.5v9",
											stroke: "currentColor",
											strokeWidth: 1.6,
											strokeLinecap: "round"
										}), (0, react_jsx_runtime.jsx)("path", {
											d: "M3.5 8h9",
											stroke: "currentColor",
											strokeWidth: 1.6,
											strokeLinecap: "round"
										})]
									})
								}), addMenuOpen ? (0, react_jsx_runtime.jsxs)("span", {
									className: c.addMenu,
									role: "menu",
									children: [(0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: c.addMenuItem,
										role: "menuitem",
										onClick: () => {
											setAddMenuOpen(false);
											folderInput.current?.click();
										},
										children: t("addMenuFolder")
									}), (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: c.addMenuItem,
										role: "menuitem",
										onClick: () => {
											setAddMenuOpen(false);
											fileInput.current?.click();
										},
										children: t("addMenuFile")
									})]
								}) : null]
							})]
						}),
						adding.status === "busy" ? (0, react_jsx_runtime.jsx)("p", {
							className: c.addStatus,
							children: t("addBusy")
						}) : null,
						adding.status === "error" ? (0, react_jsx_runtime.jsxs)("div", {
							className: c.addErrorBanner,
							role: "alert",
							children: [(0, react_jsx_runtime.jsx)("span", {
								className: c.addErrorText,
								children: adding.message
							}), (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: c.addDismiss,
								onClick: () => {
									setAdding({ status: "idle" });
								},
								children: t("addDismiss")
							})]
						}) : null,
						currentSessionId() === undefined ? (0, react_jsx_runtime.jsx)("p", {
							className: c.status,
							children: t("noSession")
						}) : null,
						skills.length === 0 && currentSessionId() !== undefined ? (0, react_jsx_runtime.jsx)("p", {
							className: c.status,
							children: t("empty")
						}) : null,
						skills.length > 0 && filtered.length === 0 ? (0, react_jsx_runtime.jsx)("p", {
							className: c.status,
							children: t("emptySearch")
						}) : null,
						filtered.length > 0 ? (0, react_jsx_runtime.jsx)("ul", {
							className: c.cards,
							children: filtered.map((skill) => {
								const open = expanded === skill.name;
								const body = bodies[skill.name];
								const enabled = skill.enabled !== false;
								const editable = skill.source !== "bundled" && skill.source !== "runtime";
								const op = ops[skill.name];
								const scope = scopeInfo(skill);
								return (0, react_jsx_runtime.jsxs)("li", {
									key: skill.name,
									className: c.card,
									"data-skill-name": skill.name,
									"data-open": open ? "true" : void 0,
									children: [(0, react_jsx_runtime.jsxs)("button", {
										className: c.cardContent,
										type: "button",
										"aria-expanded": open,
										onClick: () => {
											toggle(skill);
										},
										children: [(0, react_jsx_runtime.jsx)("span", {
											className: c.cardLeading,
											children: (0, react_jsx_runtime.jsx)(primitives.IconSkillOutline16, { size: 14 })
										}), (0, react_jsx_runtime.jsx)("strong", {
											className: c.cardTitle,
											"data-disabled": enabled ? void 0 : "true",
											title: skill.name,
											children: skill.name
										}), (0, react_jsx_runtime.jsxs)("span", {
											className: c.cardTrailing,
											children: [(0, react_jsx_runtime.jsx)("span", {
												className: c.statusDot,
												"data-enabled": enabled ? "true" : "false",
												"aria-hidden": "true"
											}), (0, react_jsx_runtime.jsx)("span", {
												className: c.configTag,
												"data-enabled": enabled ? "true" : "false",
												children: enabled ? t("enabledTag") : t("disabledTag")
											}), scope !== null ? (0, react_jsx_runtime.jsx)("span", {
												className: c.scopeTag,
												"data-scoped": scope.scoped ? "true" : "false",
												"data-zero": scope.zero ? "true" : "false",
												title: scope.title,
												children: scope.text
											}) : null, (0, react_jsx_runtime.jsx)(primitives.IconChevronDownOutline14, {
												className: c.chevron,
												size: 12,
												"aria-hidden": "true"
											})]
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
										}) : null,
										editable ? (0, react_jsx_runtime.jsxs)("div", {
											className: c.cardActions,
											children: [(0, react_jsx_runtime.jsxs)("span", {
												className: c.switchRow,
												children: [(0, react_jsx_runtime.jsx)("button", {
													type: "button",
													role: "switch",
													className: c.switch,
													"data-on": enabled ? "true" : void 0,
													"aria-checked": enabled,
													"aria-label": enabled ? t("switchDisable") : t("switchEnable"),
													disabled: op?.status === "busy",
													onClick: () => {
														applySetEnabled(skill);
													},
													children: (0, react_jsx_runtime.jsx)("span", {
														className: c.switchThumb
													})
												}), (0, react_jsx_runtime.jsx)("span", {
													className: c.switchText,
													children: enabled ? t("switchDisable") : t("switchEnable")
												})]
											}), op?.status === "error" ? (0, react_jsx_runtime.jsx)("span", {
												className: c.opError,
												children: t("opFailed")
											}) : null, skill.scope !== undefined ? (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: c.scopeEditButton,
												disabled: op?.status === "busy",
												onClick: () => {
													openScopeEditor(skill);
												},
												children: t("scopeEditLabel")
											}) : null, (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: c.deleteButton,
												disabled: op?.status === "busy",
												onClick: () => {
													applyRemove(skill);
												},
												children: t("deleteLabel")
											})]
										}) : null]
									}) : null]
								}, skill.name);
							})
						}) : null,
						(0, react_jsx_runtime.jsx)("input", {
							ref: folderInput,
							className: c.fileInput,
							type: "file",
							webkitdirectory: "",
							onChange: onPickFolder
						}),
						(0, react_jsx_runtime.jsx)("input", {
							ref: fileInput,
							className: c.fileInput,
							type: "file",
							accept: ".md,text/markdown",
							onChange: onPickFile
						}),
						pendingAdd !== null ? (0, react_jsx_runtime.jsx)(ScopeDialog, {
							t,
							options: wsOptions,
							initial: null,
							busy: false,
							onCancel: () => {
								setPendingAdd(null);
							},
							onConfirm: submitPendingAdd
						}) : null,
						scopeEditor !== null ? (0, react_jsx_runtime.jsx)(ScopeDialog, {
							t,
							options: wsOptions,
							initial: scopeEditor.scope,
							busy: scopeBusy,
							onCancel: () => {
								setScopeEditor(null);
							},
							onConfirm: (workspaces) => {
								applySetScope(scopeEditor.name, workspaces);
							}
						}) : null
					]
				})
			});
		}


		// ── 设置页导航图标补丁 ──────────────────────────────────────────────
		// 外壳的 navIcon 是硬编码的（无扩展点），这里用 MutationObserver 给
		// “技能”导航项打上 data 标记，由 CSS 隐藏齿轮并用蒙版绘制自定义图标。
		const NAV_LABELS = [zh.nav, en.nav];
		let navPatchScheduled = false;
		const patchSkillsNavIcons = () => {
			navPatchScheduled = false;
			if (typeof document === "undefined") return;
			for (const dialog of document.querySelectorAll('[role="dialog"]')) {
				for (const button of dialog.querySelectorAll("button")) {
					if (button.dataset.skillsNav === "1") continue;
					let hit = false;
					for (const span of button.querySelectorAll("span")) {
						const text = (span.textContent ?? "").trim();
						if (span.childElementCount === 0 && NAV_LABELS.includes(text)) {
							hit = true;
							break;
						}
					}
					if (hit) button.dataset.skillsNav = "1";
				}
			}
		};
		const scheduleNavPatch = () => {
			if (navPatchScheduled || typeof document === "undefined") return;
			navPatchScheduled = true;
			queueMicrotask(patchSkillsNavIcons);
		};

		// ── cordis 插件体 ─────────────────────────────────────────────────────
		const inject = ["slots", "locale", "remote", "sessions"];

		function apply(ctx) {
			// 字典注册（生命周期随插件 fiber）
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "ui-skills-viewer: dictionaries");

			// 设置面板重开时重新打图标标记（元素重建，观察者再次扫描）
			if (typeof document !== "undefined") {
				const navObserver = new MutationObserver(scheduleNavPatch);
				navObserver.observe(document.body, { childList: true, subtree: true });
				scheduleNavPatch();
				ctx.effect(() => () => navObserver.disconnect(), "ui-skills-viewer: nav icon patch");
			}

			const t = ctx.locale.bind(NS);
			// 挂载远程贡献；所有远程调用都等待挂载完成后再取命名空间服务。
			const mount = ctx.remote.$mount(CONTRIBUTION);
			const currentSessionId = () => ctx.get("sessions").currentProvideInfo.getSnapshot().sessionId;
			const callRemote = async (method, ...args) => {
				await mount;
				const remote = ctx.get("remote.skillsViewer");
				const result = await remote[method](...args);
				if (!result.ok) throw new Error("skillsViewer." + method + " failed: " + result.error.code + ": " + result.error.message);
				return result.value;
			};
			const sectionFace = () => ({
				currentSessionId,
				listSkills: () => callRemote("list", currentSessionId()),
				listWorkspaces: () => callRemote("workspaces"),
				loadContent: (name) => callRemote("content", name, currentSessionId()),
				setSkillEnabled: (name, enabled) => callRemote("setEnabled", name, currentSessionId(), enabled),
				setSkillScope: (name, workspaces) => callRemote("setScope", name, currentSessionId(), workspaces),
				removeSkill: (name) => callRemote("deleteSkill", name, currentSessionId()),
				addSkill: (payload) => callRemote("addSkill", currentSessionId(), payload)
			});
			// 注册“技能”设置栏（order 16：位于“插件”15 与“agent 预设”20 之间）。
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "skills",
				order: 16,
				label: () => t("nav"),
				locale: NS,
				inject: sectionFace
			}, SkillsSection));
		}

		exports.NS = NS;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
