/**
 * app.js — main page (project selection)
 */

class App {
    constructor() {
        this.grid        = document.getElementById("project-grid");
        this.emptyState  = document.getElementById("empty-state");
        this.modal       = document.getElementById("project-modal");
        this.form        = document.getElementById("project-form");
        this.searchInput = document.getElementById("search-input");
        this.searchRegex = document.getElementById("search-regex");
        this.searchResults = document.getElementById("search-results");
        this.importInput = document.getElementById("import-input");

        Utils.bindLogout();
        this._bindEvents();
        this.loadProjects();
        this._registerServiceWorker();

        inboxPanel.registerBadge(document.getElementById("btn-inbox"));
    }

    // -----------------------------------------------------------------------
    // Data
    // -----------------------------------------------------------------------

    async loadProjects() {
        this.grid.innerHTML = `<p class="loading">Loading…</p>`;
        try {
            this._projects = await api.getProjects();
            this._renderGrid(this._projects);
        } catch {
            this.grid.innerHTML = `<p class="error">Could not reach the server. Working offline.</p>`;
        }
    }

    async createProject(name, description, color) {
        const project = await api.createProject({ name, description, color });
        if (project) this.loadProjects();
    }

    async deleteProject(id, event) {
        event.stopPropagation();
        if (!confirm("Delete this project and all its modules?")) return;
        await api.deleteProject(id);
        this.loadProjects();
    }

    async exportProject(id, name, event) {
        event.stopPropagation();
        const data = await api.exportProject(id);
        Utils.downloadJson(`${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "project"}.json`, data);
    }

    async importProjectFile(file) {
        const text = await file.text();
        let payload;
        try {
            payload = JSON.parse(text);
        } catch {
            alert("That file isn't valid JSON.");
            return;
        }
        try {
            await api.importProject(payload);
            this.loadProjects();
        } catch (err) {
            alert(`Import failed: ${err.message}`);
        }
    }

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------

    _renderGrid(projects) {
        this.grid.innerHTML = "";
        this.emptyState.hidden = projects.length > 0;

        projects.forEach(p => {
            const card = document.createElement("div");
            card.className = "project-card";
            card.style.setProperty("--project-color", p.color);
            card.innerHTML = `
                <div class="project-card-color-bar"></div>
                <div class="project-card-body">
                    <h2 class="project-card-title">${Utils.escape(p.name)}</h2>
                    <p class="project-card-desc">${Utils.escape(p.description)}</p>
                    <span class="project-card-date">${Utils.formatDate(p.updated_at)}</span>
                </div>
                <div class="project-card-actions">
                    <button class="btn-icon project-export" title="Export as JSON">⭳</button>
                    ${p.my_permissions?.includes("delete_project")
                        ? `<button class="btn-icon project-delete" title="Delete project">✕</button>`
                        : ""}
                </div>
            `;
            card.querySelector(".project-export").addEventListener("click", e => this.exportProject(p.id, p.name, e));
            const deleteBtn = card.querySelector(".project-delete");
            if (deleteBtn) deleteBtn.addEventListener("click", e => this.deleteProject(p.id, e));
            card.addEventListener("click", () => {
                window.location.href = `project.html?id=${p.id}`;
            });
            this.grid.appendChild(card);
        });
    }

    // -----------------------------------------------------------------------
    // Search
    // -----------------------------------------------------------------------

    async _runSearch() {
        const query = this.searchInput.value.trim();
        if (!query) {
            this.searchResults.hidden = true;
            this.grid.hidden = false;
            this.emptyState.hidden = (this._projects?.length ?? 0) === 0;
            return;
        }

        this.grid.hidden = true;
        this.emptyState.hidden = true;
        this.searchResults.hidden = false;
        this.searchResults.innerHTML = `<p class="loading">Searching…</p>`;

        try {
            const { projects, modules } = await api.search(query, this.searchRegex.checked);
            this._renderSearchResults(projects, modules);
        } catch (err) {
            this.searchResults.innerHTML = `<p class="error">${Utils.escape(err.message)}</p>`;
        }
    }

    _renderSearchResults(projects, modules) {
        if (!projects.length && !modules.length) {
            this.searchResults.innerHTML = `<p class="loading">No matches.</p>`;
            return;
        }

        const projectById = new Map(this._projects?.map(p => [p.id, p]) ?? []);
        let html = "";

        if (projects.length) {
            html += `<h3 class="search-section-title">Projects</h3><ul class="search-result-list">`;
            for (const p of projects) {
                html += `
                    <li class="search-result">
                        <a href="project.html?id=${p.id}">
                            <span class="search-result-title">${Utils.escape(p.name)}</span>
                            <span class="search-result-meta">${Utils.escape(p.description)}</span>
                        </a>
                    </li>`;
            }
            html += `</ul>`;
        }

        if (modules.length) {
            html += `<h3 class="search-section-title">Modules</h3><ul class="search-result-list">`;
            for (const m of modules) {
                const project = projectById.get(m.project_id);
                html += `
                    <li class="search-result">
                        <a href="project.html?id=${m.project_id}">
                            <span class="search-result-title">${Utils.escape(m.title)}</span>
                            <span class="search-result-meta">in ${Utils.escape(project?.name ?? "a project")}</span>
                        </a>
                    </li>`;
            }
            html += `</ul>`;
        }

        this.searchResults.innerHTML = html;
    }

    // -----------------------------------------------------------------------
    // Modal & events
    // -----------------------------------------------------------------------

    _bindEvents() {
        document.getElementById("btn-new-project").addEventListener("click", () => this._openModal());
        document.getElementById("modal-close").addEventListener("click", () => this._closeModal());
        this.modal.addEventListener("click", e => { if (e.target === this.modal) this._closeModal(); });

        this.form.addEventListener("submit", async e => {
            e.preventDefault();
            const data = Object.fromEntries(new FormData(this.form));
            await this.createProject(data.name, data.description, data.color);
            this._closeModal();
            this.form.reset();
        });

        let searchTimer = null;
        this.searchInput.addEventListener("input", () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => this._runSearch(), 250);
        });
        this.searchRegex.addEventListener("change", () => this._runSearch());

        document.getElementById("btn-import").addEventListener("click", () => this.importInput.click());
        this.importInput.addEventListener("change", () => {
            const file = this.importInput.files[0];
            if (file) this.importProjectFile(file);
            this.importInput.value = "";
        });

        document.getElementById("btn-inbox").addEventListener("click", () => inboxPanel.open());
    }

    _openModal() {
        this.modal.hidden = false;
        this.modal.style.display = "flex";
        this.modal.querySelector("input[name=name]").focus();
    }

    _closeModal() {
        this.modal.style.display = "none";
        this.modal.hidden = true;
    }

    // -----------------------------------------------------------------------
    // Service Worker
    // -----------------------------------------------------------------------

    _registerServiceWorker() {
        if (!("serviceWorker" in navigator)) return;
        navigator.serviceWorker.register("/sw.js").then(reg => {
            const status = document.getElementById("status");
            navigator.serviceWorker.addEventListener("message", event => {
                if (event.data.type === "NETWORK_STATUS") {
                    status.style.background = event.data.online ? "#69F0AE" : "#FF6B6B";
                }
            });
        });
    }
}

document.addEventListener("DOMContentLoaded", () => new App());
