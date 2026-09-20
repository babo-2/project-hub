/**
 * drawio.js — embeds the diagrams.net (draw.io) editor via its documented
 * embed protocol (https://www.drawio.com/doc/faq/embed-mode). Diagram XML
 * is round-tripped through postMessage and stored in this module's data;
 * a lightweight PNG thumbnail is cached alongside it so the diagram is
 * still visible without loading the external editor.
 *
 * data shape: { xml: string, previewImage: string|null }
 *
 * The editor iframe (from embed.diagrams.net, a third-party service) is
 * only loaded once you click "Edit diagram" - not eagerly on page load -
 * so simply viewing a project never silently calls out to it.
 */

class DrawioModule {
    type  = "drawio";
    label = "Diagram (draw.io)";
    icon  = "📐";
    defaultData = { xml: "", previewImage: null };

    render(container, moduleData, { onSave }) {
        const data = { ...this.defaultData, ...(moduleData.data ?? {}) };
        let editing = false;
        let ready   = false;

        container.innerHTML = `
            <div class="module-drawio">
                <div class="drawio-toolbar">
                    <button class="btn btn-primary btn-edit-diagram">${data.xml ? "Edit diagram" : "Create diagram"}</button>
                    <span class="save-status drawio-save-status"></span>
                </div>
                <div class="drawio-preview-wrap"></div>
                <div class="drawio-editor-wrap" hidden></div>
            </div>
        `;

        const editBtn     = container.querySelector(".btn-edit-diagram");
        const previewWrap = container.querySelector(".drawio-preview-wrap");
        const editorWrap  = container.querySelector(".drawio-editor-wrap");
        const statusEl    = container.querySelector(".drawio-save-status");

        const save = async () => {
            await onSave(data);
            statusEl.textContent = "Saved ✓";
            setTimeout(() => (statusEl.textContent = ""), 1800);
        };

        const renderPreview = () => {
            previewWrap.innerHTML = data.previewImage
                ? `<img class="drawio-preview-img" src="${data.previewImage}" alt="Diagram preview" />`
                : `<p class="embed-hint">No diagram yet. Click "Create diagram" to start.</p>`;
        };

        const mountEditor = () => {
            editing = true;
            editBtn.hidden = true;
            previewWrap.hidden = true;
            editorWrap.hidden = false;
            // ui=dark selects draw.io's dark editor theme (rather than the
            // default light "atlas" theme), so the embed matches the rest
            // of the app instead of showing a bright white canvas.
            editorWrap.innerHTML = `<iframe class="drawio-iframe" src="https://embed.diagrams.net/?embed=1&ui=dark&spin=1&proto=json&saveAndExit=0"></iframe>`;

            const iframe = editorWrap.querySelector("iframe");

            const handler = event => {
                if (event.source !== iframe.contentWindow) return;
                let msg;
                try { msg = JSON.parse(event.data); } catch { return; }

                if (msg.event === "init") {
                    ready = true;
                    iframe.contentWindow.postMessage(JSON.stringify({ action: "load", xml: data.xml || "", autosave: 1 }), "*");
                } else if (msg.event === "autosave" || msg.event === "save") {
                    data.xml = msg.xml;
                    save();
                    iframe.contentWindow.postMessage(JSON.stringify({ action: "export", format: "png", w: 480 }), "*");
                } else if (msg.event === "export") {
                    data.previewImage = msg.data;
                    save();
                }
            };
            window.addEventListener("message", handler);
        };

        editBtn.addEventListener("click", mountEditor);

        renderPreview();
    }

}

registry.register(new DrawioModule());
