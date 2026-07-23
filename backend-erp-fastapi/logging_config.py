"""JSON logging to stdout, picked up by Docker's log driver.

Stdlib `logging` rather than `structlog` — the app has zero logging calls
today, so this establishes one paradigm rather than two. `python-json-logger`
gives structured, greppable/aggregatable output without hand-rolling a
formatter.
"""

from __future__ import annotations

import logging
import sys

from pythonjsonlogger.json import JsonFormatter

REQUEST_LOGGER_NAME = "scas.request"


def setup_logging(level: int = logging.INFO) -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        JsonFormatter(
            "%(asctime)s %(levelname)s %(name)s %(message)s",
            rename_fields={"asctime": "time", "levelname": "level", "name": "logger"},
        )
    )

    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)

    # uvicorn's own loggers otherwise attach a second, plain-text handler.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access", "gunicorn.error"):
        logger = logging.getLogger(name)
        logger.handlers = []
        logger.propagate = True


request_logger = logging.getLogger(REQUEST_LOGGER_NAME)
