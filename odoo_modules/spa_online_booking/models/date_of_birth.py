"""What counts as a usable date of birth, in one place.

The browser has the same rule in static/booking/spa_validation.js, which both
the booking page and the POS validate with. This is the server's copy of it -
the one that holds when the request did not come from either of those: the
tablet API, an import, a shell session, or a POS screen writing through the ORM.
"""
from dateutil.relativedelta import relativedelta

from odoo import _
from odoo.exceptions import ValidationError

# Nobody booking a massage was born in 1823 - a year that far back is a typo,
# and a date in the future is always one. Matches MAX_AGE in spa_validation.js.
MAX_AGE = 120


def date_of_birth_error(value, env):
    """Return a short reason a date of birth is unusable, or None.

    'future' / 'too_old' - the same codes the controllers hand back to the
    browser, so one wording table covers both.
    """
    if not value:
        return None
    # The company's day - not date.today(), and not the reader's: a spa in
    # Muscat is four hours ahead of the server's UTC, and for those four hours a
    # birthday entered today would otherwise read as tomorrow.
    today = env.company._spa_today()
    if value > today:
        return 'future'
    if relativedelta(today, value).years >= MAX_AGE:
        return 'too_old'
    return None


def check_date_of_birth(value, env):
    """Raise ValidationError if `value` is not a usable date of birth."""
    reason = date_of_birth_error(value, env)
    if reason == 'future':
        raise ValidationError(_("The date of birth cannot be in the future."))
    if reason == 'too_old':
        raise ValidationError(
            _("Please check the year of birth - that is over %s years ago.",
              MAX_AGE))
