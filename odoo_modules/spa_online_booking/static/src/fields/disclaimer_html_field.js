import { onWillDestroy, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { HtmlField, htmlField } from "@html_editor/fields/html_field";
import { Toolbar } from "@html_editor/main/toolbar/toolbar";

/**
 * An Html field whose formatting toolbar is always on screen.
 *
 * Odoo 19 shows the editor toolbar as an overlay that opens on a text
 * selection (see ToolbarPlugin: it builds `this.overlay` and only opens it from
 * `_updateToolbar`). Every control is there - font family and size, bold,
 * italic, underline, colour, alignment, lists, indent - but it is invisible
 * until something is selected, and it starts in a "compact" namespace that
 * hides most of it behind the ⋮ "Expand toolbar" button.
 *
 * A waiver is written the way an email is: you want the buttons in front of
 * you. So this mounts Odoo's OWN Toolbar component in a fixed bar under the
 * field and feeds it the same reactive state the overlay uses. Nothing is
 * reimplemented - the buttons, their commands and their active states are the
 * editor's.
 *
 * CAVEAT, and it is a real one: the toolbar plugin's `state`, `toolbarProps`
 * and the `plugins` array are internals, not a public API. An Odoo point
 * release can rename them. Everything here is written to fail soft - if the
 * plugin cannot be found, the field still works exactly like a normal Html
 * field and the overlay toolbar carries on as usual.
 */
export class DisclaimerHtmlField extends HtmlField {
    static template = "spa_online_booking.DisclaimerHtmlField";
    static components = { ...HtmlField.components, Toolbar };

    setup() {
        super.setup();
        // `null` until the editor is up; the template renders no bar until then.
        this.toolbarState = useState({ plugin: null });
        onWillDestroy(() => this.stopKeepingToolbarOpen());
    }

    onEditorLoad(editor) {
        const res = super.onEditorLoad(editor);
        this.editorRef = editor;
        return res;
    }

    /**
     * Grab the toolbar plugin once the editor has started. Called from the
     * template rather than a lifecycle hook because the plugins only exist
     * after Wysiwyg has mounted and run onLoad.
     */
    get toolbarPlugin() {
        if (this.toolbarState.plugin) {
            return this.toolbarState.plugin;
        }
        const editor = this.editorRef || this.editor;
        const plugin = editor?.plugins?.find?.((p) => p.constructor?.id === "toolbar");
        if (plugin && plugin.state && plugin.toolbarProps) {
            this.toolbarState.plugin = plugin;
            this.startKeepingToolbarOpen(plugin);
        }
        return this.toolbarState.plugin;
    }

    get fixedToolbarProps() {
        const plugin = this.toolbarPlugin;
        if (!plugin) {
            return null;
        }
        // Same props the overlay is given, minus its floating-card styling.
        return { ...plugin.toolbarProps, class: "" };
    }

    /**
     * Keep the bar populated and fully expanded.
     *
     * Two things otherwise leave it looking broken:
     *  - `state.buttonGroups` is empty until the first selection, so the bar
     *    would start blank;
     *  - the plugin resets to the "compact" namespace whenever the toolbar
     *    closes, which hides most buttons behind ⋮.
     * Re-asserting both on every editor step keeps the bar steady.
     */
    startKeepingToolbarOpen(plugin) {
        const prime = () => {
            try {
                plugin.isToolbarExpanded = true;
                if (plugin.state.namespace !== "expanded") {
                    plugin.state.namespace = "expanded";
                }
                if (!plugin.state.buttonGroups.length) {
                    const data = plugin.dependencies?.selection?.getSelectionData?.();
                    if (data?.editableSelection) {
                        plugin.updateButtonsStates(data.editableSelection, []);
                    }
                }
            } catch {
                // Never let toolbar cosmetics stop the field from working.
            }
        };
        prime();
        // The plugin recomputes on selection; re-assert just after it does.
        this._primeInterval = setInterval(prime, 400);
    }

    stopKeepingToolbarOpen() {
        if (this._primeInterval) {
            clearInterval(this._primeInterval);
            this._primeInterval = null;
        }
    }
}

export const disclaimerHtmlField = {
    ...htmlField,
    component: DisclaimerHtmlField,
    displayName: "Html (fixed toolbar)",
};

registry.category("fields").add("spa_disclaimer_html", disclaimerHtmlField);
