"""Monthly budget maths, used by checkout and the shopping chat."""
import datetime as dt

from . import store


def spent_this_month(uid: str) -> float:
    month = dt.date.today().strftime("%Y-%m")
    return sum(o.get("total", 0) for o in store.list_orders(uid) if o.get("created", "").startswith(month))


def budget_left(uid: str, profile: dict) -> float | None:
    budget = profile.get("budget")
    if not budget:
        return None
    return round(float(budget) - spent_this_month(uid), 2)
