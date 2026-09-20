/**
 * project.js — single project view with module management.
 * Reordering is done with up/down arrows (not drag-and-drop).
 */

class ProjectPage {
    constructor() {
        const params    = new URLSearchParams(location.search);
        this.projectId  = Number(params.get("id"));
        this.modulesEl  = document.getElementById("modules-container");

        this._modules = []; // local mirror of module metadata, kept in DOM order

        if (!this.projectId) {
            location.href = "/";
            return;
        }

        Utils.bindLogout();
        this._bindEvents();
        this.load();
        this._registerServiceWorker();
        this._bindFloatingAddButton();

        inboxPanel.registerBadge(document.getElementById("btn-inbox"));
    }

    // -----------------------------------------------------------------------
    // Data
    // -----------------------------------------------------------------------

    async load() {
        try {
            const [project, modules] = await Promise.all([
                api.getProject(this.projectId),
                api.getModules(this.projectId),
            ]);
            this.project = project;
            this._modules = modules;
            this._renderHeader(project);
            this._renderModules(modules);
        } catch {
            this.modulesEl.innerHTML = `<p class="error">Could not load project. Working offline.</p>`;
        }
    }

    /** New modules are appended at the end of the list. */
    async addModule(moduleType, title) {
        const plugin = registry.get(moduleType);
        const data   = plugin?.defaultData ?? {};
        const created = await api.createModule(this.projectId, { module_type: moduleType, title, data });
        await this._appendModule(created);
    }

    async pasteModule() {
        const clip = Utils.readClipboardModule();
        if (!clip) return;
        const created = await api.createModule(this.projectId, {
            module_type: clip.module_type,
            title: clip.title,
            data: clip.data,
        });
        await this._appendModule(created);
    }

    async _appendModule(created) {
        this._modules = [...this._modules, created];
        document.querySelector(".empty-modules")?.remove();
        this._createModuleCard(created);
        this._updateMoveButtonStates();
        try {
            await api.reorderModules(this.projectId, this._modules.map(m => m.id));
        } catch { /* order persists locally either way for this session */ }
    }

    async saveModule(moduleId, newData) {
        await api.updateModule(moduleId, { data: newData });
    }

    async renameModule(moduleId, newTitle) {
        await api.updateModule(moduleId, { title: newTitle });
    }

    async deleteModule(moduleId, event) {
        event.stopPropagation();
        if (!confirm("Remove this module?")) return;
        await api.deleteModule(moduleId);
        this._modules = this._modules.filter(m => m.id !== moduleId);
        this.modulesEl.querySelector(`.module-card[data-id="${moduleId}"]`)?.remove();
        this._updateMoveButtonStates();
        if (!this._modules.length) this._renderModules([]);
    }

    copyModule(moduleId, event) {
        event.stopPropagation();
        const module = this._modules.find(m => m.id === moduleId);
        if (module) Utils.copyModuleToClipboard(module);
    }

    async moveModule(moduleId, direction) {
        const card = this.modulesEl.querySelector(`.module-card[data-id="${moduleId}"]`);
        if (!card) return;
        if (direction === "up" && card.previousElementSibling) {
            this.modulesEl.insertBefore(card, card.previousElementSibling);
        } else if (direction === "down" && card.nextElementSibling) {
            this.modulesEl.insertBefore(card.nextElementSibling, card);
        } else {
            return;
        }
        this._modules = Utils.moveItem(this._modules, moduleId, direction);
        this._updateMoveButtonStates();
        Utils.flashMove(card);
        await api.reorderModules(this.projectId, this._modules.map(m => m.id));
    }

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------

    _renderHeader(project) {
        document.title = `${project.name} \u00b7 Project Hub`;
        document.getElementById("project-name").textContent = project.name;
        document.getElementById("project-desc").textContent = project.description;
        document.getElementById("project-color-bar").style.background = project.color;

        const perms = project.my_permissions ?? [];
        document.getElementById("btn-add-module").hidden = !perms.includes("manage_modules");
        document.getElementById("btn-rename-project").hidden = !perms.includes("edit_project");
    }

    _renderModules(modules) {
        this.modulesEl.innerHTML = "";

        if (!modules.length) {
            this.modulesEl.innerHTML = `
                <div class="empty-modules">
                    <p>No modules yet. Add one to get started.</p>
                </div>`;
            return;
        }

        modules.forEach(m => this._createModuleCard(m));
        this._updateMoveButtonStates();
    }

    _createModuleCard(m) {
        this.modulesEl.appendChild(this._buildModuleCard(m));
    }

    _buildModuleCard(m) {
        const plugin = registry.get(m.module_type);
        const canManage = (this.project?.my_permissions ?? []).includes("manage_modules");
        const card   = document.createElement("div");
        card.className  = "module-card";
        card.dataset.id = m.id;

        card.innerHTML = `
            <div class="module-card-header">
                <span class="module-icon">${plugin?.icon ?? "📦"}</span>
                <div class="module-title-group">
                    <span class="module-title">${Utils.escape(m.title)}</span>
                    ${canManage ? `<button class="btn-icon module-rename-btn" title="Rename">✎</button>` : ""}
                </div>
                <div style="flex:1"></div>
                <span class="module-type-label">${plugin?.label ?? m.module_type}</span>
                <button class="btn-icon module-copy" title="Copy module">⧉</button>
                ${canManage ? Utils.moveButtonsHtml(false, false) : ""}
                ${canManage ? `<button class="btn-icon module-delete" title="Remove module">✕</button>` : ""}
            </div>
            <div class="module-card-body" hidden></div>
        `;

        const header    = card.querySelector(".module-card-header");
        const body      = card.querySelector(".module-card-body");
        const titleEl   = card.querySelector(".module-title");
        const renameBtn = card.querySelector(".module-rename-btn");

        if (renameBtn) renameBtn.addEventListener("click", () => this._startRename(titleEl, m));

        const toggleExpanded = () => {
            const expanded = !body.hidden;
            body.hidden = expanded;
            if (!body.hidden && !body.dataset.rendered) {
                registry.render(body, m, {
                    onSave: (newData) => this.saveModule(m.id, newData),
                });
                body.dataset.rendered = "1";
            }
        };

        // Clicking anywhere on the header toggles expand/collapse, except on
        // its buttons or the title itself (so renaming/copying/moving/deleting
        // and selecting the title text all still work without also toggling).
        header.addEventListener("click", e => {
            if (Utils.closest(e.target, "button, .module-title-group")) return;
            toggleExpanded();
        });

        card.querySelector(".module-copy").addEventListener("click", e => this.copyModule(m.id, e));

        const deleteBtn = card.querySelector(".module-delete");
        if (deleteBtn) deleteBtn.addEventListener("click", e => this.deleteModule(m.id, e));

        const upBtn = card.querySelector(".move-up");
        const downBtn = card.querySelector(".move-down");
        upBtn?.addEventListener("click", e => { e.stopPropagation(); this.moveModule(m.id, "up"); });
        downBtn?.addEventListener("click", e => { e.stopPropagation(); this.moveModule(m.id, "down"); });

        return card;
    }

    _updateMoveButtonStates() {
        const cards = [...this.modulesEl.querySelectorAll(".module-card")];
        cards.forEach((card, idx) => {
            card.querySelector(".move-up")?.toggleAttribute("disabled", idx === 0);
            card.querySelector(".move-down")?.toggleAttribute("disabled", idx === cards.length - 1);
        });
    }

    /** Swaps a module's title span for an inline input, saving on blur/Enter. */
    _startRename(titleEl, m) {
        if (titleEl.querySelector("input")) return; // already renaming

        const original = m.title;
        titleEl.innerHTML = `<input class="input module-rename-input" type="text" value="${Utils.escape(original)}" />`;
        const input = titleEl.querySelector("input");
        Utils.focusRenameInput(input);

        const finish = async (commit) => {
            const newTitle = input.value.trim();
            if (commit && newTitle && newTitle !== original) {
                m.title = newTitle;
                titleEl.textContent = newTitle;
                await this.renameModule(m.id, newTitle);
            } else {
                titleEl.textContent = original;
            }
        };

        input.addEventListener("blur", () => finish(true));
        input.addEventListener("keydown", e => {
            if (e.key === "Enter") { e.preventDefault(); input.blur(); }
            if (e.key === "Escape") { e.preventDefault(); finish(false); }
        });
    }

    // -----------------------------------------------------------------------
    // Project rename
    // -----------------------------------------------------------------------

    _startProjectEdit() {
        const form = document.getElementById("project-edit-form");
        document.getElementById("project-edit-name").value = this.project.name;
        document.getElementById("project-edit-desc").value = this.project.description ?? "";
        document.getElementById("project-edit-color").value = this.project.color ?? "#6366f1";
        form.style.display = "flex";
        document.getElementById("project-edit-name").focus();
    }

    async _saveProjectEdit() {
        const name = document.getElementById("project-edit-name").value.trim();
        const description = document.getElementById("project-edit-desc").value.trim();
        const color = document.getElementById("project-edit-color").value;
        if (!name) return;
        this.project = await api.updateProject(this.projectId, { name, description, color });
        this._renderHeader(this.project);
        document.getElementById("project-edit-form").style.display = "none";
    }

    // -----------------------------------------------------------------------
    // Module picker modal
    // -----------------------------------------------------------------------

    _bindEvents() {
        document.getElementById("btn-add-module").addEventListener("click", () => this._openAddModal());
        document.getElementById("btn-settings").addEventListener("click", () => settingsPanel.open(this.projectId));
        document.getElementById("btn-inbox").addEventListener("click", () => inboxPanel.open());

        document.getElementById("btn-rename-project").addEventListener("click", () => this._startProjectEdit());
        document.getElementById("btn-save-project").addEventListener("click", () => this._saveProjectEdit());
        document.getElementById("btn-cancel-project-edit").addEventListener("click", () => {
            document.getElementById("project-edit-form").style.display = "none";
        });
    }

    /** Opens the shared "Add module" modal (also hosts "Paste module"). */
    _openAddModal() {
        const canManage = (this.project?.my_permissions ?? []).includes("manage_modules");
        moduleAddModal.open({
            heading: "Add module",
            canPaste: canManage,
            onAdd: (type, title) => this.addModule(type, title),
            onPaste: () => this.pasteModule(),
        });
    }

    /** Shows a small floating "+" button once the header's Add Module
     *  button scrolls out of view, so adding a module never requires
     *  scrolling all the way back up. */
    _bindFloatingAddButton() {
        const headerBtn = document.getElementById("btn-add-module");
        const floatingBtn = document.getElementById("btn-floating-add-module");
        floatingBtn.addEventListener("click", () => this._openAddModal());

        const observer = new IntersectionObserver(([entry]) => {
            const shouldShow = !entry.isIntersecting && !headerBtn.hidden;
            floatingBtn.hidden = !shouldShow;
        }, { threshold: 0 });
        observer.observe(headerBtn);
    }

    // -----------------------------------------------------------------------
    // Service Worker
    // -----------------------------------------------------------------------

    _registerServiceWorker() {
        if (!("serviceWorker" in navigator)) return;
        navigator.serviceWorker.register("/sw.js").then(() => {
            const status = document.getElementById("status");
            navigator.serviceWorker.addEventListener("message", event => {
                if (event.data.type === "NETWORK_STATUS") {
                    status.style.background = event.data.online ? "#69F0AE" : "#FF6B6B";
                }
            });
        });
    }
}

document.addEventListener("DOMContentLoaded", () => new ProjectPage());
