/**
 * links.js — curated list of external links (docs, repos, staging URLs…).
 *
 * data shape: { links: [ { id, title, url, description } ] }
 */

class LinksModule {
    type  = "links";
    label = "Links";
    icon  = "🔗";
    defaultData = { links: [] };

    static _id() {
        return crypto.randomUUID?.() ?? `l-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    static _favicon(url) {
        try {
            const host = new URL(url).hostname;
            return `https://www.google.com/s2/favicons?domain=${host}&sz=32`;
        } catch {
            return "";
        }
    }

    render(container, moduleData, { onSave }) {
        const data = { links: (moduleData.data?.links ?? []).map(l => ({ ...l })) };

        container.innerHTML = `
            <div class="module-links">
                <div class="links-list"></div>
                <div class="links-add-row">
                    <input class="input links-new-title" placeholder="Title…" />
                    <input class="input links-new-url" placeholder="https://…" />
                    <input class="input links-new-desc" placeholder="Short description (optional)…" />
                    <button class="btn btn-primary btn-add-link">+ Add</button>
                </div>
                <span class="save-status links-save-status"></span>
            </div>
        `;

        const listEl   = container.querySelector(".links-list");
        const titleI   = container.querySelector(".links-new-title");
        const urlI     = container.querySelector(".links-new-url");
        const descI    = container.querySelector(".links-new-desc");
        const addBtn   = container.querySelector(".btn-add-link");
        const statusEl = container.querySelector(".links-save-status");

        const save = async () => {
            await onSave(data);
            statusEl.textContent = "Saved ✓";
            setTimeout(() => (statusEl.textContent = ""), 1800);
        };

        const renderList = () => {
            listEl.innerHTML = "";
            if (!data.links.length) {
                listEl.innerHTML = `<p class="links-hint">No links yet.</p>`;
                return;
            }
            data.links.forEach(link => listEl.appendChild(this._buildRow(link, data, save, renderList)));
        };

        const addLink = async () => {
            const title = titleI.value.trim();
            let url = urlI.value.trim();
            if (!title || !url) { (title ? urlI : titleI).focus(); return; }
            if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
            data.links.push({ id: LinksModule._id(), title, url, description: descI.value.trim() });
            titleI.value = ""; urlI.value = ""; descI.value = "";
            renderList();
            await save();
        };

        addBtn.addEventListener("click", addLink);
        [titleI, urlI, descI].forEach(input => {
            input.addEventListener("keydown", e => { if (e.key === "Enter") addLink(); });
        });

        renderList();
    }

    _buildRow(link, data, save, rerender) {
        const row = document.createElement("div");
        row.className = "links-row";
        row.dataset.id = link.id;
        const favicon = LinksModule._favicon(link.url);

        row.innerHTML = `
            ${favicon ? `<img class="links-favicon" src="${Utils.escape(favicon)}" alt="" onerror="this.style.visibility='hidden'" />` : `<span class="links-favicon-placeholder">🔗</span>`}
            <div class="links-row-body">
                <a class="links-row-title" href="${Utils.escape(link.url)}" target="_blank" rel="noopener noreferrer">${Utils.escape(link.title)}</a>
                ${link.description ? `<p class="links-row-desc">${Utils.escape(link.description)}</p>` : ""}
                <span class="links-row-url">${Utils.escape(link.url)}</span>
            </div>
            <button class="btn-icon btn-delete-link" title="Remove link">✕</button>
        `;

        row.querySelector(".btn-delete-link").addEventListener("click", async () => {
            data.links = data.links.filter(x => x.id !== link.id);
            rerender();
            await save();
        });

        return row;
    }

}

registry.register(new LinksModule());
