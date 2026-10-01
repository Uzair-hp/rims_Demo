"""
Ruchita Interiors — development and production entry point.

Run with `python run.py` from the backend directory, or from the repository root
with `npm run dev` (which uses scripts/run-backend.mjs to pick an interpreter).
"""

import os

from app import create_app

app = create_app()


def main() -> None:
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "5000"))
    debug = app.config["DEBUG"]

    # The Werkzeug debugger is a remote code execution surface: it evaluates
    # arbitrary Python from the browser, and it is reachable by anyone who can
    # reach the port. `FLASK_DEBUG` defaults to on whenever `FLASK_ENV` is unset,
    # which includes a container that simply forgot to set it — so the debug
    # default is not a safety property and is not relied on here.
    if debug and app.config["IS_PRODUCTION"]:
        raise RuntimeError(
            "Refusing to start with debug=True in production: the Werkzeug "
            "debugger allows remote code execution. Set FLASK_DEBUG=false, or "
            "FLASK_ENV to something other than 'production' for local work."
        )

    print(f"Ruchita Interiors API on http://{host}:{port}  (debug={debug})")
    app.run(host=host, port=port, debug=debug)


if __name__ == "__main__":
    main()
