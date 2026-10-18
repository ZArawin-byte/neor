"""Catalog, simulated Visa checkout and orders. Owner: core lane."""
import datetime as dt
import secrets

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import store
from ..budget import budget_left, spent_this_month
from ..deps import current_user
from ..seed import CATALOG, CATALOG_BY_ID

router = APIRouter()


@router.get("/api/catalog")
def catalog():
    return CATALOG


def _luhn(num: str) -> bool:
    total = 0
    for i, d in enumerate(reversed(num)):
        n = int(d)
        if i % 2:
            n = n * 2 - 9 if n > 4 else n * 2
        total += n
    return total % 10 == 0


class Card(BaseModel):
    number: str
    exp: str  # MM/YY
    cvc: str
    name: str


class CheckoutReq(BaseModel):
    product_ids: list[str]
    card: Card
    confirm_over_budget: bool = False


@router.post("/api/checkout")
def checkout(req: CheckoutReq, uid: str = Depends(current_user)):
    products = [CATALOG_BY_ID[p] for p in req.product_ids if p in CATALOG_BY_ID]
    if not products:
        raise HTTPException(400, "Your bag is empty")

    number = "".join(c for c in req.card.number if c.isdigit())
    if not number.startswith("4") or len(number) not in (13, 16, 19) or not _luhn(number):
        raise HTTPException(402, "Neor accepts Visa only - please check your Visa card number")
    try:
        mm, yy = req.card.exp.split("/")
        exp = dt.date(2000 + int(yy), int(mm), 1)
    except Exception:
        raise HTTPException(402, "Expiry must be MM/YY")
    if exp < dt.date.today().replace(day=1):
        raise HTTPException(402, "This card has expired")
    if not (req.card.cvc.isdigit() and len(req.card.cvc) == 3):
        raise HTTPException(402, "CVV should be 3 digits")

    total = round(sum(p["price"] for p in products), 2)
    profile = store.get_profile(uid)
    left = budget_left(uid, profile)
    if left is not None and total > left and not req.confirm_over_budget:
        raise HTTPException(409, f"This is ${total - left:.2f} over the budget you set. Confirm if you still want it.")

    # The full card number is never stored or logged: we keep only last4 and a
    # simulated network token, the way Visa Token Service replaces the PAN.
    order = {
        "created": dt.datetime.now().isoformat(timespec="seconds"),
        "items": [{"id": p["id"], "name": p["name"], "price": p["price"], "brand": p["brand"]} for p in products],
        "total": total,
        "card": {"network": "visa", "last4": number[-4:], "token": "vtok_" + secrets.token_hex(8)},
        "status": "confirmed",
        "points_earned": int(total),
    }
    saved = store.add_order(uid, order)
    store.save_profile(uid, {"points": profile.get("points", 0) + int(total)})

    # Post-purchase: the item walks straight into your closet, care guide attached.
    for p in products:
        store.add_item(uid, {
            "name": p["name"], "category": p["category"], "color": p["color"], "hex": p["hex"],
            "material": p["material"], "styles": p["styles"], "seasons": p["seasons"],
            "occasions": p["occasions"], "brand": p["brand"], "price": p["price"], "tier": p["tier"],
            "catalog_id": p["id"], "status": "arriving",
        })
    return saved


@router.get("/api/orders")
def orders(uid: str = Depends(current_user)):
    profile = store.get_profile(uid)
    return {"orders": store.list_orders(uid), "budget": profile.get("budget"),
            "spent_this_month": spent_this_month(uid), "points": profile.get("points", 0)}
