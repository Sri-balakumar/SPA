{
    'name': 'Spa Online Booking',
    'version': '19.0.14.6.0',
    'summary': 'Public WhatsApp-link booking flow: JSON API + static booking page',
    'category': 'Services',
    # 'spa_kiosk' is the technical folder name of the team's existing module.
    # 'pos_spa_header' owns the POS top bar we add the "Bookings" button to.
    # 'product' for product.product_template_form_view (product_template_details_views.xml)
    #
    # NO WhatsApp module is declared, on purpose. Booking links go out on a
    # WhatsApp session when one is available, but which module provides that
    # session differs per deployment (whatsapp_gateway here, a different build
    # elsewhere), and naming one makes this module uninstallable everywhere
    # else. The integration is probed at runtime instead - see
    # models/booking_session.py.
    #
    # The contract expected of ANY WhatsApp module, when present:
    #   model   whatsapp.session
    #   fields  active, name, status  (status == 'connected' means it can send)
    #   method  send_message(number, body)
    # Anything richer - get_connected_session(), _refresh_state() - is probed
    # with hasattr and skipped when absent. With no such module installed the
    # booking link is still created, shown and copyable; only automatic sending
    # is unavailable, and it says so.
    'depends': ['base', 'web', 'product', 'account', 'spa_kiosk',
                'point_of_sale', 'pos_spa_header'],
    'external_dependencies': {'python': ['phonenumbers']},
    'data': [
        'security/ir.model.access.csv',
        'data/spa_customer_sequence.xml',
        # No catalogue is seeded here, on purpose. This module used to ship
        # four therapies, sixteen packages and their questions as ordinary
        # module data, so every database got someone else's price list whether
        # they wanted it or not. A fresh install now starts empty and the
        # booking page says so; `data/spa_member_type.xml` is kept on disk,
        # unloaded, as a template for anyone who wants those four types back.
        #
        # Note the old records are NOT deleted by dropping those lines: they
        # were loaded noupdate="1" and ir.model.data._process_end skips those.
        # Settings > Spa Online Booking > Remove Starter Data clears them.
        #
        # Loaded before the therapy view: that view's Copy button references
        # this action by id, so the action has to exist first.
        'wizards/copy_questions_wizard_views.xml',
        'wizards/starter_cleanup_wizard_views.xml',
        'views/booking_session_views.xml',
        'views/res_config_settings_views.xml',
        'views/booking_workflow_views.xml',
        'views/booking_signature_views.xml',
        'views/pos_order_channel_views.xml',
        'views/product_template_details_views.xml',
        'views/product_category_addon_views.xml',
        'views/spa_member_type_views.xml',
        'views/pos_category_therapy_views.xml',
        'views/spa_question_therapy_views.xml',
        'views/session_pass_views.xml',
        'views/res_partner_spa_views.xml',
        'report/pos_sales_report.xml',
        'report/invoice_spa_details.xml',
    ],
    'assets': {
        # Backend only: the always-visible editor toolbar for the therapy's
        # disclaimer field. Nothing here is needed inside the POS bundle.
        'web.assets_backend': [
            'spa_online_booking/static/src/fields/disclaimer_html_field.js',
            'spa_online_booking/static/src/fields/disclaimer_html_field.xml',
            'spa_online_booking/static/src/fields/disclaimer_html_field.scss',
        ],
        'point_of_sale._assets_pos': [
            # Classic script (no import/export) so it runs at bundle load,
            # before phone_country.js's module body reads window.SpaValidate.
            # Same file the public booking page loads - one set of rules.
            'spa_online_booking/static/booking/spa_validation.js',
            'spa_online_booking/static/src/pos/phone_country.js',
            # The country picker itself, as one component instead of the copy
            # every screen used to carry. Listed before its users.
            'spa_online_booking/static/src/pos/phone_field.js',
            'spa_online_booking/static/src/pos/phone_field.xml',
            'spa_online_booking/static/src/pos/send_link_dialog.js',
            'spa_online_booking/static/src/pos/send_link_dialog.xml',
            'spa_online_booking/static/src/pos/set_slot_dialog.js',
            'spa_online_booking/static/src/pos/set_slot_dialog.xml',
            # Who performed each session. Listed before ticket_tabs.js, which
            # imports the dialog.
            'spa_online_booking/static/src/pos/spa_assign_dialog.js',
            'spa_online_booking/static/src/pos/spa_assign_dialog.xml',
            # One shared copy of "who may assign / is it mandatory / who is
            # assignable". Listed FIRST: the payment gate, the Orders screen
            # and the Redeem dialog all call into it.
            'spa_online_booking/static/src/pos/pos_store_assign.js',
            # The "Assignee mandatory" gate on Validate. After the dialog it
            # opens and after the store it reads.
            'spa_online_booking/static/src/pos/payment_assign.js',
            # Settings > Spa Invoicing: tick Invoice on every new order.
            'spa_online_booking/static/src/pos/auto_invoice.js',
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
