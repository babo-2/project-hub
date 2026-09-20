/**
 * checklist.js — one module, multiple independent checklists.
 *
 * data shape: {
 *   checklists: [ { id, title, items: [ { id, text, done } ] } ]
 * }
 *
 * Every mutation saves immediately (checking a box is a single, low-risk
 * action - unlike Notes' free text, there's no reason to debounce it).
 */

class ChecklistModule {
    type  = "checklist";
    label = "Checklist";
    icon  = "☑️";
    defaultData = { checklists: [] };

    static _id(prefix) {
        return crypto.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    render(container, moduleData, { onSave }) {
        const data = {
            checklists: (moduleData.data?.checklists ?? []).map(c => ({ ...c, items: c.items.map(i => ({ ...i })) })),
        };

        container.innerHTML = `
            <div class="module-checklist">
                <div class="checklist-groups"></div>
                <div class="module-actions">
                    <button class="btn btn-primary btn-add-checklist">+ New checklist</button>
                    <span class="save-status checklist-save-status"></span>
                </div>
            </div>
        `;

        const groupsEl  = container.querySelector(".checklist-groups");
        const addBtn    = container.querySelector(".btn-add-checklist");
        const statusEl  = container.querySelector(".checklist-save-status");

        const save = async () => {
            await onSave(data);
            statusEl.textContent = "Saved ✓";
            setTimeout(() => (statusEl.textContent = ""), 1800);
        };

        const renderGroups = () => {
            groupsEl.innerHTML = "";
            if (!data.checklists.length) {
                groupsEl.innerHTML = `<p class="checklist-hint">No checklists yet. Add one to get started.</p>`;
                return;
            }
            data.checklists.forEach(cl => groupsEl.appendChild(this._buildChecklistCard(cl, data, save, renderGroups)));
        };

        addBtn.addEventListener("click", async () => {
            data.checklists.push({ id: ChecklistModule._id("cl"), title: "New checklist", items: [] });
            renderGroups();
            await save();
        });

        renderGroups();
    }

    _buildChecklistCard(cl, data, save, rerender) {
        const card = document.createElement("div");
        card.className = "checklist-card";

        const done  = cl.items.filter(i => i.done).length;
        const total = cl.items.length;
        const pct   = total ? Math.round((done / total) * 100) : 0;

        card.innerHTML = `
            <div class="checklist-card-header">
                <span class="checklist-title" tabindex="0" title="Click to rename">${Utils.escape(cl.title)}</span>
                <span class="checklist-progress-text">${done}/${total}</span>
                <button class="btn-icon btn-delete-checklist" title="Delete checklist">✕</button>
            </div>
            <div class="checklist-progress-bar"><div class="checklist-progress-fill" style="width:${pct}%"></div></div>
            <div class="checklist-items"></div>
            <div class="checklist-add-row">
                <input class="input checklist-new-item" placeholder="Add item…" />
            </div>
        `;

        const titleEl   = card.querySelector(".checklist-title");
        const itemsEl   = card.querySelector(".checklist-items");
        const newItemI  = card.querySelector(".checklist-new-item");

        const renameChecklist = () => {
            const original = cl.title;
            titleEl.innerHTML = `<input class="input checklist-rename-input" type="text" value="${Utils.escape(original)}" />`;
            const input = titleEl.querySelector("input");
            input.focus();
            input.select();
            const finish = async (commit) => {
                const val = input.value.trim();
                if (commit && val && val !== original) {
                    cl.title = val;
                    await save();
                }
                rerender();
            };
            input.addEventListener("blur", () => finish(true));
            input.addEventListener("keydown", e => {
                if (e.key === "Enter") { e.preventDefault(); input.blur(); }
                if (e.key === "Escape") { e.preventDefault(); finish(false); }
            });
        };
        titleEl.addEventListener("click", renameChecklist);
        titleEl.addEventListener("keydown", e => { if (e.key === "Enter") renameChecklist(); });

        card.querySelector(".btn-delete-checklist").addEventListener("click", async () => {
            if (!confirm(`Delete "${cl.title}" and all its items?`)) return;
            data.checklists = data.checklists.filter(x => x.id !== cl.id);
            rerender();
            await save();
        });

        cl.items.forEach(item => itemsEl.appendChild(this._buildItemRow(item, cl, save, rerender)));

        newItemI.addEventListener("keydown", async e => {
            if (e.key !== "Enter") return;
            const text = newItemI.value.trim();
            if (!text) return;
            cl.items.push({ id: ChecklistModule._id("it"), text, done: false });
            newItemI.value = "";
            rerender();
            await save();
        });

        return card;
    }

    _buildItemRow(item, cl, save, rerender) {
        const row = document.createElement("div");
        row.className = "checklist-item" + (item.done ? " done" : "");
        row.innerHTML = `
            <label class="checklist-item-label">
                <input type="checkbox" ${item.done ? "checked" : ""} />
                <span>${Utils.escape(item.text)}</span>
            </label>
            <button class="btn-icon btn-delete-item" title="Remove item">✕</button>
        `;

        row.querySelector("input").addEventListener("change", async e => {
            item.done = e.target.checked;
            row.classList.toggle("done", item.done);
            rerender();
            await save();
        });

        row.querySelector(".btn-delete-item").addEventListener("click", async () => {
            cl.items = cl.items.filter(x => x.id !== item.id);
            rerender();
            await save();
        });

        return row;
    }

}

registry.register(new ChecklistModule());
