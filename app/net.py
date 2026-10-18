"""Fetching URLs that users paste in (shop links, calendar links) without letting them reach
our own network: only public http(s) hosts, checked again on every redirect hop."""
import ipaddress
import socket
from urllib.parse import urljoin, urlparse

import httpx
from fastapi import HTTPException


def is_public(url: str) -> bool:
    parts = urlparse(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return False
    try:
        addrs = {info[4][0] for info in socket.getaddrinfo(parts.hostname, None)}
    except socket.gaierror:
        return False
    return all(ipaddress.ip_address(a.split("%")[0]).is_global for a in addrs)


async def fetch_public(http: httpx.AsyncClient, url: str) -> httpx.Response:
    # Follow redirects by hand so every hop gets the same public-host check.
    for _ in range(5):
        if not is_public(url):
            raise HTTPException(400, "That link doesn't point to a public web page")
        res = await http.get(url)
        if res.is_redirect and "location" in res.headers:
            url = urljoin(url, res.headers["location"])
            continue
        return res
    raise HTTPException(400, "That link redirects too many times")
