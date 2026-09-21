/**
 * folder.js — a module that contains other modules, for organizing a
 * project page into sub-groups. Children are NOT separate database rows —
 * they live entirely inside this module's own `data` blob, and are
 * rendered through the same plugin registry as top-level modules. A
 * folder can contain another folder, nesting arbitrarily deep.
 *
 * data shape: {
 *   children: [ { id, module_type, title, data, collapsed } ]
 * }
 *
 * New items are appended at the end. Reordering uses up/down arrows (no
 * drag). Mutations only touch the DOM node for the child that changed, so
 * adding/removing/moving one item never collapses or remounts its
 * siblings.
 *
 * Each rendered child is given `path`: the full chain of ids from the
 * top-level module down to itself. This lets nested Template modules
 * detect and link to each other (see template.js), and lets
 * Utils.jumpToModulePath() navigate to them regardless of nesting depth.
 */

class FolderModule {
    type  = "folder";
    label = "Folder";
    icon  = "📁";
    defaultData = { children: [] };

    static _id() {
        return crypto.randomUUID?.() ?? `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    render(container, moduleData, { onSave }) {
        const data = {
            children: (moduleData.data?.children ?? []).map(c => ({ ...c, data: { ...c.data } })),
        };
        const myPath = moduleData.path ?? [moduleData.id];

        container.innerHTML = `
            <div class="module-folder">
                <div class="folder-children"></div>
                <button type="button" class="btn btn-ghost folder-add-btn">+ Add module</button>
                <span class="save-status folder-save-status"></span>
            </div>
        `;

        const childrenEl = container.querySelector(".folder-children");
        const addBtn     = container.querySelector(".folder-add-btn");
        const statusEl   = container.querySelector(".folder-save-status");

        const save = async () => {
            await onSave(data);
            statusEl.textContent = "Saved ✓";
            setTimeout(() => (statusEl.textContent = ""), 1800);
            Utils.notifyModuleChanged();
        };

        function updateMoveButtonStates() {
            const cards = [...childrenEl.querySelectorAll(".folder-child-card")];
            cards.forEach((card, idx) => {
                card.querySelector(".move-up")?.toggleAttribute("disabled", idx === 0);
                card.querySelector(".move-down")?.toggleAttribute("disabled", idx === cards.length - 1);
            });
        }

        const renderAllChildren = () => {
            childrenEl.innerHTML = "";
            data.children.forEach(child => childrenEl.appendChild(this._buildChildCard(child, data, moduleData, myPath, save, renderAllChildren, updateMoveButtonStates)));
            updateMoveButtonStates();
        };

        const appendChild = (child) => {
            childrenEl.appendChild(this._buildChildCard(child, data, moduleData, myPath, save, renderAllChildren, updateMoveButtonStates));
            updateMoveButtonStates();
        };

        const addChild = async (type, title) => {
            const plugin = registry.get(type);
            const child = {
                id: FolderModule._id(),
                module_type: type,
                title,
                data: plugin?.defaultData ?? {},
                collapsed: false,
            };
            data.children = [...data.children, child];
            appendChild(child);
            await save();
        };

        const pasteChild = async () => {
            const clip = Utils.readClipboardModule();
            if (!clip) return;
            const child = {
                id: FolderModule._id(),
                module_type: clip.module_type,
                title: clip.title,
                data: clip.data,
                collapsed: false,
            };
            data.children = [...data.children, child];
            appendChild(child);
            await save();
        };

        addBtn.addEventListener("click", () => {
            moduleAddModal.open({
                heading: `Add module in "${moduleData.title}"`,
                canPaste: true,
                onAdd: (type, title) => addChild(type, title),
                onPaste: () => pasteChild(),
            });
        });

        renderAllChildren();
    }

    _buildChildCard(child, data, parentModuleData, parentPath, saveFolder, rerenderAll, updateMoveButtonStates) {
        const plugin = registry.get(child.module_type);
        const card = document.createElement("div");
        card.className = child.module_type === "folder" ? "folder-child-card folder-child-card-nested" : "folder-child-card";
        card.dataset.id = child.id;

        card.innerHTML = `
            <div class="folder-child-header">
                <span class="module-icon">${plugin?.icon ?? "📦"}</span>
                <div class="folder-child-title-group">
                    <span class="folder-child-title">${Utils.escape(child.title)}</span>
                    <button class="btn-icon folder-child-rename" title="Rename">✎</button>
                </div>
                <span class="module-type-label">${plugin?.label ?? child.module_type}</span>
                <button class="btn-icon folder-child-copy" title="Copy module">⧉</button>
                ${Utils.moveButtonsHtml(false, false)}
                <button class="btn-icon btn-delete-child" title="Remove item">✕</button>
            </div>
            <div class="folder-child-body" ${child.collapsed ? "hidden" : ""}></div>
        `;

        const header    = card.querySelector(".folder-child-header");
        const titleEl   = card.querySelector(".folder-child-title");
        const bodyEl    = card.querySelector(".folder-child-body");
        const renameBtn = card.querySelector(".folder-child-rename");

        const mountChild = () => {
            if (!plugin) { bodyEl.innerHTML = `<p class="text-muted">Unknown module type "${Utils.escape(child.module_type)}"</p>`; return; }
            registry.render(bodyEl, {
                id: child.id,
                project_id: parentModuleData.project_id,
                module_type: child.module_type,
                title: child.title,
                data: child.data,
                path: [...parentPath, child.id],
            }, {
                onSave: async (newData) => {
                    child.data = newData;
                    await saveFolder();
                },
            });
        };

        if (!child.collapsed) mountChild();

        // Clicking anywhere on the header toggles expand/collapse, except on
        // its buttons or the title itself.
        header.addEventListener("click", async e => {
            if (Utils.closest(e.target, "button, .folder-child-title-group")) return;
            child.collapsed = !child.collapsed;
            bodyEl.hidden = child.collapsed;
            if (!child.collapsed) mountChild();
            await saveFolder();
        });

        const renameChild = () => {
            if (titleEl.querySelector("input")) return;
            const original = child.title;
            titleEl.innerHTML = `<input class="input module-rename-input" type="text" value="${Utils.escape(original)}" />`;
            const input = titleEl.querySelector("input");
            Utils.focusRenameInput(input);
            const finish = async (commit) => {
                const val = input.value.trim();
                if (commit && val && val !== original) {
                    child.title = val;
                    titleEl.textContent = val;
                    await saveFolder();
                } else {
                    titleEl.textContent = original;
                }
            };
            input.addEventListener("blur", () => finish(true));
            input.addEventListener("keydown", e => {
                if (e.key === "Enter") { e.preventDefault(); input.blur(); }
                if (e.key === "Escape") { e.preventDefault(); finish(false); }
            });
        };
        renameBtn.addEventListener("click", renameChild);

        card.querySelector(".folder-child-copy").addEventListener("click", () => {
            Utils.copyModuleToClipboard(child);
        });

        card.querySelector(".move-up").addEventListener("click", async e => {
            e.stopPropagation();
            if (!card.previousElementSibling) return;
            card.parentElement.insertBefore(card, card.previousElementSibling);
            data.children = Utils.moveItem(data.children, child.id, "up");
            updateMoveButtonStates();
            Utils.flashMove(card);
            await saveFolder();
        });
        card.querySelector(".move-down").addEventListener("click", async e => {
            e.stopPropagation();
            if (!card.nextElementSibling) return;
            card.parentElement.insertBefore(card.nextElementSibling, card);
            data.children = Utils.moveItem(data.children, child.id, "down");
            updateMoveButtonStates();
            Utils.flashMove(card);
            await saveFolder();
        });

        card.querySelector(".btn-delete-child").addEventListener("click", async () => {
            if (!confirm(`Remove "${child.title}" from this folder? This can't be undone.`)) return;
            data.children = data.children.filter(x => x.id !== child.id);
            card.remove();
            updateMoveButtonStates();
            if (!data.children.length) rerenderAll();
            await saveFolder();
        });

        return card;
    }
}

registry.register(new FolderModule());
