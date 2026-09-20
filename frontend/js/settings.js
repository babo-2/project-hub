/**
 * settings.js — project settings hub. A small card grid that either shows
 * info inline (My access) or hands off to another panel (Permissions ->
 * members.js, History -> backups.js).
 */

class SettingsPanel {
    constructor() {
        this._buildDom();
    }

    async open(projectId) {
        this.projectId = projectId;
        this.backdrop.hidden = false;
        this.backdrop.style.display = "flex";
        this._showingAccess = false;
        document.body.classList.add("modal-open");
        await this._refresh();
    }

    close() {
        this.backdrop.style.display = "none";
        this.backdrop.hidden = true;
        document.body.classList.remove("modal-open");
    }

    async _refresh() {
        this.body.innerHTML = `<p class="loading">Loading…</p>`;
        try {
            this.project = await api.getProject(this.projectId);
            this._render();
        } catch (err) {
            this.body.innerHTML = `<p class="error">${Utils.escape(err.message)}</p>`;
        }
    }

    _render() {
        const perms = this.project.my_permissions ?? [];

        this.body.innerHTML = `
            <div class="settings-cards">
                <button class="settings-card" data-card="access">
                    <span class="settings-card-icon">🪪</span>
                    <span class="settings-card-title">My access</span>
                    <span class="settings-card-desc">See your role and permissions here</span>
                </button>
                ${perms.includes("manage_members") ? `
                <button class="settings-card" data-card="permissions">
                    <span class="settings-card-icon">👥</span>
                    <span class="settings-card-title">Permissions</span>
                    <span class="settings-card-desc">Manage roles and members</span>
                </button>` : ""}
                ${perms.includes("manage_backups") ? `
                <button class="settings-card" data-card="history">
                    <span class="settings-card-icon">🕓</span>
                    <span class="settings-card-title">History</span>
                    <span class="settings-card-desc">Browse and restore backups</span>
                </button>` : ""}
            </div>
            <div class="settings-inline-panel"></div>
        `;

        this.body.querySelector('[data-card="access"]').addEventListener("click", () => this._toggleAccessInfo());
        this.body.querySelector('[data-card="permissions"]')?.addEventListener("click", () => {
            this.close();
            membersPanel.open(this.projectId, { onBack: () => settingsPanel.open(this.projectId) });
        });
        this.body.querySelector('[data-card="history"]')?.addEventListener("click", () => {
            this.close();
            backupsPanel.open(this.projectId, { onBack: () => settingsPanel.open(this.projectId) });
        });
    }

    async _toggleAccessInfo() {
        const panel = this.body.querySelector(".settings-inline-panel");
        if (this._showingAccess) {
            panel.innerHTML = "";
            this._showingAccess = false;
            return;
        }
        this._showingAccess = true;
        panel.innerHTML = `<p class="loading">Loading…</p>`;
        try {
            const access = await api.getMyAccess(this.projectId);
            panel.innerHTML = `
                <div class="access-info-panel">
                    ${access.is_owner ? `<p><strong>You're the owner</strong> \u2014 full access to everything.</p>` : `
                        <p><strong>Your roles:</strong> ${access.roles.length ? access.roles.map(r => Utils.escape(r.name)).join(", ") : "None assigned"}</p>
                    `}
                    <p><strong>Your permissions:</strong></p>
                    <div class="access-row-chips">
                        ${access.permissions.map(p => `<span class="perm-chip">${p.replace("_", " ")}</span>`).join("") || `<span class="perm-chip perm-chip-muted">None</span>`}
                    </div>
                </div>
            `;
        } catch (err) {
            panel.innerHTML = `<p class="error">${Utils.escape(err.message)}</p>`;
        }
    }

    _buildDom() {
        this.backdrop = document.createElement("div");
        this.backdrop.className = "modal-backdrop";
        this.backdrop.hidden = true;
        this.backdrop.style.display = "none";
        this.backdrop.innerHTML = `
            <div class="modal modal-wide" role="dialog" aria-modal="true">
                <div class="modal-header">
                    <h2>Settings</h2>
                    <button class="btn-icon" id="settings-modal-close" aria-label="Close">✕</button>
                </div>
                <div class="modal-body settings-modal-body"></div>
            </div>
        `;
        document.body.appendChild(this.backdrop);
        this.body = this.backdrop.querySelector(".settings-modal-body");

        this.backdrop.querySelector("#settings-modal-close").addEventListener("click", () => this.close());
        this.backdrop.addEventListener("click", e => { if (e.target === this.backdrop) this.close(); });
    }
}

const settingsPanel = new SettingsPanel();
