{
    'name': 'POS Spa Header',
    'version': '19.0.1.3.0',
    'category': 'Point of Sale',
    'summary': 'Customize the POS top bar: Orders / Customers / Services, no order tabs',
    'author': 'Danat',
    # spa_kiosk owns the `spa.question` model (navbar.js) and the
    # product.template.get_pos_spa_questions() method (spa_questions.js)
    # that this module's JS calls.
    'depends': ['point_of_sale', 'spa_kiosk'],
    'assets': {
        'point_of_sale._assets_pos': [
            'pos_spa_header/static/src/navbar.js',
            'pos_spa_header/static/src/navbar_patch.xml',
            'pos_spa_header/static/src/spa_questions_dialog.js',
            'pos_spa_header/static/src/spa_questions_dialog.xml',
            'pos_spa_header/static/src/spa_questions.js',
            'pos_spa_header/static/src/partner_list.js',
            'pos_spa_header/static/src/order_line_stepper.js',
            'pos_spa_header/static/src/order_line_stepper.xml',
            'pos_spa_header/static/src/order_line_stepper.scss',
        ],
    },
    'installable': True,
    'application': False,
    'license': 'LGPL-3',
}
