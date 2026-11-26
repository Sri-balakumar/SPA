{
    'name': 'Spa WhatsApp Bridge',
    'version': '19.0.1.0.0',
    'summary': "Send invoices to the customer's own WhatsApp number as well as their phone",
    'category': 'Services',
    # spa_kiosk owns res.partner.whatsapp - the tablet saves a WhatsApp number
    # there with its own country code, an Omani mobile can come with a foreign
    # WhatsApp. whatsapp_email sends the invoice / payment receipt PDFs, but
    # only ever to partner.phone, so that number was never used.
    #
    # A module of its own rather than code in spa_online_booking, which names
    # no WhatsApp module on purpose (see its manifest), and rather than an edit
    # to whatsapp_email, which is shared with other clients. auto_install puts
    # it in wherever both sides are installed, and nowhere else.
    #
    # Python overrides only: no fields, no data, nothing to migrate.
    'depends': ['spa_kiosk', 'whatsapp_email'],
    'data': [],
    'installable': True,
    'application': False,
    'auto_install': True,
    'author': 'Danat',
    'license': 'LGPL-3',
}
