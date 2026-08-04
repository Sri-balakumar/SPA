{
    'name': 'Spa Online Booking',
    'version': '19.0.4.0.0',
    'summary': 'Public WhatsApp-link booking flow: JSON API + static booking page',
    'category': 'Services',
    # 'spa_kiosk' is the technical folder name of the team's existing module.
    # 'pos_spa_header' owns the POS top bar we add the "Bookings" button to.
    # 'product' for product.product_template_form_view (product_template_details_views.xml)
    # 'whatsapp_neonize' for whatsapp.session.send_message() - booking links go
    # out directly on our own WhatsApp session.
    'depends': ['base', 'web', 'product', 'account', 'spa_kiosk',
                'point_of_sale', 'pos_spa_header', 'whatsapp_neonize'],
    'external_dependencies': {'python': ['phonenumbers']},
    'data': [
        'security/ir.model.access.csv',
        'views/booking_session_views.xml',
        'views/res_config_settings_views.xml',
        'views/booking_workflow_views.xml',
        'views/booking_signature_views.xml',
        'views/pos_order_channel_views.xml',
        'views/product_template_details_views.xml',
        'views/pos_category_therapy_views.xml',
        'views/spa_question_therapy_views.xml',
        'views/session_pass_views.xml',
        'views/res_partner_spa_views.xml',
        'report/pos_sales_report.xml',
        # Starter catalogue: therapies, session packages and their questions.
        # Listed as DATA, not demo — Odoo only reads the 'demo' key when a
        # database is CREATED with demonstration data, so on an existing
        # database a demo file never loads and the tablet finds no services.
        # The records are noupdate="1", so edits made in Odoo survive upgrades.
        'data/spa_starter_catalogue.xml',
    ],
    'assets': {
        'point_of_sale._assets_pos': [
            'spa_online_booking/static/src/pos/phone_country.js',
            'spa_online_booking/static/src/pos/send_link_dialog.js',
            'spa_online_booking/static/src/pos/send_link_dialog.xml',
            'spa_online_booking/static/src/pos/set_slot_dialog.js',
            'spa_online_booking/static/src/pos/set_slot_dialog.xml',
            'spa_online_booking/static/src/pos/navbar_bookings.js',
            'spa_online_booking/static/src/pos/navbar_bookings.xml',
            'spa_online_booking/static/src/pos/ticket_tabs.js',
            'spa_online_booking/static/src/pos/ticket_tabs.xml',
            'spa_online_booking/static/src/pos/therapy_booking_dialog.js',
            'spa_online_booking/static/src/pos/therapy_booking_dialog.xml',
            'spa_online_booking/static/src/pos/navbar_therapy.js',
            'spa_online_booking/static/src/pos/navbar_therapy.xml',
            'spa_online_booking/static/src/pos/session_pass_dialog.js',
            'spa_online_booking/static/src/pos/session_pass_dialog.xml',
            'spa_online_booking/static/src/pos/navbar_redeem.js',
            'spa_online_booking/static/src/pos/customer_info_dialog.js',
            'spa_online_booking/static/src/pos/customer_info_dialog.xml',
            'spa_online_booking/static/src/pos/navbar_customer.js',
            'spa_online_booking/static/src/pos/new_question_dialog.js',
            'spa_online_booking/static/src/pos/new_question_dialog.xml',
            'spa_online_booking/static/src/pos/navbar_questions.js',
            'spa_online_booking/static/src/pos/spa_signature.js',
            'spa_online_booking/static/src/pos/spa_signature.xml',
            'spa_online_booking/static/src/pos/spa_sign_dialog.js',
            'spa_online_booking/static/src/pos/spa_sign_dialog.xml',
            'spa_online_booking/static/src/pos/spa_sign_order.js',
            'spa_online_booking/static/src/pos/therapy_screen.js',
            'spa_online_booking/static/src/pos/therapy_screen.xml',
            'spa_online_booking/static/src/pos/product_screen_therapy.js',
            'spa_online_booking/static/src/pos/product_screen_brand.xml',
            'spa_online_booking/static/src/pos/control_buttons_therapy.xml',
            'spa_online_booking/static/src/pos/therapy_pos.css',
            'spa_online_booking/static/src/pos/sales_report_dialog.js',
            'spa_online_booking/static/src/pos/sales_report_dialog.xml',
            'spa_online_booking/static/src/pos/navbar_report.js',
            'spa_online_booking/static/src/pos/navbar_report.xml',
        ],
    },
    'installable': True,
    'application': False,
    'author': 'Danat',
    'license': 'LGPL-3',
}
