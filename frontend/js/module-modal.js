/**
 * module-modal.js — shared "Add module" modal, used both by the project
 * page's top-level "+ Add module" button and by every folder's own "+"
 * button (with the heading swapped to name the folder). Built once and
 * reused rather than re-created per folder, the same way settings.js and
 * inbox.js own a single persistent panel.
 *
 * Also hosts the "Paste module" action, so callers no longer need their
 * own separate paste button - see project.js and folder.js.
 */
class ModuleAddModal {
    constructor() {
        this._onAdd   = null;
        this._onPaste = null;
        this._buildDom();
    }

    /**
     * @param {string}   heading   Modal title, e.g. `Add module` or `Add module in "Sprint tasks"`.
     * @param {boolean}  canPaste  Whether the current user is allowed to paste here (permission check).
     * @param {function} onAdd     async (moduleType, title) => void
     * @param {function} onPaste   async () => void
     */
    open({ heading = "Add module", canPaste = false, onAdd, onPaste } = {}) {
        this._onAdd   = onAdd;
        this._onPaste = onPaste;

        this.headingEl.textContent = heading;
        this.pasteBtn.hidden = !(canPaste && Utils.hasClipboardModule());
        this.titleInput.value = "";
        this.typeSelect.selectedIndex = 0;

        this.backdrop.hidden = false;
        this.backdrop.style.display = "flex";
        this.titleInput.focus();
    }

    close() {
        this.backdrop.style.display = "none";
        this.backdrop.hidden = true;
        this._onAdd   = null;
        this._onPaste = null;
    }

    _buildDom() {
        this.backdrop = document.createElement("div");
        this.backdrop.className = "modal-backdrop";
        this.backdrop.hidden = true;
        this.backdrop.style.display = "none";
        this.backdrop.innerHTML = `
            <div class="modal" role="dialog" aria-modal="true" aria-labelledby="module-modal-heading">
                <div class="modal-header">
                    <h2 id="module-modal-heading" class="module-modal-heading">Add module</h2>
                    <button type="button" class="btn-icon module-modal-close" aria-label="Close">✕</button>
                </div>
                <form class="module-modal-form">
                    <div class="form-group">
                        <label for="module-modal-type">Type</label>
                        <select class="input module-modal-type" id="module-modal-type"></select>
                    </div>
                    <div class="form-group">
                        <label for="module-modal-title">Title</label>
                        <input class="input module-modal-title" id="module-modal-title" type="text" placeholder="e.g. Sprint 1 Roadmap" required />
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-ghost module-modal-paste" hidden>📋 Paste module</button>
                        <button type="button" class="btn btn-ghost module-modal-cancel">Cancel</button>
                        <button type="submit" class="btn btn-primary">Add</button>
                    </div>
                </form>
            </div>
        `;
        document.body.appendChild(this.backdrop);

        this.headingEl  = this.backdrop.querySelector(".module-modal-heading");
        this.typeSelect = this.backdrop.querySelector(".module-modal-type");
        this.titleInput = this.backdrop.querySelector(".module-modal-title");
        this.pasteBtn   = this.backdrop.querySelector(".module-modal-paste");
        const form       = this.backdrop.querySelector(".module-modal-form");

        registry.getAll().forEach(plugin => {
            const opt = document.createElement("option");
            opt.value = plugin.type;
            opt.textContent = `${plugin.icon} ${plugin.label}`;
            this.typeSelect.appendChild(opt);
        });

        form.addEventListener("submit", async e => {
            e.preventDefault();
            const title = this.titleInput.value.trim();
            if (!title) { this.titleInput.focus(); return; }
            const type = this.typeSelect.value;
            const onAdd = this._onAdd;
            this.close();
            await onAdd?.(type, title);
        });

        this.pasteBtn.addEventListener("click", async () => {
            const onPaste = this._onPaste;
            this.close();
            await onPaste?.();
        });

        this.backdrop.querySelector(".module-modal-close").addEventListener("click", () => this.close());
        this.backdrop.querySelector(".module-modal-cancel").addEventListener("click", () => this.close());
        this.backdrop.addEventListener("click", e => { if (e.target === this.backdrop) this.close(); });
    }
}

// Global singleton — available to all scripts loaded after this file
const moduleAddModal = new ModuleAddModal();
