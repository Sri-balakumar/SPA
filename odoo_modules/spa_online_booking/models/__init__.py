# Plain helpers, no model - imported by the models below and by the
# controllers, so the date-of-birth rule is written once.
from . import date_of_birth
# First: every member-type field points at this model.
from . import member_type
from . import booking_session
from . import booking_fields
# After booking_fields: the member model reads spa_member_type off spa.booking.
from . import booking_member
from . import res_config_settings
from . import pos_booking
from . import pos_order
from . import account_move
from . import service_signature
from . import pos_config
from . import spa_product_detail
from . import package_price
from . import product_template
from . import pos_category_therapy
from . import session_pass
# After session_pass and service_signature: extends spa.session.pass.use and
# pos.order.line, and pos_booking imports spa_can_assign from it lazily.
from . import spa_assignee
from . import res_partner
from . import pos_sales_report
# The POS needs to know whether a company logo is actually set;
# /web/image answers 200 with a placeholder when it is not.
from . import res_company
