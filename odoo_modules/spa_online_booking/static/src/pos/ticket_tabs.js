import { patch } from "@web/core/utils/patch";
import { TicketScreen } from "@point_of_sale/app/screens/ticket_screen/ticket_screen";
import { onMounted } from "@odoo/owl";
import { makeAwaitable } from "@point_of_sale/app/utils/make_awaitable_dialog";
import { SetSlotDialog } from "@spa_online_booking/pos/set_slot_dialog";

const { DateTime } = luxon;

// Adds Online / Web / Tab tabs to the POS Orders screen. Each tab lists the
// bookings that came in through that channel, with their status, and a "Load"
// button that pulls the booking (customer + services + answers) into an order.
// The default "All" view keeps showing the normal POS orders.
patch(TicketScreen.prototype, {
    setup() {
        super.setup(...arguments);
        this.state.spaType = null;
        this.state.spaBookings = [];
        this.state.spaSessions = { pending: [], taken: [] }; // 'Sessions' tab
        this.state.spaDate = null; // 'YYYY-MM-DD' filter, or null = today
        // Sub-filter within a channel tab: pending | today | upcoming | completed
        this.state.spaSubFilter = "pending";
        // Fetch the day's paid orders so the "All" tab can show them next to
        // the active (unpaid) ones the POS already keeps in memory.
        onMounted(async () => {
            await this.refreshSpaBookings();
            await this.loadDayOrders();
        });
    },

    setSpaDate(value) {
        this.state.spaDate = value || null;
        // The Sessions tab's "Taken" list is day-scoped on the server, so refetch
        // it for the newly picked date.
        if (this.state.spaType === "sessions") {
            this.refreshSpaBookings();
            return;
        }
        // The All tab and the channel tabs both list orders for the day.
        if (this.state.spaType !== "today") {
            this.loadDayOrders();
        }
    },

    // Load this day's already-paid orders into the POS so the All tab (and the
    // channel tabs' "served/paid" section) can list them alongside the ongoing
    // ones (the register only pre-loads unpaid orders).
    async loadDayOrders() {
        const d = this.state.spaDate
            ? DateTime.fromISO(this.state.spaDate)
            : DateTime.now();
        if (!d.isValid) {
            return;
        }
        try {
            await this.pos.data.loadServerOrders([
                ["config_id", "=", this.pos.config.id],
                ["state", "!=", "draft"],
                ["date_order", ">=", d.minus({ days: 7 }).toFormat("yyyy-MM-dd") + " 00:00:00"],
                ["date_order", "<=", d.plus({ days: 1 }).toFormat("yyyy-MM-dd") + " 23:59:59"],
            ]);
        } catch (e) {
            console.warn("Spa: failed to load the day's orders", e);
        }
    },

    _spaDay() {
        return this.state.spaDate || DateTime.now().toFormat("yyyy-MM-dd");
    },

    _orderBookingIds() {
        return new Set(
            this.pos.models["pos.order"]
                .filter((o) => o.spa_booking_ref)
                .map((o) => o.spa_booking_ref)
        );
    },

    // TOP section — bookings still to act on for the day (not yet paid). On a
    // channel tab, ones already turned into an order are hidden (they show in
    // the "served/paid" section, no duplication).
    spaFilteredBookings() {
        // Channel tabs (Online / Web / Tab): show every actionable booking for
        // that channel — including future-dated ones — so a pending request is
        // visible for approval as soon as it comes in, not only on its
        // appointment day. Narrow by date only when a date is explicitly picked.
        if (this.state.spaType && this.state.spaType !== "today") {
            const booked = this._orderBookingIds();
            let bookings = this.state.spaBookings.filter(
                (b) =>
                    b.state !== "paid" &&
                    b.state !== "rejected" &&
                    !booked.has(b.id)
            );
            if (this.state.spaDate) {
                bookings = bookings.filter((b) => (b.date || "") === this.state.spaDate);
            }
            return bookings;
        }
        // "Today" tab (and the default): scoped to the selected day.
        const day = this._spaDay();
        return this.state.spaBookings.filter((b) => (b.date || "") === day);
    },

    // BOTTOM section — bookings already marked Paid without a POS order.
    spaPaidBookings() {
        if (!this.state.spaType || this.state.spaType === "today") {
            return [];
        }
        const day = this._spaDay();
        const booked = this._orderBookingIds();
        return this.state.spaBookings.filter(
            (b) => (b.date || "") === day && b.state === "paid" && !booked.has(b.id)
        );
    },

    // Served/paid orders of the current channel for the selected day.
    spaChannelOrders() {
        if (!this.state.spaType || this.state.spaType === "today") {
            return [];
        }
        const day = this._spaDay();
        return this.pos.models["pos.order"]
            .filter(
                (o) =>
                    (o.spa_channel || "web") === this.state.spaType &&
                    (o.getOrderlines().length > 0 || o.payment_ids.length > 0) &&
                    o.date_order &&
                    o.date_order.toFormat("yyyy-MM-dd") === day
            )
            .sort((a, b) => b.date_order.ts - a.date_order.ts);
    },

    spaOrderCustomer(o) {
        return o.getPartnerName?.() || o.partner_id?.name || "";
    },

    // Ongoing (unpaid, non-cancelled) POS orders of the current channel — these
    // aren't bookings and aren't in the "paid" list, so surface them under the
    // channel tab's "Today's Appointments" group.
    spaChannelActiveOrders() {
        if (!this.state.spaType || this.state.spaType === "today") {
            return [];
        }
        // When a date is picked, only show ongoing orders from that day (so
        // picking a future/past date doesn't keep showing the current day's).
        const picked = this.state.spaDate;
        return this.pos.models["pos.order"].filter(
            (o) =>
                (o.spa_channel || "web") === this.state.spaType &&
                !o.finalized &&
                o.state !== "cancel" &&
                (o.getOrderlines().length > 0 || o.payment_ids.length > 0) &&
                (!picked || (o.date_order && o.date_order.toFormat("yyyy-MM-dd") === picked))
        );
    },

    // ---- branded order/booking card helpers ----
    spaOrderDate(o) {
        return o.date_order ? o.date_order.toFormat("dd LLL yyyy") : "";
    },
    spaOrderTime(o) {
        return o.date_order ? o.date_order.toFormat("h:mm a") : "";
    },
    spaAvatarClass(o) {
        if (o.state === "cancel") {
            return "sg-av--red";
        }
        return o.finalized ? "sg-av--green" : "sg-av--purple";
    },
    spaOrderStatusPill(o) {
        if (o.state === "cancel") {
            return "sg-pill--red";
        }
        return o.finalized ? "sg-pill--green" : "sg-pill--blue";
    },
    spaBookingDate(b) {
        return b.date ? DateTime.fromISO(b.date).toFormat("dd LLL yyyy") : "";
    },
    // "25 Jul 2026" or "25 Jul 2026, 6:30 PM" (drops the time when it's the
    // midnight placeholder used for preferred-time-note bookings).
    spaBookingWhen(b) {
        if (b.slot_datetime) {
            // slot_datetime arrives as "YYYY-MM-DD HH:MM:SS" (with seconds).
            const dt = DateTime.fromSQL(b.slot_datetime);
            if (dt.isValid) {
                return dt.hour === 0 && dt.minute === 0
                    ? dt.toFormat("dd LLL yyyy")
                    : dt.toFormat("dd LLL yyyy, h:mm a");
            }
        }
        return b.date ? DateTime.fromISO(b.date).toFormat("dd LLL yyyy") : "";
    },
    spaBookingPill(b) {
        if (b.state === "rejected") {
            return "sg-pill--red";
        }
        if (b.state === "paid" || b.state === "completed") {
            return "sg-pill--green";
        }
        if (b.state === "pending") {
            return "sg-pill--purple";
        }
        return "sg-pill--blue";
    },
    spaBookingAvatarClass(b) {
        if (b.state === "rejected") {
            return "sg-av--red";
        }
        if (b.state === "paid" || b.state === "completed") {
            return "sg-av--green";
        }
        return "sg-av--purple";
    },

    // Product/therapy names on the order, shown on the order card.
    spaOrderServices(o) {
        return o
            .getOrderlines()
            .map((l) => l.getFullProductName?.() || l.product_id?.display_name || "")
            .filter(Boolean)
            .join(", ");
    },

    spaOrderTotal(o) {
        return this.env.utils.formatCurrency(o.priceIncl);
    },

    spaOrderStatusLabel(o) {
        if (o.state === "cancel") {
            return "Cancelled";
        }
        return o.finalized ? "Paid" : "Ongoing";
    },

    // Open a POS order from the list into the register (so an ongoing order can
    // be paid). Uses the same reliable path as loading a booking — select the
    // order and go to its screen — instead of TicketScreen.setOrder, whose
    // shareable-config sync can bounce the register to an empty order (which is
    // why clicking was landing on the empty logo screen).
    async spaOpenOrder(o) {
        if (!o || !o.uuid) {
            return;
        }
        const uuid = o.uuid;
        // Resolve the live order object in the POS models; (re)load it from the
        // server if it's missing or its lines aren't in memory yet.
        let order = this.pos.models["pos.order"].getBy("uuid", uuid);
        const needsLoad =
            !order || (order.getOrderlines && order.getOrderlines().length === 0);
        if (needsLoad) {
            try {
                await this.pos.data.loadServerOrders([["uuid", "=", uuid]]);
                order = this.pos.models["pos.order"].getBy("uuid", uuid);
            } catch (e) {
                console.warn("Spa: could not load order", uuid, e);
            }
        }
        order = order || o;
        // Clear any leftover Book Therapy overlay, make this the active order,
        // and open the register directly for its uuid.
        this.pos.showTherapyBooking = false;
        this.pos.selectedOrderUuid = order.uuid;
        this.pos.setOrder(order);
        if (order.finalized) {
            // Paid order: show its receipt (with Reprint / Email), not the
            // editable register (which would be an empty screen).
            this.pos.navigate("ReceiptScreen", { orderUuid: order.uuid });
        } else {
            this.pos.navigate("ProductScreen", { orderUuid: order.uuid });
        }
    },

    // Download/open the invoice PDF for a paid order (the same branded invoice).
    async spaDownloadInvoice(o) {
        const moveId = o?.raw?.account_move;
        if (!moveId) {
            this.env.services.notification.add(
                "This order isn't invoiced. Open it, then use the Invoice option.",
                { type: "warning" }
            );
            return;
        }
        try {
            await this.env.services.account_move.downloadPdf(moveId);
        } catch (e) {
            console.warn("Spa: invoice download failed", e);
            this.env.services.notification.add("Could not open the invoice.", { type: "danger" });
        }
    },

    spaOrderStatusClass(o) {
        if (o.state === "cancel") {
            return "text-bg-danger";
        }
        return o.finalized ? "text-bg-success" : "text-bg-info";
    },

    async setSpaType(type) {
        this.state.spaType = type;
        // Online (website) and Tab (in-store app) both need approval first, so
        // they open on the pending queue. Web is a counter sale — start on the
        // active ("Ongoing") group.
        this.state.spaSubFilter =
            type === "sessions" || type === "online" || type === "tab" ? "pending" : "today";
        await this.refreshSpaBookings();
        if (type !== "today") {
            await this.loadDayOrders();
        }
    },

    setSpaSubFilter(name) {
        this.state.spaSubFilter = name;
    },

    // Online shows scheduled appointments; Web/Tab show the live counter sale.
    spaTodayLabel() {
        return this.state.spaType === "online" ? "Today's Appointments" : "Ongoing";
    },

    // Trim the built-in order filter dropdown to Active / Ongoing / Paid
    // (drop the Payment and Receipt sub-states).
    _getOrderStates() {
        const states = super._getOrderStates(...arguments);
        states.delete("PAYMENT");
        states.delete("RECEIPT");
        return states;
    },

    // Group a channel's bookings by status for the Online/Web/Tab sub-filters.
    // "today"/"upcoming" are by appointment date; "completed" holds paid ones.
    spaGroups() {
        const today = DateTime.now().toFormat("yyyy-MM-dd");
        // When a specific date is picked in the filter, scope EVERY section to
        // that day, so the list shows the chosen date's bookings instead of the
        // current day's. The today/upcoming split is then relative to the
        // picked day. With no date picked, behave as before (relative to today).
        const picked = this.state.spaDate;
        const ref = picked || today;
        const g = { pending: [], today: [], upcoming: [], completed: [] };
        // Hide bookings that have already been loaded into a POS order — they
        // show as the order (in the Ongoing/Completed sections), so they must
        // NOT still appear here with a "Load" button. That gap let an
        // already-paid booking keep offering "Load" and created duplicate orders.
        const booked = this._orderBookingIds();
        for (const b of this.state.spaBookings) {
            if (b.state === "rejected") {
                continue;
            }
            if (booked.has(b.id)) {
                continue;
            }
            if (picked && (b.date || "") !== picked) {
                continue;
            }
            if (b.state === "pending") {
                g.pending.push(b);
            } else if (b.state === "paid" || b.state === "completed") {
                g.completed.push(b);
            } else if (b.state === "approved" || b.state === "in_service") {
                if ((b.date || "") > ref) {
                    g.upcoming.push(b);
                } else {
                    g.today.push(b);
                }
            }
        }
        return g;
    },

    // Paid bookings for the day, across ALL channels, that never became an
    // order — shown in the "All" tab next to the paid orders.
    spaAllPaidBookings() {
        if (this.state.spaType) {
            return [];
        }
        const day = this._spaDay();
        const booked = this._orderBookingIds();
        return this.state.spaBookings.filter(
            (b) => (b.date || "") === day && b.state === "paid" && !booked.has(b.id)
        );
    },

    async refreshSpaBookings() {
        try {
            if (this.state.spaType === "sessions") {
                this.state.spaSessions = await this.pos.data.call(
                    "spa.booking",
                    "get_pos_sessions",
                    [this.state.spaDate || false]
                );
                return;
            }
            if (!this.state.spaType) {
                this.state.spaBookings = await this.pos.data.call(
                    "spa.booking",
                    "get_pos_all_bookings",
                    []
                );
                return;
            }
            if (this.state.spaType === "today") {
                this.state.spaBookings = await this.pos.data.call(
                    "spa.booking",
                    "get_pos_today_bookings",
                    []
                );
            } else {
                this.state.spaBookings = await this.pos.data.call(
                    "spa.booking",
                    "get_pos_bookings",
                    [this.state.spaType]
                );
            }
        } catch (e) {
            console.warn("Spa bookings: load failed", e);
            this.state.spaBookings = [];
        }
    },

    // "2026-07-25 14:00:00" -> "2026-07-25 14:00"
    spaSlot(b) {
        const s = b.slot_datetime || "";
        return s ? s.slice(0, 16) : "";
    },

    spaCanLoad(b) {
        // Load = customer has arrived -> starts service. Only once approved.
        return b.state === "approved" || b.state === "in_service";
    },

    spaStateClass(b) {
        return (
            {
                pending: "text-bg-secondary",
                approved: "text-bg-warning",
                in_service: "text-bg-info",
                completed: "text-bg-primary",
                paid: "text-bg-success",
                rejected: "text-bg-danger",
            }[b.state] || "text-bg-secondary"
        );
    },

    // Channel label/badge for an order in the Orders list. A manual order that
    // isn't synced yet has no spa_channel client-side, but it defaults to 'web'
    // on the server — so show "Web" for anything unset.
    spaChannelLabel(order) {
        return { online: "Online", web: "Web", tab: "Tab" }[order.spa_channel] || "Web";
    },

    spaChannelClass(order) {
        return (
            {
                online: "text-bg-info",
                web: "text-bg-secondary",
                tab: "text-bg-primary",
            }[order.spa_channel] || "text-bg-secondary"
        );
    },

    getFilteredOrderList() {
        const base = super.getFilteredOrderList(...arguments);
        // The Online / Web / Tab tabs show bookings, not orders.
        if (this.state.spaType) {
            return [];
        }
        const hasContent = (o) =>
            o.getOrderlines().length > 0 || o.payment_ids.length > 0;
        const onDate = (o, d) =>
            o.date_order && o.date_order.toFormat("yyyy-MM-dd") === d;

        // The selected day (default today); a search term spans all dates so
        // you can still find any order by name.
        const term = (this.state.search.searchTerm || "").toLowerCase();
        const day =
            this.state.spaDate ||
            (term ? null : DateTime.now().toFormat("yyyy-MM-dd"));
        const dayOK = (o) => {
            // An in-progress (ongoing/paused) order may not have a date_order
            // stamped yet — treat it as today's, so it isn't dropped. Only hide
            // it when a specific past date is explicitly picked in the date box.
            if (!o.date_order) {
                return !this.state.spaDate;
            }
            return !day || onDate(o, day);
        };
        const ts = (o) => (o.date_order ? o.date_order.ts : Number.MAX_SAFE_INTEGER);

        // A specific dropdown filter (Paid / Ongoing / Payment / Receipt):
        // built-in list, narrowed to the same day as everything else.
        const f = this.state.filter;
        if (f && f !== "ACTIVE_ORDERS") {
            return base.filter((o) => hasContent(o) && dayOK(o));
        }

        // Default "All" view: the selected day's orders (active + paid).
        const matches = (o) =>
            !term ||
            (o.getPartnerName?.() || "").toLowerCase().includes(term) ||
            (o.pos_reference || "").toLowerCase().includes(term) ||
            (o.getName?.() || "").toLowerCase().includes(term);

        // `base` already applied the built-in search to the active orders.
        const result = base.filter((o) => hasContent(o) && dayOK(o));
        const seen = new Set(result.map((o) => o.uuid));
        const paid = this.pos.models["pos.order"].filter(
            (o) =>
                o.finalized &&
                hasContent(o) &&
                dayOK(o) &&
                matches(o) &&
                !seen.has(o.uuid)
        );
        return [...result, ...paid].sort((a, b) => ts(b) - ts(a));
    },

    // Set / adjust the appointment time (e.g. from the customer's note).
    async setSpaSlot(booking) {
        const current =
            booking.slot_datetime ||
            (booking.date ? booking.date + " 00:00:00" : "");
        const value = await makeAwaitable(this.dialog, SetSlotDialog, {
            current,
            note: booking.time_note || "",
        });
        if (!value) {
            return;
        }
        try {
            await this.pos.data.call("spa.booking", "pos_set_slot", [[booking.id], value]);
        } catch (e) {
            console.warn("Spa: set slot failed", e);
            this.env.services.notification.add("Could not set the time.", {
                type: "danger",
            });
            return;
        }
        await this.refreshSpaBookings();
    },

    // Approve / Reject / Mark Completed / Mark Paid — same transitions as the
    // back-office form. Refreshes the list so the row's status/buttons update.
    async spaBookingAction(bookingId, action) {
        try {
            await this.pos.data.call("spa.booking", "pos_booking_action", [[bookingId], action]);
        } catch (e) {
            console.warn("Spa booking action failed", e);
            this.env.services.notification.add("Could not update the booking.", {
                type: "danger",
            });
            return;
        }
        await this.refreshSpaBookings();
    },

    async loadSpaBooking(bookingId) {
        let info;
        try {
            info = await this.pos.data.call("spa.booking", "action_pos_load", [[bookingId]]);
        } catch (e) {
            console.warn("Spa booking load failed", e);
            this.env.services.notification.add("Could not load this booking.", {
                type: "danger",
            });
            return;
        }
        if (!info) {
            return;
        }

        // Reuse an existing empty order if there is one, otherwise create a
        // new one — avoids leaving stray empty "duplicate" orders behind.
        const order = this._getEmptyOrder(null);
        this.pos.selectedOrderUuid = order.uuid;
        // Carry the booking's channel onto the order for per-channel reports,
        // and link back to the booking so the channel tab shows it once.
        if (info.channel) {
            order.spa_channel = info.channel;
        }
        order.spa_booking_ref = bookingId;

        if (info.partner_id) {
            let partner = this.pos.models["res.partner"].get(info.partner_id);
            if (!partner) {
                await this.pos.data.read("res.partner", [info.partner_id]);
                partner = this.pos.models["res.partner"].get(info.partner_id);
            }
            if (partner) {
                order.setPartner(partner);
            }
        }

        const tmplIds = info.service_tmpl_ids || [];
        const missing = tmplIds.filter((id) => !this.pos.models["product.template"].get(id));
        if (missing.length) {
            await this.pos.data.read("product.template", missing);
        }

        let first = true;
        for (const tmplId of tmplIds) {
            const line = await this.pos.addLineToCurrentOrder(
                { product_tmpl_id: tmplId, qty: 1 },
                { skipSpaQuestions: true }
            );
            if (first && line && info.answers) {
                line.setCustomerNote(info.answers);
                first = false;
            }
        }

        this.pos.navigateToOrderScreen(order);
        this.env.services.notification.add("Booking loaded into the order.", {
            type: "success",
        });
    },
});
