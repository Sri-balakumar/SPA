from odoo import api, fields, models


class SpaBooking(models.Model):
    _name = 'spa.booking'
    _description = 'Spa Booking'
    _inherit = ['mail.thread', 'mail.activity.mixin']
    _order = 'create_date desc'

    name = fields.Char(string='Token', readonly=True, copy=False,
                       default='New')
    partner_name = fields.Char(string='Customer Name', required=True)
    mobile = fields.Char(string='Mobile', required=True)
    partner_id = fields.Many2one('res.partner', string='Customer')
    product_id = fields.Many2one(
        'product.template', string='Service', required=True,
        domain=[('type', '=', 'service')])
    service_id = fields.Many2one('spa.service')
    price = fields.Float()
    payment_mode = fields.Selection([
        ('online', 'Online'),
        ('offline', 'Offline (at counter)'),
    ], required=True, default='offline', tracking=True)
    source = fields.Selection([
        ('walk_in', 'Walk-in (tablet)'),
        ('online_link', 'WhatsApp Link'),
    ], default='walk_in', readonly=True)
    state = fields.Selection([
        ('pending', 'Pending Approval'),
        ('in_service', 'In Service'),
        ('completed', 'Completed'),
        ('paid', 'Paid'),
        ('rejected', 'Rejected'),
    ], default='pending', tracking=True)
    answer_ids = fields.One2many('spa.booking.answer', 'booking_id',
                                 string='Answers', readonly=True)
    answers_summary = fields.Char(
        string='Answers', compute='_compute_answers_summary')
    reject_reason = fields.Char(tracking=True)
    company_id = fields.Many2one(
        'res.company', default=lambda self: self.env.company, required=True)

    @api.depends('answer_ids.value_text', 'answer_ids.question_id')
    def _compute_answers_summary(self):
        for rec in self:
            rec.answers_summary = ' | '.join(
                '%s: %s' % (a.question_id.name, a.value_text)
                for a in rec.answer_ids if a.value_text
            )

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('name', 'New') == 'New':
                vals['name'] = self.env['ir.sequence'].next_by_code(
                    'spa.booking') or 'New'
        return super().create(vals_list)

    def action_approve(self):
        self.write({'state': 'in_service'})

    def action_reject(self):
        self.write({'state': 'rejected'})

    def action_complete(self):
        self.write({'state': 'completed'})

    def action_mark_paid(self):
        self.write({'state': 'paid'})


class SpaBookingAnswer(models.Model):
    _name = 'spa.booking.answer'
    _description = 'Spa Booking Answer'

    booking_id = fields.Many2one(
        'spa.booking', required=True, ondelete='cascade')
    question_id = fields.Many2one('spa.question', required=True)
    value_text = fields.Char(string='Answer')
