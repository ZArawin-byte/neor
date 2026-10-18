"""Simulated, Visa-only payments.

The DubHacks organisers confirmed no Visa API is required, so no money ever moves. To stay honest:
  * only published Visa *test* card numbers are accepted, so a real card number is refused and
    never travels further than this function;
  * every order is labelled payment_mode="simulated";
  * nothing about the card is logged or stored except the network, the last 4 digits and a
    simulated token (the way Visa Token Service replaces the card number).
Swapping in a real provider later (e.g. Visa Acceptance sandbox) means writing another class
with the same charge() method.
"""
import datetime as dt
import secrets
from dataclasses import dataclass

VISA_TEST_CARDS = {"4242424242424242", "4111111111111111", "4000056655665556"}
# Well-known test numbers for other networks, so we can say "Visa only" instead of "invalid".
OTHER_NETWORK_TEST_CARDS = {"5555555555554444", "2223003122003222", "378282282246310", "6011111111111117"}


class PaymentDeclined(Exception):
    def __init__(self, message: str, status: int = 402):
        super().__init__(message)
        self.message = message
        self.status = status


@dataclass
class Charge:
    network: str
    last4: str
    token: str

    def as_dict(self) -> dict:
        return {"network": self.network, "last4": self.last4, "token": self.token}


class SimulatedVisaProvider:
    mode = "simulated"

    def charge(self, number: str, exp: str, cvc: str, amount: float) -> Charge:
        digits = "".join(c for c in number if c.isdigit())
        if digits in OTHER_NETWORK_TEST_CARDS:
            raise PaymentDeclined("neor accepts Visa only")
        if digits not in VISA_TEST_CARDS:
            raise PaymentDeclined("Simulated checkout: use a Visa test card (4242 4242 4242 4242)")
        try:
            mm, yy = exp.strip().split("/")
            expiry = dt.date(2000 + int(yy), int(mm), 1)
        except (ValueError, TypeError):
            raise PaymentDeclined("Expiry must be MM/YY")
        if expiry < dt.date.today().replace(day=1):
            raise PaymentDeclined("This card has expired")
        if not (cvc.isdigit() and len(cvc) == 3):
            raise PaymentDeclined("CVV should be 3 digits")
        if amount <= 0:
            raise PaymentDeclined("Nothing to pay for", status=400)
        return Charge(network="visa", last4=digits[-4:], token="vtok_sim_" + secrets.token_hex(8))


provider = SimulatedVisaProvider()
