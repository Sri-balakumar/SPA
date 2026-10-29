{
    'name': 'Service Tracker',
    'version': '19.0.1.4.0',
    'summary': 'Sessions by assignee: who gave which service, and how many finished',
    'category': 'Services',
    # spa_online_booking owns the assignee fields this reports on
    # (pos.order.line.spa_therapist_id, spa.booking.spa_therapist_id,
    # spa.session.pass.use.spa_therapist_id) and, through spa_kiosk, the
    # groups used below. Nothing here is useful without it.
    'depends': ['spa_online_booking', 'calendar'],
    'data': [
        'security/ir.model.access.csv',
        'views/service_session_views.xml',
        'views/session_pass_tracker_views.xml',
    ],
    'installable': True,
    'application': False,
    'author': 'Danat',
    'license': 'LGPL-3',
}
