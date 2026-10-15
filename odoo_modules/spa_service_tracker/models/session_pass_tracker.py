from odoo import _, fields, models
from odoo.exceptions import UserError


class SpaSessionPassTracker(models.Model):
    """Detail-screen fields for a package, added from THIS module.

    Deliberately not put on spa.session.pass in spa_online_booking: they exist
    only so the tracker's read-only form can show a customer block and offer
    Print Invoice, and that module should not grow fields for a report that can
    be uninstalled independently of it.

    The `tracker_` prefix keeps them out of the way of the fields the Session
    Passes screen already uses, so neither module can shadow the other's.
    """
    _inherit = 'spa.session.pass'

    tracker_customer_id = fields.Char(
        related='partner_id.spa_customer_id', string='Customer ID', readonly=True)
    tracker_phone = fields.Char(
        related='partner_id.phone', string='Phone', readonly=True)
    tracker_whatsapp = fields.Char(
        related='partner_id.whatsapp', string='WhatsApp', readonly=True)
    tracker_email = fields.Char(
        related='partner_id.email', string='Email', readonly=True)
    tracker_dob = fields.Date(
        related='partner_id.date_of_birth', string='Date of Birth', readonly=True)
    tracker_gender = fields.Selection(
        related='partner_id.gender', string='Gender', readonly=True)

    # The invoice of the order the PACKAGE was bought on - which is the document
    # that was actually paid, and so the right one to print for any visit taken
    # off it. A redeemed session raises no invoice of its own.
    tracker_invoice_id = fields.Many2one(
        related='pos_order_id.account_move', string='Invoice', readonly=True)

    def action_print_pass_invoice(self):
        """The spa invoice PDF for the order this package was bought on.

        Same report as everywhere else - `account.account_invoices` renders
        `account.report_invoice_with_payments`, which spa_online_booking already
        extends with the Therapy / Duration / Package / Assignee rows.
        """
        self.ensure_one()
        move = self.pos_order_id.account_move
        if not move:
            raise UserError(_(
                "This package has no invoice. A POS sale only creates one when "
                "Invoice is ticked at payment, so there is nothing to print "
                "for it."))
        return self.env.ref('account.account_invoices').report_action(move)
