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
# Stand-in for spa_kiosk, which does not yet own the disclaimer fields. MUST be
# imported before pos_category_therapy: that module's _spa_disclaimer_payload()
# calls super(), and the base it reaches is the one declared here. Delete this
# line together with disclaimer_base.py when spa_kiosk supplies them.
from . import disclaimer_base
from . import pos_category_therapy
from . import session_pass
from . import res_partner
from . import pos_sales_report
