/**
 * members.js — "Manage access" panel: create/edit roles (name + permission
 * set) and invite/remove members, assigning them any number of roles.
 *
 * Self-contained: builds its own modal DOM on first use so the static HTML
 * pages don't need to carry markup for a panel most visits never open.
 */

const PERMISSION_LABELS = {
    view:            "View",
    edit_project:    "Edit project",
    delete_project:  "Delete project",
    manage_modules:  "Manage modules",
    manage_members:  "Manage members",
    manage_backups:  "Manage backups",
};

class MembersPanel {
    constructor() {
        this._buildDom();
    }

    async open(projectId, { onBack = null } = {}) {
        this.projectId = projectId;
        this._onBack = onBack;
        this.backdrop.hidden = false;
        this.backdrop.style.display = "flex";
        document.body.classList.add("modal-open");
        await this._refresh();
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

    async _refresh() {
        this.body.innerHTML = `<p class="loading">Loading…</p>`;
        const closeBtn = this.backdrop.querySelector("#access-modal-close");
        closeBtn.textContent = this._onBack ? "←" : "✕";
        closeBtn.title = this._onBack ? "Back to Settings" : "Close";
        closeBtn.setAttribute("aria-label", closeBtn.title);
        try {
            [this.roles, this.members] = await Promise.all([
                api.getRoles(this.projectId),
                api.getMembers(this.projectId),
            ]);
            this._render();
        } catch (err) {
            this.body.innerHTML = `<p class="error">${Utils.escape(err.message)}</p>`;
        }
    }

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------

    _render() {
        this.body.innerHTML = `
            <section class="panel-section">
                <h3>Roles</h3>
                <div class="role-list">${this.roles.map(r => this._roleRow(r)).join("") || '<p class="loading">No roles yet.</p>'}</div>
                <details class="panel-add-form">
                    <summary>+ New role</summary>
                    <form id="new-role-form">
                        <input class="input" name="name" placeholder="Role name (e.g. Editor)" required />
                        <div class="permission-checkboxes">${this._permissionCheckboxes()}</div>
                        <button type="submit" class="btn btn-primary">Create role</button>
                    </form>
                </details>
            </section>

            <section class="panel-section">
                <h3>Members</h3>
                <div class="member-list">${this.members.map(m => this._memberRow(m)).join("") || '<p class="loading">No members yet — just you.</p>'}</div>
                <details class="panel-add-form">
                    <summary>+ Invite member</summary>
                    <form id="new-member-form">
                        <input class="input" name="username" placeholder="Username" required />
                        <div class="permission-checkboxes">${this._roleCheckboxes([])}</div>
                        <button type="submit" class="btn btn-primary">Send invite</button>
                    </form>
                </details>
            </section>
        `;

        this._bindRoleRows();
        this._bindMemberRows();

        this.body.querySelector("#new-role-form").addEventListener("submit", e => this._createRole(e));
        this.body.querySelector("#new-member-form").addEventListener("submit", e => this._addMember(e));
    }

    _roleRow(role) {
        return `
            <div class="access-row" data-role-id="${role.id}">
                <span class="access-row-name">${Utils.escape(role.name)}</span>
                <span class="access-row-chips">${role.permissions.map(p => `<span class="perm-chip">${PERMISSION_LABELS[p] ?? p}</span>`).join("") || '<span class="perm-chip perm-chip-muted">No permissions</span>'}</span>
                <button class="btn-icon role-edit" title="Edit role">✎</button>
                <button class="btn-icon role-delete" title="Delete role">✕</button>
            </div>`;
    }

    _memberRow(member) {
        return `
            <div class="access-row" data-username="${Utils.escape(member.username)}">
                <span class="access-row-name">${Utils.escape(member.username)}</span>
                <span class="access-row-chips">${member.roles.map(r => `<span class="perm-chip">${Utils.escape(r.name)}</span>`).join("") || '<span class="perm-chip perm-chip-muted">No roles</span>'}</span>
                <button class="btn-icon member-edit-roles" title="Edit roles">✎</button>
                <button class="btn-icon member-remove" title="Remove member">✕</button>
            </div>`;
    }

    _permissionCheckboxes(selected = []) {
        return Object.entries(PERMISSION_LABELS).map(([value, label]) => `
            <label class="checkbox-label">
                <input type="checkbox" name="permissions" value="${value}" ${selected.includes(value) ? "checked" : ""} />
                ${label}
            </label>`).join("");
    }

    _roleCheckboxes(selectedIds = []) {
        if (!this.roles.length) return `<p class="loading">Create a role first.</p>`;
        return this.roles.map(r => `
            <label class="checkbox-label">
                <input type="checkbox" name="role_ids" value="${r.id}" ${selectedIds.includes(r.id) ? "checked" : ""} />
                ${Utils.escape(r.name)}
            </label>`).join("");
    }

    // -----------------------------------------------------------------------
    // Actions
    // -----------------------------------------------------------------------

    async _createRole(e) {
        e.preventDefault();
        const form = e.target;
        const data = new FormData(form);
        const permissions = data.getAll("permissions");
        try {
            await api.createRole(this.projectId, { name: data.get("name"), permissions });
            await this._refresh();
        } catch (err) {
            Utils.showToast(err.message, "error");
        }
    }

    async _addMember(e) {
        e.preventDefault();
        const form = e.target;
        const data = new FormData(form);
        const roleIds = data.getAll("role_ids").map(Number);
        try {
            await api.inviteMember(this.projectId, data.get("username"), roleIds);
            form.reset();
            Utils.showToast(`Invite sent to ${data.get("username")}`, "info");
        } catch (err) {
            Utils.showToast(err.message, "error");
        }
    }

    _bindRoleRows() {
        this.body.querySelectorAll(".role-delete").forEach(btn => {
            btn.addEventListener("click", async () => {
                const roleId = Number(btn.closest(".access-row").dataset.roleId);
                if (!confirm("Delete this role? Members holding only this role will lose its permissions.")) return;
                await api.deleteRole(this.projectId, roleId);
                await this._refresh();
            });
        });

        this.body.querySelectorAll(".role-edit").forEach(btn => {
            btn.addEventListener("click", () => {
                const row = btn.closest(".access-row");
                const roleId = Number(row.dataset.roleId);
                const role = this.roles.find(r => r.id === roleId);
                row.querySelector(".access-row-chips").outerHTML = `
                    <div class="member-role-editor">
                        <input class="input role-edit-name" value="${Utils.escape(role.name)}" style="max-width:160px" />
                        ${this._permissionCheckboxes(role.permissions)}
                        <button class="btn btn-primary btn-save-role" type="button">Save</button>
                    </div>`;
                row.querySelector(".btn-save-role").addEventListener("click", async () => {
                    const name = row.querySelector(".role-edit-name").value.trim() || role.name;
                    const permissions = [...row.querySelectorAll('input[name="permissions"]:checked')].map(i => i.value);
                    try {
                        await api.updateRole(this.projectId, roleId, { name, permissions });
                        await this._refresh();
                    } catch (err) {
                        Utils.showToast(err.message, "error");
                    }
                });
            });
        });
    }

    _bindMemberRows() {
        this.body.querySelectorAll(".member-remove").forEach(btn => {
            btn.addEventListener("click", async () => {
                const username = btn.closest(".access-row").dataset.username;
                if (!confirm(`Remove ${username} from this project?`)) return;
                await api.removeMember(this.projectId, username);
                await this._refresh();
            });
        });

        this.body.querySelectorAll(".member-edit-roles").forEach(btn => {
            btn.addEventListener("click", () => {
                const row = btn.closest(".access-row");
                const username = row.dataset.username;
                const member = this.members.find(m => m.username === username);
                const currentIds = member.roles.map(r => r.id);
                row.querySelector(".access-row-chips").outerHTML = `
                    <div class="member-role-editor">
                        ${this._roleCheckboxes(currentIds)}
                        <button class="btn btn-primary btn-save-roles" type="button">Save</button>
                    </div>`;
                row.querySelector(".btn-save-roles").addEventListener("click", async () => {
                    const roleIds = [...row.querySelectorAll('input[name="role_ids"]:checked')].map(i => Number(i.value));
                    await api.setMemberRoles(this.projectId, username, roleIds);
                    await this._refresh();
                });
            });
        });
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
                    <h2>Manage access</h2>
                    <button class="btn-icon" id="access-modal-close" aria-label="Close">✕</button>
                </div>
                <div class="modal-body access-modal-body"></div>
            </div>
        `;
        document.body.appendChild(this.backdrop);
        this.body = this.backdrop.querySelector(".access-modal-body");

        this.backdrop.querySelector("#access-modal-close").addEventListener("click", () => this.close());
        this.backdrop.addEventListener("click", e => { if (e.target === this.backdrop) this._hardClose(); });
    }
}

const membersPanel = new MembersPanel();
