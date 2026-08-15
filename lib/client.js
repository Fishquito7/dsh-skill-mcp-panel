window.__ModuleLoader__.load({
    id: "dsh-skill-viewer",
    factory: (require) => {
        const bundleModule = { exports: {} };
        Object.defineProperty(bundleModule.exports, Symbol.toStringTag, { value: "Module" });
        // 束契约：本文件由宿主以 /plugins/dsh-skill-viewer/client.js 提供，
        // 只能 require 外壳种子词（react、jsx-runtime、primitives）。
        let react_jsx_runtime = require("react/jsx-runtime");
        let react = require("react");
        let primitives = require("@deepseek-ai/dsh-client-ui-primitives");
        // ── 样式（按用途分组）─────────────────────────────────────────────────
        // 页面骨架：section / 状态文案 / 搜索框 / 标题行
        const cssChrome = ".SKV_section{width:100%;max-width:760px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:14px;display:flex}.SKV_status{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px;margin:0}.SKV_failure{color:var(--dsw-alias-state-error-primary);align-items:center;gap:10px;display:flex}.SKV_failure p{margin:0}.SKV_failure button{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;background:0 0;border-radius:6px;padding:4px 10px}.SKV_catalog{flex-direction:column;gap:12px;display:flex}.SKV_catalogHeading{align-items:baseline;gap:7px;padding:0 2px;display:flex}.SKV_catalogHeading h3{font-size:13px;font-weight:600;line-height:20px;margin:0}.SKV_catalogHeading span{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;font-size:12px;line-height:18px}.SKV_searchBox{position:relative;width:100%}.SKV_searchIcon{color:var(--dsw-alias-label-tertiary)}.SKV_searchField::placeholder{color:var(--dsw-alias-label-tertiary)}.SKV_searchField:focus-visible{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-business-primary) 18%, transparent)}";
        // 卡片列表：卡片、状态标签、内容框、开关与删除操作
        const cssCards = ".SKV_cards{grid-template-columns:repeat(2,minmax(0,1fr));align-items:start;gap:10px;margin:0;padding:0;list-style:none;display:grid}.SKV_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:10px;min-width:0;overflow:hidden}.SKV_card[data-open=true]{border-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-shadow-lv1)}.SKV_cardContent{width:100%;align-items:center;gap:8px;font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;border:none;padding:10px 12px;display:flex;text-align:left}.SKV_cardLeading{width:16px;height:16px;color:var(--dsw-alias-label-tertiary);flex:none;justify-content:center;align-items:center;display:inline-flex}.SKV_cardTitle{min-width:0;flex:1;text-overflow:ellipsis;white-space:nowrap;overflow:hidden;font-size:13px;font-weight:500;line-height:20px;transition:color .2s ease}.SKV_cardTitle[data-disabled=true]{color:var(--dsw-alias-label-tertiary)}.SKV_cardTrailing{color:var(--dsw-alias-label-tertiary);flex:none;align-items:center;gap:7px;display:inline-flex}.SKV_statusDot{background:var(--dsw-alias-label-tertiary);border-radius:999px;flex:none;width:7px;height:7px;display:inline-block;transition:background-color .2s ease}.SKV_statusDot[data-enabled=true]{background:var(--dsw-alias-state-success-primary)}.SKV_configTag{background:var(--dsw-alias-bg-layer-1);min-height:20px;color:var(--dsw-alias-label-secondary);white-space:nowrap;border-radius:5px;align-items:center;padding:1px 6px;font-size:11px;line-height:16px;display:inline-flex;transition:background-color .2s ease,color .2s ease}.SKV_configTag[data-enabled=true]{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);color:var(--dsw-alias-state-success-primary)}.SKV_configTag[data-enabled=false]{color:var(--dsw-alias-label-tertiary)}.SKV_chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .15s}.SKV_card[data-open=true] .SKV_chevron{transform:rotate(180deg)}.SKV_cardDetails{border-top:1px solid var(--dsw-alias-border-l2);flex-direction:column;gap:8px;padding:10px 12px;display:flex}.SKV_meta{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;margin:0}.SKV_metaProvider{color:var(--dsw-alias-label-tertiary);margin-left:6px}.SKV_contentBox{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-markdown-code-block);border-radius:8px;max-height:213px;overflow:auto}.SKV_content{margin:0;padding:10px 12px;white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Consolas,Menlo,monospace;font-size:12px;line-height:18px}.SKV_failureText{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;margin:0}.SKV_cardActions{border-top:1px solid var(--dsw-alias-border-l2);align-items:center;gap:8px;padding-top:10px;display:flex}.SKV_switchRow{align-items:center;gap:8px;display:inline-flex}.SKV_switch{box-sizing:border-box;width:36px;height:20px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:999px;cursor:pointer;padding:0;position:relative;flex:none;transition:background-color .2s ease,border-color .2s ease}.SKV_switch:disabled{cursor:default;opacity:.6}.SKV_switch[data-on=true]{border-color:transparent;background:var(--dsw-alias-state-business-primary)}.SKV_switchThumb{box-sizing:border-box;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-secondary);position:absolute;top:2px;left:2px;transition:transform .22s cubic-bezier(.34,1.56,.64,1),background-color .18s ease,width .15s ease}.SKV_switch[data-on=true] .SKV_switchThumb{transform:translateX(18px);background:var(--dsw-alias-label-primary-foreground)}.SKV_switch:active:not(:disabled) .SKV_switchThumb{width:18px}.SKV_switch[data-on=true]:active:not(:disabled) .SKV_switchThumb{transform:translateX(14px)}.SKV_switchText{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}.SKV_opError{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}.SKV_deleteButton{box-sizing:border-box;height:28px;color:var(--dsw-alias-state-error-primary);font:inherit;cursor:pointer;background:0 0;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;padding:0 12px;font-size:12px;line-height:26px;margin-left:auto}.SKV_deleteButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid)}.SKV_deleteButton:disabled{cursor:default;opacity:.6}";
        // 添加技能：按钮组与状态行
        const cssAdd = ".SKV_addActions{margin-left:auto;align-items:center;gap:6px;display:inline-flex;position:relative}.SKV_addButton{box-sizing:border-box;width:28px;height:28px;color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;background:0 0;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;padding:0;display:inline-flex;align-items:center;justify-content:center}.SKV_addButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid)}.SKV_addButton:disabled{cursor:default;opacity:.6}.SKV_addMenu{position:absolute;top:calc(100% + 4px);right:0;background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;box-shadow:var(--dsw-shadow-lv1);flex-direction:column;padding:4px;display:flex;z-index:10}.SKV_addMenuItem{font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;border:none;border-radius:6px;padding:6px 12px;font-size:13px;line-height:20px;text-align:left;white-space:nowrap}.SKV_addMenuItem:hover{background:var(--dsw-alias-interactive-bg-hover)}.SKV_addStatus{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin:0}.SKV_addErrorBanner{border:1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 40%, transparent);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);border-radius:8px;align-items:center;gap:10px;padding:8px 12px;display:flex}.SKV_addErrorText{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;flex:1;min-width:0}.SKV_addDismiss{font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:2px 10px;font-size:12px;line-height:18px;flex:none}.SKV_addDismiss:hover{background:var(--dsw-alias-interactive-bg-hover-solid)}.SKV_fileInput{display:none}";
        // 作用域：横栏、迁移按钮与迁移对话框样式
        const cssScope = ".SKV_scopeTag{background:var(--dsw-alias-bg-layer-1);min-height:20px;color:var(--dsw-alias-label-secondary);white-space:nowrap;border-radius:5px;align-items:center;padding:1px 6px;font-size:11px;line-height:16px;display:inline-flex}.SKV_scopeTag[data-scoped=true]{background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent);color:var(--dsw-alias-state-business-primary)}.SKV_scopeTag[data-scoped=true][data-zero=true]{background:color-mix(in srgb, var(--dsw-alias-state-warning-primary) 12%, transparent);color:var(--dsw-alias-state-warning-primary)}.SKV_scopeEditButton{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:3px 10px;font-size:12px;line-height:18px}.SKV_scopeEditButton:hover{background:var(--dsw-alias-interactive-bg-hover-solid)}.SKV_scopeOverlay{position:fixed;inset:0;background:color-mix(in srgb, rgba(0,0,0,.45) 55%, transparent);align-items:center;justify-content:center;display:flex;z-index:1000}.SKV_scopeBox{background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;box-shadow:var(--dsw-shadow-lv2);width:440px;max-width:calc(100vw - 48px);max-height:80vh;flex-direction:column;padding:16px;gap:12px;display:flex}.SKV_scopeBox h4{font-size:14px;font-weight:600;line-height:20px;margin:0}.SKV_scopeOptions{flex-direction:column;gap:8px;display:flex}.SKV_scopeOption{font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 12px;font-size:13px;line-height:20px;text-align:left;display:flex;align-items:center;gap:8px}.SKV_scopeOption[data-active=true]{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 1px color-mix(in srgb, var(--dsw-alias-state-business-primary) 30%, transparent)}.SKV_scopeOption input{margin:0;accent-color:var(--dsw-alias-state-business-primary)}.SKV_wsList{flex-direction:column;gap:4px;max-height:200px;overflow:auto;padding:0;margin:0;list-style:none;display:flex}.SKV_wsItem{font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;border:none;border-radius:6px;padding:5px 8px;font-size:12px;line-height:18px;text-align:left;display:flex;align-items:center;gap:8px}.SKV_wsItem:hover{background:var(--dsw-alias-interactive-bg-hover)}.SKV_wsItem input{margin:0;flex:none;accent-color:var(--dsw-alias-state-business-primary)}.SKV_wsPath{color:var(--dsw-alias-label-tertiary);min-width:0;text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.SKV_manualRow{align-items:center;gap:6px;display:flex}.SKV_manualInput{flex:1;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);height:30px;color:var(--dsw-alias-label-primary);font:inherit;border-radius:6px;outline:none;padding:0 8px;font-size:12px}.SKV_manualInput:focus-visible{border-color:var(--dsw-alias-state-business-primary)}.SKV_manualAdd{font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:3px 10px;font-size:12px;flex:none}.SKV_scopeHint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin:0}.SKV_scopeWarning{color:var(--dsw-alias-state-warning-primary);font-size:12px;line-height:18px;margin:0}.SKV_scopeActions{align-items:center;justify-content:flex-end;gap:8px;display:flex}.SKV_scopeAction{font:inherit;cursor:pointer;border-radius:6px;padding:5px 14px;font-size:13px;line-height:20px}.SKV_scopeCancel{background:0 0;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}.SKV_scopeConfirm{background:var(--dsw-alias-state-business-primary);border:1px solid transparent;color:var(--dsw-alias-state-business-on-primary, #fff)}.SKV_scopeConfirm:disabled{opacity:.6;cursor:default}";
        const cssUtils = "";
        // 设置页导航图标（外壳硬编码图标，无扩展点：打标记 + CSS 蒙版绘制）
        const cssIcon = "button[data-skills-nav]>svg{display:none!important}button[data-skills-nav] svg{display:none!important}button[data-skills-nav] *::before{display:none!important}button[data-skills-nav] *::after{display:none!important}button[data-skills-nav] *{background-image:none!important}button[data-skills-nav]::before{content:\"\";width:16px;height:16px;flex:none;display:inline-block;background-color:currentColor;-webkit-mask:url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAfxSURBVHhe7Vtbq2RHFY5JUIPXaIh4efBdAl6iDyFM4pNEIoLgPzAmoCBkjAFBQx589Af4mssQEBI1JoJnxpnM0dwmo4LOJRNfzJmZZAjMOWeOPb2+tdauHVZ1VXftNd3n9Om9d59DzAeLql27dl2+XmtV1dq7r7vufbyPuSEi94jI48xyGsBbAN6OQllodN2US8zsyyZizxXXInKBmZ/a3Ayf9v3vGba2tj6jzH+olwhV/efW1tatfixLh01eRE7boJi5BuDH2hmIKGSxa2b+x5UrV27xY1oqADwfBzccBhWJA2XwRRE5zsyHARxh4AiAv5gwc8yP06KcEcuO2HP2TK4D4LBATjBzABBAFMX6EpGTGxsbn/LjWgqGw+G30i9RC0tdVZWp5sEQwsd93bYIIdwWJ2xalgjImiCqJ/dEE4joUFbNlP7C1+kKzHx7HUIkIPcXQoialzThRAhhuZoA4GweCIPfuXTp0kd9nUVR1/UHTPI1M389VEaAmJaZrzHzeGdkfmNzOLG+Xn+y2VKPAHAhGr2ZAfHf/f0uwQO+3UzMCEhm9yMAX1XV/zkSXqvr+mb/fC8AcL4g4DV/v0sw89dCk4BfWvlwOLxbVbdGJIzN4eWlOEYG1goC+tUAbmoAMUUCDFevXr1LVQeOhFcuX778iWYrHaNBAPeuAYkAzv1Fh5v9hAzFNCGaw7Agoa7r/khg5jEBAF7197uEmUBDA4geyfcyCaU5FCS81Js5lD6AiE74+12Cmb8RV5ukAZkAv1okc7hGE9bX17tfHUoC+taAAQ9GBKStNtHIB5STzzASKq0ajlFFX63rjpfIBgE9awCAr1Q68QEAfmXlXgMykjkkxzhaIlX1lc3Nze5OkbxEExgMBp8DcNX8QCLgZV/HUBIiIt8c7xPS7tFI2NjY6Gaf4EygVwIMAP6a+hpNhvlBX8cDwJdV9WKlWhONnrMdYyckLHMjZADw/dgXMHaGzPykiHw3hHAHM9/JzAeSWP5OMx1bMkVE4mlycoq0JbIdCctcBTIY+K31B5qQsBMACIj0mlOkyIutTq57QUBd1x9m5t/nfk0bLAhjZETBKDVnWV6DJnGEMp5ARI/5PuaGc4K9m0AJVf1xVem53P9uYKtJ1gIAF33bc6MkANS/E/QIIXwohHBAVR9Q1oeY+SFV/amlSSz/M2Z+OKUPKutBZn7TjtSJgPO+3bnR3Acsn4BFAWB1PO42BDCWdxYo4Tc+0zZDuayUfA/AS8W418rndgXnBHslwE/Cw9/3k59FgP2I40Z2i2VuhXdCOcntiDIAeHE87jYm0NQAPunv942dJjoLoNIEuCsCaOkELIqGCXALE2DmyVa454hQlxBI6QQX14DmRmhiAtNUczgcflFEDgF4Ib3tOQrCUSI6NkpxDBgJEa0S0XEiesHuWwqKz42EsArgeK6fyo+LyN+qqnraXqL4/kt05gMYEw0oT4PTCMiv0JYBe2dY1/X1fgwZdpTOdUG44O/PDXs4N1SeBWYQcGw8wp7BzG/UdX2DH0OG8wGLa4BzgmMfMGPtvU1VV1T1NDNPBEgp2zcFlj/DzKcAnErlZ4TFyk/J5DnLnxKWKHbNjLMicrbSalVE7h4Pcgq6M4EiKkxFPMBP3qMg6PqSrCllls9SXk+rf8N2v3qJhgm0IaCxEVpCRKgrdKYBto/ODe3FMug1bTutK9HcCHVFwIyQmB/kfoA7DLUiYFcmEEL4Ugjhrhy3Cxxy/O6AxfKLeF6ZnynWlgU9fT87AdTwAS12gsU+YKeQGDM/UFVVjMJ0DQC/9v1th840wBHQMAGv9sz879hhCmZuKymOd424cmsrTeKKRYfK/sqVoiw3EJFFhNsTUJrAdj7AUnuTk+t2DSJ6ctpEZ5HglsHFTWBeH5AHICL3WvyOmX+owH2WArgPwA8sZeb7k1h5LMtS1I352Ibq/SLyvbqub/R9bgcQdWMC74XjcCsCSh/Q9T5glvp2gc7iAQ0f0DEBfYKIxj6gSwL2hQnMozHUhw/wYXGvwoPB4AtVVf1GVf/E4OcsPpDE8n8E8KyJvfZK+Xi/qiore6Su6w+W7c/CPASg1IDuYoITAvzkDcz8u1x3ETDt/CrcMBcBjbB4Cw1ovBgp3gxNIwBE8d3+ohCRR8cdtwSIOjoNEk01gZKATIJ95aWqq8x8DsDrAM4xOKYpf8Y+vbV7KShi16+rql0f2s2XXp58j3Ij1EoDytOgD4nNGkQKXNzoxMossBGDGl58G21R+oB2GjBjGZxGwDQy9gpuK7x4ULT8UnTaVtgT4EnxKOtsV68tOiNgnoBIxryTWhIB5WlwcQLMcVkj6f8Cb4cQbvJ1Suw0qXLifZFgY7R/n9mYEwFv+Dpzg4ieio1Mvrf5ua+z30BEB9PE8ycyz/g6c4OI7o3qDw4WoFDRoKoPhxA+5uvuNUIIH1HVn6iqfTEXgyvpR/uOr7srENGKNWQfJquMv7tZS+///gxghS0l+H+QWRrLkqwU+XjN4BVQfOZwzI/qWJk9NxIiEyuze9Zf7DOLjS+1918bm30blL8fJqKjfj67RgjhsyJir6IiqzlMtR9BRONfnpn/Y5/f+vksBGtIVZ/zHe5XqOrzg8Hg834erUFE3xaRx5j5X7ZHsI1SFIqpXa8RUb4+b3lK+SRrIBrVSfWz2LnDnkv3zoPoQvHcNX2M68UyftPeH1ZV9URrm/9/w7uta8ACW3GakwAAAABJRU5ErkJggg==) center/16px 16px no-repeat;mask:url(data:image/png;base64,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) center/16px 16px no-repeat}body[data-ds-dark-theme] .SKV_switchThumb{background:#fff}body[data-ds-dark-theme] .SKV_switch[data-on=true] .SKV_switchThumb{background:#fff}";
        const cssMigrate = ".SKV_scopeBar{gap:6px;padding:2px;max-width:100%;overflow-x:auto;scrollbar-width:thin;display:flex;align-items:center}.SKV_scopeChip{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:3px 12px;font-size:12px;line-height:18px;white-space:nowrap;flex:none;display:inline-flex;align-items:center;gap:6px}.SKV_scopeChip:hover{background:var(--dsw-alias-interactive-bg-hover)}.SKV_scopeChip[data-active=true]{background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent);border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}.SKV_scopeChipCount{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;font-size:11px;line-height:16px}.SKV_scopeChip[data-active=true] .SKV_scopeChipCount{color:var(--dsw-alias-state-business-primary)}.SKV_migrateButton{box-sizing:border-box;width:28px;height:28px;color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;background:0 0;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;padding:0;display:inline-flex;align-items:center;justify-content:center}.SKV_migrateButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid)}.SKV_migrateButton:disabled{cursor:default;opacity:.6}.SKV_migrateSection{flex-direction:column;gap:6px;display:flex}.SKV_migrateLabel{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;margin:0}.SKV_migrateFromValue{color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;margin:0;word-break:break-all}.SKV_migrateList{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;max-height:220px;overflow-y:auto;margin:0;padding:4px;list-style:none;display:flex;flex-direction:column;gap:2px}.SKV_migrateItem{font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;border:none;border-radius:6px;padding:6px 10px;font-size:13px;line-height:20px;text-align:left;display:flex;align-items:center;gap:8px}.SKV_migrateItem:hover{background:var(--dsw-alias-interactive-bg-hover)}.SKV_migrateItem input{margin:0;accent-color:var(--dsw-alias-state-business-primary)}.SKV_migrateItemName{flex:1;min-width:0;text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.SKV_migrateItemState{color:var(--dsw-alias-label-tertiary);font-size:11px;flex:none}.SKV_migrateSelectAll{font:inherit;color:var(--dsw-alias-state-business-primary);cursor:pointer;background:0 0;border:none;padding:0;font-size:12px;line-height:18px}.SKV_migrateHint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin:0}.SKV_migrateResult{border-radius:8px;padding:8px 12px;font-size:12px;line-height:18px;margin:0}.SKV_migrateResult[data-ok=true]{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);color:var(--dsw-alias-state-success-primary)}.SKV_migrateResult[data-ok=false]{background:color-mix(in srgb, var(--dsw-alias-state-warning-primary) 10%, transparent);color:var(--dsw-alias-state-warning-primary)}.SKV_migrateResultList{margin:4px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:2px;max-height:120px;overflow-y:auto}.SKV_scopeChip{max-width:320px}.SKV_scopeChipLabel{max-width:220px;min-width:0;text-overflow:ellipsis;white-space:nowrap;overflow:hidden;display:inline-block}.SKV_wsPath{min-width:0;text-overflow:ellipsis;white-space:nowrap;overflow:hidden;display:block}.SKV_migrateOptionLabel{min-width:0;text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.SKV_scopeOptions{max-height:132px;overflow-y:auto;scrollbar-width:thin}.SKV_migrateList{max-height:148px}.SKV_scopeBox{overflow-y:auto;scrollbar-width:thin}.SKV_groupBar{gap:0;padding:0 2px;max-width:100%;overflow-x:auto;scrollbar-width:thin;display:flex;align-items:center}.SKV_groupItem{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;padding:2px 10px;font-size:12px;line-height:18px;white-space:nowrap;flex:none}.SKV_groupItem:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);border-radius:5px}.SKV_groupItem[data-active=true]{color:var(--dsw-alias-state-business-primary);font-weight:500}.SKV_groupSep{color:var(--dsw-alias-border-l1);flex:none;user-select:none;font-size:12px;line-height:18px;padding:0 1px}.SKV_select{width:100%;box-sizing:border-box;height:32px;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:0 8px}.SKV_select:focus-visible{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-business-primary) 18%, transparent);outline:none}.SKV_selectMulti{width:100%;box-sizing:border-box;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:4px}.SKV_selectMulti option{padding:4px 6px;border-radius:4px}.SKV_selectMulti option:checked{background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 18%, transparent)}.SKV_groupBody{display:flex;gap:16px;min-height:0}.SKV_groupSide{width:150px;flex:none;display:flex;flex-direction:column;gap:2px;min-width:0}.SKV_groupNewBtn{display:flex;align-items:center;gap:6px;justify-content:flex-start;font:inherit;font-size:13px;color:var(--dsw-alias-state-business-primary);cursor:pointer;background:0 0;border:1px dashed var(--dsw-alias-border-l1);border-radius:8px;padding:7px 10px;margin-bottom:6px;text-align:left}.SKV_groupNewBtn:hover{background:var(--dsw-alias-interactive-bg-hover)}.SKV_groupSideLabel{font-size:12px;color:var(--dsw-alias-label-tertiary);padding:0 10px;margin-bottom:2px}.SKV_groupSideItem{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:6px;font:inherit;font-size:13px;cursor:pointer;color:var(--dsw-alias-label-secondary);background:0 0;border:none;text-align:left;min-width:0}.SKV_groupSideItem:hover{background:var(--dsw-alias-interactive-bg-hover)}.SKV_groupSideItem[data-active=true]{background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent);color:var(--dsw-alias-state-business-primary);font-weight:500}.SKV_groupMain{flex:1;min-width:0;display:flex;flex-direction:column;gap:12px}.SKV_field{display:flex;flex-direction:column;gap:6px}.SKV_fieldLabel{font-size:12px;color:var(--dsw-alias-label-secondary);margin:0}.SKV_skillListBox{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:0 10px;max-height:220px;overflow-y:auto}.SKV_skillRow{display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:0.5px solid var(--dsw-alias-border-l2);font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;min-width:0}.SKV_skillRow:last-child{border-bottom:none}.SKV_skillRow:hover{background:var(--dsw-alias-interactive-bg-hover)}.SKV_skillRow input{margin:0;accent-color:var(--dsw-alias-state-business-primary);flex:none}.SKV_skillName{flex:1;min-width:0;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.SKV_skillBadge{font-size:12px;padding:2px 8px;border-radius:5px;white-space:nowrap;flex:none}.SKV_skillBadge[data-on=true]{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, transparent);color:var(--dsw-alias-state-success-primary)}.SKV_skillBadge[data-on=false]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-tertiary)}.SKV_countRow{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}.SKV_countText{font-size:12px;color:var(--dsw-alias-label-secondary);margin:0}.SKV_dialogFooter{display:flex;align-items:center;justify-content:space-between;margin-top:12px;padding-top:12px;border-top:0.5px solid var(--dsw-alias-border-l2)}.SKV_dangerBtn{font:inherit;font-size:13px;color:var(--dsw-alias-state-error-primary);cursor:pointer;background:0 0;border:1px solid transparent;border-radius:6px;padding:5px 10px}.SKV_dangerBtn:hover:not(:disabled){background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent)}.SKV_dangerBtn:disabled{cursor:default;opacity:.6}.SKV_textInput{width:100%;box-sizing:border-box;height:32px;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;outline:none;padding:0 10px}.SKV_textInput::placeholder{color:var(--dsw-alias-label-tertiary)}.SKV_textInput:focus-visible{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-business-primary) 18%, transparent)}.SKV_scopeBox{width:640px}.SKV_groupSide{width:170px}.SKV_groupSideItem{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.SKV_select{appearance:none;-webkit-appearance:none;width:100%;box-sizing:border-box;height:32px;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);background-color:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:0 30px 0 10px;background-image:url('data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 viewBox=%270 0 16 16%27 fill=%27none%27%3E%3Cpath d=%27M4 6l4 4 4-4%27 stroke=%27%23888%27 stroke-width=%271.6%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27/%3E%3C/svg%3E');background-repeat:no-repeat;background-position:right 10px center}.SKV_select:hover{border-color:var(--dsw-alias-border-l1)}.SKV_selectMulti:focus-visible{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-business-primary) 18%, transparent);outline:none}.SKV_selectMulti option:hover{background:var(--dsw-alias-interactive-bg-hover)}.SKV_targetBox{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:4px;max-height:152px;overflow-y:auto;scrollbar-width:thin}.SKV_targetItem{display:flex;align-items:center;gap:8px;padding:7px 6px;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;border:none;border-bottom:0.5px solid var(--dsw-alias-border-l2);width:100%;text-align:left;min-width:0}.SKV_targetItem:last-child{border-bottom:none}.SKV_targetItem:hover{background:var(--dsw-alias-interactive-bg-hover)}.SKV_targetItem[data-active=true]{background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 8%, transparent)}.SKV_targetItem input{margin:0;accent-color:var(--dsw-alias-state-business-primary);flex:none}.SKV_skillListBox{max-height:180px}.SKV_updateBanner{border:1px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 40%, transparent);background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 8%, transparent);border-radius:8px;align-items:center;gap:10px;padding:8px 12px;display:flex}.SKV_updateText{color:var(--dsw-alias-state-business-primary);font-size:12px;line-height:18px;flex:1;min-width:0};";
        const css = cssChrome + cssCards + cssAdd + cssScope + cssMigrate + cssUtils + cssIcon;
        const tagId = "dsh-skill-viewer/SkillsSection.module.css";
        if (typeof document !== "undefined") {
            let tag = document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]");
            if (tag === null) {
                tag = document.createElement("style");
                tag.dataset.plugin = "dsh-skill-viewer";
                tag.dataset.pluginCss = tagId;
                document.head.appendChild(tag);
            }
            // 始终用当前版本的样式覆盖，避免残留旧样式标签
            tag.textContent = css;
        }
        // 类名映射（CSS 是内联手写字符串，无法走 CSS Modules）
        const c = {
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
            addButton: "SKV_addButton",
            addStatus: "SKV_addStatus",
            addMenu: "SKV_addMenu",
            addMenuItem: "SKV_addMenuItem",
            addErrorBanner: "SKV_addErrorBanner",
            addErrorText: "SKV_addErrorText",
            addDismiss: "SKV_addDismiss",
            fileInput: "SKV_fileInput",
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
            scopeConfirm: "SKV_scopeConfirm",
            scopeBar: "SKV_scopeBar",
            scopeChip: "SKV_scopeChip",
            scopeChipCount: "SKV_scopeChipCount",
            groupBar: "SKV_groupBar",
            groupItem: "SKV_groupItem",
            groupSep: "SKV_groupSep",
            select: "SKV_select",
            selectMulti: "SKV_selectMulti",
            groupBody: "SKV_groupBody",
            groupSide: "SKV_groupSide",
            groupNewBtn: "SKV_groupNewBtn",
            groupSideLabel: "SKV_groupSideLabel",
            groupSideItem: "SKV_groupSideItem",
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
            updateBanner: "SKV_updateBanner",
            updateText: "SKV_updateText",
            migrateButton: "SKV_migrateButton",
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
            scopeChipLabel: "SKV_scopeChipLabel",
            migrateOptionLabel: "SKV_migrateOptionLabel"
        };
        // ── 文案字典 ─────────────────────────────────────────────────────────
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
            groupTitle: "技能分组",
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
            groupDeleteConfirm: "确定删除分组 ",
            skillFilterPlaceholder: "筛选技能",
            skillCountLabel: "已选",
            selectNone: "取消全选",
            checkUpdateAvailable: "发现新版本 v",
            checkUpdateCurrent: "（当前 v",
            checkUpdateHint: "）。可在终端运行 dsh-skill update 更新"
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
            groupTitle: "Skill groups",
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
            groupDeleteConfirm: "Delete group ",
            skillFilterPlaceholder: "Filter skills",
            skillCountLabel: "Selected",
            selectNone: "Select none",
            checkUpdateAvailable: "Update available: v",
            checkUpdateCurrent: " (current v",
            checkUpdateHint: "). Run dsh-skill update in a terminal to install it"
        };
        // ── 远程贡献 ─────────────────────────────────────────────────────────
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
                    id: "dsh-skill-viewer#skillsViewer/groups",
                    service: "skillsViewer",
                    namespace: "skillsViewer",
                    method: "groups",
                    invocation: { kind: "direct" },
                    parameters: [],
                    result: codec("dsh-skill-viewer#GroupsResult")
                },
                {
                    id: "dsh-skill-viewer#skillsViewer/checkUpdate",
                    service: "skillsViewer",
                    namespace: "skillsViewer",
                    method: "checkUpdate",
                    invocation: { kind: "direct" },
                    parameters: [],
                    result: codec("dsh-skill-viewer#CheckUpdateResult")
                },
                {
                    id: "dsh-skill-viewer#skillsViewer/saveGroup",
                    service: "skillsViewer",
                    namespace: "skillsViewer",
                    method: "saveGroup",
                    invocation: { kind: "direct" },
                    parameters: [
                        { name: "payload", wire: "payload", source: "json", codec: codec("dsh-skill-viewer#SaveGroupPayload") }
                    ],
                    result: codec("dsh-skill-viewer#GroupsResult")
                },
                {
                    id: "dsh-skill-viewer#skillsViewer/deleteGroup",
                    service: "skillsViewer",
                    namespace: "skillsViewer",
                    method: "deleteGroup",
                    invocation: { kind: "direct" },
                    parameters: [
                        { name: "payload", wire: "payload", source: "json", codec: codec("dsh-skill-viewer#DeleteGroupPayload") }
                    ],
                    result: codec("dsh-skill-viewer#GroupsResult")
                },
                {
                    id: "dsh-skill-viewer#skillsViewer/migrate",
                    service: "skillsViewer",
                    namespace: "skillsViewer",
                    method: "migrate",
                    invocation: { kind: "direct" },
                    parameters: [
                        { name: "name", wire: "name", source: "json", codec: codec("dsh-skill-viewer#SkillName") },
                        { name: "sessionId", wire: "sessionId", source: "json", acceptsUndefined: true, codec: codec("dsh-skill-viewer#sessionId") },
                        { name: "payload", wire: "payload", source: "json", codec: codec("dsh-skill-viewer#MigratePayload") }
                    ],
                    result: codec("dsh-skill-viewer#MigrateResult")
                },
                {
                    id: "dsh-skill-viewer#skillsViewer/batchMigrate",
                    service: "skillsViewer",
                    namespace: "skillsViewer",
                    method: "batchMigrate",
                    invocation: { kind: "direct" },
                    parameters: [
                        { name: "sessionId", wire: "sessionId", source: "json", acceptsUndefined: true, codec: codec("dsh-skill-viewer#sessionId") },
                        { name: "payload", wire: "payload", source: "json", codec: codec("dsh-skill-viewer#BatchMigratePayload") }
                    ],
                    result: codec("dsh-skill-viewer#BatchMigrateResult")
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
        // ── 分组编辑对话框（左侧分组列表，右侧名称/工作区/技能）──────────────
        function GroupDialog({ t, options, groups, groupId, setGroupId, name, setName, scope, setScope, skills, selected, toggle, selectAll, busy, error, onSave, onDelete, onCancel }) {
            const known = Array.isArray(options) ? options : [];
            const rows = Array.isArray(groups) ? groups : [];
            const [query, setQuery] = react.useState("");
            const q = query.trim().toLowerCase();
            const visible = skills.filter((skill) => skill.name.toLowerCase().includes(q));
            const allChecked = skills.length > 0 && selected.size === skills.length;
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
                                        }), ...rows.map((group) => (0, react_jsx_runtime.jsx)("button", {
                                            type: "button",
                                            className: c.groupSideItem,
                                            "data-active": groupId === group.id ? "true" : void 0,
                                            onClick: () => {
                                                setGroupId(group.id, group.name);
                                            },
                                            children: group.name
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
                                                }), (0, react_jsx_runtime.jsx)("input", {
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
                                    onClick: onDelete,
                                    children: t("groupDelete")
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
            const targetLabelOf = (value) => (value === null || value === undefined ? t("scopeGlobal") : value === "global" ? t("scopeGlobal") : value);
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
                                }), (0, react_jsx_runtime.jsxs)("select", {
                                    className: c.select,
                                    value: from,
                                    onChange: (event) => {
                                        setFrom(event.currentTarget.value);
                                    },
                                    children: [(0, react_jsx_runtime.jsx)("option", {
                                            value: "",
                                            disabled: true,
                                            children: t("migratePickSource")
                                        }), (0, react_jsx_runtime.jsx)("option", {
                                            value: "global",
                                            children: t("scopeGlobal")
                                        }), ...known.map((option) => (0, react_jsx_runtime.jsx)("option", {
                                            value: option.path,
                                            children: option.label + " — " + option.path
                                        }, option.path))]
                                })]
                        }), (0, react_jsx_runtime.jsxs)("div", {
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
                                }), (0, react_jsx_runtime.jsx)("input", {
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
                            children: [(0, react_jsx_runtime.jsx)("p", {
                                    className: c.migrateResult,
                                    "data-ok": failCount === 0 ? "true" : "false",
                                    children: t("migrateDoneOk") + okCount + t("migrateDoneFail") + failCount + t("migrateDoneSuffix")
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
                })
            });
        }
        function SkillsSection(props) {
            const { t, currentSessionId, listSkills, loadContent, setSkillEnabled, removeSkill, addSkill, listWorkspaces, batchMigrateSkill, listGroups, saveGroupSkill, deleteGroupSkill, checkUpdateRemote } = props;
            const [query, setQuery] = react.useState("");
            const [listState, setListState] = react.useState({ status: "loading" });
            const [request, setRequest] = react.useState(0);
            const [expanded, setExpanded] = react.useState(null);
            const [bodies, setBodies] = react.useState({});
            const [ops, setOps] = react.useState({});
            const [adding, setAdding] = react.useState({ status: "idle" });
            const [addMenuOpen, setAddMenuOpen] = react.useState(false);
            const [wsOptions, setWsOptions] = react.useState(null);
            const [scopeFilter, setScopeFilter] = react.useState("global");
            const [migrator, setMigrator] = react.useState(null);
            const [groupsList, setGroupsList] = react.useState(null);
            const [groupFilter, setGroupFilter] = react.useState("all");
            const [groupEditor, setGroupEditor] = react.useState(null);
            const [updateBanner, setUpdateBanner] = react.useState(null);
            const inflight = react.useRef(new Set());
            const folderInput = react.useRef(null);
            const fileInput = react.useRef(null);
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
            }, [listSkills, request]);
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
                if (typeof window !== "undefined" && !window.confirm(t("deleteConfirm") + skill.name + t("deleteConfirmSuffix")))
                    return;
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
                    for (let i = 0; i < bytes.length; i++)
                        binary += String.fromCharCode(bytes[i]);
                    resolve(btoa(binary));
                };
                reader.onerror = () => reject(new Error("file read failed"));
                reader.readAsArrayBuffer(file);
            });
            // 把宿主的业务报错从 RPC 信封前缀里剥出来（提示语已经是面向用户的中文）。
            const cleanHostError = (error) => String(error?.message ?? error).replace(/^skillsViewer\.[a-zA-Z]+ failed: [a-z-]+: /, "");
            const runAdd = (kind, files) => {
                if (files.length === 0)
                    return;
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
                const workspace = scopeFilter === "global" ? null : scopeFilter;
                Promise.all(files.map(readFileAsBase64)).then((items) => {
                    const payloadFiles = items.map((base64, index) => ({ path: (files[index].webkitRelativePath || files[index].name).replaceAll("\\", "/"), base64 }));
                    return addSkill({ kind, files: payloadFiles, workspace });
                }).then(() => {
                    setAdding({ status: "ok" });
                    setTimeout(() => setRequest((value) => value + 1), 700);
                    setTimeout(() => setAdding({ status: "idle" }), 2500);
                }, (error) => {
                    setAdding({ status: "error", message: cleanHostError(error) });
                });
            };
            // 批量迁移：打开对话框，源/目标/技能均由用户手动选择。
            const openMigrator = () => {
                setMigrator({
                    from: "",
                    targets: new Set(),
                    mode: "move",
                    selected: new Set(),
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
                if (typeof window !== "undefined" && !window.confirm(t("groupDeleteConfirm") + editor.name + "？"))
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
            const onPickFolder = (event) => {
                const input = event.currentTarget;
                const files = [...input.files];
                input.value = "";
                if (files.length === 0)
                    return;
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
                if (files.length === 0)
                    return;
                runAdd("flat", files);
            };
            // 点击菜单外部时收起。
            react.useEffect(() => {
                if (!addMenuOpen || typeof document === "undefined")
                    return;
                const close = (event) => {
                    if (event.target instanceof Element && event.target.closest("[data-add-menu]"))
                        return;
                    setAddMenuOpen(false);
                };
                document.addEventListener("click", close);
                return () => document.removeEventListener("click", close);
            }, [addMenuOpen]);
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
            const scopeCount = (key) => skills.reduce((sum, skill) => sum + (scopeOf(skill) === key ? 1 : 0), 0);
            const scoped = skills.filter((skill) => scopeOf(skill) === scopeFilter);
            const grouped = groupFilter === "all" ? scoped : scoped.filter((skill) => (Array.isArray(skill.groups) ? skill.groups : []).includes(groupFilter));
            const filtered = grouped.filter((skill) => skill.name.toLocaleLowerCase().includes(normalizedQuery));
            const groupKeys = ["all", ...(Array.isArray(groupsList) ? groupsList.map((group) => group.name) : [])];
            const groupCount = (key) => (key === "all" ? scoped.length : scoped.reduce((sum, skill) => sum + ((Array.isArray(skill.groups) ? skill.groups : []).includes(key) ? 1 : 0), 0));
            const migratorSkills = migrator !== null ? skills.filter((skill) => scopeOf(skill) === migrator.from) : [];
            const membersOfGroup = (groupId, scopeKey) => {
                if (groupId === null || groupId === undefined)
                    return [];
                const group = (Array.isArray(groupsList) ? groupsList : []).find((item) => item.id === groupId);
                return group !== undefined && Array.isArray(group.scopes[scopeKey]) ? group.scopes[scopeKey] : [];
            };
            const groupEditorSkills = groupEditor !== null ? skills.filter((skill) => scopeOf(skill) === groupEditor.scope) : [];
            // 搜索过滤掉已展开项时自动收起。
            react.useEffect(() => {
                if (expanded !== null && !filtered.some((skill) => skill.name === expanded))
                    setExpanded(null);
            }, [expanded, filtered]);
            // 展开/收起：展开时懒加载内容并缓存。
            const toggle = (skill) => {
                const next = expanded === skill.name ? null : skill.name;
                setExpanded(next);
                if (next === null || bodies[skill.name] !== undefined || inflight.current.has(skill.name))
                    return;
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
                        updateBanner !== null ? (0, react_jsx_runtime.jsxs)("div", {
                            className: c.updateBanner,
                            role: "status",
                            children: [(0, react_jsx_runtime.jsx)("span", {
                                    className: c.updateText,
                                    children: updateBanner
                                }), (0, react_jsx_runtime.jsx)("button", {
                                    type: "button",
                                    className: c.addDismiss,
                                    onClick: () => {
                                        setUpdateBanner(null);
                                    },
                                    children: t("addDismiss")
                                })]
                        }) : null,
                        (0, react_jsx_runtime.jsxs)("div", {
                            className: c.searchBox,
                            style: { position: "relative", width: "100%" },
                            children: [(0, react_jsx_runtime.jsx)("span", {
                                    className: c.searchIcon,
                                    "aria-hidden": "true",
                                    style: { position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", display: "inline-flex", alignItems: "center", pointerEvents: "none", color: "var(--dsw-alias-label-tertiary, #7d7f8c)" },
                                    children: (0, react_jsx_runtime.jsx)(primitives.IconSearchOutline16, {})
                                }), (0, react_jsx_runtime.jsx)("input", {
                                    type: "search",
                                    className: c.searchField,
                                    value: query,
                                    placeholder: t("search"),
                                    "aria-label": t("search"),
                                    style: { boxSizing: "border-box", width: "100%", height: "36px", border: "1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.35))", borderRadius: "8px", background: "var(--dsw-alias-bg-layer-1, #ffffff)", color: "var(--dsw-alias-label-primary, #1f2329)", font: "inherit", fontSize: "13px", lineHeight: "34px", outline: "none", padding: "0 12px 0 38px" },
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
                                            className: c.migrateButton,
                                            "aria-label": t("groupButton"),
                                            title: t("groupButton"),
                                            disabled: listState.status !== "ready" || skills.length === 0,
                                            onClick: openGroupEditor,
                                            children: (0, react_jsx_runtime.jsxs)("svg", {
                                                width: "14",
                                                height: "14",
                                                viewBox: "0 0 16 16",
                                                fill: "none",
                                                "aria-hidden": "true",
                                                children: [(0, react_jsx_runtime.jsx)("path", {
                                                        d: "M2.5 5.5h3.2l1.6 2h6.2v5h-11z",
                                                        stroke: "currentColor",
                                                        strokeWidth: 1.4,
                                                        strokeLinejoin: "round"
                                                    }), (0, react_jsx_runtime.jsx)("path", {
                                                        d: "M5.8 10.8h4.4",
                                                        stroke: "currentColor",
                                                        strokeWidth: 1.4,
                                                        strokeLinecap: "round"
                                                    })]
                                            })
                                        }), (0, react_jsx_runtime.jsx)("button", {
                                            type: "button",
                                            className: c.migrateButton,
                                            "aria-label": t("migrateButton"),
                                            title: t("migrateButton"),
                                            disabled: listState.status !== "ready" || skills.length === 0 || adding.status === "busy",
                                            onClick: openMigrator,
                                            children: (0, react_jsx_runtime.jsxs)("svg", {
                                                width: "14",
                                                height: "14",
                                                viewBox: "0 0 16 16",
                                                fill: "none",
                                                "aria-hidden": "true",
                                                children: [(0, react_jsx_runtime.jsx)("path", {
                                                        d: "M2.5 5h11M11 2.5 13.5 5 11 7.5",
                                                        stroke: "currentColor",
                                                        strokeWidth: 1.6,
                                                        strokeLinecap: "round",
                                                        strokeLinejoin: "round"
                                                    }), (0, react_jsx_runtime.jsx)("path", {
                                                        d: "M13.5 11h-11M5 8.5 2.5 11 5 13.5",
                                                        stroke: "currentColor",
                                                        strokeWidth: 1.6,
                                                        strokeLinecap: "round",
                                                        strokeLinejoin: "round"
                                                    })]
                                            })
                                        }), (0, react_jsx_runtime.jsx)("button", {
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
                        (0, react_jsx_runtime.jsxs)("div", {
                            className: c.scopeBar,
                            role: "tablist",
                            children: scopeKeys.map((key) => (0, react_jsx_runtime.jsxs)("button", {
                                type: "button",
                                role: "tab",
                                "aria-selected": scopeFilter === key,
                                className: c.scopeChip,
                                "data-active": scopeFilter === key ? "true" : void 0,
                                onClick: () => {
                                    setScopeFilter(key);
                                },
                                children: [(0, react_jsx_runtime.jsx)("span", {
                                        className: c.scopeChipLabel,
                                        title: key === "global" ? t("scopeGlobal") : key,
                                        children: key === "global" ? t("scopeGlobal") : labelOf(key)
                                    }), (0, react_jsx_runtime.jsx)("span", {
                                        className: c.scopeChipCount,
                                        children: scopeCount(key)
                                    })]
                            }, key))
                        }),
                        (0, react_jsx_runtime.jsxs)("div", {
                            className: c.groupBar,
                            role: "tablist",
                            children: groupKeys.map((key) => [(0, react_jsx_runtime.jsx)("span", {
                                    className: c.groupSep,
                                    "aria-hidden": "true",
                                    children: "|"
                                }, "sep-" + key), (0, react_jsx_runtime.jsx)("button", {
                                    type: "button",
                                    role: "tab",
                                    "aria-selected": groupFilter === key,
                                    className: c.groupItem,
                                    "data-active": groupFilter === key ? "true" : void 0,
                                    onClick: () => {
                                        setGroupFilter(key);
                                    },
                                    children: key === "all" ? t("groupAll") : key
                                }, key)]).concat([(0, react_jsx_runtime.jsx)("span", {
                                    className: c.groupSep,
                                    "aria-hidden": "true",
                                    children: "|"
                                }, "sep-end")])
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
                        skills.length > 0 && scoped.length === 0 ? (0, react_jsx_runtime.jsx)("p", {
                            className: c.status,
                            children: t("emptyScope")
                        }) : null,
                        scoped.length > 0 && grouped.length === 0 ? (0, react_jsx_runtime.jsx)("p", {
                            className: c.status,
                            children: t("groupEmpty")
                        }) : null,
                        grouped.length > 0 && filtered.length === 0 ? (0, react_jsx_runtime.jsx)("p", {
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
                                                        }), (0, react_jsx_runtime.jsx)(primitives.IconChevronDownOutline14, {
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
                            multiple: true,
                            onChange: onPickFile
                        }),
                        groupEditor !== null ? (0, react_jsx_runtime.jsx)(GroupDialog, {
                            t,
                            options: wsOptions,
                            groups: groupsList,
                            groupId: groupEditor.groupId,
                            setGroupId: (value, presetName) => {
                                setGroupEditor((prev) => (prev === null ? prev : { ...prev, groupId: value, name: value === null ? "" : presetName, selected: new Set(membersOfGroup(value, prev.scope)), error: null }));
                            },
                            name: groupEditor.name,
                            setName: (value) => {
                                setGroupEditor((prev) => (prev === null ? prev : { ...prev, name: value, error: null }));
                            },
                            scope: groupEditor.scope,
                            setScope: (value) => {
                                setGroupEditor((prev) => (prev === null ? prev : { ...prev, scope: value, selected: new Set(membersOfGroup(prev.groupId, value)), error: null }));
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
                                setMigrator((prev) => (prev === null ? prev : { ...prev, from: value, error: null }));
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
        }
        // ── 设置页导航图标补丁 ──────────────────────────────────────────────
        // 外壳的 navIcon 是硬编码的（无扩展点），这里用 MutationObserver 给
        // “技能”导航项打上 data 标记，由 CSS 隐藏齿轮并用蒙版绘制自定义图标。
        const NAV_LABELS = [zh.nav, en.nav];
        let navPatchScheduled = false;
        const patchSkillsNavIcons = () => {
            navPatchScheduled = false;
            if (typeof document === "undefined")
                return;
            for (const dialog of document.querySelectorAll('[role="dialog"]')) {
                for (const button of dialog.querySelectorAll("button")) {
                    if (button.dataset.skillsNav === "1")
                        continue;
                    let hit = false;
                    for (const span of button.querySelectorAll("span")) {
                        const text = (span.textContent ?? "").trim();
                        if (span.childElementCount === 0 && NAV_LABELS.includes(text)) {
                            hit = true;
                            break;
                        }
                    }
                    if (hit)
                        button.dataset.skillsNav = "1";
                }
            }
        };
        const scheduleNavPatch = () => {
            if (navPatchScheduled || typeof document === "undefined")
                return;
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
                if (!result.ok)
                    throw new Error("skillsViewer." + method + " failed: " + result.error.code + ": " + result.error.message);
                return result.value;
            };
            const sectionFace = () => ({
                currentSessionId,
                listSkills: () => callRemote("list", currentSessionId()),
                listWorkspaces: () => callRemote("workspaces"),
                loadContent: (name) => callRemote("content", name, currentSessionId()),
                setSkillEnabled: (name, enabled) => callRemote("setEnabled", name, currentSessionId(), enabled),
                batchMigrateSkill: (payload) => callRemote("batchMigrate", currentSessionId(), payload),
                listGroups: () => callRemote("groups"),
                saveGroupSkill: (payload) => callRemote("saveGroup", payload),
                deleteGroupSkill: (payload) => callRemote("deleteGroup", payload),
                checkUpdateRemote: () => callRemote("checkUpdate"),
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
        bundleModule.exports.NS = NS;
        bundleModule.exports.apply = apply;
        bundleModule.exports.inject = inject;
        return bundleModule.exports;
    }
});
