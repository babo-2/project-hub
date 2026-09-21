/**
 * template.js — define a schema once, create typed instances of it.
 *
 * data shape: {
 *   fields:    [ { id, label, type, options? } ]
 *   instances: [ { id, createdAt, values: {} } ]
 *   hiddenFieldIds: [ id, ... ]   // fields hidden from the table/visual view
 * }
 *
 * Field types: "text" | "long_text" | "number" | "select" | "tags" | "date"
 *            | "checkbox" | "url" | "image_url" | "linked_module"
 *
 * Value encoding per type (all values are stored as strings, like the DB
 * blob itself, so every field type round-trips through JSON the same way):
 *   checkbox       "true" | "false"
 *   tags           JSON-stringified string[]
 *   linked_module  JSON-stringified { path, extra, title } (see below), or "" if unset
 *   everything else  the raw string
 *
 * "linked_module" fields use exactly the same picker as Notes' inline
 * module links (NotesLinkPicker, in notes.js): each instance independently
 * points at any module in the project, optionally narrowed to something
 * inside it ("Specify"), with either a computed or an overridden title.
 * `path` is an array of ids from the project's top level down to the
 * target, however deeply nested inside folders; `extra` is the narrowing
 * detail (see NotesLinkPicker.SPECIFY_LABELS / Utils.jumpToModulePath);
 * `title` is the overridden text, or null to keep it live-resolved via
 * resolveLinkTitle(). Clicking a linked value jumps to and expands that
 * module via Utils.jumpToModulePath.
 *
 * View modes (client-side only, not persisted):
 *   "table"  — dense tabular layout
 *   "visual" — card grid
 *
 * Sorting/filtering apply to the instance list itself, so both views share
 * the same order. Reordering uses up/down arrows, shown only when sorted
 * to "Default" with no filter active (otherwise "up" wouldn't have a
 * stable meaning).
 */

class TemplateModule {
    type  = "template";
    label = "Template";
    icon  =  "📜";//"🗂️";
    defaultData = { fields: [], instances: [], hiddenFieldIds: ["__created__"] };

    static FIELD_TYPES = [
        { value: "text",          label: "Text"          },
        { value: "long_text",     label: "Long text"     },
        { value: "number",        label: "Integer"       },//Number
        { value: "select",        label: "Select"        },
        { value: "tags",          label: "Tags"          },
        { value: "date",          label: "Date"          },
        { value: "checkbox",      label: "Checkbox"      },
        { value: "url",           label: "URL"           },
        { value: "image_url",     label: "Image URL"     },
        { value: "linked_module", label: "Linked module" },
    ];

    async render(container, moduleData, { onSave }) {
        const data = {
            fields:    (moduleData.data?.fields    ?? []).map(f => ({ ...f })),
            instances: (moduleData.data?.instances ?? []).map(i => ({ ...i, values: { ...i.values } })),
            hiddenFieldIds: [...(moduleData.data?.hiddenFieldIds ?? [])],
            primaryFieldId: moduleData.data?.primaryFieldId ?? null,
        };

        container.innerHTML = `<p class="loading">Loading…</p>`;
        const projectId = moduleData.project_id;
        const myPath = moduleData.path ?? [moduleData.id];
        // Every other module in the project, however deeply nested inside
        // folders - possible "linked module" targets. Refetched whenever
        // another Template module elsewhere on the page saves, so linked
        // values here update without a reload.
        let allModules = await this._fetchOtherModules(projectId, myPath);

        // ── View state (not persisted) ──────────────────────────────────────
        let viewMode          = "table";   // "table" | "visual"
        let editingInstanceId = null;
        let showSchema        = !data.fields.length;
        let sortBy            = "default"; // "default" | "created" | <field.id>
        let sortDir            = "asc";
        let filterFieldId     = "";        // "" = no filter
        let filterValue       = "";

        // ── Shell ───────────────────────────────────────────────────────────
        container.innerHTML = `
            <div class="module-template">
                <div class="template-top-bar">
                    <div class="template-schema-bar">
                        <span class="template-schema-summary"></span>
                        <button class="btn btn-ghost btn-toggle-schema">Edit schema</button>
                    </div>
                    <div class="template-view-switcher">
                        <button class="btn-view active" data-view="table" title="Table view">⊞ Table</button>
                        <button class="btn-view"        data-view="visual" title="Visual view">◫ Visual</button>
                    </div>
                </div>

                <div class="template-schema-editor"></div>

                <div class="template-instances-toolbar">
                    <select class="input template-sortby">
                        <option value="default">Sort: Default</option>
                        <option value="created">Sort: Created</option>
                    </select>
                    <button class="btn-icon template-sort-dir" title="Toggle sort direction" hidden>▲</button>
                    <select class="input template-filter-field">
                        <option value="">No filter</option>
                    </select>
                    <span class="template-filter-value-wrap"></span>
                    <button class="btn btn-ghost btn-toggle-columns">Columns</button>
                </div>

                <div class="template-columns-editor" style="display:none"></div>

                <div class="template-instances"></div>

                <div class="module-actions">
                    <button class="btn btn-primary btn-add-instance">+ New instance</button>
                    <span class="save-status template-save-status"></span>
                </div>
            </div>
        `;

        const q = sel => container.querySelector(sel);

        const schemaSummary   = q(".template-schema-summary");
        const toggleSchBtn    = q(".btn-toggle-schema");
        const schemaEditor    = q(".template-schema-editor");
        const instancesEl     = q(".template-instances");
        const addInstBtn      = q(".btn-add-instance");
        const saveStatus      = q(".template-save-status");
        const sortBySelect    = q(".template-sortby");
        const sortDirBtn      = q(".template-sort-dir");
        const filterFieldSel  = q(".template-filter-field");
        const filterValueWrap = q(".template-filter-value-wrap");
        const toggleColsBtn   = q(".btn-toggle-columns");
        const columnsEditor   = q(".template-columns-editor");

        // ── Helpers ──────────────────────────────────────────────────────────

        const showSaved = () => {
            saveStatus.textContent = "Saved ✓";
            setTimeout(() => (saveStatus.textContent = ""), 2200);
        };

        const save = async () => {
            await onSave(data);
            showSaved();
            // Central saves already dispatch "project-hub:module-changed"
            // (see Utils.notifyModuleChanged, called from project.js/folder.js's
            // own save paths) - the listener below picks that up to refresh
            // "linked module" displays without a page reload.
        };

        // Refresh allModules (and anything showing linked-module data)
        // whenever ANY module anywhere on the page saves - a rename, a
        // primary field value changing, a sticky's title, etc.
        window.addEventListener("project-hub:module-changed", async () => {
            allModules = await this._fetchOtherModules(projectId, myPath);
            renderInstances();
            if (!schemaEditor.hidden) renderSchemaEditor();
        });

        const updateSchemaSummary = () => {
            schemaSummary.textContent = data.fields.length
                ? `Schema: ${data.fields.map(f => f.label).join(", ")}`
                : "No fields defined yet.";
        };

        const rebuildSortAndFilterOptions = () => {
            const currentSort   = sortBySelect.value;
            const currentFilter = filterFieldSel.value;

            sortBySelect.innerHTML = `
                <option value="default">Sort: Default</option>
                <option value="created">Sort: Created</option>
                ${data.fields.map(f => `<option value="${f.id}">Sort: ${Utils.escape(f.label)}</option>`).join("")}
            `;
            sortBySelect.value = [...sortBySelect.options].some(o => o.value === currentSort) ? currentSort : "default";

            filterFieldSel.innerHTML = `
                <option value="">No filter</option>
                ${data.fields.map(f => `<option value="${f.id}">Filter: ${Utils.escape(f.label)}</option>`).join("")}
            `;
            filterFieldSel.value = [...filterFieldSel.options].some(o => o.value === currentFilter) ? currentFilter : "";
        };

        const renderFilterValueControl = () => {
            const field = data.fields.find(f => f.id === filterFieldId);
            filterValue = "";
            if (!field) { filterValueWrap.innerHTML = ""; return; }

            if (field.type === "select") {
                filterValueWrap.innerHTML = `
                    <select class="input template-filter-value">
                        <option value="">Any</option>
                        ${(field.options ?? []).map(o => `<option value="${Utils.escape(o)}">${Utils.escape(o)}</option>`).join("")}
                    </select>`;
            } else if (field.type === "checkbox") {
                filterValueWrap.innerHTML = `
                    <select class="input template-filter-value">
                        <option value="">Any</option>
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                    </select>`;
            } else if (field.type === "linked_module") {
                // Filter by the target module's name, not the raw stored value.
                const options = allModules.map(m => `<option value='${Utils.escape(JSON.stringify(m.path))}'>${Utils.escape(m.title)}</option>`).join("");
                filterValueWrap.innerHTML = `<select class="input template-filter-value"><option value="">Any</option>${options}</select>`;
            } else if (field.type === "date") {
                filterValueWrap.innerHTML = `<input class="input template-filter-value" type="date" />`;
            } else {
                filterValueWrap.innerHTML = `<input class="input template-filter-value" type="text" placeholder="Contains…" />`;
            }

            const valueEl = filterValueWrap.querySelector(".template-filter-value");
            valueEl.addEventListener("input",  () => { filterValue = valueEl.value; renderInstances(); });
            valueEl.addEventListener("change", () => { filterValue = valueEl.value; renderInstances(); });
        };

        const applyFilter = (instances) => {
            const field = data.fields.find(f => f.id === filterFieldId);
            if (!field || filterValue === "") return instances;

            return instances.filter(inst => {
                const val = inst.values[field.id] ?? "";
                switch (field.type) {
                    case "select":
                    case "checkbox":
                        return val === filterValue;
                    case "linked_module": {
                        const payload = val ? decodeModuleLinkToken(val) : null;
                        return payload ? JSON.stringify(payload.path) === filterValue : false;
                    }
                    case "date":
                        return val === filterValue;
                    case "number": {
                        const n = parseFloat(filterValue);
                        return !Number.isNaN(n) && parseFloat(val) === n;
                    }
                    case "tags": {
                        const tags = this._parseTags(val);
                        return tags.some(t => t.toLowerCase().includes(filterValue.toLowerCase()));
                    }
                    default:
                        return String(val).toLowerCase().includes(filterValue.toLowerCase());
                }
            });
        };

        const applySort = (instances) => {
            if (sortBy === "default") return instances;
            const dir = sortDir === "asc" ? 1 : -1;
            const copy = [...instances];

            const key = (inst) => {
                if (sortBy === "created") return inst.createdAt ?? "";
                const field = data.fields.find(f => f.id === sortBy);
                const val = inst.values[sortBy] ?? "";
                if (field?.type === "number") return val === "" ? null : parseFloat(val);
                return val;
            };

            copy.sort((a, b) => {
                const ka = key(a), kb = key(b);
                if (ka === null || ka === "" || ka === undefined) return 1;
                if (kb === null || kb === "" || kb === undefined) return -1;
                if (typeof ka === "number" && typeof kb === "number") return (ka - kb) * dir;
                return String(ka).localeCompare(String(kb)) * dir;
            });
            return copy;
        };

        // ── View switcher ─────────────────────────────────────────────────────

        container.querySelectorAll(".btn-view").forEach(btn => {
            btn.addEventListener("click", () => {
                viewMode = btn.dataset.view;
                container.querySelectorAll(".btn-view").forEach(b => b.classList.toggle("active", b === btn));
                editingInstanceId = null;
                renderInstances();
            });
        });

        sortBySelect.addEventListener("change", () => {
            sortBy = sortBySelect.value;
            sortDirBtn.hidden = sortBy === "default";
            renderInstances();
        });
        sortDirBtn.addEventListener("click", () => {
            sortDir = sortDir === "asc" ? "desc" : "asc";
            sortDirBtn.textContent = sortDir === "asc" ? "▲" : "▼";
            renderInstances();
        });
        filterFieldSel.addEventListener("change", () => {
            filterFieldId = filterFieldSel.value;
            renderFilterValueControl();
            renderInstances();
        });

        const renderColumnsEditor = () => {
            const allColumns = [...data.fields, { id: "__created__", label: "Created" }];
            columnsEditor.innerHTML = allColumns.map(f => `
                <label class="checkbox-label">
                    <input type="checkbox" class="col-visibility-cb" value="${f.id}" ${data.hiddenFieldIds.includes(f.id) ? "" : "checked"} />
                    ${Utils.escape(f.label)}
                </label>`).join("");

            columnsEditor.querySelectorAll(".col-visibility-cb").forEach(cb => {
                cb.addEventListener("change", async () => {
                    data.hiddenFieldIds = data.hiddenFieldIds.filter(id => id !== cb.value);
                    if (!cb.checked) data.hiddenFieldIds.push(cb.value);
                    renderInstances();
                    await save();
                });
            });
        };

        toggleColsBtn.addEventListener("click", () => {
            const isHidden = columnsEditor.style.display === "none";
            columnsEditor.style.display = isHidden ? "flex" : "none";
            if (isHidden) renderColumnsEditor();
        });

        // ── Schema editor ─────────────────────────────────────────────────────

        const renderSchemaEditor = () => {
            schemaEditor.innerHTML = "";
            if (!showSchema) { schemaEditor.hidden = true; return; }
            schemaEditor.hidden = false;
            toggleSchBtn.textContent = "Hide schema";

            const wrap = document.createElement("div");
            wrap.className = "template-schema-wrap";

            data.fields.forEach((f, idx) => {
                const isPrimary = f.id === (data.primaryFieldId ?? data.fields[0]?.id);
                const row = document.createElement("div");
                row.className = "template-field-row";
                row.innerHTML = `
                    <button type="button" class="btn-icon tf-set-primary" title="${isPrimary ? "Display field for links to this instance" : "Set as display field"}">${isPrimary ? "⭐" : "☆"}</button>
                    <input  class="input tf-label" value="${Utils.escape(f.label)}" placeholder="Field name…" />
                    <select class="input tf-type">
                        ${TemplateModule.FIELD_TYPES.map(t => `<option value="${t.value}" ${t.value === f.type ? "selected" : ""}>${t.label}</option>`).join("")}
                    </select>
                    <span class="tf-extra"></span>
                    <button class="btn-icon tf-remove" title="Remove field">✕</button>
                `;

                row.querySelector(".tf-set-primary").addEventListener("click", async () => {
                    data.primaryFieldId = f.id;
                    renderSchemaEditor();
                    renderInstances();
                    await save();
                });

                const extra = row.querySelector(".tf-extra");
                this._renderFieldExtra(extra, f);

                row.querySelector(".tf-label").addEventListener("input", e => { data.fields[idx].label = e.target.value; });
                row.querySelector(".tf-type").addEventListener("change", e => {
                    data.fields[idx].type = e.target.value;
                    data.fields[idx].options = [];
                    this._renderFieldExtra(extra, data.fields[idx]);
                });

                row.querySelector(".tf-remove").addEventListener("click", async () => {
                    const affected = data.instances.filter(inst => (inst.values[f.id] ?? "") !== "").length;
                    const msg = affected
                        ? `Delete "${f.label}"? This permanently removes its data from ${affected} instance(s).`
                        : `Delete "${f.label}"?`;
                    if (!confirm(msg)) return;
                    data.fields.splice(idx, 1);
                    data.hiddenFieldIds = data.hiddenFieldIds.filter(id => id !== f.id);
                    if (data.primaryFieldId === f.id) data.primaryFieldId = null;
                    renderSchemaEditor();
                    rebuildSortAndFilterOptions();
                    if (columnsEditor.style.display !== "none") renderColumnsEditor();
                    renderInstances();
                    await save();
                });

                wrap.appendChild(row);
            });

            const addRow = document.createElement("div");
            addRow.className = "template-add-field-row";
            addRow.innerHTML = `
                <input  class="input tf-new-label" placeholder="New field name…" />
                <select class="input tf-new-type">
                    ${TemplateModule.FIELD_TYPES.map(t => `<option value="${t.value}">${t.label}</option>`).join("")}
                </select>
                <button class="btn btn-ghost btn-add-field">+ Add field</button>
            `;

            addRow.querySelector(".btn-add-field").addEventListener("click", async () => {
                const label = addRow.querySelector(".tf-new-label").value.trim();
                const type  = addRow.querySelector(".tf-new-type").value;
                if (!label) { addRow.querySelector(".tf-new-label").focus(); return; }
                data.fields.push({ id: `f${Date.now()}`, label, type, options: [] });
                addRow.querySelector(".tf-new-label").value = "";
                renderSchemaEditor();
                rebuildSortAndFilterOptions();
                if (columnsEditor.style.display !== "none") renderColumnsEditor();
                renderInstances();
                updateSchemaSummary();
                await save();
            });

            wrap.appendChild(addRow);

            /*
            const schSaveRow = document.createElement("div");
            schSaveRow.className = "module-actions";
            schSaveRow.innerHTML = `<button class="btn btn-primary btn-save-schema">Save schema</button>`;
            schSaveRow.querySelector(".btn-save-schema").addEventListener("click", async () => {
                updateSchemaSummary();
                await save();
            });
            wrap.appendChild(schSaveRow);
            */
            schemaEditor.appendChild(wrap);
        };

        toggleSchBtn.addEventListener("click", () => {
            showSchema = !showSchema;
            toggleSchBtn.textContent = showSchema ? "Hide schema" : "Edit schema";
            renderSchemaEditor();
        });

        // ── Instances dispatcher ──────────────────────────────────────────────

        const renderInstances = () => {
            instancesEl.innerHTML = "";
            if (!data.fields.length) {
                instancesEl.innerHTML = `<p class="template-hint">Define fields in the schema first.</p>`;
                return;
            }
            if (!data.instances.length) {
                instancesEl.innerHTML = `<p class="template-hint">No instances yet. Click "+ New instance" to create one.</p>`;
                return;
            }

            const visible = applySort(applyFilter(data.instances));
            const reorderable = sortBy === "default" && filterFieldId === "";
            const visibleFields = data.fields.filter(f => !data.hiddenFieldIds.includes(f.id));
            const showCreated = !data.hiddenFieldIds.includes("__created__");

            if (viewMode === "visual") {
                this._renderVisual(instancesEl, data, visibleFields, showCreated, allModules, projectId, myPath, visible, reorderable, save, renderInstances,
                    id => { editingInstanceId = id; }, () => { editingInstanceId = null; }, editingInstanceId);
            } else {
                this._renderTable(instancesEl, data, visibleFields, showCreated, allModules, projectId, myPath, visible, reorderable, save, renderInstances,
                    id => { editingInstanceId = id; }, () => { editingInstanceId = null; }, editingInstanceId);
            }
        };

        // ── Add instance ──────────────────────────────────────────────────────

        addInstBtn.addEventListener("click", async () => {
            if (!data.fields.length) {
                alert("Add at least one field to the schema first.");
                return;
            }
            const inst = {
                id:        Date.now(),
                createdAt: new Date().toISOString(),
                values:    Object.fromEntries(data.fields.map(f => [f.id, ""])),
            };
            data.instances.push(inst);
            editingInstanceId = inst.id;
            renderInstances();
            await save();
        });

        // ── Initial render ────────────────────────────────────────────────────
        updateSchemaSummary();
        renderSchemaEditor();
        rebuildSortAndFilterOptions();
        renderInstances();
    }

    /** Extra schema-row control that depends on field type: only "select"/
     *  "tags" have one (their options list) - "linked_module" needs no
     *  field-level config since each instance picks its own target. */
    _renderFieldExtra(extraEl, f) {
        if (f.type === "select" || f.type === "tags") {
            extraEl.innerHTML = `<input class="input tf-options" value="${Utils.escape((f.options ?? []).join(", "))}" placeholder="Options: comma separated… (tags: suggestions)" />`;
            extraEl.querySelector(".tf-options").addEventListener("input", e => {
                f.options = e.target.value.split(",").map(s => s.trim()).filter(Boolean);
            });
        } else {
            extraEl.innerHTML = "";
        }
    }

    /** Fetches the project's top-level modules fresh and flattens them (via
     *  Utils.flattenModules) into every other module reachable from the
     *  project - "linked module" field targets. Called at mount and again
     *  whenever any module elsewhere on the page signals it changed (see
     *  the "project-hub:module-changed" listener in render()), so linked
     *  data stays live without a reload. */
    async _fetchOtherModules(projectId, excludePath) {
        const all = await Utils.fetchProjectModules(projectId);
        const excludeKey = excludePath.join(">");
        return all.filter(m => m.path.join(">") !== excludeKey);
    }

    // =========================================================================
    // TABLE view
    // =========================================================================

    _renderTable(instancesEl, data, visibleFields, showCreated, allModules, projectId, myPath, visible, reorderable, save, rerender, startEdit, stopEdit, editingId) {
        const wrap = document.createElement("div");
        wrap.className = "template-table-wrap";

        const table = document.createElement("table");
        table.className = "template-table";

        const thead = document.createElement("thead");
        thead.innerHTML = `<tr>
            ${reorderable ? `<th class="col-move"></th>` : ""}
            ${visibleFields.map(f => `<th>${Utils.escape(f.label)}</th>`).join("")}
            ${showCreated ? `<th class="col-created">Created</th>` : ""}
            <th class="col-actions"></th>
        </tr>`;
        table.appendChild(thead);

        const tbody = document.createElement("tbody");
        visible.forEach((inst, i) => {
            const isFirst = i === 0;
            const isLast  = i === visible.length - 1;
            tbody.appendChild(
                editingId === inst.id
                    ? this._buildTableEditRow(inst, data, visibleFields, showCreated, allModules, projectId, myPath, save, rerender, stopEdit, reorderable)
                    : this._buildTableViewRow(inst, data, visibleFields, showCreated, allModules, save, rerender, startEdit, reorderable, isFirst, isLast)
            );
        });
        table.appendChild(tbody);

        wrap.appendChild(table);
        instancesEl.appendChild(wrap);
        this._bindJumpLinks(wrap);
    }

    _buildTableViewRow(inst, data, visibleFields, showCreated, allModules, save, rerender, startEdit, reorderable, isFirst, isLast) {
        const tr = document.createElement("tr");
        tr.className = "template-instance-row";
        tr.dataset.id = inst.id;

        const createdFmt = this._fmtDate(inst.createdAt);
        const cells = visibleFields.map(f => `<td>${this._displayValue(f, inst.values[f.id] ?? "", allModules)}</td>`).join("");

        tr.innerHTML = `
            ${reorderable ? `<td class="col-move">${Utils.moveButtonsHtml(isFirst, isLast)}</td>` : ""}
            ${cells}
            ${showCreated ? `<td class="col-created">${createdFmt}</td>` : ""}
            <td class="col-actions">
                <button class="btn-icon btn-edit-inst"   title="Edit">✎</button>
                <button class="btn-icon btn-delete-inst" title="Delete">✕</button>
            </td>
        `;

        tr.querySelector(".btn-edit-inst").addEventListener("click", () => { startEdit(inst.id); rerender(); });
        tr.querySelector(".btn-delete-inst").addEventListener("click", async () => {
            data.instances = data.instances.filter(x => x.id !== inst.id);
            rerender();
            await save();
        });
        tr.querySelector(".move-up")?.addEventListener("click", async () => {
            data.instances = Utils.moveItem(data.instances, inst.id, "up");
            rerender();
            Utils.flashMove(document.querySelector(`.template-instance-row[data-id="${inst.id}"]`));
            await save();
        });
        tr.querySelector(".move-down")?.addEventListener("click", async () => {
            data.instances = Utils.moveItem(data.instances, inst.id, "down");
            rerender();
            Utils.flashMove(document.querySelector(`.template-instance-row[data-id="${inst.id}"]`));
            await save();
        });

        return tr;
    }

    _buildTableEditRow(inst, data, visibleFields, showCreated, allModules, projectId, myPath, save, rerender, stopEdit, reorderable) {
        const tr = document.createElement("tr");
        tr.className = "template-instance-row editing";
        tr.dataset.id = inst.id;

        if (reorderable) tr.appendChild(document.createElement("td"));
        // Editing always shows every field, even ones hidden from the table view.
        data.fields.forEach(f => tr.appendChild(this._buildInputCell(f, inst, allModules, projectId, myPath, false)));

        const actionsTd = document.createElement("td");
        actionsTd.colSpan = (showCreated ? 1 : 0) + 1;
        actionsTd.innerHTML = `
            <button class="btn-icon btn-save-inst"   title="Save">✓</button>
            <button class="btn-icon btn-cancel-inst" title="Cancel">✕</button>
        `;
        actionsTd.querySelector(".btn-save-inst").addEventListener("click", async () => { stopEdit(); rerender(); await save(); });
        actionsTd.querySelector(".btn-cancel-inst").addEventListener("click", () => { stopEdit(); rerender(); });
        tr.appendChild(actionsTd);

        return tr;
    }

    // =========================================================================
    // VISUAL view
    // =========================================================================

    _renderVisual(instancesEl, data, visibleFields, showCreated, allModules, projectId, myPath, visible, reorderable, save, rerender, startEdit, stopEdit, editingId) {
        const grid = document.createElement("div");
        grid.className = "template-visual-grid";

        visible.forEach((inst, i) => {
            const isFirst = i === 0;
            const isLast  = i === visible.length - 1;
            grid.appendChild(
                editingId === inst.id
                    ? this._buildVisualEditCard(inst, data, allModules, projectId, myPath, save, rerender, stopEdit)
                    : this._buildVisualViewCard(inst, data, visibleFields, showCreated, allModules, save, rerender, startEdit, reorderable, isFirst, isLast)
            );
        });

        instancesEl.appendChild(grid);
        this._bindJumpLinks(grid);
    }

    _buildVisualViewCard(inst, data, visibleFields, showCreated, allModules, save, rerender, startEdit, reorderable, isFirst, isLast) {
        const card = document.createElement("div");
        card.className = "template-visual-card";
        card.dataset.id = inst.id;

        const imgField = visibleFields.find(f => f.type === "image_url");
        const imgUrl   = imgField ? (inst.values[imgField.id] ?? "") : "";
        const bodyFields = visibleFields.filter(f => f.type !== "image_url");

        const imgHtml = imgUrl
            ? `<div class="tvc-image-wrap">
                   <img class="tvc-image" src="${Utils.escape(imgUrl)}" alt="" loading="lazy"
                        onerror="this.closest('.tvc-image-wrap').classList.add('tvc-img-error')" />
               </div>`
            : `<div class="tvc-image-placeholder">no image</div>`;

        const fieldsHtml = bodyFields.map(f => `
            <div class="tvc-field">
                <span class="tvc-field-label">${Utils.escape(f.label)}</span>
                <span class="tvc-field-value">${this._displayValue(f, inst.values[f.id] ?? "", allModules)}</span>
            </div>`).join("");

        card.innerHTML = `
            ${reorderable ? Utils.moveButtonsHtml(isFirst, isLast, "tvc-move-buttons") : ""}
            ${imgHtml}
            <div class="tvc-body">
                ${fieldsHtml}
                ${showCreated ? `<div class="tvc-footer text-muted">${this._fmtDate(inst.createdAt)}</div>` : ""}
            </div>
            <div class="tvc-actions">
                <button class="btn-icon btn-edit-inst"   title="Edit">✎</button>
                <button class="btn-icon btn-delete-inst" title="Delete">✕</button>
            </div>
        `;

        card.querySelector(".btn-edit-inst").addEventListener("click", () => { startEdit(inst.id); rerender(); });
        card.querySelector(".btn-delete-inst").addEventListener("click", async () => {
            data.instances = data.instances.filter(x => x.id !== inst.id);
            rerender();
            await save();
        });
        card.querySelector(".move-up")?.addEventListener("click", async () => {
            data.instances = Utils.moveItem(data.instances, inst.id, "up");
            rerender();
            Utils.flashMove(document.querySelector(`.template-visual-card[data-id="${inst.id}"]`));
            await save();
        });
        card.querySelector(".move-down")?.addEventListener("click", async () => {
            data.instances = Utils.moveItem(data.instances, inst.id, "down");
            rerender();
            Utils.flashMove(document.querySelector(`.template-visual-card[data-id="${inst.id}"]`));
            await save();
        });

        return card;
    }

    _buildVisualEditCard(inst, data, allModules, projectId, myPath, save, rerender, stopEdit) {
        const card = document.createElement("div");
        card.className = "template-visual-card editing";
        card.dataset.id = inst.id;

        const fieldsHtml = document.createElement("div");
        fieldsHtml.className = "tvc-edit-fields";

        // Editing always shows every field, even ones hidden from the visual view.
        data.fields.forEach(f => {
            const group = document.createElement("div");
            group.className = "tvc-edit-group";
            group.innerHTML = `<label class="tvc-edit-label">${Utils.escape(f.label)}</label>`;
            group.appendChild(this._buildInputCell(f, inst, allModules, projectId, myPath, true));
            fieldsHtml.appendChild(group);
        });

        const actions = document.createElement("div");
        actions.className = "module-actions";
        actions.innerHTML = `
            <button class="btn btn-primary btn-sm btn-save-inst">Save</button>
            <button class="btn btn-ghost   btn-sm btn-cancel-inst">Cancel</button>
        `;
        actions.querySelector(".btn-save-inst").addEventListener("click", async () => { stopEdit(); rerender(); await save(); });
        actions.querySelector(".btn-cancel-inst").addEventListener("click", () => { stopEdit(); rerender(); });

        card.appendChild(fieldsHtml);
        card.appendChild(actions);
        return card;
    }

    /** Delegated click handling for "jump to linked module" links rendered by _displayValue(). */
    _bindJumpLinks(root) {
        root.querySelectorAll(".template-jump-link[data-jump-path]").forEach(el => {
            el.addEventListener("click", () => {
                try {
                    Utils.jumpToModulePath(JSON.parse(el.dataset.jumpPath), el.dataset.jumpInstance || null);
                } catch { /* malformed path - ignore */ }
            });
        });
    }

    // =========================================================================
    // Shared value display (used by both table + visual "view" rendering)
    // =========================================================================

    _displayValue(f, val, allModules) {
        if (val === "" || val === undefined || val === null) return "—";

        switch (f.type) {
            case "checkbox":
                return val === "true" ? "✓" : "✗";
            case "date":
                return this._fmtDate(val + "T00:00:00");
            case "url":
            case "image_url":
                return `<a href="${Utils.escape(val)}" target="_blank" rel="noopener noreferrer" class="template-img-link">🔗 ${f.type === "image_url" ? "View image" : "Open link"}</a>`;
            case "tags":
                return this._parseTags(val).map(t => `<span class="perm-chip">${Utils.escape(t)}</span>`).join(" ") || "—";
            case "linked_module": {
                const payload = decodeModuleLinkToken(val);
                if (!payload) return `<span class="text-muted">unavailable</span>`;
                const target = allModules.find(m => m.path.join(">") === (payload.path ?? []).join(">"));
                if (!target) return `<span class="text-muted">unavailable</span>`;
                const label = payload.title ?? resolveLinkTitle(target, payload.extra ?? null, allModules);
                return `<button type="button" class="template-jump-link" data-jump-path='${Utils.escape(JSON.stringify(payload.path))}' data-jump-instance="${payload.extra != null ? Utils.escape(String(payload.extra)) : ""}">${Utils.escape(label)}</button>`;
            }
            default:
                return Utils.escape(String(val));
        }
    }

    _parseTags(val) {
        try {
            const parsed = JSON.parse(val || "[]");
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    // =========================================================================
    // Shared input builder (edit mode)
    // =========================================================================

    _buildInputCell(f, inst, allModules, projectId, myPath, asDiv = false) {
        const wrapper = document.createElement(asDiv ? "div" : "td");
        const val = inst.values[f.id] ?? "";

        if (f.type === "checkbox") {
            wrapper.innerHTML = `<input type="checkbox" ${val === "true" ? "checked" : ""} />`;
            wrapper.querySelector("input").addEventListener("change", e => { inst.values[f.id] = String(e.target.checked); });

        } else if (f.type === "select") {
            const opts = (f.options ?? []).map(o => `<option value="${Utils.escape(o)}" ${o === val ? "selected" : ""}>${Utils.escape(o)}</option>`).join("");
            wrapper.innerHTML = `<select class="input input-sm"><option value="">—</option>${opts}</select>`;
            wrapper.querySelector("select").addEventListener("change", e => { inst.values[f.id] = e.target.value; });

        } else if (f.type === "long_text") {
            wrapper.innerHTML = `<textarea class="input input-sm tf-long-text">${Utils.escape(val)}</textarea>`;
            wrapper.querySelector("textarea").addEventListener("input", e => { inst.values[f.id] = e.target.value; });

        } else if (f.type === "tags") {
            wrapper.appendChild(this._buildTagsInput(this._parseTags(val), (newTags, suggestions) => {
                inst.values[f.id] = JSON.stringify(newTags);
            }, f.options ?? []));

        } else if (f.type === "linked_module") {
            // Uses exactly the same picker as Notes' inline module links -
            // see notesLinkPicker (notes.js) - so target/specify/override
            // behave identically in both places.
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "template-jump-link";

            const renderLabel = () => {
                const payload = inst.values[f.id] ? decodeModuleLinkToken(inst.values[f.id]) : null;
                if (!payload) { btn.textContent = "Choose module…"; return; }
                const target = allModules.find(m => m.path.join(">") === (payload.path ?? []).join(">"));
                btn.textContent = payload.title ?? resolveLinkTitle(target, payload.extra ?? null, allModules);
            };
            renderLabel();

            btn.addEventListener("click", () => {
                notesLinkPicker.open({
                    projectId,
                    excludePath: myPath,
                    initial: inst.values[f.id] ? decodeModuleLinkToken(inst.values[f.id]) : null,
                    onSubmit: ({ path, extra, title, label }) => {
                        inst.values[f.id] = encodeModuleLinkToken({ path, extra, title });
                        btn.textContent = label;
                    },
                });
            });
            wrapper.appendChild(btn);

        } else {
            // text | number | date | url | image_url  →  all plain inputs
            const inputType = f.type === "date" ? "date" : f.type === "number" ? "number" : "text";
            const placeholder = (f.type === "image_url" || f.type === "url") ? "https://…" : "";
            wrapper.innerHTML = `<input class="input input-sm" type="${inputType}" value="${Utils.escape(val)}" placeholder="${placeholder}" />`;
            wrapper.querySelector("input").addEventListener("input", e => { inst.values[f.id] = e.target.value; });
        }

        return wrapper;
    }

    /** Chip-style tag editor: type + Enter/comma to add, click a chip's x to remove. */
    _buildTagsInput(currentTags, onChange, suggestions = []) {
        const wrap = document.createElement("div");
        wrap.className = "tags-input";
        let tags = [...currentTags];

        const renderChips = () => {
            wrap.querySelectorAll(".tag-chip").forEach(el => el.remove());
            tags.forEach((t, i) => {
                const chip = document.createElement("span");
                chip.className = "tag-chip perm-chip";
                chip.innerHTML = `${Utils.escape(t)} <button type="button" class="tag-chip-remove">✕</button>`;
                chip.querySelector(".tag-chip-remove").addEventListener("click", () => {
                    tags.splice(i, 1);
                    renderChips();
                    onChange(tags);
                });
                wrap.insertBefore(chip, input);
            });
        };

        const input = document.createElement("input");
        input.className = "input input-sm tags-input-field";
        input.placeholder = suggestions.length ? `Add tag… (${suggestions.slice(0, 3).join(", ")})` : "Add tag…";
        input.setAttribute("list", `tag-suggestions-${Math.random().toString(36).slice(2)}`);

        if (suggestions.length) {
            const datalist = document.createElement("datalist");
            datalist.id = input.getAttribute("list");
            datalist.innerHTML = suggestions.map(s => `<option value="${Utils.escape(s)}"></option>`).join("");
            wrap.appendChild(datalist);
        }

        input.addEventListener("keydown", e => {
            if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                const val = input.value.trim().replace(/,$/, "");
                if (val && !tags.includes(val)) {
                    tags.push(val);
                    renderChips();
                    onChange(tags);
                }
                input.value = "";
            } else if (e.key === "Backspace" && !input.value && tags.length) {
                tags.pop();
                renderChips();
                onChange(tags);
            }
        });

        wrap.appendChild(input);
        renderChips();
        return wrap;
    }

    // =========================================================================
    // Plugin interface
    // =========================================================================

    _fmtDate(iso) {
        if (!iso) return "";
        return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    }
}

registry.register(new TemplateModule());
