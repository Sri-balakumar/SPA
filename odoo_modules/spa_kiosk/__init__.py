from . import models
from . import controllers



def _link_groups_to_app(env, module, category_xmlid, privilege_xmlid,
                        privilege_name, group_xmlids, sequence=10):
    """File this module's groups under its app, whichever shape the build uses.

    Odoo 19 changed how a group is grouped. Newer builds put a
    `res.groups.privilege` record between the group and `ir.module.category`
    and give `res.groups` a `privilege_id`; earlier ones hang `category_id`
    straight on the group and have no privilege model at all.

    Declaring either shape in the security XML makes the module installable on
    one kind of build and broken on the other: the data file fails, the groups
    are never created, and then every ACL row naming one dies with "No matching
    record found for external id" - which is a confusing way to be told the
    server is a different Odoo 19 than the module was written on.

    So the XML now creates only what every build agrees on - the category and
    the groups themselves - and the linking happens here, against whatever the
    running build actually has. A build with neither field simply keeps the
    groups ungrouped, which costs a little tidiness in the user form and
    nothing else.
    """
    Groups = env['res.groups']
    groups = Groups.browse()
    for xmlid in group_xmlids:
        record = env.ref('%s.%s' % (module, xmlid), raise_if_not_found=False)
        if record:
            groups |= record
    if not groups:
        return
    category = env.ref('%s.%s' % (module, category_xmlid),
                       raise_if_not_found=False)

    if 'privilege_id' in Groups._fields and 'res.groups.privilege' in env:
        privilege = env.ref('%s.%s' % (module, privilege_xmlid),
                            raise_if_not_found=False)
        if privilege:
            # A row left over from when this record was declared in XML. Its
            # external id is in no data file any more, so `_process_end` would
            # delete it at the very end of this same upgrade - after this code
            # has already pointed the groups at it - and they would be back to
            # filed under nothing. Marking it noupdate is what spares it.
            env['ir.model.data'].sudo().search([
                ('module', '=', module),
                ('name', '=', privilege_xmlid),
                ('model', '=', 'res.groups.privilege'),
            ]).write({'noupdate': True})
        else:
            privilege = env['res.groups.privilege'].create({
                'name': privilege_name,
                'sequence': sequence,
                'category_id': category.id if category else False,
            })
            # Registered with an external id so a later run finds it instead of
            # making a second one, and noupdate so it is never a candidate for
            # removal when the module's data files change.
            env['ir.model.data'].create({
                'module': module,
                'name': privilege_xmlid,
                'model': 'res.groups.privilege',
                'res_id': privilege.id,
                'noupdate': True,
            })
        groups.write({'privilege_id': privilege.id})
    elif 'category_id' in Groups._fields and category:
        groups.write({'category_id': category.id})


def _post_init_hook(env):
    _link_groups_to_app(
        env, 'spa_kiosk',
        category_xmlid='module_category_spa',
        privilege_xmlid='privilege_spa',
        privilege_name='Spa',
        group_xmlids=('group_spa_receptionist', 'group_spa_manager'),
        sequence=25,
    )
