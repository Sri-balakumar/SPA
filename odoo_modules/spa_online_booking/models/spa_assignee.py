import logging

from odoo import _, api, fields, models
from odoo.exceptions import AccessError

_logger = logging.getLogger(__name__)

# Who may say which member of staff performed a session. Reception books the
# appointment and hands the customer over, so reception is who knows; the Spa
# Manager group implies the receptionist one, and base.group_system is the
# administrator. Nobody else can set an assignee, from the POS or the back
# office.
ASSIGN_GROUPS = ('spa_kiosk.group_spa_receptionist', 'base.group_system')


def spa_assign_required(env):
    """True when a session may not be finished without naming who gave it.

    Settings -> Spa Online Booking -> Session Assignee. Off by default, so
    installing this module never stops a till that was working a minute
    earlier; the business turns it on once its therapists have user accounts.
    """
    param = env['ir.config_parameter'].sudo().get_param(
        'spa_online_booking.assign_required')
    # get_param returns the STRING Odoo stored, and 'False' is truthy in
    # Python - the classic way this kind of flag ends up permanently on.
    return str(param).strip().lower() in ('1', 'true')


def spa_can_assign(env):
    """True when this user is allowed to assign a session to a member of staff.

    `env.su` passes so that server-side plumbing (order sync, migrations, the
    redemption path below) is never blocked by a check meant for a person.
    """
    return env.su or any(env.user.has_group(group) for group in ASSIGN_GROUPS)


class PosOrderLineAssignee(models.Model):
    """Who actually performed this session.

    The assignee lives on the LINE, not on the order: one line is one session,
    and a visit that buys a massage and a heat pack is routinely split between
    two people. An order-level field could only ever name one of them.

    NOTE: deliberately NOT added to `_load_pos_data_fields`. `res.users` is
    loaded into the POS with the domain `[('id', '=', uid)]` (see
    point_of_sale/models/res_users.py), so the register holds exactly ONE user
    record - the cashier. A many2one pointing at any other therapist would
    resolve to nothing on the client. The POS reads and writes assignees over
    `spa_assignees` / `spa_set_assignees` below instead, which also keeps the
    list correct when two tills assign at the same time.
    """
    _inherit = 'pos.order.line'

    spa_therapist_id = fields.Many2one(
        'res.users', string='Assignee', index='btree_not_null',
        ondelete='set null', copy=False,
        help="Member of staff who performed this session. Set from the POS "
             "Orders screen (Assign), by Spa Reception or an administrator.")

    @api.model_create_multi
    def create(self, vals_list):
        if not spa_can_assign(self.env) and any(
                vals.get('spa_therapist_id') for vals in vals_list):
            # Dropped, not refused. An ordinary cashier syncing an order must
            # never be stopped at the till over a field they did not touch -
            # and there is no POS path that sets this at create time anyway.
            _logger.warning(
                "%s may not assign a session; spa_therapist_id dropped on "
                "pos.order.line create.", self.env.user.login)
            vals_list = [
                {k: v for k, v in vals.items() if k != 'spa_therapist_id'}
                for vals in vals_list
            ]
        return super().create(vals_list)

    def write(self, vals):
        if 'spa_therapist_id' in vals and not spa_can_assign(self.env):
            new = vals['spa_therapist_id'] or False
            # An unchanged value is not an assignment. The POS re-syncs whole
            # orders, so a cashier's client sends back the assignee reception
            # set a moment earlier; refusing that would break order sync.
            changed = self.filtered(
                lambda line: (line.spa_therapist_id.id or False) != new)
            if changed:
                raise AccessError(_(
                    "Only Spa Reception and the administrator can assign a "
                    "session to a member of staff."))
        return super().write(vals)


class SpaBookingAssignee(models.Model):
    """The member of staff a booking is given to, chosen when it is approved.

    A booking is not an order yet - reception approves it hours before anyone
    rings it up - so it needs its own field rather than borrowing the order
    line's. It then feeds both downstream records:

      * Load into the POS  -> copied onto every line of the new order
        (`pos.order.spa_apply_booking_assignee`, called from ticket_tabs.js);
      * Session Done       -> copied onto the spa.session.pass.use row
        (`_redeem_pass_if_prepaid`), which is where a prepaid session's only
        record of the person lives.
    """
    _inherit = 'spa.booking'

    spa_therapist_id = fields.Many2one(
        'res.users', string='Assignee', index='btree_not_null',
        ondelete='set null', copy=False,
        help="Member of staff this appointment is given to. Chosen by "
             "reception when the booking is approved, and carried onto the "
             "order lines when it is loaded into the POS.")


class SpaSessionPassUseAssignee(models.Model):
    """The assignee of a redeemed prepaid session.

    Separate from `user_id`, which is whoever was logged in when the session
    was counted - normally reception, not the therapist who gave it.
    """
    _inherit = 'spa.session.pass.use'

    spa_therapist_id = fields.Many2one(
        'res.users', string='Assignee', index='btree_not_null',
        ondelete='set null',
        help="Member of staff who performed this prepaid session.")


class PosOrderAssignee(models.Model):
    _inherit = 'pos.order'

    # Assignees picked at the payment screen, as {line uuid: user id}. A
    # CARRIER, not a store: the lines have no database ids until the order
    # syncs, so the POS cannot write them itself - the same trick
    # spa_members_json and spa_signatures_json already use. Drained and
    # cleared by _process_order below.
    spa_assignees_json = fields.Text(
        string='Session Assignees (pending)', copy=False)

    def _spa_store_assignees_payload(self, payload):
        """Apply {line uuid: user id} to this order's lines.

        Matched on `uuid` rather than position: a line can be merged, split or
        removed between the picker opening and the order syncing, and an index
        would then put the wrong person against the wrong session.
        """
        self.ensure_one()
        if not isinstance(payload, dict) or not payload:
            return
        by_uuid = {line.uuid: line for line in self.lines if line.uuid}
        for key, user_id in payload.items():
            line = by_uuid.get(key)
            if line is None or not user_id:
                continue
            if line.spa_therapist_id.id != user_id:
                line.spa_therapist_id = user_id

    def _process_order(self, order, existing_order):
        """Carry the booking's assignee onto the lines it became.

        Done on SYNC, not on Load: while the cashier is building the order
        there is no server-side record to write to, and the POS never carries
        `spa_therapist_id` in its own line data (see the note above).

        Only EMPTY assignees are filled, so a per-line choice made in the
        Assign dialog is never overwritten by the booking's default.
        """
        order_id = super()._process_order(order, existing_order)
        rec = self.browse(order_id).sudo()
        if not rec.exists():
            return order_id
        # What the cashier picked at the payment screen wins over the
        # booking's default below, so it is applied first.
        rec._spa_drain('spa_assignees_json', rec._spa_store_assignees_payload)
        if not rec.spa_booking_ref:
            return order_id
        booking = self.env['spa.booking'].sudo().browse(
            rec.spa_booking_ref).exists()
        if booking and booking.spa_therapist_id:
            blank = rec.lines.filtered(lambda line: not line.spa_therapist_id)
            if blank:
                blank.spa_therapist_id = booking.spa_therapist_id.id
        return order_id

    @api.model
    def spa_assignable_staff(self):
        """Everything the POS Assign dialog needs, in one call.

        `can_assign` rides along so the button can be hidden for a cashier
        rather than only failing when they press it.
        """
        users = self.env['res.users'].sudo().search(
            [('share', '=', False), ('active', '=', True)], order='name')
        return {
            'can_assign': spa_can_assign(self.env),
            'required': spa_assign_required(self.env),
            'staff': [{'id': user.id, 'name': user.name or ''} for user in users],
        }

    def spa_assignees(self):
        """`{order_id: [{line_id, product, user_id, user_name}, ...]}`.

        Read with sudo: a cashier has no read access to res.users beyond
        themselves, and the card has to be able to print the name of whoever
        reception put against the line.
        """
        result = {}
        for order in self.sudo():
            result[order.id] = [{
                'line_id': line.id,
                'product': (line.full_product_name
                            or line.product_id.display_name or ''),
                'user_id': line.spa_therapist_id.id or False,
                'user_name': line.spa_therapist_id.name or '',
            } for line in order.lines]
        return result

    def spa_set_assignees(self, mapping):
        """Write one assignee per line. `mapping` is `{line_id: user_id|false}`.

        Only lines of THIS order are touched - the ids come from the browser,
        so an arbitrary line id in the payload must not be writable through it.
        """
        self.ensure_one()
        if not spa_can_assign(self.env):
            raise AccessError(_(
                "Only Spa Reception and the administrator can assign a "
                "session to a member of staff."))
        order = self.sudo()
        own_lines = {line.id: line for line in order.lines}
        for key, value in (mapping or {}).items():
            # JSON object keys arrive as strings.
            try:
                line_id = int(key)
            except (TypeError, ValueError):
                continue
            line = own_lines.get(line_id)
            if line is None:
                continue
            user_id = int(value) if value else False
            if (line.spa_therapist_id.id or False) != user_id:
                line.spa_therapist_id = user_id
        return order.spa_assignees()[order.id]
