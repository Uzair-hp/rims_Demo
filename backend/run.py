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

    print(f"Ruchita Interiors API on http://{host}:{port}  (debug={debug})")
    app.run(host=host, port=port, debug=debug)


if __name__ == "__main__":
    main()
