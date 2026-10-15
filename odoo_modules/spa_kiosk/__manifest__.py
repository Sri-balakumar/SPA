{
    'name': 'Spa Kiosk',
    'version': '19.0.2.4.0',
    'category': 'Services',
    'summary': 'Spa self-service kiosk with per-service questions',
    'description': 'Walk-in kiosk: select a service, enter details, answer service-specific questions, choose payment mode, submit for receptionist approval.',
    'author': 'Danat',
    # 'account' for account.tax._check_company_domain()/compute_all() in
    # controllers/main.py - previously satisfied only transitively.
    'depends': ['base', 'mail', 'product', 'account', 'point_of_sale',
                'phone_validation'],
    'post_init_hook': '_post_init_hook',
    'data': [
        'security/spa_security.xml',
        'security/ir.model.access.csv',
        'data/spa_sequence.xml',
        'views/spa_service_views.xml',
        'views/product_template_views.xml',
        'views/spa_booking_views.xml',
        'views/res_partner_views.xml',
        'views/spa_menus.xml',
        'views/kiosk_templates.xml',
    ],
    'application': True,
    'license': 'LGPL-3',
}
