import { Component, useRef, useEffect } from "@odoo/owl";

// Shared signature capture used by the Book Therapy details step and by the
// "Sign" sheet on an order / questionnaire. It works on ONE plain object (kept
// in the parent's useState, so both sides re-render):
//
//   { value, original, fromContact, mode, busy, message }
//
// `value` is always the base64 payload WITHOUT the "data:...;base64," prefix,
// because that is exactly what the ORM stores in a Binary field.

// The ORM hands back a bare payload with no MIME type, so sniff it from the
// magic bytes: an <img> with the wrong data: MIME is refused by the browser.
export function sigMime(b64) {
    if (b64.startsWith("/9j/")) {
        return "image/jpeg";
    }
    if (b64.startsWith("R0lGOD")) {
        return "image/gif";
    }
    if (b64.startsWith("UklGR")) {
        return "image/webp";
    }
    if (b64.startsWith("PHN2Zy") || b64.startsWith("PD94bW")) {
        return "image/svg+xml";
    }
    return "image/png";
}

export function sigDataUrl(b64) {
    return b64 ? `data:${sigMime(b64)};base64,${b64}` : "";
}

export function newSigState(value = "") {
    return {
        value: value || "",
        // What was already stored, so we only write when it actually changed.
        original: value || "",
        fromContact: !!value,
        mode: value ? "view" : "draw",
        busy: false,
        message: "",
    };
}

export class SpaSignatureField extends Component {
    static template = "spa_online_booking.SpaSignatureField";
    static props = {
        sig: true,
        label: { type: String, optional: true },
        hint: { type: String, optional: true },
        // Off where a customer signs for themselves at the counter: a consent
        // signature should be drawn there and then, not supplied as a picture
        // from a file. Left on by default so the staff reprint sheet, where an
        // uploaded scan is a legitimate way to attach one, keeps working.
        allowUpload: { type: Boolean, optional: true },
    };
    static defaultProps = { allowUpload: true };

    setup() {
        // The pad only exists while mode === "draw", so (re)size it whenever the
        // canvas is mounted. A canvas left at its default 300x150 backing store
        // draws the strokes badly offset from the pointer.
        this.pad = useRef("sigPad");
        useEffect(
            (el) => {
                if (el) {
                    this.setupPad(el);
                }
            },
            () => [this.pad.el]
        );
    }

    get sig() {
        return this.props.sig;
    }
    get label() {
        return this.props.label === undefined ? "Signature" : this.props.label;
    }
    get src() {
        return sigDataUrl(this.sig.value);
    }

    // Give the pad a backing store that matches its on-screen size (times the
    // device pixel ratio) and a white background, so the saved PNG prints the
    // same way it looked on the tablet.
    setupPad(el) {
        const rect = el.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const w = Math.max(1, Math.round(rect.width));
        const h = Math.max(1, Math.round(rect.height));
        el.width = Math.round(w * dpr);
        el.height = Math.round(h * dpr);
        const ctx = el.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
        ctx.lineWidth = 2.2;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = "#0f1720";
        this.ctx = ctx;
        this.hasInk = false;
        this.drawing = false;
        // Leaving the step and coming back remounts the pad with a blank bitmap
        // - paint whatever signature we still hold back onto it, otherwise the
        // box looks empty while a signature is queued.
        const b64 = this.sig.value;
        if (b64) {
            const img = new Image();
            img.onload = () => {
                if (this.pad.el !== el) {
                    return;   // pad was replaced while the image decoded
                }
                const scale = Math.min(w / img.width, h / img.height, 1);
                const dw = img.width * scale;
                const dh = img.height * scale;
                ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
                this.hasInk = true;
            };
            img.src = sigDataUrl(b64);
        }
    }

    point(ev, el) {
        const r = el.getBoundingClientRect();
        return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    }

    onDown(ev) {
        const el = this.pad.el;
        if (!el || !this.ctx) {
            return;
        }
        ev.preventDefault();
        // Capture the pointer: on a tablet a finger easily slides off the pad
        // mid-stroke, and without this the stroke just stops there.
        if (el.setPointerCapture) {
            try {
                el.setPointerCapture(ev.pointerId);
            } catch (e) {
                // Safari throws for a pointer that already ended - harmless.
            }
        }
        const p = this.point(ev, el);
        this.drawing = true;
        this.ctx.beginPath();
        this.ctx.moveTo(p.x, p.y);
    }

    onMove(ev) {
        if (!this.drawing || !this.ctx) {
            return;
        }
        ev.preventDefault();
        const p = this.point(ev, this.pad.el);
        this.ctx.lineTo(p.x, p.y);
        this.ctx.stroke();
        this.hasInk = true;
    }

    onUp() {
        if (!this.drawing) {
            return;
        }
        this.drawing = false;
        const el = this.pad.el;
        if (!el || !this.hasInk) {
            return;
        }
        // Keep the pad on screen (mode stays "draw") so the customer can carry
        // on signing; only the value behind it is updated.
        this.sig.value = el.toDataURL("image/png").split(",")[1] || "";
        this.sig.fromContact = false;
        this.sig.message = "";
    }

    clear() {
        const el = this.pad.el;
        if (el) {
            this.sig.value = "";   // cleared BEFORE setupPad, or it repaints it
            this.setupPad(el);
        }
        this.sig.value = "";
        this.sig.fromContact = false;
        this.sig.message = "";
    }

    // Replace the signature already on file (or the one just drawn).
    startDrawing() {
        this.sig.value = "";
        this.sig.fromContact = false;
        this.sig.message = "";
        this.sig.mode = "draw";
    }

    // Back out of a replacement: put the contact's own signature back.
    cancelDrawing() {
        this.sig.value = this.sig.original;
        this.sig.fromContact = !!this.sig.original;
        this.sig.mode = this.sig.original ? "view" : "draw";
        this.sig.message = "";
    }

    onFile(ev) {
        const file = ev.target.files && ev.target.files[0];
        // Reset the input so picking the SAME file again still fires change.
        ev.target.value = "";
        if (!file) {
            return;
        }
        if (!/^image\//.test(file.type || "")) {
            this.sig.message = "The signature has to be an image file.";
            return;
        }
        if (file.size > 2 * 1024 * 1024) {
            this.sig.message = "That signature image is too big (max 2 MB).";
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            const b64 = String(reader.result || "").split(",")[1] || "";
            if (!b64) {
                return;
            }
            this.sig.value = b64;
            this.sig.fromContact = false;
            this.sig.mode = "view";
            this.sig.message = "";
        };
        reader.onerror = () => {
            this.sig.message = "Could not read that signature image.";
        };
        reader.readAsDataURL(file);
    }
}
