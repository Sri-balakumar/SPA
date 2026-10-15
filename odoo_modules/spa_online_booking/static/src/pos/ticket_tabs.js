import { patch } from "@web/core/utils/patch";
import { TicketScreen } from "@point_of_sale/app/screens/ticket_screen/ticket_screen";
import { onMounted } from "@odoo/owl";
import { makeAwaitable } from "@point_of_sale/app/utils/make_awaitable_dialog";
import { ConfirmationDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { SetSlotDialog } from "@spa_online_booking/pos/set_slot_dialog";
import { SpaAssignDialog } from "@spa_online_booking/pos/spa_assign_dialog";

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
        // Who performed each session, per order: { orderId: [ {line_id,
        // product, user_id, user_name}, ... ] }. Fetched rather than loaded
        // with the order, because res.users reaches the POS as the cashier
        // ALONE - see the note on pos.order.line.spa_therapist_id.
        this.state.spaAssignees = {};
        // The staff the Assign pickers offer, and whether this user may assign
        // at all (Spa Reception / administrator). Both come from one call.
        this.state.spaStaff = [];
        this.state.spaCanAssign = false;
        // Mirrors the "Assignee mandatory" setting. Only when this is on does
        // Session Done refuse an unassigned session.
        this.state.spaAssignRequired = false;
        // Assignee chosen inline on a pending prepaid session card, before
        // "Session Done" counts it: { bookingId: userId|"" }.
        this.state.spaSessionAssignee = {};
        // Fetch the day's paid orders so the "All" tab can show them next to
        // the active (unpaid) ones the POS already keeps in memory.
        onMounted(async () => {
            await this.loadSpaStaff();
            await this.refreshSpaBookings();
            await this.loadDayOrders();
        });
    },

    // The assignable staff list + this user's right to assign. Once per visit
    // to the screen: it changes about as often as the staff rota does, and the
    // server re-checks the group on every write anyway.
    async loadSpaStaff() {
        // Shared with the payment gate and the Redeem dialog, so all three
        // agree about the policy and only one round trip is made.
        const info = await this.pos.spaLoadAssignStaff();
        this.state.spaStaff = (info && info.staff) || [];
        this.state.spaCanAssign = !!(info && info.can_assign);
        this.state.spaAssignRequired = !!(info && info.required);
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
            : this.spaZoned(DateTime.now());
        if (!d.isValid) {
            return;
        }
        const day = d.toFormat("yyyy-MM-dd");
        try {
            await this.pos.data.loadServerOrders([
                ["config_id", "=", this.pos.config.id],
                ["state", "!=", "draft"],
                // Either rung up around this day, OR due on it. Without the
                // second branch an order paid weeks before its appointment is
                // never fetched, so picking the appointment date would still
                // show nothing however the list is filtered afterwards.
                // Naive local bounds on the slot, because that is how it is
                // stored - same split get_pos_today_bookings documents.
                "|",
                "&",
                ["date_order", ">=", d.minus({ days: 7 }).toFormat("yyyy-MM-dd") + " 00:00:00"],
                ["date_order", "<=", d.plus({ days: 1 }).toFormat("yyyy-MM-dd") + " 23:59:59"],
                "&",
                ["spa_slot_datetime", ">=", day + " 00:00:00"],
                ["spa_slot_datetime", "<=", day + " 23:59:59"],
            ]);
        } catch (e) {
            console.warn("Spa: failed to load the day's orders", e);
        }
        await this.refreshSpaAssignees();
    },

    // Who performed each session, for every synced order the register is
    // holding. `loadDayOrders` has already narrowed the server side to the
    // selected day, so this is the day's orders plus whatever is open at the
    // till - a handful of rows, not the whole history.
    async refreshSpaAssignees() {
        // getAll(), not a spread: pos.models[...] is a Model instance and has
        // no Symbol.iterator - `for...of` over it throws.
        const ids = this.pos.models["pos.order"]
            .getAll()
            .filter((o) => o.id > 0)
            .map((o) => o.id);
        if (!ids.length) {
            this.state.spaAssignees = {};
            return;
        }
        try {
            this.state.spaAssignees = await this.pos.data.call(
                "pos.order", "spa_assignees", [ids]
            );
        } catch (e) {
            console.warn("Spa: failed to load session assignees", e);
        }
    },

    // The rows for one order's card, or [] while they are still loading.
    // A saved order is answered by the server (state.spaAssignees); an ONGOING
    // one has no server id, so its rows are built from the lines in memory and
    // whatever has been parked on it for the sync.
    spaOrderAssignees(o) {
        if (!o) {
            return [];
        }
        if (o.id > 0) {
            return this.state.spaAssignees[o.id] || [];
        }
        return this.spaLocalAssigneeRows(o);
    },

    // What the POS has parked for an unsaved order: { lineUuid: userId }.
    spaParkedAssignees(o) {
        try {
            return JSON.parse(o.spa_assignees_json || "{}") || {};
        } catch {
            return {};
        }
    },

    // Same row shape the server returns, built client-side. `line_id` carries
    // the line UUID rather than an id — that is what the carrier is keyed on,
    // and pos.order._spa_store_assignees_payload matches it back on sync.
    spaLocalAssigneeRows(o) {
        const parked = this.spaParkedAssignees(o);
        return (o.lines || []).map((line) => {
            const userId = parked[line.uuid] || false;
            const user = userId
                ? this.state.spaStaff.find((u) => u.id === userId)
                : null;
            return {
                line_id: line.uuid,
                product:
                    line.getFullProductName?.() || line.full_product_name || "",
                user_id: userId,
                user_name: user ? user.name : "",
            };
        });
    },

    // One line for the card: "Aisha — GO Ease, Rana — Heat Pack", or the names
    // alone when there is only one session on the order.
    spaAssigneeLabel(o) {
        const rows = this.spaOrderAssignees(o);
        if (!rows.length) {
            return "";
        }
        const named = rows.filter((r) => r.user_name);
        if (!named.length) {
            return "Unassigned";
        }
        if (rows.length === 1) {
            return named[0].user_name;
        }
        const parts = named.map((r) => `${r.user_name} — ${r.product}`);
        const missing = rows.length - named.length;
        if (missing) {
            parts.push(`${missing} unassigned`);
        }
        return parts.join(", ");
    },

    // Muted grey normally, amber while nobody has been put against the order,
    // so an unassigned visit is visible without blocking anything.
    spaAssigneeClass(o) {
        const rows = this.spaOrderAssignees(o);
        return rows.length && !rows.some((r) => r.user_name)
            ? "sg-meta--unassigned"
            : "";
    },

    // "Assign" on an order card: one picker per session, saved in one write.
    async spaAssignOrder(o) {
        const rows = this.spaOrderAssignees(o);
        if (!rows.length) {
            this.env.services.notification.add(
                "This order has no sessions to assign.",
                { type: "warning" }
            );
            return;
        }
        const payload = await makeAwaitable(this.dialog, SpaAssignDialog, {
            rows,
            staff: this.state.spaStaff,
            title: `Assign Sessions — ${o.pos_reference || ""}`,
        });
        if (!payload) {
            return;
        }
        // An ongoing order has no server record to write to. Park the pick on
        // the order instead; pos.order._process_order applies it the moment
        // the order syncs, matching lines on the UUIDs used as keys here.
        if (!(o.id > 0)) {
            const parked = { ...this.spaParkedAssignees(o), ...payload };
            for (const key of Object.keys(parked)) {
                if (!parked[key]) {
                    delete parked[key];
                }
            }
            o.spa_assignees_json = JSON.stringify(parked);
            return;
        }
        try {
            const updated = await this.pos.data.call(
                "pos.order", "spa_set_assignees", [[o.id], payload]
            );
            this.state.spaAssignees = {
                ...this.state.spaAssignees,
                [o.id]: updated,
            };
        } catch (e) {
            console.warn("Spa: failed to save the assignees", e);
            this.env.services.notification.add(
                "Could not save the assignees. Only Spa Reception and the " +
                    "administrator can assign a session.",
                { type: "danger" }
            );
        }
    },

    // ---- the clock these cards print on ---------------------------------
    //
    // The COMPANY's, taken from its country and shipped with the company record
    // (res_company.spa_display_tz). Left to itself luxon uses the BROWSER's OS
    // timezone, so a till opened from India showed an Oman order 1h30 late -
    // and disagreed with the server-rendered dates in Customer Details, which
    // are on this same clock now.
    //
    // Empty when the POS loaded before this field existed: IndexedDB keeps the
    // old copy of the company and Ctrl+F5 does not clear it. Everything then
    // falls back to the browser zone, i.e. exactly the old behaviour.
    spaTz() {
        return this.pos.config?.company_id?.spa_display_tz || "";
    },
    // A luxon DateTime moved onto that clock, or left alone when there is none.
    spaZoned(dt) {
        const tz = this.spaTz();
        if (!dt || !tz) {
            return dt;
        }
        const zoned = dt.setZone(tz);
        return zoned.isValid ? zoned : dt;
    },
    // "Now" on the company's clock, as YYYY-MM-DD.
    spaToday() {
        return this.spaZoned(DateTime.now()).toFormat("yyyy-MM-dd");
    },

    _spaDay() {
        return this.state.spaDate || this.spaToday();
    },

    // The day an order is filed under by the date filter: its APPOINTMENT when
    // it has one, so a rescheduled order moves to the new date instead of
    // staying on the day it was paid, and the day it was rung up otherwise.
    // Exactly the rule spa.booking already applies server side, in
    // _pos_booking_data (pos_booking.py) - orders simply never got it.
    //
    // `raw` is the unconverted "YYYY-MM-DD HH:MM:SS" string straight from the
    // server. spa_slot_datetime holds naive LOCAL wall clock in a UTC column,
    // so the ORM getter shifts it by the timezone offset and would file an
    // evening appointment on the wrong day. date_order IS genuine UTC, so its
    // converted value is the right thing to read.
    spaOrderDay(o) {
        const slot = o.raw?.spa_slot_datetime;
        if (slot) {
            return String(slot).slice(0, 10);
        }
        return o.date_order ? this.spaZoned(o.date_order).toFormat("yyyy-MM-dd") : "";
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

    // A rescheduled order is listed in the Rescheduled tab and NOWHERE else, so
    // a moved appointment is never shown twice on the same day. Same idea as
    // _orderBookingIds() below, which drops a booking from the booking lists
    // once it has become an order.
    spaInOrdinaryLists(o) {
        return !o.spa_rescheduled;
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
                    this.spaInOrdinaryLists(o) &&
                    (o.spa_channel || "web") === this.state.spaType &&
                    (o.getOrderlines().length > 0 || o.payment_ids.length > 0) &&
                    this.spaOrderDay(o) === day
            )
            .sort((a, b) => b.date_order.ts - a.date_order.ts);
    },

    // The "Rescheduled" tab: orders whose appointment has been moved, across
    // all channels, filed under their NEW date by spaOrderDay().
    //
    // Day-scoped exactly like spaChannelOrders() - the picked date, else today
    // - so every tab answers the same question about dates and a moved
    // appointment is found where the customer is actually due in.
    spaRescheduledOrders() {
        const day = this._spaDay();
        return this.pos.models["pos.order"]
            .filter(
                (o) =>
                    o.spa_rescheduled &&
                    (o.getOrderlines().length > 0 || o.payment_ids.length > 0) &&
                    this.spaOrderDay(o) === day
            )
            .sort((a, b) =>
                String(a.raw?.spa_slot_datetime || "").localeCompare(
                    String(b.raw?.spa_slot_datetime || "")
                )
            );
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
                this.spaInOrdinaryLists(o) &&
                (o.spa_channel || "web") === this.state.spaType &&
                !o.finalized &&
                o.state !== "cancel" &&
                (o.getOrderlines().length > 0 || o.payment_ids.length > 0) &&
                (!picked || this.spaOrderDay(o) === picked)
        );
    },

    // ---- branded order/booking card helpers ----
    spaOrderDate(o) {
        return o.date_order ? this.spaZoned(o.date_order).toFormat("dd LLL yyyy") : "";
    },
    spaOrderTime(o) {
        return o.date_order ? this.spaZoned(o.date_order).toFormat("h:mm a") : "";
    },

    // The appointment, shown ALONGSIDE the order date rather than replacing it:
    // "Date/Time" on this card has always meant when the order was paid, and
    // quietly changing that would misread every historical row. Empty for an
    // order with no appointment, and the card then looks exactly as before.
    spaOrderSlot(o) {
        // Read the RAW value, not o.spa_slot_datetime: the slot is naive local
        // wall clock stored in a UTC column, so the ORM getter adds the
        // timezone offset and printed an 11:13 appointment as 4:43 PM. The
        // booking card has always shown the raw value (spaBookingWhen), so
        // going through the same string keeps the two cards agreeing - and
        // agreeing with the day spaOrderDay() files the order under.
        const raw = o.raw?.spa_slot_datetime || o.spa_slot_datetime;
        if (!raw) {
            return "";
        }
        if (typeof raw === "string") {
            const dt = DateTime.fromSQL(raw.replace("T", " "));
            return dt.isValid
                ? dt.toFormat("dd LLL yyyy, h:mm a")
                : raw.slice(0, 16).replace("T", " ");
        }
        return raw.toFormat ? raw.toFormat("dd LLL yyyy, h:mm a") : String(raw);
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
        // Queuing, not confirmed - keep it visually quieter than a real
        // appointment so the two are never mistaken for each other.
        if (b.state === "waiting") {
            return "sg-pill--grey";
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

    // "Family 2" when the order carries a family package, else "".
    //
    // Read off spa_member_type, NOT the line name. The name is stored with a
    // " - Family 2" suffix server-side, but core rebuilds full_product_name
    // from product.name + attributes every time a line is instantiated in the
    // browser (constructFullProductName), so the suffix is gone by the time
    // this card renders. The field survives.
    spaOrderMemberType(o) {
        for (const line of o.getOrderlines()) {
            // spa.member.type is loaded into the POS session, so the record is
            // right here - no labels map to keep in step with the backend.
            const type = line.spa_member_type;
            if (type && !type.is_individual) {
                return type.name || "";
            }
        }
        return "";
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
        const today = this.spaToday();
        // When a specific date is picked in the filter, scope EVERY section to
        // that day, so the list shows the chosen date's bookings instead of the
        // current day's. The today/upcoming split is then relative to the
        // picked day. With no date picked, behave as before (relative to today).
        const picked = this.state.spaDate;
        const ref = picked || today;
        const g = { waiting: [], pending: [], today: [], upcoming: [], completed: [] };
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
            if (b.state === "waiting") {
                g.waiting.push(b);
            } else if (b.state === "pending") {
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
        // The queue is first-come-first-served, and that is the order the slot
        // is handed on in, so show it that way rather than by appointment time.
        g.waiting.sort((a, b) =>
            String(a.create_date || "").localeCompare(String(b.create_date || "")) ||
            a.id - b.id
        );
        return g;
    },

    // Position in the queue for a waiting booking, so reception can see at a
    // glance who gets the slot next if the holder cancels.
    spaQueuePosition(booking) {
        const sameSlot = this.spaGroups().waiting.filter(
            (b) => (b.slot_datetime || "") === (booking.slot_datetime || "")
        );
        const i = sameSlot.findIndex((b) => b.id === booking.id);
        return i < 0 ? "" : `#${i + 1}`;
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
        await this._loadSpaBookings();
        this._seedSpaSessionAssignees();
    },

    // Preselect each card's picker with the assignee already on the booking,
    // so re-rendering the list does not make a saved choice look unset. Only
    // untouched cards are seeded: a pick made but not yet submitted (reception
    // choosing, then reading the notes before pressing Approve) must survive
    // the periodic refresh.
    _seedSpaSessionAssignees() {
        for (const b of this.state.spaBookings || []) {
            if (!(b.id in this.state.spaSessionAssignee)) {
                this.state.spaSessionAssignee[b.id] = b.assignee_id || 0;
            }
        }
        for (const b of (this.state.spaSessions && this.state.spaSessions.pending) || []) {
            if (!(b.id in this.state.spaSessionAssignee)) {
                this.state.spaSessionAssignee[b.id] = b.assignee_id || 0;
            }
        }
    },

    // Everything up to the seeding above. Split out because the fetch has
    // several early returns, and each one has to be followed by the seeding.
    async _loadSpaBookings() {
        try {
            if (this.state.spaType === "sessions") {
                this.state.spaSessions = await this.pos.data.call(
                    "spa.booking",
                    "get_pos_sessions",
                    [this.state.spaDate || false]
                );
                return;
            }
            // Rescheduled lists pos.order records that loadDayOrders() already
            // brought in - there are no bookings to fetch. Without this the
            // call below would ask get_pos_bookings('rescheduled'), which the
            // server rejects as an unknown channel.
            if (this.state.spaType === "rescheduled") {
                this.state.spaBookings = [];
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
        // Appointment day when there is one, else the day it was rung up -
        // see spaOrderDay().
        const onDate = (o, d) => this.spaOrderDay(o) === d;

        // The selected day (default today); a search term spans all dates so
        // you can still find any order by name.
        const term = (this.state.search.searchTerm || "").toLowerCase();
        const day =
            this.state.spaDate ||
            (term ? null : this.spaToday());
        const dayOK = (o) => {
            // An in-progress (ongoing/paused) order may have neither an
            // appointment nor a date_order stamped yet — treat it as today's,
            // so it isn't dropped. Only hide it when a specific past date is
            // explicitly picked in the date box.
            if (!this.spaOrderDay(o)) {
                return !this.state.spaDate;
            }
            return !day || onDate(o, day);
        };
        const ts = (o) => (o.date_order ? o.date_order.ts : Number.MAX_SAFE_INTEGER);
        // Everything the All tab will list. Kept separate from dayOK, which
        // answers only "is this on the selected day" - a rescheduled order is
        // excluded whatever the day, because it belongs to its own tab.
        const listable = (o) =>
            this.spaInOrdinaryLists(o) && hasContent(o) && dayOK(o);

        // A specific dropdown filter (Paid / Ongoing / Payment / Receipt):
        // built-in list, narrowed to the same day as everything else.
        const f = this.state.filter;
        if (f && f !== "ACTIVE_ORDERS") {
            return base.filter(listable);
        }

        // Default "All" view: the selected day's orders (active + paid).
        const matches = (o) =>
            !term ||
            (o.getPartnerName?.() || "").toLowerCase().includes(term) ||
            (o.pos_reference || "").toLowerCase().includes(term) ||
            (o.getName?.() || "").toLowerCase().includes(term);

        // `base` already applied the built-in search to the active orders.
        const result = base.filter(listable);
        const seen = new Set(result.map((o) => o.uuid));
        const paid = this.pos.models["pos.order"].filter(
            (o) => o.finalized && listable(o) && matches(o) && !seen.has(o.uuid)
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

    // Move a PAID order's appointment to another day: the customer paid, then
    // could not come. Same dialog as setSpaSlot, but the work happens on the
    // order because a counter sale has no booking yet - the backend creates one
    // to hold the new date. The payment itself is never touched.
    async spaRescheduleOrder(order) {
        // Pre-fill with the appointment if this order already has one, else the
        // day it was rung up - a sensible starting point either way.
        const current =
            (order.raw && order.raw.spa_slot_datetime) ||
            (order.date_order
                ? this.spaZoned(order.date_order).toFormat("yyyy-LL-dd HH:mm:ss")
                : "");
        const value = await makeAwaitable(this.dialog, SetSlotDialog, {
            current,
            note: "",
        });
        if (!value) {
            return;
        }
        try {
            const res = await this.pos.data.call(
                "pos.order", "pos_reschedule", [[order.id], value]
            );
            if (res && res.error) {
                this.env.services.notification.add(res.error, { type: "danger" });
                return;
            }
            this.env.services.notification.add(
                res && res.target_taken
                    ? `Moved to ${res.slot}. Note: that time already has an appointment.`
                    : `Appointment moved to ${res.slot}.`,
                { type: res && res.target_taken ? "warning" : "success" }
            );
        } catch (e) {
            // Log it: a swallowed exception here leaves nothing to diagnose.
            console.error("Spa: reschedule failed", e);
            this.env.services.notification.add("Could not reschedule this order.", {
                type: "danger",
            });
            return;
        }
        await this.refreshSpaBookings();
        await this.loadDayOrders();
    },

    // The date this order's appointment had before the last reschedule, as the
    // raw "YYYY-MM-DD HH:MM:SS" string, or "". Read from `raw` for the same
    // reason spaOrderDay() does: the server stores naive local wall clock in
    // that column, so the luxon-converted getter would shift an evening
    // appointment by a day.
    spaPrevSlot(order) {
        return (order.raw && order.raw.spa_prev_slot_datetime) || "";
    },

    // Whether this button steps the appointment back or cancels it outright.
    spaCanUndo(order) {
        return Boolean(this.spaPrevSlot(order));
    },

    spaRemoveLabel(order) {
        return this.spaCanUndo(order) ? "Undo" : "Remove";
    },

    spaRemoveTitle(order) {
        return this.spaCanUndo(order)
            ? `Put this appointment back to ${this.spaPrevSlot(order).slice(0, 16)}`
            : "Cancel this appointment and free the time slot";
    },

    // One button, two jobs, chosen by whether there is a date to go back to.
    // Reschedule moved it; this steps it back, or drops it when there is nowhere
    // to step to. The server decides - this only asks the right question first.
    async spaRemoveAppointment(order) {
        const prev = this.spaPrevSlot(order).slice(0, 16);
        const confirmed = await makeAwaitable(this.dialog, ConfirmationDialog, {
            title: prev ? "Move appointment back?" : "Remove appointment?",
            body: prev
                ? `This puts the appointment back to ${prev}. The time it is ` +
                  "on now is freed for the waiting list. The payment on this " +
                  "order is not affected."
                : "This cancels the booking and frees its time slot. " +
                  "Anyone on the waiting list for that time will be given it. " +
                  "The payment on this order is not affected.",
            confirmLabel: prev ? "Move back" : "Remove",
        });
        if (!confirmed) {
            return;
        }
        try {
            const res = await this.pos.data.call(
                "pos.order", "pos_remove_appointment", [[order.id]]
            );
            if (res && res.error) {
                this.env.services.notification.add(res.error, { type: "danger" });
                return;
            }
            if (res && res.undone) {
                // Same warning the forward path gives: going back can land on a
                // slot the waiting list has since been given.
                this.env.services.notification.add(
                    res.target_taken
                        ? `Appointment moved back to ${res.slot}. Note: that time already has an appointment.`
                        : `Appointment moved back to ${res.slot}.`,
                    { type: res.target_taken ? "warning" : "success" }
                );
            } else {
                this.env.services.notification.add(
                    res && res.was
                        ? `Appointment removed (was ${res.was}). The slot is free again.`
                        : "Appointment removed.",
                    { type: "success" }
                );
            }
        } catch (e) {
            console.error("Spa: remove appointment failed", e);
            this.env.services.notification.add("Could not update the appointment.", {
                type: "danger",
            });
            return;
        }
        await this.refreshSpaBookings();
        await this.loadDayOrders();
    },

    // Who this booking is down to, as an id — the pick reception has just made
    // if there is one, otherwise whatever is already saved on the booking
    // (set at Approve, or by the Redeem dialog). Falling back to the saved
    // value matters for a cashier: they cannot assign, so their picker is
    // never rendered, and without this "Session Done" would look permanently
    // disabled to them even on a session reception had already assigned.
    spaSessionAssignee(b) {
        return this.state.spaSessionAssignee[b.id] || b.assignee_id || 0;
    },

    // Inline picker on a pending prepaid session card. Stored as a NUMBER, so
    // the template can mark the chosen option with `=== user.id` - OWL has no
    // `String` in its template scope to convert the other way.
    setSpaSessionAssignee(bookingId, ev) {
        this.state.spaSessionAssignee[bookingId] = parseInt(ev.target.value, 10) || 0;
    },

    // Approve / Reject / Mark Completed / Mark Paid — same transitions as the
    // back-office form. Refreshes the list so the row's status/buttons update.
    async spaBookingAction(bookingId, action) {
        // The picked assignee rides along on EVERY transition, not just
        // session_done: Approve is where reception decides who is taking the
        // customer, and the server records it on the booking either way.
        // Blank is allowed - assigning never blocks a transition.
        const assigneeId = this.state.spaSessionAssignee[bookingId] || false;
        try {
            await this.pos.data.call("spa.booking", "pos_booking_action", [
                [bookingId],
                action,
                assigneeId,
            ]);
        } catch (e) {
            console.warn("Spa booking action failed", e);
            // Show the server's own words when it has any. The unassigned
            // "Session Done" refusal explains WHY it is refused, and replacing
            // that with "Could not update the booking" would leave reception
            // pressing a button that silently does nothing.
            const detail = (e && e.data && e.data.message) || (e && e.message) || "";
            this.env.services.notification.add(
                detail || "Could not update the booking.",
                { type: "danger" }
            );
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
        // Carry the appointment across too. The order card shows date_order,
        // which is when it was PAID - without this the time the customer is
        // actually due in never reaches the order, and the booking that holds
        // it is hidden from the lists as soon as this link is made.
        if (info.slot_datetime) {
            order.spa_slot_datetime = info.slot_datetime;
        }

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
        // Extras chosen online. Loaded in the same pass so a product the POS
        // has never shown is fetched once, but added as its own plain line.
        const addonIds = info.addon_tmpl_ids || [];
        const missing = [...tmplIds, ...addonIds].filter(
            (id) => !this.pos.models["product.template"].get(id)
        );
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

        for (const addonId of addonIds) {
            // No skipSpaQuestions games and no member-type label: an add-on is
            // an ordinary product, so it goes on at its own list price.
            await this.pos.addLineToCurrentOrder(
                { product_tmpl_id: addonId, qty: 1 },
                { skipSpaQuestions: true }
            );
        }

        this.pos.navigateToOrderScreen(order);
        this.env.services.notification.add("Booking loaded into the order.", {
            type: "success",
        });
    },
});
