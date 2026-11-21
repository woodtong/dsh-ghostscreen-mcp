window.__ModuleLoader__.load({
  id: "dsh-ghostscreen-mcp",
  factory(require) {
    const React = require("react");
    const { useState, useEffect, useRef } = React;
    const h = React.createElement;

    const NS = "ghostscreen-mcp";
    const STATUS_URL = "/ghostscreen-mcp/status";

    const en = {
      title: "GhostScreen bridge",
      summary: "Drives the GhostScreen desktop-isolation MCP server (window parking, screenshots, input) and keeps it updated.",
      argsLabel: "Extra arguments",
      argsDesc: "One per line, passed to GhostScreen.Mcp.exe as-is.",
      envLabel: "Environment variables",
      envDesc: "One KEY=VALUE per line.",
      timeoutLabel: "Tool call timeout (ms)",
      timeoutDesc: "Leave empty to use the client default.",
      overridden: "overridden",
      reset: "Reset",
      resetAll: "Reset all",
      save: "Save",
      saving: "Saving…",
      saved: "Saved",
      discard: "Discard",
      loading: "Loading configuration…",
      unavailable: "Configuration is unavailable for this entry.",
      readonly: "The active profile cannot edit this entry.",
      errEnv: "Bad environment line (expected KEY=VALUE): ",
      errTimeout: "Timeout must be a positive number of milliseconds.",
      saveFailed: "Save failed: ",
      applied: "Saving applies immediately — the bridge remounts with the new options.",
      updateTitle: "Version",
      updateRunning: "Running",
      updateLatest: "Latest release",
      updateNone: "unknown",
      updateNoBridge: "not mounted",
      updateSourceExternal: "external build",
      updateSourceManaged: "managed",
      updateSourceLegacy: "legacy layout",
      updateChecking: "Checking GitHub for a newer release…",
      updateUpToDate: "Up to date.",
      updateDownloading: "Downloading {pct}% ({done} / {total} MiB)…",
      updateReady: "{version} is downloaded — it starts automatically the next time DSH starts.",
      updatePendingRestart: "{version} is installed — restart DSH to switch to it.",
      updateExternalManaged: "{version} is present in the managed folder; the externally pinned build still wins.",
      updateExternalNote: "Auto-update keeps the managed folder current; the pinned build is what actually runs.",
      updateFailed: "Update failed: {msg}",
      updateRetry: "Check now",
      updateCheckedAt: "Checked at {time}",
      updateUnavailable: "Update status is unavailable (no status route on this host).",
      updateCleanup: "Older versions are deleted on the next start.",
      updateNever: "No check yet this session.",
      checkMissingMcp: "Package self-check: mcp\\GhostScreen.Mcp.exe is missing from the installed package.",
      checkMissingNotifier:
        "Package self-check: GhostScreen.Notifier\\GhostScreen.Notifier.exe is missing (no desktop notification while the tray is off).",
      checkNote:
        "Releases before 0.2.0 shipped no notifier folder, so a missing notifier is expected for older packages. Advisory only: nothing was repaired and the bridge keeps running.",
    };

    const zh = {
      title: "GhostScreen 桥接",
      summary: "接入 GhostScreen 桌面隔离 MCP 服务（窗口停靠、截图、输入驱动），并自动保持最新版本。",
      argsLabel: "附加命令行参数",
      argsDesc: "每行一个，原样传给 GhostScreen.Mcp.exe。",
      envLabel: "环境变量",
      envDesc: "每行一个，格式 KEY=VALUE。",
      timeoutLabel: "工具调用超时（毫秒）",
      timeoutDesc: "留空使用客户端默认值。",
      overridden: "已覆盖",
      reset: "重置",
      resetAll: "全部重置",
      save: "保存",
      saving: "保存中…",
      saved: "已保存",
      discard: "放弃更改",
      loading: "正在加载配置…",
      unavailable: "该条目暂不可配置。",
      readonly: "当前活动配置无法编辑此条目。",
      errEnv: "环境变量行格式错误（应为 KEY=VALUE）：",
      errTimeout: "超时必须是正整数毫秒值。",
      saveFailed: "保存失败：",
      applied: "保存后立即生效——桥接会以新参数自动重挂。",
      updateTitle: "版本",
      updateRunning: "正在运行",
      updateLatest: "最新发行版",
      updateNone: "未知",
      updateNoBridge: "未挂载",
      updateSourceExternal: "外部指定构建",
      updateSourceManaged: "托管安装",
      updateSourceLegacy: "旧版布局",
      updateChecking: "正在向 GitHub 检查新版本…",
      updateUpToDate: "已是最新版本。",
      updateDownloading: "下载中 {pct}%（{done} / {total} MiB）…",
      updateReady: "{version} 已下载完成——下次启动 DSH 时自动启用。",
      updatePendingRestart: "{version} 已就绪——重启 DSH 后切换到该版本。",
      updateExternalManaged: "托管目录已有 {version}；但外部指定的构建优先运行。",
      updateExternalNote: "自动更新会保持托管目录为最新；实际运行的是外部指定的构建。",
      updateFailed: "更新失败：{msg}",
      updateRetry: "立即检查",
      updateCheckedAt: "检查时间 {time}",
      updateUnavailable: "更新状态不可用（当前宿主未注册状态路由）。",
      updateCleanup: "旧版本会在下次启动时删除。",
      updateNever: "本次会话尚未检查。",
      checkMissingMcp: "包自检：安装包内缺少 mcp\\GhostScreen.Mcp.exe。",
      checkMissingNotifier:
        "包自检：安装包内缺少 GhostScreen.Notifier\\GhostScreen.Notifier.exe（托盘未运行时无法弹通知）。",
      checkNote:
        "0.2.0 之前的发布包不含 notifier 目录，旧包缺失属正常情况。此项仅供参考：未做任何自动修复，桥接照常运行。",
    };

    /* ------------------------------------------------------------------ */
    /* Styles: copies of the ui-primitives controls, gsmp- prefixed,       */
    /* themed only through --dsw-alias-* tokens.                           */
    /* ------------------------------------------------------------------ */

    const CSS = [
      ".gsmp-root{display:flex;flex-direction:column;gap:16px;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary)}",
      ".gsmp-head{display:flex;flex-direction:column;gap:2px}",
      ".gsmp-title{font-size:16px;line-height:24px;font-weight:600;color:var(--dsw-alias-label-primary)}",
      ".gsmp-note{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}",
      ".gsmp-flash{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}",

      ".gsmp-card{display:flex;flex-direction:column;gap:6px;padding:12px;border:0.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1)}",
      ".gsmp-cardhead{display:flex;align-items:center;justify-content:space-between;gap:8px}",
      ".gsmp-cardtitle{font-size:12px;line-height:18px;font-weight:600;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary);text-transform:uppercase}",
      ".gsmp-kv{display:flex;gap:8px;font-size:13px;line-height:20px;min-width:0}",
      ".gsmp-k{flex:0 0 auto;min-width:84px;color:var(--dsw-alias-label-tertiary)}",
      ".gsmp-v{min-width:0;color:var(--dsw-alias-label-primary);word-break:break-all}",
      ".gsmp-v.dim{color:var(--dsw-alias-label-tertiary)}",
      ".gsmp-bar{height:4px;border-radius:2px;background:var(--dsw-alias-border-l2);overflow:hidden;margin-top:2px}",
      ".gsmp-barfill{height:100%;background:var(--dsw-alias-brand-primary);transition:width 200ms ease}",
      ".gsmp-warn{display:flex;flex-direction:column;gap:2px;padding:8px 10px;border-left:2px solid var(--dsw-alias-state-business-primary);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2)}",
      ".gsmp-warnline{font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary);word-break:break-all}",
      ".gsmp-warnnote{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}",

      ".gsmp-field{display:flex;flex-direction:column;gap:4px}",
      ".gsmp-field-head{display:flex;align-items:center;gap:6px}",
      ".gsmp-label{font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary)}",
      ".gsmp-desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}",
      ".gsmp-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-brand-primary);flex:0 0 auto}",

      ".gsmp-inputwrap{display:flex;align-items:center;gap:6px;height:32px;padding:0 8px;border:0.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1)}",
      ".gsmp-inputwrap:focus-within{border-color:var(--dsw-alias-state-business-primary)}",
      ".gsmp-input{flex:1;min-width:0;border:none;outline:none;background:transparent;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary)}",
      ".gsmp-input::placeholder{color:var(--dsw-alias-label-dimmed)}",
      ".gsmp-textareawrap{display:flex;padding:4px 8px;border:0.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1)}",
      ".gsmp-textareawrap:focus-within{border-color:var(--dsw-alias-state-business-primary)}",
      ".gsmp-textarea{flex:1;min-width:0;border:none;outline:none;background:transparent;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family-mono,ui-monospace,monospace);resize:vertical}",
      ".gsmp-textarea::placeholder{color:var(--dsw-alias-label-dimmed)}",

      ".gsmp-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px}",
      ".gsmp-button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:4px;border:none;border-radius:var(--dsw-radius-md);cursor:pointer;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary);background:transparent;padding:0 14px;height:32px}",
      ".gsmp-button.sm{height:28px;font-size:12px;line-height:18px;padding:0 10px;border-radius:var(--dsw-radius-sm)}",
      ".gsmp-button:disabled{cursor:not-allowed;opacity:.4}",
      ".gsmp-button.primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}",
      ".gsmp-button:disabled.primary{background:var(--dsw-alias-button-primary-fill)}",
      "@media (hover:hover){.gsmp-button.primary:hover:enabled{background:var(--dsw-alias-button-primary-hover)}.gsmp-button.ghost:hover:enabled{background:var(--dsw-alias-interactive-bg-hover)}}",
      "@media (hover:hover){.gsmp-button.ghost:active:enabled{background:var(--dsw-alias-interactive-bg-active)}}",
      ".gsmp-linkbtn{border:none;background:transparent;cursor:pointer;padding:2px 6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);border-radius:var(--dsw-radius-sm)}",
      "@media (hover:hover){.gsmp-linkbtn:hover:enabled{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}}",
      ".gsmp-error{font-size:12px;line-height:18px;color:var(--dsw-alias-label-error)}",
      ".gsmp-muted{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}",
      ".gsmp-divider{height:0.5px;background:var(--dsw-alias-border-l2)}",
    ].join("\n");

    let styleElement = null;
    function ensureStyles() {
      if (typeof document === "undefined") return;
      if (styleElement && document.getElementById("gsmp-config-style")) return;
      if (!styleElement) {
        styleElement = document.createElement("style");
        styleElement.id = "gsmp-config-style";
        styleElement.textContent = CSS;
      }
      if (!document.getElementById("gsmp-config-style")) document.head.appendChild(styleElement);
    }

    /* ------------------------------------------------------------------ */
    /* Helpers                                                             */
    /* ------------------------------------------------------------------ */

    function envToText(env) {
      const entries = Object.entries(env ?? {});
      entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      return entries.map(([k, v]) => `${k}=${v}`).join("\n");
    }

    function parseEnvText(text, errPrefix) {
      const env = {};
      for (const raw of String(text ?? "").split("\n")) {
        const line = raw.trim();
        if (!line || line.startsWith("#")) continue;
        const eq = line.indexOf("=");
        if (eq <= 0) throw new Error(errPrefix + line);
        env[line.slice(0, eq).trim()] = line.slice(eq + 1);
      }
      return env;
    }

    function stable(value) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const out = {};
        for (const k of Object.keys(value).sort()) out[k] = value[k];
        return out;
      }
      return value;
    }

    function sameJson(a, b) {
      return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
    }

    function fill(template, vars) {
      return String(template ?? "").replace(/\{(\w+)\}/g, (all, key) => (key in vars ? String(vars[key]) : all));
    }

    function mib(bytes) {
      if (!bytes) return "0";
      return (bytes / 1048576).toFixed(bytes >= 512 * 1048576 ? 0 : 1);
    }

    const FIELDS = ["args", "env", "toolCallTimeoutMs"];

    function initialDraft(value) {
      return {
        args: Array.isArray(value.args) ? value.args.join("\n") : "",
        env: envToText(value.env),
        toolCallTimeoutMs: value.toolCallTimeoutMs == null ? "" : String(value.toolCallTimeoutMs),
        unset: {},
      };
    }

    function draftDirty(draft, base) {
      if (!draft) return false;
      if (Object.keys(draft.unset).length > 0) return true;
      const init = initialDraft(base);
      for (const key of FIELDS) {
        if (String(draft[key] ?? "") !== String(init[key] ?? "")) return true;
      }
      return false;
    }

    function buildOps(draft, value, user, t) {
      const ops = [];
      const push = (op, path, val) => ops.push(val === undefined ? { op, path } : { op, path, value: val });

      if (draft.unset.args) push("unset", ["args"]);
      else {
        const args = String(draft.args ?? "").split("\n").map((s) => s.trim()).filter((s) => s !== "");
        if (!sameJson(args, value.args ?? [])) push("set", ["args"], args);
      }

      if (draft.unset.env) push("unset", ["env"]);
      else {
        const env = parseEnvText(draft.env, t("errEnv"));
        if (!sameJson(env, value.env ?? {})) push("set", ["env"], env);
      }

      if (draft.unset.toolCallTimeoutMs) push("unset", ["toolCallTimeoutMs"]);
      else {
        const raw = String(draft.toolCallTimeoutMs ?? "").trim();
        if (!raw) {
          if ("toolCallTimeoutMs" in (user ?? {})) push("unset", ["toolCallTimeoutMs"]);
        } else {
          const n = Number(raw);
          if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) throw new Error(t("errTimeout"));
          if (n !== value.toolCallTimeoutMs) push("set", ["toolCallTimeoutMs"], n);
        }
      }

      return ops;
    }

    /* ------------------------------------------------------------------ */
    /* Controls                                                            */
    /* ------------------------------------------------------------------ */

    function TextField({ label, desc, value, onChange, disabled, overridden, onReset, placeholder, t }) {
      return h(
        "div",
        { className: "gsmp-field" },
        h(
          "div",
          { className: "gsmp-field-head" },
          overridden ? h("span", { className: "gsmp-dot", title: t("overridden") }) : null,
          h("span", { className: "gsmp-label" }, label),
          overridden && !disabled
            ? h("button", { type: "button", className: "gsmp-linkbtn", title: t("reset"), onClick: onReset }, "↺")
            : null,
        ),
        h(
          "div",
          { className: "gsmp-inputwrap" },
          h("input", {
            className: "gsmp-input",
            type: "text",
            value: value,
            placeholder: placeholder,
            disabled: !!disabled,
            spellCheck: false,
            onChange: (e) => onChange(e.target.value),
          }),
        ),
        desc ? h("div", { className: "gsmp-desc" }, desc) : null,
      );
    }

    function TextareaField({ label, desc, value, onChange, disabled, overridden, onReset, placeholder, rows, t }) {
      return h(
        "div",
        { className: "gsmp-field" },
        h(
          "div",
          { className: "gsmp-field-head" },
          overridden ? h("span", { className: "gsmp-dot", title: t("overridden") }) : null,
          h("span", { className: "gsmp-label" }, label),
          overridden && !disabled
            ? h("button", { type: "button", className: "gsmp-linkbtn", title: t("reset"), onClick: onReset }, "↺")
            : null,
        ),
        h(
          "div",
          { className: "gsmp-textareawrap" },
          h("textarea", {
            className: "gsmp-textarea",
            rows: rows,
            value: value,
            placeholder: placeholder,
            disabled: !!disabled,
            spellCheck: false,
            onChange: (e) => onChange(e.target.value),
          }),
        ),
        desc ? h("div", { className: "gsmp-desc" }, desc) : null,
      );
    }

    /* ------------------------------------------------------------------ */
    /* Version card                                                        */
    /* ------------------------------------------------------------------ */

    function UpdateCard({ t }) {
      const [status, setStatus] = useState(null);
      const [unreachable, setUnreachable] = useState(false);
      const [poking, setPoking] = useState(false);

      useEffect(() => {
        let alive = true;
        async function tick() {
          try {
            const res = await fetch(STATUS_URL, {
              headers: { accept: "application/json" },
              credentials: "same-origin",
              cache: "no-store",
            });
            if (!res.ok) throw new Error(String(res.status));
            const data = await res.json();
            if (alive) {
              setStatus(data);
              setUnreachable(false);
            }
          } catch {
            if (alive) setUnreachable(true);
          }
        }
        void tick();
        const id = setInterval(tick, 2500);
        return () => {
          alive = false;
          clearInterval(id);
        };
      }, []);

      const poke = () => {
        setPoking(true);
        fetch(`${STATUS_URL}?refresh=1`, { headers: { accept: "application/json" }, credentials: "same-origin", cache: "no-store" })
          .catch(() => undefined)
          .then(() => setTimeout(() => setPoking(false), 1200));
      };

      const s = status ?? {};
      const current = s.current;
      const managedTop = Array.isArray(s.managed) && s.managed.length ? s.managed[0] : undefined;
      const phase = s.phase ?? "idle";
      const busy = phase === "checking" || phase === "downloading";

      const sourceText = current
        ? current.source === "external"
          ? t("updateSourceExternal")
          : current.source === "legacy"
            ? t("updateSourceLegacy")
            : t("updateSourceManaged")
        : null;

      let line = null;
      let tone = "muted";
      if (unreachable) {
        line = t("updateUnavailable");
      } else if (phase === "checking") {
        line = t("updateChecking");
        tone = "muted";
      } else if (phase === "downloading") {
        const p = s.progress ?? {};
        line = fill(t("updateDownloading"), { pct: p.pct ?? 0, done: mib(p.done), total: mib(p.total) });
        tone = "muted";
      } else if (phase === "ready") {
        line = fill(t("updateReady"), { version: s.latest && s.latest.version ? `v${s.latest.version}` : "" });
        tone = "accent";
      } else if (phase === "error") {
        line = fill(t("updateFailed"), { msg: (s.error && s.error.message) || "?" });
        tone = "error";
      } else if (managedTop && current && current.source === "managed" && managedTop.version !== current.version) {
        line = fill(t("updatePendingRestart"), { version: `v${managedTop.version}` });
        tone = "accent";
      } else if (managedTop && current && current.source !== "managed") {
        line = fill(t("updateExternalManaged"), { version: `v${managedTop.version}` });
        tone = "muted";
      } else if (s.checkedAt) {
        line = t("updateUpToDate");
        tone = "muted";
      } else {
        line = t("updateNever");
        tone = "muted";
      }

      // Advisory package self-check from the host: nothing here blocks the
      // bridge, changes the update flow, or repairs anything.
      const missing = Array.isArray(s.integrity && s.integrity.missing) ? s.integrity.missing : [];
      const warnings = missing.map((key) =>
        key === "mcp" ? t("checkMissingMcp") : t("checkMissingNotifier"),
      );

      const rows = [
        h(
          "div",
          { className: "gsmp-kv", key: "running" },
          h("div", { className: "gsmp-k" }, t("updateRunning")),
          h(
            "div",
            { className: "gsmp-v" },
            current
              ? current.version
                ? `v${current.version}${sourceText ? ` · ${sourceText}` : ""}`
                : `${t("updateNone")} · ${sourceText ?? ""}`
              : t("updateNoBridge"),
          ),
        ),
        h(
          "div",
          { className: "gsmp-kv", key: "latest" },
          h("div", { className: "gsmp-k" }, t("updateLatest")),
          h("div", { className: "gsmp-v dim" }, s.latest && s.latest.version ? `v${s.latest.version}` : t("updateNone")),
        ),
      ];

      return h(
        "div",
        { className: "gsmp-card" },
        h(
          "div",
          { className: "gsmp-cardhead" },
          h("span", { className: "gsmp-cardtitle" }, t("updateTitle")),
          h(
            "button",
            {
              type: "button",
              className: "gsmp-button ghost sm",
              disabled: busy || poking,
              onClick: poke,
            },
            t("updateRetry"),
          ),
        ),
        ...rows,
        h("div", { className: tone === "error" ? "gsmp-error" : tone === "accent" ? "gsmp-label" : "gsmp-muted" }, line),
        phase === "downloading"
          ? h("div", { className: "gsmp-bar" }, h("div", { className: "gsmp-barfill", style: { width: `${(s.progress && s.progress.pct) || 0}%` } }))
          : null,
        phase === "ready" ? h("div", { className: "gsmp-muted" }, t("updateCleanup")) : null,
        s.checkedAt && phase !== "checking" && phase !== "downloading"
          ? h("div", { className: "gsmp-muted" }, fill(t("updateCheckedAt"), { time: new Date(s.checkedAt).toLocaleTimeString() }))
          : null,
        warnings.length
          ? h(
              "div",
              { className: "gsmp-warn" },
              ...warnings.map((text) => h("div", { className: "gsmp-warnline", key: text }, text)),
              h("div", { className: "gsmp-warnnote" }, t("checkNote")),
            )
          : null,
      );
    }

    /* ------------------------------------------------------------------ */
    /* The form                                                            */
    /* ------------------------------------------------------------------ */

    function ConfigBody({ t, form }) {
      const state = form && form.state;
      const mutate = form && form.mutate;

      const [draft, setDraft] = useState(null);
      const [saving, setSaving] = useState(false);
      const [error, setError] = useState(null);
      const [flash, setFlash] = useState(false);
      const flashTimer = useRef(null);

      const revision = state && state.revision;
      useEffect(() => {
        setDraft(null);
        setError(null);
      }, [revision]);

      useEffect(
        () => () => {
          if (flashTimer.current) clearTimeout(flashTimer.current);
        },
        [],
      );

      if (!state || state.status === "loading") {
        return h("div", { className: "gsmp-muted" }, t("loading"));
      }
      if (state.status !== "ready") {
        return h("div", { className: "gsmp-muted" }, t("unavailable"));
      }

      const value = (state.value && typeof state.value === "object" ? state.value : {}) ?? {};
      const user = state.user && typeof state.user === "object" ? state.user : {};
      const writable = state.writable !== false && typeof mutate === "function";
      const init = initialDraft(value);
      const d = draft ?? init;
      const dirty = draftDirty(draft, value);
      const overridden = (f) => Object.prototype.hasOwnProperty.call(user, f);

      const setField = (key, v) =>
        setDraft((prev) => {
          const base = prev ?? init;
          const unset = { ...base.unset };
          delete unset[key];
          return { ...base, [key]: v, unset };
        });
      const markUnset = (key) =>
        setDraft((prev) => {
          const base = prev ?? init;
          return { ...base, [key]: "", unset: { ...base.unset, [key]: true } };
        });
      const resetAll = () =>
        setDraft(() => {
          const unset = {};
          for (const key of FIELDS) if (overridden(key)) unset[key] = true;
          return { ...initialDraft({}), unset };
        });

      async function save() {
        setError(null);
        let ops;
        try {
          ops = buildOps(d, value, user, t);
        } catch (e) {
          setError(String((e && e.message) || e));
          return;
        }
        if (!ops.length) {
          setDraft(null);
          return;
        }
        setSaving(true);
        try {
          await mutate(ops, typeof revision === "number" ? revision : undefined);
          setDraft(null);
          setFlash(true);
          if (flashTimer.current) clearTimeout(flashTimer.current);
          flashTimer.current = setTimeout(() => setFlash(false), 2500);
        } catch (e) {
          setError(t("saveFailed") + String((e && e.message) || e));
        } finally {
          setSaving(false);
        }
      }

      return h(
        React.Fragment,
        null,
        writable ? null : h("div", { className: "gsmp-error" }, t("readonly")),
        h(TextareaField, {
          label: t("argsLabel"),
          desc: t("argsDesc"),
          placeholder: "--headless",
          rows: 2,
          value: d.args,
          disabled: !writable || saving,
          overridden: overridden("args"),
          onReset: () => markUnset("args"),
          onChange: (v) => setField("args", v),
          t: t,
        }),
        h(TextareaField, {
          label: t("envLabel"),
          desc: t("envDesc"),
          placeholder: "GHOSTSCREEN_LOG_LEVEL=debug",
          rows: 2,
          value: d.env,
          disabled: !writable || saving,
          overridden: overridden("env"),
          onReset: () => markUnset("env"),
          onChange: (v) => setField("env", v),
          t: t,
        }),
        h(TextField, {
          label: t("timeoutLabel"),
          desc: t("timeoutDesc"),
          placeholder: "120000",
          value: d.toolCallTimeoutMs,
          disabled: !writable || saving,
          overridden: overridden("toolCallTimeoutMs"),
          onReset: () => markUnset("toolCallTimeoutMs"),
          onChange: (v) => setField("toolCallTimeoutMs", v),
          t: t,
        }),
        error ? h("div", { className: "gsmp-error" }, error) : null,
        flash && !error ? h("div", { className: "gsmp-flash" }, t("saved")) : null,
        h(
          "div",
          { className: "gsmp-actions" },
          writable
            ? h(
                "button",
                { type: "button", className: "gsmp-button ghost sm", disabled: !dirty || saving, onClick: resetAll },
                t("resetAll"),
              )
            : null,
          writable
            ? h(
                "button",
                {
                  type: "button",
                  className: "gsmp-button ghost sm",
                  disabled: !dirty || saving,
                  onClick: () => {
                    setDraft(null);
                    setError(null);
                  },
                },
                t("discard"),
              )
            : null,
          writable
            ? h(
                "button",
                {
                  type: "button",
                  className: "gsmp-button primary sm",
                  disabled: !dirty || saving,
                  onClick: () => void save(),
                },
                saving ? t("saving") : t("save"),
              )
            : null,
        ),
      );
    }

    /* ------------------------------------------------------------------ */
    /* The page                                                            */
    /* ------------------------------------------------------------------ */

    function GhostScreenConfigView(props) {
      const { t, view, form } = props || {};
      ensureStyles();

      if (view === "summary") {
        return h("div", { className: "gsmp-muted" }, t ? t("summary") : en.summary);
      }

      return h(
        "div",
        { className: "gsmp-root" },
        h(
          "div",
          { className: "gsmp-head" },
          h("div", { className: "gsmp-title" }, t("title")),
          h("div", { className: "gsmp-note" }, t("applied")),
        ),
        h(UpdateCard, { t: t }),
        h("div", { className: "gsmp-divider" }),
        h(ConfigBody, { t: t, form: form }),
      );
    }

    return {
      inject: ["slots", "locale"],
      apply(ctx) {
        ctx.locale.register(NS, { en: en, zh: zh });
        ctx.slots.inject("plugins.row.config", () =>
          ctx.slots.register(
            {
              name: "plugins.row.config",
              key: "dsh-ghostscreen-mcp#ghostscreen-mcp-runtime",
              locale: NS,
            },
            GhostScreenConfigView,
          ),
        );
      },
    };
  },
});
