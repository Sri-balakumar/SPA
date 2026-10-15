"""Re-file the groups under their app after the security data changed.

The privilege record used to be declared in the security XML. It is created in
Python now, so that this module installs on Odoo 19 builds both before and
after `res.groups.privilege` existed - see _link_groups_to_app().

On a database that already had the old shape the XML-declared privilege is
removed when this module updates (its external id is gone from the data files),
which would leave the groups filed under nothing. This puts them back, using
whichever mechanism the running build has.
"""

from odoo import SUPERUSER_ID, api

from odoo.addons.spa_kiosk import _link_groups_to_app


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    _link_groups_to_app(
        env, 'spa_kiosk',
        category_xmlid='module_category_spa',
        privilege_xmlid='privilege_spa',
        privilege_name='Spa',
        group_xmlids=('group_spa_receptionist', 'group_spa_manager'),
        sequence=25,
    )
