def migrate(cr, version):
    """Default the new per-POS channel-tab toggles to ON for existing configs,
    so upgrading doesn't suddenly hide the Online/Web/Tab tabs (a NULL column
    would read as false)."""
    if not version:
        return
    cr.execute("UPDATE pos_config SET spa_show_online = TRUE WHERE spa_show_online IS NULL")
    cr.execute("UPDATE pos_config SET spa_show_web = TRUE WHERE spa_show_web IS NULL")
    cr.execute("UPDATE pos_config SET spa_show_tab = TRUE WHERE spa_show_tab IS NULL")
