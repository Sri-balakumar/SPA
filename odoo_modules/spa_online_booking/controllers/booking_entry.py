import re

from odoo import http
from odoo.http import request
from odoo.addons.web.controllers.home import Home
from odoo.addons.web.controllers.utils import ensure_db

# The path the customer's booking link points at. It has to live under a route
# that Odoo serves BEFORE a database is chosen - see the class docstring.
SPA_BOOK_ENTRY = 'spa-book'

# Tokens are uuid4().hex (32 hex chars). Older rows may differ in length, so
# accept a range - but nothing that is not plain hex.
_TOKEN_RE = re.compile(r'^[0-9a-fA-F]{16,64}$')


class SpaBookingEntry(Home):
    """Doorway for the customer booking link on a shared, multi-database server.

    `/spa/book` already resolves its own `?db=` through `ensure_db()`, and that
    is enough on a server that lists this module in `server_wide_modules`. On a
    server that does not - a shared box hosting a dozen tenants, where pinning
    `dbfilter` to one database is not an option - the route is invisible: Odoo
    builds its no-database routing map from `server_wide_modules` ONLY, so
    werkzeug answers 404 "No database is selected" before any of our code runs.

    `/odoo/<path:subpath>` IS in that map (auth='none', declared by `web`), and
    the first thing it does is call `ensure_db()`. That binds the session to the
    `?db=` and redirects to the same URL so the request comes back through the
    database's own router - at which point this override exists and can hand the
    customer on to the booking page.

    Net effect: three invisible redirects, no login screen, no auth, and nothing
    to configure on the server. The old `/spa/book?token=..&db=..` form keeps
    working wherever it already did, so links already sent stay valid.
    """

    @http.route()
    def web_client(self, s_action=None, **kw):
        if kw.get('subpath') != SPA_BOOK_ENTRY:
            return super().web_client(s_action=s_action, **kw)

        # Bind the session to ?db= before doing anything else. On a server that
        # does NOT carry this module server-wide the stock handler has already
        # done this and the call is a no-op; on one that DOES, we are the first
        # code to run and skipping it would leave the session with no database -
        # which is how the customer ended up looking at a login form.
        # The first time round this aborts with a 302 to the same URL.
        ensure_db()
        if not request.db:
            # Unknown or filtered-out database: say nothing about why.
            return request.not_found()

        # This is a redirect on an auth-less route, so the target is built here
        # and never echoed from the caller: the only thing taken from the URL is
        # the token, and only once it looks like a token.
        token = (kw.get('token') or '').strip()
        if not _TOKEN_RE.match(token):
            return request.not_found()
        return request.redirect('/spa/book?token=%s' % token, code=303)
