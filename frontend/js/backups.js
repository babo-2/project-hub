/**
 * backups.js — "History" panel: browse past snapshots (and the daily zips
 * older snapshots roll into), see a per-module diff against the live
 * project, and push chosen modules (or the whole snapshot) back in.
 */

const STATUS_LABELS = {
    add:            { dot: "status-add",      text: "New in this snapshot" },
    modify:         { dot: "status-modify",   text: "Changed since this snapshot" },
    unchanged:      { dot: "status-unchanged", text: "Unchanged" },
    removed_since:  { dot: "status-removed",  text: "Created after this snapshot" },
};

class BackupsPanel {
    constructor() {
        this._buildDom();
    }

    async open(projectId, { onBack = null } = {}) {
        this.projectId = projectId;
        this._onBack = onBack;
        try {
            this.project = await api.getProject(projectId);
        } catch {
            this.project = null;
        }
        this.backdrop.hidden = false;
        this.backdrop.style.display = "flex";
        this._view = "sources";
        document.body.classList.add("modal-open");
        await this._loadSources();
    }

    close() {
        this.backdrop.style.display = "none";
        this.backdrop.hidden = true;
        document.body.classList.remove("modal-open");
        if (this._onBack) {
            const onBack = this._onBack;
            this._onBack = null;
            onBack();
        }
    }

    /** Fully closes regardless of onBack - used for clicking outside the modal,
     *  as opposed to the X button, which goes back to Settings when applicable. */
    _hardClose() {
        this._onBack = null;
        this.close();
    }

    // -----------------------------------------------------------------------
    // Sources list (snapshots + daily archives)
    // -----------------------------------------------------------------------

    async _loadSources() {
        this.body.innerHTML = `<p class="loading">Loading…</p>`;
        const closeBtn = this.backdrop.querySelector("#backup-modal-close");
        closeBtn.textContent = this._onBack ? "←" : "✕";
        closeBtn.title = this._onBack ? "Back to Settings" : "Close";
        closeBtn.setAttribute("aria-label", closeBtn.title);
        try {
            this.sources = await api.getBackupSources();
            this._renderSources();
        } catch (err) {
            this.body.innerHTML = `<p class="error">${Utils.escape(err.message)}</p>`;
        }
    }

    _renderSources() {
        const snapshotRows = this.sources.snapshots.map(s => `
            <div class="access-row backup-row" data-kind="snapshot" data-name="${Utils.escape(s.name)}">
                <span class="access-row-name">${Utils.formatDateTime(s.timestamp) || s.name}</span>
                <button class="btn btn-ghost btn-view-diff">View changes</button>
            </div>`).join("") || `<p class="loading">No snapshots yet \u2014 backups run automatically after edits.</p>`;

        const dailyRows = this.sources.daily.map(d => `
            <div class="access-row backup-row" data-kind="daily-day" data-day="${Utils.escape(d.day)}">
                <span class="access-row-name">${Utils.escape(d.day)}</span>
                <span class="access-row-meta">${d.snapshots.length} snapshot${d.snapshots.length === 1 ? "" : "s"}</span>
                <button class="btn btn-ghost btn-expand-day">Browse</button>
            </div>`).join("") || `<p class="loading">No daily archives yet.</p>`;

        this.body.innerHTML = `
            <div class="backup-tabs">
                <button class="backup-tab active" data-tab="snapshots">Snapshots</button>
                <button class="backup-tab" data-tab="daily">Daily archives</button>
            </div>
            <div class="backup-tab-panel" data-panel="snapshots">${snapshotRows}</div>
            <div class="backup-tab-panel" data-panel="daily" hidden>${dailyRows}</div>
        `;

        this.body.querySelectorAll(".backup-tab").forEach(tab => {
            tab.addEventListener("click", () => {
                this.body.querySelectorAll(".backup-tab").forEach(t => t.classList.toggle("active", t === tab));
                this.body.querySelectorAll(".backup-tab-panel").forEach(p => {
                    p.hidden = p.dataset.panel !== tab.dataset.tab;
                });
            });
        });

        this.body.querySelectorAll('[data-kind="snapshot"] .btn-view-diff').forEach(btn => {
            btn.addEventListener("click", e => {
                const name = e.target.closest(".backup-row").dataset.name;
                this._openDiff("snapshot", name);
            });
        });

        this.body.querySelectorAll('[data-kind="daily-day"] .btn-expand-day').forEach(btn => {
            btn.addEventListener("click", e => {
                const day = e.target.closest(".backup-row").dataset.day;
                this._renderDailyDay(day);
            });
        });
    }

    _renderDailyDay(day) {
        const entry = this.sources.daily.find(d => d.day === day);
        const rows = entry.snapshots.map(s => `
            <div class="access-row backup-row" data-name="${Utils.escape(s.name)}">
                <span class="access-row-name">${Utils.formatDateTime(s.timestamp) || s.name}</span>
                <button class="btn btn-ghost btn-view-diff">View changes</button>
            </div>`).join("");

        const panel = this.body.querySelector('[data-panel="daily"]');
        panel.innerHTML = `
            <button class="btn btn-ghost btn-back">\u2190 All days</button>
            <h4 class="panel-subheading">${Utils.escape(day)}</h4>
            ${rows}
        `;
        panel.querySelector(".btn-back").addEventListener("click", () => this._renderSources());
        panel.querySelectorAll(".btn-view-diff").forEach(btn => {
            btn.addEventListener("click", e => {
                const name = e.target.closest(".backup-row").dataset.name;
                this._openDiff("daily", name, day);
            });
        });
    }

    // -----------------------------------------------------------------------
    // Diff view
    // -----------------------------------------------------------------------

    _sourcePath(kind, name, day) {
        return kind === "snapshot" ? `snapshot/${name}` : `daily/${day}/${name}`;
    }

    async _openDiff(kind, name, day = null) {
        this._currentSource = { kind, name, day, path: this._sourcePath(kind, name, day) };
        this.body.innerHTML = `<p class="loading">Comparing…</p>`;
        try {
            this.diff = await api.getBackupDiff(this._currentSource.path, this.projectId);
            this._renderDiff();
        } catch (err) {
            this.body.innerHTML = `<p class="error">${Utils.escape(err.message)}</p>`;
        }
    }

    _renderDiff() {
        const canPush = (this.project?.my_permissions ?? []).includes("manage_backups");
        const rows = this.diff.modules.map(m => this._diffRowHtml(m, canPush, 0)).join("")
            || `<p class="loading">This project didn't exist yet in this snapshot.</p>`;

        this.body.innerHTML = `
            <button class="btn btn-ghost btn-back">\u2190 Back</button>
            ${this.diff.project_changed ? `
                <label class="checkbox-label">
                    <input type="checkbox" id="diff-include-meta" />
                    Also restore project name / description / color
                </label>` : ""}
            <div class="diff-rows">${rows}</div>
            ${canPush ? `
                <div class="modal-footer">
                    <button class="btn btn-ghost" id="btn-push-selected">Push selected</button>
                    <button class="btn btn-primary" id="btn-push-all">Push all changes</button>
                </div>` : ""}
        `;

        this.body.querySelector(".btn-back").addEventListener("click", () => {
            if (this._currentSource.kind === "daily") this._renderDailyDay(this._currentSource.day);
            else this._renderSources();
        });

        this.body.querySelectorAll(".diff-view-btn").forEach(btn => {
            btn.addEventListener("click", () => this._togglePreview(btn));
        });
        this.body.querySelectorAll(".diff-expand-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                const row = btn.closest(".diff-row");
                const childrenEl = row.nextElementSibling.nextElementSibling; // .diff-row -> <pre> -> .diff-children
                const collapsed = childrenEl.hidden;
                childrenEl.hidden = !collapsed;
                btn.textContent = collapsed ? "▾" : "▸";
            });
        });

        const pushSelected = this.body.querySelector("#btn-push-selected");
        const pushAll = this.body.querySelector("#btn-push-all");
        if (pushSelected) pushSelected.addEventListener("click", () => this._push(false));
        if (pushAll) pushAll.addEventListener("click", () => this._push(true));
    }

    /** Renders one diff node, plus (for folders) a recursive, collapsible
     *  block of its children right below it. */
    _diffRowHtml(m, canPush, depth) {
        const status = STATUS_LABELS[m.status] ?? STATUS_LABELS.unchanged;
        const hasChildren = Array.isArray(m.children) && m.children.length > 0;
        const indent = `style="padding-left:${0.7 + depth * 1.4}rem"`;

        const row = `
            <div class="diff-row" ${indent} data-path='${Utils.escape(JSON.stringify(m.path))}' data-pushable="${m.pushable}">
                ${hasChildren ? `<button type="button" class="btn-icon diff-expand-btn" title="Expand">▸</button>` : `<span class="diff-expand-spacer"></span>`}
                <span class="status-dot ${status.dot}" title="${status.text}"></span>
                <span class="diff-row-title">${m.module_type === "folder" ? "📁 " : ""}${Utils.escape(m.title)}</span>
                <span class="diff-row-meta">${status.text}</span>
                <button class="btn-icon diff-view-btn" title="Preview snapshot content">👁</button>
                ${m.pushable && canPush ? `<label class="checkbox-label diff-select"><input type="checkbox" class="diff-checkbox" /> select</label>` : ""}
            </div>
            <pre class="diff-preview" hidden></pre>
        `;

        const childrenHtml = hasChildren
            ? `<div class="diff-children" hidden>${m.children.map(c => this._diffRowHtml(c, canPush, depth + 1)).join("")}</div>`
            : "";

        return row + childrenHtml;
    }

    async _togglePreview(btn) {
        const row = btn.closest(".diff-row");
        const pre = row.nextElementSibling;
        if (!pre.hidden) { pre.hidden = true; return; }
        if (!pre.textContent) {
            const path = JSON.parse(row.dataset.path);
            try {
                const module = await api.getBackupModulePreview(this._currentSource.path, this.projectId, path);
                pre.textContent = JSON.stringify(module.data, null, 2);
            } catch (err) {
                pre.textContent = err.message;
            }
        }
        pre.hidden = false;
    }

    async _push(all) {
        const includeMeta = this.body.querySelector("#diff-include-meta")?.checked ?? false;
        let paths;
        if (all) {
            paths = "all";
        } else {
            paths = [...this.body.querySelectorAll(".diff-checkbox:checked")]
                .map(cb => JSON.parse(cb.closest(".diff-row").dataset.path));
            if (!paths.length && !includeMeta) {
                alert("Select at least one item to push.");
                return;
            }
        }
        try {
            await api.pushBackup(this._currentSource.path, this.projectId, paths, includeMeta);
            alert("Pushed. Reloading the project view.");
            this.close();
            window.location.reload();
        } catch (err) {
            alert(err.message);
        }
    }

    // -----------------------------------------------------------------------
    // DOM setup
    // -----------------------------------------------------------------------

    _buildDom() {
        this.backdrop = document.createElement("div");
        this.backdrop.className = "modal-backdrop";
        this.backdrop.hidden = true;
        this.backdrop.style.display = "none";
        this.backdrop.innerHTML = `
            <div class="modal modal-wide" role="dialog" aria-modal="true">
                <div class="modal-header">
                    <h2>History</h2>
                    <button class="btn-icon" id="backup-modal-close" aria-label="Close">✕</button>
                </div>
                <div class="modal-body backup-modal-body"></div>
            </div>
        `;
        document.body.appendChild(this.backdrop);
        this.body = this.backdrop.querySelector(".backup-modal-body");

        this.backdrop.querySelector("#backup-modal-close").addEventListener("click", () => this.close());
        this.backdrop.addEventListener("click", e => { if (e.target === this.backdrop) this._hardClose(); });
    }
}

const backupsPanel = new BackupsPanel();
