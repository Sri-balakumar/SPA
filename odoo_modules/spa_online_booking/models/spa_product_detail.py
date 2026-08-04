from odoo import fields, models


class SpaProductDetail(models.Model):
    """One detail block for a service — heading / subheading / description /
    photo(s). A service can have many (a table you 'Add a line' to), so it can
    show several sections and photos on the booking page."""
    _name = 'spa.product.detail'
    _description = 'Service Detail Block'
    _order = 'sequence, id'

    product_tmpl_id = fields.Many2one(
        'product.template', string='Service', ondelete='cascade', index=True)
    sequence = fields.Integer(default=10)
    heading = fields.Char(string='Heading', translate=True)
    subheading = fields.Char(string='Subheading', translate=True)
    description = fields.Html(
        string='Description', translate=True, sanitize=True)
    image = fields.Image(string='Main Photo', max_width=1024, max_height=1024)
    image_ids = fields.One2many(
        'spa.product.detail.image', 'detail_id', string='More Photos',
        copy=True)


class SpaProductDetailImage(models.Model):
    """An extra photo in a detail block's gallery."""
    _name = 'spa.product.detail.image'
    _description = 'Service Detail Photo'
    _order = 'sequence, id'

    detail_id = fields.Many2one(
        'spa.product.detail', string='Detail', ondelete='cascade', index=True)
    sequence = fields.Integer(default=10)
    name = fields.Char(string='Caption', translate=True)
    image = fields.Image(
        string='Photo', max_width=1024, max_height=1024, required=True)
