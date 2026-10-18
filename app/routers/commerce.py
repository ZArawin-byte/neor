"""Catalog, simulated Visa-only checkout and orders. Owner: core lane.

The flow judges see: a wardrobe gap -> an entry in the bag -> checkout with a Visa test card ->
the piece arrives in the closet, and wearing it lowers its cost per wear.
"""
import datetime as dt

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from .. import config, store
from ..budget import budget_left, spent_this_month
from ..deps import current_user
from ..payments import PaymentDeclined, provider
from ..seed import CATALOG, CATALOG_BY_ID

router = APIRouter()


@router.get("/api/catalog")
def catalog():
    return CATALOG


class Card(BaseModel):
    number: str = Field(max_length=30)
    exp: str = Field(max_length=7)  # MM/YY
    cvc: str = Field(max_length=4)
    name: str = Field(default="", max_length=100)


class CheckoutReq(BaseModel):
    product_ids: list[str] = Field(default_factory=list, max_length=30)
    bag_ids: list[str] = Field(default_factory=list, max_length=30)
    card: Card
    confirm_over_budget: bool = False


@router.post("/api/checkout")
def checkout(req: CheckoutReq, uid: str = Depends(current_user),
             idempotency_key: str | None = Header(default=None, max_length=100)):
    # A double-click or a retry after a dropped connection must not buy things twice.
    if idempotency_key and (previous := store.find_order(uid, idempotency_key)):
        return previous

    bag_entries = []
    for entry_id in req.bag_ids:
        entry = store.get_bag_entry(uid, entry_id)
        if not entry:
            raise HTTPException(404, "That bag entry isn't yours or no longer exists")
        if not entry.get("catalog_id"):
            raise HTTPException(400, f"\"{entry.get('title', 'That entry')}\" is an idea, not a product you can buy yet")
        bag_entries.append(entry)

    ids = [*req.product_ids, *(e["catalog_id"] for e in bag_entries)]
    products = [CATALOG_BY_ID[p] for p in ids if p in CATALOG_BY_ID]
    if not products:
        raise HTTPException(400, "Your bag is empty")

    total = round(sum(p["price"] for p in products), 2)
    profile = store.get_profile(uid)
    left = budget_left(uid, profile)
    if left is not None and total > left and not req.confirm_over_budget:
        raise HTTPException(409, f"This is ${total - left:.2f} over the budget you set. Confirm if you still want it.")

    try:
        charge = provider.charge(req.card.number, req.card.exp, req.card.cvc, total)
    except PaymentDeclined as e:
        raise HTTPException(e.status, e.message)

    order = {
        "created": dt.datetime.now().isoformat(timespec="seconds"),
        "items": [{"id": p["id"], "name": p["name"], "price": p["price"], "brand": p["brand"]} for p in products],
        "total": total,
        "card": charge.as_dict(),
        "status": "confirmed",
        "payment_mode": config.PAYMENT_MODE,
        "notice": "Simulated checkout: no money moved and no real order was placed.",
        "points_earned": int(total),
        "bag_ids": [e["id"] for e in bag_entries],
        "idempotency_key": idempotency_key,
    }
    saved = store.add_order(uid, order)
    store.save_profile(uid, {"points": profile.get("points", 0) + int(total)})
    for e in bag_entries:
        store.update_bag_entry(uid, e["id"], {"status": "bought"})

    # Post-purchase: the piece walks straight into the closet, marked as arriving.
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
    bought = [i for i in store.list_items(uid) if i.get("catalog_id") and i.get("price")]
    return {
        "orders": store.list_orders(uid),
        "budget": profile.get("budget"),
        "spent_this_month": spent_this_month(uid),
        "points": profile.get("points", 0),
        # "Buy less, better": what each bought piece has cost per wear so far.
        "cost_per_wear": [
            {"item_id": i["id"], "name": i["name"], "price": i["price"], "wear_count": i.get("wear_count", 0),
             "cost_per_wear": round(i["price"] / max(int(i.get("wear_count") or 0), 1), 2)}
            for i in bought
        ],
    }
